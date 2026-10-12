import type { AgentEvent } from '../background/agent.ts';
import { PANEL_PORT, type BackgroundToPanel, type BridgeStatus, type PanelToBackground } from '../shared/messages.ts';
import { loadSettings, saveSettings } from '../shared/settings.ts';

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

const messages = $<HTMLOListElement>('#messages');
const scroller = $<HTMLElement>('#scroll');
const empty = $<HTMLElement>('#empty');
const modelButton = $<HTMLButtonElement>('#model-button');
const modelLabel = $<HTMLSpanElement>('#model-label');
const modelMenu = $<HTMLDivElement>('#model-menu');
const composer = $<HTMLFormElement>('#composer');
const prompt = $<HTMLTextAreaElement>('#prompt');
const sendButton = $<HTMLButtonElement>('#send');
const stopButton = $<HTMLButtonElement>('#stop');
const confirmBox = $<HTMLElement>('#confirm');
const confirmText = $<HTMLParagraphElement>('#confirm-text');
const bridgeStatus = $<HTMLSpanElement>('#bridge-status');

const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

let pendingConfirm: string | undefined;
let lastAssistant: HTMLLIElement | undefined;
let running = false;
const thinking = document.createElement('li');
thinking.className = 'thinking';
thinking.setAttribute('aria-label', 'Working');
thinking.append(...[0, 1, 2].map(() => document.createElement('span')));
let model = '';
let models: string[] = [];
let modelsError: string | undefined;
const toolItems = new Map<string, HTMLDetailsElement>();
let port = connect();

function connect() {
    const next = chrome.runtime.connect({ name: PANEL_PORT });
    next.onMessage.addListener(onMessage);
    next.onDisconnect.addListener(() => {
        port = connect();
    });
    return next;
}

function send(message: PanelToBackground) {
    port.postMessage(message);
}

function onMessage(message: BackgroundToPanel) {
    // Follow new output only when the user is already at the bottom, not while they read back.
    const follow = message.type === 'transcript' || (message.type === 'agent' && message.event.type === 'user') || scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 80;
    switch (message.type) {
        case 'confirm':
            pendingConfirm = message.id;
            confirmText.textContent = message.request.summary;
            confirmBox.hidden = false;
            break;
        case 'transcript':
            messages.replaceChildren();
            toolItems.clear();
            lastAssistant = undefined;
            for (const event of message.events) render(event);
            setRunning(message.running);
            break;
        case 'agent':
            if (message.event.type === 'running') setRunning(message.event.running);
            else render(message.event);
            break;
        case 'models':
            showModels(message.models, message.error);
            break;
        case 'bridge':
            showBridge(message.status);
            break;
    }
    showThinking();
    empty.hidden = messages.childElementCount > 0;
    if (follow) scroller.scrollTop = scroller.scrollHeight;
}

/** Three dots at the end of the chat while the agent works and no answer text is streaming yet. */
function showThinking() {
    thinking.remove();
    const last = messages.lastElementChild;
    if (running && !last?.classList.contains('assistant')) messages.append(thinking);
}

function item(className: string, text = '') {
    const li = document.createElement('li');
    li.className = className;
    li.textContent = text;
    messages.append(li);
    return li;
}

function images(urls: string[]) {
    return urls.map((url) => {
        const image = document.createElement('img');
        image.src = url;
        image.alt = 'Screenshot';
        return image;
    });
}

function render(event: AgentEvent) {
    thinking.remove();
    if (event.type !== 'assistant') lastAssistant = undefined;
    switch (event.type) {
        case 'user':
            item('user', event.text);
            break;
        case 'assistant':
            lastAssistant ??= item('assistant');
            lastAssistant.textContent += event.text;
            break;
        case 'tool-start': {
            const li = item('tool');
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            const name = document.createElement('span');
            name.className = 'tool-name';
            name.textContent = event.name;
            const note = document.createElement('span');
            note.className = 'tool-note';
            note.textContent = event.source === 'bridge' ? 'from a coding agent · running' : 'running';
            summary.append(name, note);
            const args = document.createElement('pre');
            args.textContent = event.args;
            details.append(summary, args);
            li.append(details);
            toolItems.set(event.id, details);
            break;
        }
        case 'tool-end': {
            const details = toolItems.get(event.id);
            if (!details) break;
            details.classList.toggle('failed', event.isError);
            const note = details.querySelector('.tool-note')!;
            note.textContent = note.textContent!.replace('running', event.isError ? 'failed' : 'done');
            const result = document.createElement('pre');
            result.textContent = event.text;
            details.append(result, ...images(event.images));
            break;
        }
        case 'error':
            item('error', event.message);
            break;
    }
}

function setRunning(next: boolean) {
    running = next;
    sendButton.hidden = running;
    stopButton.hidden = !running;
    prompt.disabled = running;
    if (!running) prompt.focus();
}

function showModels(next: string[], error?: string) {
    models = next;
    modelsError = error;
    modelLabel.textContent = model;
    modelButton.title = error ? `Model (${error})` : 'Model';
    if (!modelMenu.hidden) renderModelMenu();
}

function menuItem(id: string) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-item';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(id === model));
    const label = document.createElement('span');
    label.textContent = id;
    button.append(label);
    button.insertAdjacentHTML('beforeend', CHECK_ICON);
    button.addEventListener('click', () => {
        model = id;
        modelLabel.textContent = id;
        saveSettings({ model: id });
        closeModelMenu();
    });
    return button;
}

function menuLabel(text: string) {
    const label = document.createElement('div');
    label.className = 'menu-label';
    label.textContent = text;
    return label;
}

function renderModelMenu() {
    const virtual = ['agent', 'auto', 'vision'];
    const others = [...new Set([model, ...models])].filter(id => id && !virtual.includes(id));
    modelMenu.replaceChildren(menuLabel('Switchyard routing'), ...virtual.map(menuItem));
    if (others.length) modelMenu.append(menuLabel('Models'), ...others.map(menuItem));
    if (modelsError) {
        const error = document.createElement('div');
        error.className = 'menu-error';
        error.textContent = modelsError;
        modelMenu.append(error);
    }
}

function openModelMenu() {
    renderModelMenu();
    modelMenu.hidden = false;
    modelButton.setAttribute('aria-expanded', 'true');
    (modelMenu.querySelector<HTMLElement>('[aria-checked="true"]') ?? modelMenu.querySelector<HTMLElement>('.menu-item'))?.focus();
    send({ type: 'list-models' });
}

function closeModelMenu() {
    modelMenu.hidden = true;
    modelButton.setAttribute('aria-expanded', 'false');
}

function showBridge(status: BridgeStatus) {
    bridgeStatus.hidden = !status.enabled;
    bridgeStatus.classList.toggle('ok', status.connected);
    bridgeStatus.textContent = status.connected ? 'MCP connected' : 'MCP offline';
    bridgeStatus.title = status.connected
        ? 'Coding agents can use this browser through Switchyard'
        : `${status.error ?? 'Switchyard is not reachable'}. Retrying.`;
}

function answerConfirm(ok: boolean) {
    if (!pendingConfirm) return;
    send({ type: 'confirm-reply', id: pendingConfirm, ok });
    pendingConfirm = undefined;
    confirmBox.hidden = true;
}

composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = prompt.value.trim();
    if (!text) return;
    prompt.value = '';
    fitPrompt();
    send({ type: 'chat', text });
});

function fitPrompt() {
    prompt.style.height = 'auto';
    prompt.style.height = `${prompt.scrollHeight}px`;
}

prompt.addEventListener('input', fitPrompt);

prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        composer.requestSubmit();
    }
});

stopButton.addEventListener('click', () => send({ type: 'stop' }));
$('#new-chat').addEventListener('click', () => send({ type: 'reset' }));
$('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#confirm-allow').addEventListener('click', () => answerConfirm(true));
$('#confirm-deny').addEventListener('click', () => answerConfirm(false));
modelButton.addEventListener('click', () => (modelMenu.hidden ? openModelMenu() : closeModelMenu()));
modelMenu.addEventListener('keydown', (event) => {
    const items = [...modelMenu.querySelectorAll<HTMLElement>('.menu-item')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + step + items.length) % items.length]?.focus();
    }
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modelMenu.hidden) {
        closeModelMenu();
        modelButton.focus();
    }
});
document.addEventListener('click', (event) => {
    if (!modelMenu.hidden && !(event.target as Element).closest('.picker')) closeModelMenu();
});
loadSettings().then((settings) => {
    model = settings.model;
    showModels([]);
    send({ type: 'list-models' });
});
