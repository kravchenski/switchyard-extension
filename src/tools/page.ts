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
    description: 'Read the page as an accessibility-style outline with refs like ref_12 for actions. Mode "interactive" (default) lists controls and landmarks; "all" includes text. Use only when the previous tool result does not already contain the page information you need; opening, navigating, clicking and scrolling return fresh outlines. Reuse refs from results and stale-ref errors.',
    inputSchema: {
        type: 'object',
        properties: {
            tabId,
            mode: { type: 'string', enum: ['interactive', 'all'], description: 'interactive (default) lists controls; all also includes text.' },
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
    description: 'Find visible controls by label, text, placeholder, aria-label, id or name. Returns refs to use with click and type. Use this when you know the label you want and do not need a full page outline; use get_page_text for article body text.',
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
    description: 'Get the visible text of the page, for reading articles and results. No element refs — use read_page or find when you need to click or type.',
    inputSchema: { type: 'object', properties: { tabId, maxChars } },
    async run(args, context) {
        const tab = await workTab(args.tabId as number | undefined, context);
        const page = await runInTab(tab, pageText, (args.maxChars as number | undefined) ?? 30_000);
        return text(`${header(page, tab.id)}\n\n${page.text}${page.truncated ? '\n\n[truncated]' : ''}`);
    },
};

export const PAGE_TOOLS = [readPage, find, getPageText];
