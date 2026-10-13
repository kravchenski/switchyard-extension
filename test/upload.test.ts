import { afterEach, beforeEach, expect, test } from 'bun:test';
import { addAttachments, clearAttachments } from '../src/background/attachments.ts';
import { endPresence } from '../src/background/presence.ts';
import { uploadToRef } from '../src/content/upload.ts';
import { snapshotPage } from '../src/content/snapshot.ts';
import { uploadFile } from '../src/tools/files.ts';
import { ToolRegistry, type ToolContext, type ToolResult } from '../src/tools/registry.ts';

const originalChrome = globalThis.chrome;
const tab = { id: 72, windowId: 1, groupId: 1, url: 'https://example.com/apply' } as chrome.tabs.Tab & { id: number };
const detachListeners = new Set<(source: { tabId: number }) => void>();
const registry = new ToolRegistry().register(uploadFile);
const context: ToolContext = { source: 'bridge', confirm: async () => true };
let commands: { method: string; params: unknown }[];
let injections: unknown[];
let approved: boolean;
let targetExists: boolean;
let debuggerTargetExists: boolean;

beforeEach(() => {
    commands = [];
    injections = [];
    approved = false;
    targetExists = true;
    debuggerTargetExists = true;
    clearAttachments();
    const event = { addListener() {}, removeListener() {} };
    globalThis.chrome = {
        tabGroups: { TAB_GROUP_ID_NONE: -1 },
        tabs: { get: async () => tab, onRemoved: event },
        storage: {
            local: { get: async () => ({ settings: { askBeforeActing: true } }) },
            session: {
                get: async () => ({ session: { currentTabId: tab.id }, approvedOrigins: approved ? ['https://example.com'] : [] }),
                set: async (values: Record<string, unknown>) => { if (values.approvedOrigins) approved = true; },
            },
        },
        scripting: {
            executeScript: async ({ func, args }: { func: unknown; args: unknown[] }) => {
                if (func === uploadToRef) {
                    injections.push(args);
                    if (!targetExists) return [{ result: { ok: false, error: 'No file input near ref_1' } }];
                    return [{ result: 'prepare' in (args[1] as object) ? { ok: true, inputRef: 'ref_2' } : { ok: true, via: 'input' } }];
                }
                if (func === snapshotPage) return [{ result: { text: 'Resume uploaded', truncated: false } }];
                return [{ result: undefined }];
            },
        },
        debugger: {
            attach: async () => {}, detach: async () => {},
            onDetach: { addListener: (listener: (source: { tabId: number }) => void) => { detachListeners.add(listener); } },
            sendCommand: async (_target: unknown, method: string, params: unknown) => {
                commands.push({ method, params });
                if (method === 'DOM.getDocument') return { root: { backendNodeId: 1, children: [{ backendNodeId: 2, shadowRoots: [{ backendNodeId: 3, children: [{ backendNodeId: 4, attributes: ['data-sy-ref', debuggerTargetExists ? 'ref_2' : 'ref_99', 'type', 'file'] }] }] }] } };
                return {};
            },
        },
    } as unknown as typeof chrome;
});

afterEach(() => {
    for (const listener of detachListeners) listener({ tabId: tab.id });
    endPresence();
    clearAttachments();
    globalThis.chrome = originalChrome;
});

function body(result: ToolResult) {
    const part = result.content[0]!;
    if (part.type !== 'text') throw new Error('Expected text');
    return JSON.parse(part.text);
}

test('uploads an absolute local path through the debugger, including shadow inputs', async () => {
    const result = await registry.call('upload_file', { ref: 'ref_1', filePath: '/tmp/cv.pdf' }, context);
    expect(result.isError).toBeUndefined();
    expect(body(result)).toMatchObject({ uploaded: 'cv.pdf', via: 'input', page: { text: 'Resume uploaded' } });
    expect(injections).toEqual([['ref_1', { prepare: true }]]);
    expect(commands).toEqual([
        { method: 'DOM.getDocument', params: { depth: -1, pierce: true } },
        { method: 'DOM.setFileInputFiles', params: { backendNodeId: 4, files: ['/tmp/cv.pdf'] } },
    ]);
});

test('keeps the attached-file interface compatible', async () => {
    addAttachments([{ name: 'cv.pdf', mimeType: 'application/pdf', size: 5, data: 'JVBERi0=' }]);
    const result = await registry.call('upload_file', { ref: 'ref_1', file: 'cv.pdf', readMode: 'none' }, context);
    expect(result.isError).toBeUndefined();
    expect(body(result)).toEqual({ uploaded: 'cv.pdf', via: 'input' });
    expect(injections).toEqual([['ref_1', { name: 'cv.pdf', mimeType: 'application/pdf', data: 'JVBERi0=' }]]);
    expect(commands).toEqual([]);
});

test('rejects ambiguous sources and non-absolute paths before browser work', async () => {
    for (const args of [{}, { file: 'cv.pdf', filePath: '/tmp/cv.pdf' }, { filePath: 'cv.pdf' }, { filePath: '~/cv.pdf' }, { filePath: '/tmp/cv\0.pdf' }]) {
        expect((await registry.call('upload_file', { ref: 'ref_1', ...args }, context)).isError).toBe(true);
    }
    expect(injections).toEqual([]);
    expect(commands).toEqual([]);
});

test('accepts Windows paths and preserves spaces without shell interpolation', async () => {
    const filePath = 'C:\\Users\\Max\\My CV.pdf';
    const result = await registry.call('upload_file', { ref: 'ref_1', filePath, readMode: 'none' }, context);
    expect(body(result)).toEqual({ uploaded: 'My CV.pdf', via: 'input' });
    expect(commands.at(-1)).toEqual({ method: 'DOM.setFileInputFiles', params: { backendNodeId: 4, files: [filePath] } });
});

test('does not set files when site approval is declined', async () => {
    const result = await registry.call('upload_file', { ref: 'ref_1', filePath: '/tmp/cv.pdf' }, { ...context, confirm: async () => false });
    expect(result.isError).toBe(true);
    expect(injections).toEqual([]);
    expect(commands).toEqual([]);
});

test('reports a missing target without opening a file dialog or setting files', async () => {
    targetExists = false;
    const result = await registry.call('upload_file', { ref: 'ref_1', filePath: '/tmp/cv.pdf' }, context);
    expect(result.isError).toBe(true);
    expect(commands).toEqual([]);
});

test('reports a target removed between preparing and setting files', async () => {
    debuggerTargetExists = false;
    const result = await registry.call('upload_file', { ref: 'ref_1', filePath: '/tmp/cv.pdf' }, context);
    expect(result.isError).toBe(true);
    expect(commands.map(command => command.method)).toEqual(['DOM.getDocument']);
});
