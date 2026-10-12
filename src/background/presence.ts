import { hideOverlay, moveCursor, setOverlayVisible, showOverlay } from '../content/overlay.ts';
import type { ToolContext } from '../tools/registry.ts';
import { isScriptable } from './session.ts';

type Tab = chrome.tabs.Tab & { id: number };

// A coding agent has no "done" signal, so its frame goes away after this much quiet.
const BRIDGE_IDLE_MS = 15_000;

let shownTabId: number | undefined;
let shownSource: ToolContext['source'] = 'panel';
let panelRunning = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

async function inject<Args extends unknown[]>(tabId: number, func: (...args: Args) => unknown, ...args: Args) {
    try {
        await chrome.scripting.executeScript({ target: { tabId }, func, args });
    } catch {
        // The page may be gone, navigating, or not scriptable; the overlay is cosmetic.
    }
}

function show(tabId: number) {
    const label = shownSource === 'panel' ? 'Switchyard is working in this tab' : 'A coding agent is using this tab through Switchyard';
    return inject(tabId, showOverlay, label, shownSource === 'panel');
}

/** Marks the tab an agent is acting in with a frame and status bar, moving them when the agent switches tabs. */
export async function markActive(tab: Tab, source: ToolContext['source']) {
    clearTimeout(idleTimer);
    if (source === 'bridge' && !panelRunning) idleTimer = setTimeout(endPresence, BRIDGE_IDLE_MS);
    if (!isScriptable(tab.url)) return;
    if (shownTabId !== undefined && shownTabId !== tab.id) void inject(shownTabId, hideOverlay);
    shownTabId = tab.id;
    shownSource = panelRunning ? 'panel' : source;
    await show(tab.id);
}

export function endPresence() {
    clearTimeout(idleTimer);
    if (shownTabId !== undefined) void inject(shownTabId, hideOverlay);
    shownTabId = undefined;
}

export function setPanelRunning(running: boolean) {
    panelRunning = running;
    if (!running) endPresence();
}

/** Glides the visible cursor to a point before a real mouse event is sent there. */
export async function pointAt(tab: Tab, point: { x: number; y: number }, press: boolean) {
    if (tab.id !== shownTabId) return;
    await inject(tab.id, moveCursor, point.x, point.y, press);
}

/** Runs a capture with the overlay hidden. */
export async function withoutOverlay<T>(tab: Tab, capture: () => Promise<T>) {
    if (tab.id !== shownTabId) return capture();
    await inject(tab.id, setOverlayVisible, false);
    try {
        return await capture();
    } finally {
        await inject(tab.id, setOverlayVisible, true);
    }
}

/** Called once by the service worker: a navigation wipes the overlay, so it is drawn again on load. */
export function watchTabs() {
    chrome.tabs.onUpdated.addListener((tabId, info) => {
        if (tabId === shownTabId && info.status === 'complete') void show(tabId);
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
        if (tabId === shownTabId) shownTabId = undefined;
    });
}
