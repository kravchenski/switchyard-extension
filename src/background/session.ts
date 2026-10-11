import { ToolError } from '../tools/registry.ts';

export const SESSION_GROUP_TITLE = 'Switchyard';
const SESSION_GROUP_COLOR = 'purple';
const LOAD_TIMEOUT_MS = 20_000;

interface SessionState {
    groupId?: number;
    currentTabId?: number;
}

async function readState(): Promise<SessionState> {
    const { session } = await chrome.storage.session.get('session');
    return (session as SessionState | undefined) ?? {};
}

async function writeState(patch: SessionState) {
    await chrome.storage.session.set({ session: { ...await readState(), ...patch } });
}

export async function setCurrentTab(tabId: number) {
    await writeState({ currentTabId: tabId });
}

async function existingTab(tabId: number | undefined) {
    if (tabId === undefined) return undefined;
    try {
        return await chrome.tabs.get(tabId);
    } catch {
        return undefined;
    }
}

/** The tab a tool acts on: the explicit tabId, else the tab the agent last worked in, else the active tab. */
export async function resolveTab(tabId?: number): Promise<chrome.tabs.Tab & { id: number }> {
    if (tabId !== undefined) {
        const tab = await existingTab(tabId);
        if (!tab) throw new ToolError(`Tab ${tabId} does not exist`);
        return tab as chrome.tabs.Tab & { id: number };
    }
    const current = await existingTab((await readState()).currentTabId);
    if (current) return current as chrome.tabs.Tab & { id: number };
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active?.id === undefined) throw new ToolError('No active tab');
    return active as chrome.tabs.Tab & { id: number };
}

export async function sessionGroupId() {
    const { groupId } = await readState();
    if (groupId === undefined) return undefined;
    try {
        await chrome.tabGroups.get(groupId);
        return groupId;
    } catch {
        return undefined;
    }
}

/** Puts tabs into the session's "Switchyard" group, creating the group on first use. */
export async function addToSessionGroup(tabIds: number[]) {
    if (!tabIds.length) return undefined;
    const groupId = await sessionGroupId();
    if (groupId !== undefined) {
        const group = await chrome.tabGroups.get(groupId);
        const tab = await chrome.tabs.get(tabIds[0]!);
        if (group.windowId === tab.windowId) {
            await chrome.tabs.group({ groupId, tabIds: tabIds as [number, ...number[]] });
            return groupId;
        }
    }
    const created = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] });
    await chrome.tabGroups.update(created, { title: SESSION_GROUP_TITLE, color: SESSION_GROUP_COLOR });
    await writeState({ groupId: created });
    return created;
}

/** Starts a panel session in the active tab: it becomes current and joins the session group. */
export async function adoptActiveTab() {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active?.id === undefined) return undefined;
    await setCurrentTab(active.id);
    if (active.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && isScriptable(active.url)) {
        await addToSessionGroup([active.id]);
    }
    return active;
}

export function isScriptable(url: string | undefined) {
    return !!url && /^(https?|file):/.test(url);
}

export function originOf(url: string | undefined) {
    try {
        return url ? new URL(url).origin : undefined;
    } catch {
        return undefined;
    }
}

export function waitForLoad(tabId: number, timeoutMs = LOAD_TIMEOUT_MS) {
    return new Promise<void>((resolve) => {
        const done = () => {
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            chrome.tabs.onRemoved.removeListener(removed);
            resolve();
        };
        const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
            if (id === tabId && info.status === 'complete') done();
        };
        const removed = (id: number) => {
            if (id === tabId) done();
        };
        const timer = setTimeout(done, timeoutMs);
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.onRemoved.addListener(removed);
        chrome.tabs.get(tabId).then(tab => {
            if (tab.status === 'complete') done();
        }, done);
    });
}
