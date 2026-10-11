import { ToolError } from '../tools/registry.ts';
import { isScriptable } from './session.ts';

/** Runs a self-contained function in the tab's top frame and returns its result. */
export async function runInTab<Args extends unknown[], Result>(
    tab: chrome.tabs.Tab & { id: number },
    func: (...args: Args) => Result,
    ...args: Args
): Promise<Awaited<Result>> {
    if (!isScriptable(tab.url)) throw new ToolError(`Cannot read or control ${tab.url ?? 'this page'}; only http, https and file pages are supported`);
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
    if (!injection) throw new ToolError('The page did not return a result');
    return injection.result as Awaited<Result>;
}
