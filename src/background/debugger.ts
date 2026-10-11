import { ToolError } from '../tools/registry.ts';

const PROTOCOL_VERSION = '1.3';
const IDLE_DETACH_MS = 30_000;

const attached = new Set<number>();
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>();

chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId !== undefined) forget(source.tabId);
});

chrome.tabs.onRemoved.addListener(forget);

function forget(tabId: number) {
    attached.delete(tabId);
    clearTimeout(idleTimers.get(tabId));
    idleTimers.delete(tabId);
}

async function attach(tabId: number) {
    if (attached.has(tabId)) return;
    try {
        await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // After a service worker restart our own session can still be attached.
        if (!message.includes('already attached')) throw new ToolError(`Cannot control this tab: ${message}`);
        await chrome.debugger.detach({ tabId }).catch(() => {});
        try {
            await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
        } catch {
            throw new ToolError('Another debugger (DevTools?) is attached to this tab. Close it and try again.');
        }
    }
    attached.add(tabId);
}

function scheduleDetach(tabId: number) {
    clearTimeout(idleTimers.get(tabId));
    idleTimers.set(tabId, setTimeout(() => {
        idleTimers.delete(tabId);
        if (!attached.has(tabId)) return;
        attached.delete(tabId);
        chrome.debugger.detach({ tabId }).catch(() => {});
    }, IDLE_DETACH_MS));
}

/** Sends a Chrome DevTools Protocol command, attaching to the tab on first use and detaching when idle. */
export async function cdp<T = unknown>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T> {
    await attach(tabId);
    scheduleDetach(tabId);
    return await chrome.debugger.sendCommand({ tabId }, method, params) as T;
}
