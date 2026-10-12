import { pageText, snapshotPage } from '../content/snapshot.ts';
import { runInTab } from '../background/scripting.ts';
import { workTab } from '../background/session.ts';
import { text, type Tool } from './registry.ts';

const tabId = { type: 'integer', description: 'Tab id. Defaults to the tab the agent is working in.' } as const;
const maxChars = { type: 'integer', minimum: 500, maximum: 200_000, description: 'Cap on returned characters (default 30000).' } as const;

function header(snapshot: { url: string; title: string }, tab: number) {
    return `Tab ${tab}: ${snapshot.title}\n${snapshot.url}`;
}

export const readPage: Tool = {
    name: 'read_page',
    description: 'Read the page as an accessibility-style outline. Each element gets a ref like ref_12 that click, type, scroll and hover accept. Mode "interactive" (default) lists only controls and landmarks; "all" also includes text.',
    inputSchema: {
        type: 'object',
        properties: {
            tabId,
            mode: { type: 'string', enum: ['interactive', 'all'] },
            maxChars,
        },
    },
    async run(args, context) {
        const tab = await workTab(args.tabId as number | undefined, context);
        const snapshot = await runInTab(tab, snapshotPage, {
            mode: (args.mode as 'interactive' | 'all' | undefined) ?? 'interactive',
            maxChars: (args.maxChars as number | undefined) ?? 30_000,
        });
        const { width, height, scrollY, pageHeight } = snapshot.viewport;
        return text([
            header(snapshot, tab.id),
            `Viewport ${width}x${height}, scrolled ${scrollY}/${Math.max(0, pageHeight - height)}px`,
            '',
            snapshot.text,
            snapshot.truncated ? '\n[truncated: raise maxChars or use find]' : '',
        ].join('\n').trimEnd());
    },
};

export const find: Tool = {
    name: 'find',
    description: 'Find visible elements whose label, text, placeholder, id or name contains the query. Returns refs to use with click and type.',
    inputSchema: {
        type: 'object',
        properties: {
            tabId,
            query: { type: 'string', description: 'Text to look for, case-insensitive.' },
            limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum matches (default 20).' },
        },
        required: ['query'],
    },
    async run(args, context) {
        const tab = await workTab(args.tabId as number | undefined, context);
        const snapshot = await runInTab(tab, snapshotPage, {
            mode: 'interactive',
            maxChars: 20_000,
            query: args.query as string,
            limit: args.limit as number | undefined,
        });
        return text(`${header(snapshot, tab.id)}\n\n${snapshot.text}`);
    },
};

export const getPageText: Tool = {
    name: 'get_page_text',
    description: 'Get the visible text of the page, for reading articles and results.',
    inputSchema: { type: 'object', properties: { tabId, maxChars } },
    async run(args, context) {
        const tab = await workTab(args.tabId as number | undefined, context);
        const page = await runInTab(tab, pageText, (args.maxChars as number | undefined) ?? 30_000);
        return text(`${header(page, tab.id)}\n\n${page.text}${page.truncated ? '\n\n[truncated]' : ''}`);
    },
};

export const PAGE_TOOLS = [readPage, find, getPageText];
