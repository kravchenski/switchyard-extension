import { GROUP_TOOLS } from '../tools/groups.ts';
import { ToolRegistry, type ToolContext } from '../tools/registry.ts';
import { TAB_TOOLS } from '../tools/tabs.ts';
import { PANEL_PORT, type PanelToBackground } from '../shared/messages.ts';
import { addPanel, confirmInPanel, resolveConfirm } from './panel.ts';

export const tools = new ToolRegistry().register(...TAB_TOOLS, ...GROUP_TOOLS);

const panelContext: ToolContext = { source: 'panel', confirm: confirmInPanel };

chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT) return;
    addPanel(port);
    port.postMessage({ type: 'tools', tools: tools.definitions() });
    port.onMessage.addListener(async (message: PanelToBackground) => {
        if (message.type === 'confirm-reply') {
            resolveConfirm(message.id, message.ok);
        } else if (message.type === 'call') {
            const result = await tools.call(message.name, message.args, panelContext);
            port.postMessage({ type: 'result', id: message.id, result });
        }
    });
});
