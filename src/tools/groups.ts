import { json, ToolError, type Tool } from './registry.ts';

const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;

const tabIds = { type: 'array', items: { type: 'integer' }, description: 'Tab ids from tabs_list.' } as const;
const groupProperties = {
    title: { type: 'string', description: 'Group name shown on the tab strip.' },
    color: { type: 'string', enum: COLORS, description: 'Group color.' },
    collapsed: { type: 'boolean', description: 'Collapse the group.' },
} as const;

function describeGroup(group: chrome.tabGroups.TabGroup, tabs: chrome.tabs.Tab[]) {
    return {
        groupId: group.id,
        windowId: group.windowId,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        tabs: tabs.map(tab => ({ tabId: tab.id, title: tab.title, url: tab.url })),
    };
}

async function groupSummary(groupId: number) {
    return describeGroup(await chrome.tabGroups.get(groupId), await chrome.tabs.query({ groupId }));
}

function groupUpdate(args: Record<string, unknown>): chrome.tabGroups.UpdateProperties {
    const update: chrome.tabGroups.UpdateProperties = {};
    if (typeof args.title === 'string') update.title = args.title;
    if (typeof args.color === 'string') update.color = args.color as chrome.tabGroups.Color;
    if (typeof args.collapsed === 'boolean') update.collapsed = args.collapsed;
    return update;
}

function nonEmpty(ids: number[]) {
    if (!ids.length) throw new ToolError('tabIds must not be empty');
    return ids as [number, ...number[]];
}

export const groupList: Tool = {
    name: 'group_list',
    description: 'List tab groups with their tabs.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
        const groups = await chrome.tabGroups.query({});
        return json(await Promise.all(groups.map(group => groupSummary(group.id))));
    },
};

export const groupCreate: Tool = {
    name: 'group_create',
    description: 'Put tabs into a new tab group with an optional title and color.',
    inputSchema: { type: 'object', properties: { tabIds, ...groupProperties }, required: ['tabIds'] },
    async run(args) {
        const groupId = await chrome.tabs.group({ tabIds: nonEmpty(args.tabIds as number[]) });
        const update = groupUpdate(args);
        if (Object.keys(update).length) await chrome.tabGroups.update(groupId, update);
        return json(await groupSummary(groupId));
    },
};

export const groupUpdateTool: Tool = {
    name: 'group_update',
    description: 'Rename, recolor, collapse or expand a tab group.',
    inputSchema: { type: 'object', properties: { groupId: { type: 'integer' }, ...groupProperties }, required: ['groupId'] },
    async run(args) {
        await chrome.tabGroups.update(args.groupId as number, groupUpdate(args));
        return json(await groupSummary(args.groupId as number));
    },
};

export const tabMoveToGroup: Tool = {
    name: 'tab_move_to_group',
    description: 'Add tabs to an existing tab group.',
    inputSchema: { type: 'object', properties: { tabIds, groupId: { type: 'integer' } }, required: ['tabIds', 'groupId'] },
    async run(args) {
        await chrome.tabs.group({ groupId: args.groupId as number, tabIds: nonEmpty(args.tabIds as number[]) });
        return json(await groupSummary(args.groupId as number));
    },
};

export const ungroup: Tool = {
    name: 'ungroup',
    description: 'Remove tabs from whatever group they are in.',
    inputSchema: { type: 'object', properties: { tabIds }, required: ['tabIds'] },
    async run(args) {
        await chrome.tabs.ungroup(nonEmpty(args.tabIds as number[]));
        return json({ ungrouped: args.tabIds });
    },
};

export const GROUP_TOOLS = [groupList, groupCreate, groupUpdateTool, tabMoveToGroup, ungroup];
