import { afterEach, beforeEach, expect, test } from 'bun:test';
import { snapshotPage } from '../src/content/snapshot.ts';
import { endPresence } from '../src/background/presence.ts';
import { observedResult } from '../src/tools/observation.ts';
import { tabCreate, navigate } from '../src/tools/tabs.ts';
import type { ToolContext, ToolResult } from '../src/tools/registry.ts';

const originalChrome = globalThis.chrome;
const context: ToolContext = { source: 'panel', confirm: async () => true };
const tab = { id: 10, windowId: 1, groupId: 1, url: 'https://example.com/', title: 'Example', status: 'complete', active: true } as chrome.tabs.Tab & { id: number };
const page = { url: tab.url, title: tab.title, viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0, pageHeight: 1000 }, text: '[ref_1] link "View profile"\nJob description', truncated: false };
let reads: Record<string, unknown>[];
let failRead: boolean;

beforeEach(() => {
    reads = [];
    failRead = false;
    const event = { addListener() {}, removeListener() {} };
    let session = {};
    globalThis.chrome = {
        tabGroups: { TAB_GROUP_ID_NONE: -1 },
        storage: { session: { get: async () => ({ session }), set: async (value: { session: object }) => { session = value.session; } } },
        tabs: {
            create: async () => tab, get: async () => tab, update: async () => tab,
            onUpdated: event, onRemoved: event,
        },
        scripting: {
            executeScript: async ({ func, args }: { func: unknown; args: Record<string, unknown>[] }) => {
                if (func !== snapshotPage) return [{ result: undefined }];
                reads.push(args[0]!);
                if (failRead) throw new Error('Destination cannot be read');
                return [{ result: page }];
            },
        },
    } as unknown as typeof chrome;
});

afterEach(() => {
    endPresence();
    globalThis.chrome = originalChrome;
});

function body(result: ToolResult) {
    const part = result.content[0]!;
    if (part.type !== 'text') throw new Error('Expected text');
    return JSON.parse(part.text);
}

test('opening a tab includes text and usable refs without a separate read call', async () => {
    const result = await tabCreate.run({ url: tab.url, group: false }, context);
    expect(body(result)).toMatchObject({ tabId: tab.id, page });
    expect(reads).toEqual([{ mode: 'all', maxChars: 30_000, settle: true }]);
});

test('navigation includes the destination outline in the same result', async () => {
    const result = await navigate.run({ tabId: tab.id, url: tab.url }, context);
    expect(body(result)).toMatchObject({ tabId: tab.id, origin: 'https://example.com', page });
    expect(reads).toHaveLength(1);
});

test('an action can return controls only or request text with a custom cap', async () => {
    await observedResult(tab, { clicked: 'button ref_1' }, {}, 'interactive');
    await observedResult(tab, { clicked: 'button ref_1' }, { readMode: 'all', maxChars: 500 }, 'interactive');
    expect(reads).toEqual([
        { mode: 'interactive', maxChars: 30_000, settle: true },
        { mode: 'all', maxChars: 500, settle: true },
    ]);
});

test('readMode=none and restricted tabs skip injection', async () => {
    expect(body(await tabCreate.run({ url: tab.url, group: false, readMode: 'none' }, context))).not.toHaveProperty('page');
    expect(body(await observedResult({ ...tab, url: 'chrome://settings/' }, { tabId: tab.id }, {}))).toEqual({ tabId: tab.id });
    expect(reads).toEqual([]);
});

test('a successful action remains successful if reading its result fails', async () => {
    failRead = true;
    const result = await navigate.run({ tabId: tab.id, url: tab.url }, context);
    expect(result.isError).toBeUndefined();
    expect(body(result)).toMatchObject({ tabId: tab.id, pageError: 'Destination cannot be read' });
});
