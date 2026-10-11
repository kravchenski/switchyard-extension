import { ToolError, type ToolContext } from '../tools/registry.ts';
import { originOf } from './session.ts';

const STORAGE_KEY = 'approvedOrigins';

async function approvedOrigins() {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    return (stored[STORAGE_KEY] as string[] | undefined) ?? [];
}

/** Asks once per browser session before the agent clicks or types on a site. */
export async function ensureSiteAllowed(tab: chrome.tabs.Tab, tool: string, summary: string, context: ToolContext) {
    const origin = originOf(tab.url);
    if (!origin) throw new ToolError('This tab has no url to act on');
    const approved = await approvedOrigins();
    if (approved.includes(origin)) return;
    const ok = await context.confirm({ tool, summary: `${summary} on ${origin}. Allow Switchyard to act on this site?`, origin });
    if (!ok) throw new ToolError(`The user did not allow acting on ${origin}`);
    await chrome.storage.session.set({ [STORAGE_KEY]: [...approved, origin] });
}
