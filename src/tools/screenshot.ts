import { cdp } from '../background/debugger.ts';
import { resolveTab } from '../background/session.ts';
import { json, type Tool } from './registry.ts';

const MAX_EDGE = 1568;
const WAIT_LIMIT_MS = 30_000;

function toBase64(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
}

/** Resizes a device-pixel capture so one image pixel is one CSS pixel (or less, for very large viewports). */
async function resize(data: string, cssWidth: number, cssHeight: number) {
    const scale = Math.min(1, MAX_EDGE / Math.max(cssWidth, cssHeight));
    const width = Math.round(cssWidth * scale);
    const height = Math.round(cssHeight * scale);
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    return { data: toBase64(await blob.arrayBuffer()), width, height, scale };
}

export const screenshot: Tool = {
    name: 'screenshot',
    description: 'Capture the visible part of a tab as an image. Image pixels map to viewport CSS pixels for click x/y (divide by "scale" when it is below 1). Brings the tab to the front of its window.',
    inputSchema: { type: 'object', properties: { tabId: { type: 'integer' } } },
    async run(args) {
        const tab = await resolveTab(args.tabId as number | undefined);
        if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
        const metrics = await cdp<{ cssLayoutViewport: { clientWidth: number; clientHeight: number } }>(tab.id, 'Page.getLayoutMetrics');
        const capture = await cdp<{ data: string }>(tab.id, 'Page.captureScreenshot', { format: 'png' });
        const image = await resize(capture.data, metrics.cssLayoutViewport.clientWidth, metrics.cssLayoutViewport.clientHeight);
        const info = json({ tabId: tab.id, url: tab.url, width: image.width, height: image.height, scale: Number(image.scale.toFixed(4)) });
        return { content: [...info.content, { type: 'image', data: image.data, mimeType: 'image/jpeg' }] };
    },
};

export const wait: Tool = {
    name: 'wait',
    description: 'Wait for a number of milliseconds, e.g. for a page to update.',
    inputSchema: {
        type: 'object',
        properties: { ms: { type: 'integer', minimum: 0, maximum: WAIT_LIMIT_MS } },
        required: ['ms'],
    },
    async run(args, context) {
        await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, args.ms as number);
            context.signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
        });
        return json({ waitedMs: args.ms });
    },
};

export const SCREENSHOT_TOOLS = [screenshot, wait];
