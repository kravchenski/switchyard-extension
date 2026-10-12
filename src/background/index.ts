import { GROUP_TOOLS } from '../tools/groups.ts';
import { INPUT_TOOLS } from '../tools/input.ts';
import { PAGE_TOOLS } from '../tools/page.ts';
import { ToolError, ToolRegistry, type ConfirmRequest, type ToolContext } from '../tools/registry.ts';
import { SCREENSHOT_TOOLS } from '../tools/screenshot.ts';
import { TAB_TOOLS } from '../tools/tabs.ts';
import { PANEL_PORT, type BridgeStatus, type PanelToBackground } from '../shared/messages.ts';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from '../shared/settings.ts';
import { Agent, toolEndEvent, type AgentEvent } from './agent.ts';
import { BridgeClient } from './bridge.ts';
import { chatStream, listModels } from './gateway.ts';
import { addPanel, confirmInPanel, hasPanel, postToPanels, resolveConfirm } from './panel.ts';
import { setPanelRunning } from './presence.ts';
import { adoptActiveTab, resolveTab, sessionGroupId } from './session.ts';

export const tools = new ToolRegistry().register(...TAB_TOOLS, ...GROUP_TOOLS, ...PAGE_TOOLS, ...INPUT_TOOLS, ...SCREENSHOT_TOOLS);

const panelContext: ToolContext = { source: 'panel', confirm: confirmInPanel };

/** Coding agents get the panel's prompt when it is open; otherwise the bridge auto-approve setting decides. */
async function confirmForBridge(request: ConfirmRequest) {
    if (hasPanel()) return confirmInPanel(request);
    if (settings.bridgeAutoApprove) return true;
    throw new ToolError(`${request.summary}: needs approval. Ask the user to open the Switchyard side panel in Chrome, or to allow agents to act without asking in the extension settings.`);
}

const transcript: AgentEvent[] = [];

function record(event: AgentEvent) {
    // Merge streamed text so a reopened panel replays whole messages.
    const last = transcript.at(-1);
    if (event.type === 'running') setPanelRunning(event.running);
    if (event.type === 'assistant' && last?.type === 'assistant') last.text += event.text;
    else if (event.type !== 'running') transcript.push({ ...event });
    postToPanels({ type: 'agent', event });
}

const bridge = new BridgeClient({
    version: chrome.runtime.getManifest().version,
    tools,
    context: { source: 'bridge', confirm: confirmForBridge },
    onStatus: (status: BridgeStatus) => postToPanels({ type: 'bridge', status }),
    onCallStart: (id, name, args) => record({ type: 'tool-start', id: `bridge-${id}`, name, args: JSON.stringify(args), source: 'bridge' }),
    onCallEnd: (id, result) => record(toolEndEvent(`bridge-${id}`, result)),
});

let settings: Settings = DEFAULT_SETTINGS;

function applySettings(next: Settings) {
    settings = next;
    bridge.configure({ gatewayUrl: next.gatewayUrl, apiKey: next.apiKey, enabled: next.bridgeEnabled });
}

const settingsReady = loadSettings().then(applySettings);
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) applySettings({ ...DEFAULT_SETTINGS, ...changes.settings.newValue as Partial<Settings> });
});

// Wakes the service worker to reconnect the bridge if Chrome stopped it.
chrome.alarms.create('bridge', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'bridge') settingsReady.then(() => bridge.ensure());
});

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
    emit: record,
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

chrome.runtime.onMessage.addListener((message: { type?: string }, sender, sendResponse) => {
    // Sent by the Stop button of the overlay this extension injects into the page.
    if (message.type === 'stop-agent' && sender.id === chrome.runtime.id) {
        agent.stop();
        return false;
    }
    if (message.type === 'bridge-status') {
        settingsReady.then(() => sendResponse(bridge.currentStatus()));
        return true;
    }
    if (message.type !== 'list-models') return false;
    modelsReply().then(sendResponse);
    return true;
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT) return;
    addPanel(port);
    port.postMessage({ type: 'tools', tools: tools.definitions() });
    port.postMessage({ type: 'transcript', events: transcript, running: agent.running });
    settingsReady.then(() => port.postMessage({ type: 'bridge', status: bridge.currentStatus() }));
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
