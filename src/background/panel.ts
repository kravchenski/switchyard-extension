import type { ConfirmRequest } from '../tools/registry.ts';
import type { BackgroundToPanel } from '../shared/messages.ts';

const ports = new Set<chrome.runtime.Port>();
const pendingConfirms = new Map<string, (ok: boolean) => void>();

export function addPanel(port: chrome.runtime.Port) {
    ports.add(port);
    port.onDisconnect.addListener(() => {
        ports.delete(port);
        if (ports.size) return;
        for (const resolve of pendingConfirms.values()) resolve(false);
        pendingConfirms.clear();
    });
}

export function postToPanels(message: BackgroundToPanel) {
    for (const port of ports) port.postMessage(message);
}

/** Shows the request in every open side panel; declines when no panel is open. */
export function confirmInPanel(request: ConfirmRequest) {
    if (!ports.size) return Promise.resolve(false);
    const id = crypto.randomUUID();
    return new Promise<boolean>((resolve) => {
        pendingConfirms.set(id, resolve);
        postToPanels({ type: 'confirm', id, request });
    });
}

export function resolveConfirm(id: string, ok: boolean) {
    pendingConfirms.get(id)?.(ok);
    pendingConfirms.delete(id);
}
