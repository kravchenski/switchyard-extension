import type { AgentEvent } from '../background/agent.ts';
import type { ToolDefinition, ToolResult } from '../tools/registry.ts';
import { PANEL_PORT, type BackgroundToPanel, type PanelToBackground } from '../shared/messages.ts';
import { loadSettings, saveSettings } from '../shared/settings.ts';

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

const messages = $<HTMLOListElement>('#messages');
const empty = $<HTMLParagraphElement>('#empty');
const modelSelect = $<HTMLSelectElement>('#model');
const composer = $<HTMLFormElement>('#composer');
const prompt = $<HTMLTextAreaElement>('#prompt');
const sendButton = $<HTMLButtonElement>('#send');
const stopButton = $<HTMLButtonElement>('#stop');
const confirmBox = $<HTMLElement>('#confirm');
const confirmText = $<HTMLParagraphElement>('#confirm-text');
const toolSelect = $<HTMLSelectElement>('#tool');
const toolDescription = $<HTMLParagraphElement>('#tool-description');
const argsInput = $<HTMLTextAreaElement>('#args');
const runButton = $<HTMLButtonElement>('#run');
const output = $<HTMLDivElement>('#output');

let tools: ToolDefinition[] = [];
let pendingConfirm: string | undefined;
let lastAssistant: HTMLLIElement | undefined;
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
    switch (message.type) {
        case 'tools':
            tools = message.tools;
            toolSelect.replaceChildren(...tools.map(tool => new Option(tool.name, tool.name)));
            showToolDescription();
            break;
        case 'result':
            runButton.disabled = false;
            showResult(message.result);
            break;
        case 'confirm':
            pendingConfirm = message.id;
            confirmText.textContent = message.request.summary;
            confirmBox.hidden = false;
            confirmBox.scrollIntoView({ block: 'nearest' });
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
    }
    empty.hidden = messages.childElementCount > 0;
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
            summary.textContent = `${event.name} …`;
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
            const summary = details.querySelector('summary')!;
            summary.textContent = summary.textContent!.replace(/ …$/, event.isError ? ' failed' : '');
            const result = document.createElement('pre');
            result.textContent = event.text;
            details.append(result, ...images(event.images));
            break;
        }
        case 'error':
            item('error', event.message);
            break;
    }
    messages.lastElementChild?.scrollIntoView({ block: 'end' });
}

function setRunning(running: boolean) {
    sendButton.hidden = running;
    stopButton.hidden = !running;
    prompt.disabled = running;
    if (!running) prompt.focus();
}

function showModels(models: string[], error?: string) {
    const current = modelSelect.value || modelSelect.dataset.saved || '';
    const ids = [...new Set([current, 'agent', 'auto', ...models].filter(Boolean))];
    modelSelect.replaceChildren(...ids.map(id => new Option(id, id)));
    modelSelect.value = current;
    modelSelect.title = error ?? 'Model';
    if (error) item('error', error);
}

function showToolDescription() {
    toolDescription.textContent = tools.find(tool => tool.name === toolSelect.value)?.description ?? '';
}

function showResult(result: ToolResult) {
    output.classList.toggle('error', !!result.isError);
    output.replaceChildren(...result.content.map((part) => {
        if (part.type === 'text') return document.createTextNode(`${part.text}\n`);
        return images([`data:${part.mimeType};base64,${part.data}`])[0]!;
    }));
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
    send({ type: 'chat', text });
});

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
modelSelect.addEventListener('change', () => saveSettings({ model: modelSelect.value }));
toolSelect.addEventListener('change', showToolDescription);

runButton.addEventListener('click', () => {
    let args: unknown;
    try {
        args = JSON.parse(argsInput.value || '{}');
    } catch (error) {
        showResult({ content: [{ type: 'text', text: `Arguments are not valid JSON: ${(error as Error).message}` }], isError: true });
        return;
    }
    runButton.disabled = true;
    output.textContent = 'Running…';
    send({ type: 'call', id: crypto.randomUUID(), name: toolSelect.value, args });
});

loadSettings().then((settings) => {
    modelSelect.dataset.saved = settings.model;
    showModels([]);
    send({ type: 'list-models' });
});
