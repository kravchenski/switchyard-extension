import { locateRef, snapshotPage, type ElementTarget } from '../content/snapshot.ts';
import { cdp } from '../background/debugger.ts';
import { ensureSiteAllowed } from '../background/permissions.ts';
import { runInTab } from '../background/scripting.ts';
import { pointAt } from '../background/presence.ts';
import { waitForLoad, workTab } from '../background/session.ts';
import { parseKeySequence } from './keys.ts';
import { json, ToolError, type Args, type Tool } from './registry.ts';
import { observedResult, observationProperties } from './observation.ts';

type Tab = chrome.tabs.Tab & { id: number };

const tabId = { type: 'integer', description: 'Tab id. Defaults to the tab the agent is working in.' } as const;
const ref = { type: 'string', description: 'Element ref from any returned page outline or find, e.g. ref_12.' } as const;
const x = { type: 'number', description: 'Viewport x in CSS pixels, used when no ref is given.' } as const;
const y = { type: 'number', description: 'Viewport y in CSS pixels, used when no ref is given.' } as const;

/** A short outline attached to stale-ref errors so the model can retry without a wasted read_page. */
async function freshRefs(tab: Tab) {
    try {
        const snapshot = await runInTab(tab, snapshotPage, { mode: 'interactive', maxChars: 4000 });
        return `\nCurrent page is "${snapshot.title}" (${snapshot.url}). Fresh refs:\n${snapshot.text}`;
    } catch {
        return '';
    }
}

async function target(tab: Tab, args: Args): Promise<ElementTarget> {
    if (typeof args.ref === 'string') {
        const found = await runInTab(tab, locateRef, args.ref);
        if (!found) {
            const outline = await freshRefs(tab);
            throw new ToolError(`No element ${args.ref} on the page (it was removed or the page changed); ${outline ? `use the refs below instead of calling read_page again.${outline}` : 'call find or read_page to get a current ref.'}`);
        }
        if (found.offscreen) throw new ToolError(`${args.ref} could not be scrolled into view (it is at ${found.x}, ${found.y}); try another element or take a screenshot`);
        return found;
    }
    if (typeof args.x === 'number' && typeof args.y === 'number') return { x: args.x, y: args.y, tag: '', editable: false, offscreen: false };
    throw new ToolError('Pass ref, or both x and y');
}

/** After a click or key the page often navigates; wait so the next tool call sees the loaded page. */
async function settle(tab: Tab) {
    const current = await chrome.tabs.get(tab.id).catch(() => undefined);
    if (current?.status === 'loading') await waitForLoad(tab.id, 10_000);
}

async function viewportCenter(tab: Tab) {
    const metrics = await cdp<{ cssLayoutViewport: { clientWidth: number; clientHeight: number } }>(tab.id, 'Page.getLayoutMetrics');
    return { x: metrics.cssLayoutViewport.clientWidth / 2, y: metrics.cssLayoutViewport.clientHeight / 2 };
}

async function mouse(tab: Tab, type: string, point: { x: number; y: number }, extra: Record<string, unknown> = {}) {
    await cdp(tab.id, 'Input.dispatchMouseEvent', { type, x: point.x, y: point.y, ...extra });
}

async function clickAt(tab: Tab, point: { x: number; y: number }, button = 'left', clickCount = 1) {
    await pointAt(tab, point, true);
    await mouse(tab, 'mouseMoved', point);
    for (let count = 1; count <= clickCount; count++) {
        await mouse(tab, 'mousePressed', point, { button, clickCount: count });
        await mouse(tab, 'mouseReleased', point, { button, clickCount: count });
    }
}

function describeTarget(args: Args, point: ElementTarget) {
    return typeof args.ref === 'string' ? `${point.tag || 'element'} ${args.ref}` : `(${point.x}, ${point.y})`;
}

export const click: Tool = {
    name: 'click',
    description: 'Click an element by ref, or a point in the viewport. Uses real mouse events. Waits if loading starts and returns fresh controls with refs by default, so menus and navigation need no separate read_page/find. Use readMode=all for text or none to skip reading.',
    inputSchema: {
        type: 'object',
        properties: {
            tabId, ref, x, y,
            button: { type: 'string', enum: ['left', 'right', 'middle'] },
            clickCount: { type: 'integer', minimum: 1, maximum: 3, description: '2 for a double click.' },
            ...observationProperties,
        },
    },
    async run(args, context) {
        const tab = await workTab(args.tabId as number | undefined, context);
        const point = await target(tab, args);
        await ensureSiteAllowed(tab, 'click', `Click ${describeTarget(args, point)}`, context);
        await clickAt(tab, point, (args.button as string | undefined) ?? 'left', (args.clickCount as number | undefined) ?? 1);
        await settle(tab);
        return observedResult(await chrome.tabs.get(tab.id) as Tab, { clicked: describeTarget(args, point), x: point.x, y: point.y }, args, 'interactive');
    },
};

export const type: Tool = {
    name: 'type',
    description: 'Type text. With a ref, clicks that field first; otherwise types into the focused element. Use clear=true to replace existing text. Use key for Enter, Tab and shortcuts.',
    inputSchema: {
        type: 'object',
        properties: {
            tabId, ref,
            text: { type: 'string' },
            clear: { type: 'boolean', description: 'Select all existing text in the field first so it is replaced.' },
        },
        required: ['text'],
    },
    async run(args, context) {
        const tab = await workTab(args.tabId as number | undefined, context);
        const point = typeof args.ref === 'string' ? await target(tab, args) : undefined;
        await ensureSiteAllowed(tab, 'type', `Type "${String(args.text).slice(0, 40)}"`, context);
        if (point) await clickAt(tab, point);
        if (args.clear) {
            const modifier = navigator.platform.startsWith('Mac') ? 4 : 2;
            await cdp(tab.id, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: modifier, commands: ['selectAll'] });
            await cdp(tab.id, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: modifier });
        }
        await cdp(tab.id, 'Input.insertText', { text: args.text });
        return json({ typed: (args.text as string).length, into: point ? describeTarget(args, point) : 'focused element' });
    },
};

export const key: Tool = {
    name: 'key',
    description: 'Press keys or shortcuts in order, separated by spaces: "Enter", "Control+a Delete", "Shift+Tab", "ArrowDown ArrowDown Enter". Waits if loading starts and returns fresh controls with refs by default. Use readMode=all for text or none to skip reading.',
    inputSchema: {
        type: 'object',
        properties: { tabId, keys: { type: 'string' }, ...observationProperties },
        required: ['keys'],
    },
    async run(args, context) {
        const tab = await workTab(args.tabId as number | undefined, context);
        let presses;
        try {
            presses = parseKeySequence(args.keys as string);
        } catch (error) {
            throw new ToolError((error as Error).message);
        }
        await ensureSiteAllowed(tab, 'key', `Press ${args.keys}`, context);
        for (const press of presses) {
            const base = { key: press.key, code: press.code, windowsVirtualKeyCode: press.keyCode, modifiers: press.modifiers };
            await cdp(tab.id, 'Input.dispatchKeyEvent', { ...base, type: press.text ? 'keyDown' : 'rawKeyDown', text: press.text });
            await cdp(tab.id, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
        }
        await settle(tab);
        return observedResult(await chrome.tabs.get(tab.id) as Tab, { pressed: args.keys }, args, 'interactive');
    },
};

export const scroll: Tool = {
    name: 'scroll',
    description: 'Scroll the page, or the scrollable area under a ref or point. Returns updated page text and refs by default; no separate get_page_text/read_page is needed. Set readMode=none to skip reading.',
    inputSchema: {
        type: 'object',
        properties: {
            tabId, ref, x, y,
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
            amount: { type: 'integer', minimum: 1, maximum: 10_000, description: 'Pixels to scroll (default 600).' },
            ...observationProperties,
        },
        required: ['direction'],
    },
    async run(args, context) {
        const tab = await workTab(args.tabId as number | undefined, context);
        const point = args.ref !== undefined || args.x !== undefined ? await target(tab, args) : await viewportCenter(tab);
        const amount = (args.amount as number | undefined) ?? 600;
        const deltas: Record<string, [number, number]> = { up: [0, -amount], down: [0, amount], left: [-amount, 0], right: [amount, 0] };
        const [deltaX, deltaY] = deltas[args.direction as string]!;
        await mouse(tab, 'mouseWheel', point, { deltaX, deltaY });
        return observedResult(tab, { scrolled: args.direction, amount }, args);
    },
};

export const hover: Tool = {
    name: 'hover',
    description: 'Move the mouse over an element or point, e.g. to open a menu or tooltip.',
    inputSchema: { type: 'object', properties: { tabId, ref, x, y } },
    async run(args, context) {
        const tab = await workTab(args.tabId as number | undefined, context);
        const point = await target(tab, args);
        await pointAt(tab, point, false);
        await mouse(tab, 'mouseMoved', point);
        return json({ hovered: describeTarget(args, point) });
    },
};

export const INPUT_TOOLS = [click, type, key, scroll, hover];
