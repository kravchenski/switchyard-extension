import { GROUP_TOOLS } from '../tools/groups.ts';
import { INPUT_TOOLS } from '../tools/input.ts';
import { PAGE_TOOLS } from '../tools/page.ts';
import { ToolRegistry, type ToolContext } from '../tools/registry.ts';
import { SCREENSHOT_TOOLS } from '../tools/screenshot.ts';
import { TAB_TOOLS } from '../tools/tabs.ts';
import { PANEL_PORT, type PanelToBackground } from '../shared/messages.ts';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from '../shared/settings.ts';
import { Agent, type AgentEvent } from './agent.ts';
import { chatStream, listModels } from './gateway.ts';
import { addPanel, confirmInPanel, postToPanels, resolveConfirm } from './panel.ts';
import { adoptActiveTab, resolveTab, sessionGroupId } from './session.ts';

export const tools = new ToolRegistry().register(...TAB_TOOLS, ...GROUP_TOOLS, ...PAGE_TOOLS, ...INPUT_TOOLS, ...SCREENSHOT_TOOLS);

const panelContext: ToolContext = { source: 'panel', confirm: confirmInPanel };

let settings: Settings = DEFAULT_SETTINGS;
const settingsReady = loadSettings().then((loaded) => {
    settings = loaded;
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue as Partial<Settings> };
});

const transcript: AgentEvent[] = [];

async function describeEnvironment() {
    const tab = await resolveTab().catch(() => undefined);
    const groupId = await sessionGroupId();
    return [
        `Current tab: ${tab ? `${tab.id} "${tab.title ?? ''}" ${tab.url ?? ''}` : 'none'}`,
        `Switchyard tab group: ${groupId ?? 'not created yet'}`,
        `Date: ${new Date().toString()}`,
    ].join('\n');
}

const agent = new Agent({
    stream: () => chatStream(settings),
    tools,
    context: panelContext,
    model: () => settings.model,
    describeEnvironment,
    emit(event) {
        // Merge streamed text so a reopened panel replays whole messages.
        const last = transcript.at(-1);
        if (event.type === 'assistant' && last?.type === 'assistant') last.text += event.text;
        else if (event.type !== 'running') transcript.push({ ...event });
        postToPanels({ type: 'agent', event });
    },
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

async function modelsReply() {
    await settingsReady;
    try {
        return { models: await listModels(settings) };
    } catch (error) {
        return { models: [], error: (error as Error).message };
    }
}

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
    if (message.type !== 'list-models') return false;
    modelsReply().then(sendResponse);
    return true;
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT) return;
    addPanel(port);
    port.postMessage({ type: 'tools', tools: tools.definitions() });
    port.postMessage({ type: 'transcript', events: transcript, running: agent.running });
    port.onMessage.addListener(async (message: PanelToBackground) => {
        await settingsReady;
        switch (message.type) {
            case 'confirm-reply':
                resolveConfirm(message.id, message.ok);
                break;
            case 'call': {
                const result = await tools.call(message.name, message.args, panelContext);
                port.postMessage({ type: 'result', id: message.id, result });
                break;
            }
            case 'chat':
                if (agent.running) break;
                if (!transcript.length) await adoptActiveTab().catch(console.error);
                await agent.send(message.text);
                break;
            case 'stop':
                agent.stop();
                break;
            case 'reset':
                agent.reset();
                transcript.length = 0;
                postToPanels({ type: 'transcript', events: transcript, running: false });
                break;
            case 'list-models':
                port.postMessage({ type: 'models', ...await modelsReply() });
                break;
        }
    });
});
