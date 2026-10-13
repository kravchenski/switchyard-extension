import { markActive } from '../background/presence.ts';
import { addToSessionGroup, originOf, resolveTab, sessionGroupId, setCurrentTab, waitForLoad, workTab } from '../background/session.ts';
import { json, ToolError, type Tool } from './registry.ts';
import { observedResult, observationProperties } from './observation.ts';

const tabId = { type: 'integer', description: 'Tab id from tabs_list. Defaults to the tab the agent is working in.' } as const;

export function describeTab(tab: chrome.tabs.Tab) {
    return {
        tabId: tab.id,
        windowId: tab.windowId,
        title: tab.title,
        url: tab.url,
        active: tab.active,
        groupId: tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE ? undefined : tab.groupId,
        pinned: tab.pinned || undefined,
    };
}

function normalizeUrl(url: string) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
    return `https://${url}`;
}

export const tabsList: Tool = {
    name: 'tabs_list',
    description: 'List browser tabs with their ids, titles, urls and group ids. Scope "session" lists only tabs in the Switchyard group.',
    inputSchema: {
        type: 'object',
        properties: {
            scope: { type: 'string', enum: ['all', 'window', 'session'], description: 'Which tabs to list (default all).' },
        },
    },
    async run(args) {
        const scope = (args.scope as string | undefined) ?? 'all';
        let tabs: chrome.tabs.Tab[];
        if (scope === 'window') {
            tabs = await chrome.tabs.query({ lastFocusedWindow: true });
        } else if (scope === 'session') {
            const groupId = await sessionGroupId();
            tabs = groupId === undefined ? [] : await chrome.tabs.query({ groupId });
        } else {
            tabs = await chrome.tabs.query({});
        }
        const current = await resolveTab().catch(() => undefined);
        return json({ currentTabId: current?.id, sessionGroupId: await sessionGroupId(), tabs: tabs.map(describeTab) });
    },
};

export const tabCreate: Tool = {
    name: 'tab_create',
    description: 'Open a new tab, add it to the Switchyard tab group and make it the current tab. Returns page text and element refs by default; use these directly instead of calling read_page or get_page_text next. Set readMode=none if you only need to open the tab.',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'Address to open. Defaults to a blank tab.' },
            active: { type: 'boolean', description: 'Focus the new tab (default true).' },
            group: { type: 'boolean', description: 'Add it to the Switchyard group (default true).' },
            ...observationProperties,
        },
    },
    async run(args, context) {
        const url = typeof args.url === 'string' ? normalizeUrl(args.url) : undefined;
        const tab = await chrome.tabs.create({ url, active: args.active !== false });
        if (tab.id === undefined) throw new ToolError('Tab was not created');
        if (args.group !== false) await addToSessionGroup([tab.id]);
        await setCurrentTab(tab.id);
        if (url) await waitForLoad(tab.id);
        const created = await chrome.tabs.get(tab.id);
        await markActive(created as chrome.tabs.Tab & { id: number }, context.source);
        return observedResult(created as chrome.tabs.Tab & { id: number }, describeTab(created), args);
    },
};

export const tabClose: Tool = {
    name: 'tab_close',
    description: 'Close one or more tabs.',
    inputSchema: {
        type: 'object',
        properties: { tabIds: { type: 'array', items: { type: 'integer' }, description: 'Tabs to close.' } },
        required: ['tabIds'],
    },
    async run(args, context) {
        const tabIds = args.tabIds as number[];
        const groupId = await sessionGroupId();
        const tabs = await Promise.all(tabIds.map(id => resolveTab(id)));
        const outside = tabs.filter(tab => groupId === undefined || tab.groupId !== groupId);
        if (outside.length) {
            const titles = outside.map(tab => `"${tab.title ?? tab.url}"`).join(', ');
            if (!await context.confirm({ tool: 'tab_close', summary: `Close ${titles}` })) throw new ToolError('The user declined closing these tabs');
        }
        await chrome.tabs.remove(tabIds);
        return json({ closed: tabIds });
    },
};

export const tabActivate: Tool = {
    name: 'tab_activate',
    description: 'Switch to a tab, focus its window and make it the current tab for later actions.',
    inputSchema: { type: 'object', properties: { tabId }, required: ['tabId'] },
    async run(args) {
        const tab = await resolveTab(args.tabId as number);
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        await setCurrentTab(tab.id);
        return json(describeTab(await chrome.tabs.get(tab.id)));
    },
};

export const navigate: Tool = {
    name: 'navigate',
    description: 'Load a url in a tab, or go back, forward or reload. Waits for loading and returns page text and fresh refs by default; reuse them without another read_page/get_page_text. Set readMode=none to skip reading.',
    inputSchema: {
        type: 'object',
        properties: {
            tabId,
            url: { type: 'string', description: 'Address to open.' },
            action: { type: 'string', enum: ['back', 'forward', 'reload'], description: 'History action instead of a url.' },
            ...observationProperties,
        },
    },
    async run(args, context) {
        const tab = await workTab(args.tabId as number | undefined, context);
        if (typeof args.url === 'string') {
            await chrome.tabs.update(tab.id, { url: normalizeUrl(args.url) });
        } else if (args.action === 'back') {
            await chrome.tabs.goBack(tab.id);
        } else if (args.action === 'forward') {
            await chrome.tabs.goForward(tab.id);
        } else if (args.action === 'reload') {
            await chrome.tabs.reload(tab.id);
        } else {
            throw new ToolError('Pass url or action');
        }
        await waitForLoad(tab.id);
        const loaded = await chrome.tabs.get(tab.id);
        return observedResult(loaded as chrome.tabs.Tab & { id: number }, { ...describeTab(loaded), origin: originOf(loaded.url) }, args);
    },
};

export const TAB_TOOLS = [tabsList, tabCreate, tabClose, tabActivate, navigate];
