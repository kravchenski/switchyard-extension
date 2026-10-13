import { snapshotPage, type SnapshotOptions } from '../content/snapshot.ts';
import { runInTab } from '../background/scripting.ts';
import { isScriptable } from '../background/session.ts';
import { json, type Args, type JsonSchema } from './registry.ts';

type ReadMode = SnapshotOptions['mode'] | 'none';

export const observationProperties = {
    readMode: {
        type: 'string', enum: ['all', 'interactive', 'none'],
        description: 'Include a fresh page outline in this result: all includes text and refs; interactive includes controls; none skips reading. Reuse returned refs without a separate read_page/find.',
    },
    maxChars: { type: 'integer', minimum: 500, maximum: 200_000, description: 'Cap on the included page outline (default 30000).' },
} satisfies Record<string, JsonSchema>;

/** Actions return their new page state so observing it does not need another model/tool round trip. */
export async function observedResult(tab: chrome.tabs.Tab & { id: number }, result: Record<string, unknown>, args: Args, defaultMode: ReadMode = 'all') {
    const mode = (args.readMode as ReadMode | undefined) ?? defaultMode;
    if (mode === 'none' || !isScriptable(tab.url)) return json(result);
    try {
        const page = await runInTab(tab, snapshotPage, { mode, maxChars: (args.maxChars as number | undefined) ?? 30_000, settle: true });
        return json({ ...result, page });
    } catch (error) {
        // The action succeeded even if the destination cannot be read (e.g. a restricted page).
        return json({ ...result, pageError: error instanceof Error ? error.message : String(error) });
    }
}
