import type { AgentEvent } from '../background/agent.ts';
import { PANEL_PORT, type BackgroundToPanel, type BridgeStatus, type PanelToBackground } from '../shared/messages.ts';
import { formatSize, MAX_ATTACHMENT_BYTES, type Attachment } from '../shared/attachments.ts';
import { loadSettings, saveSettings } from '../shared/settings.ts';
import { renderMarkdown } from './markdown.ts';

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
const fileList = $<HTMLUListElement>('#files');
const fileInput = $<HTMLInputElement>('#file-input');

const MAX_FILES = 5;
const PROMPT_PLACEHOLDER = prompt.placeholder;

const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

let pendingConfirm: string | undefined;
let lastAssistant: HTMLLIElement | undefined;
let running = false;
let attachments: Attachment[] = [];
const rawText = new WeakMap<HTMLElement, string>();
const questions = new Map<string, HTMLLIElement>();
let pendingQuestion: string | undefined;
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
            questions.clear();
            pendingQuestion = undefined;
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
    if (running && !pendingQuestion && !last?.classList.contains('assistant')) messages.append(thinking);
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
        case 'user': {
            const li = item('user', event.text);
            if (event.files?.length) li.append(fileChips(event.files.map(name => ({ name }))));
            break;
        }
        case 'assistant': {
            lastAssistant ??= item('assistant markdown');
            const text = (rawText.get(lastAssistant) ?? '') + event.text;
            rawText.set(lastAssistant, text);
            renderMarkdown(lastAssistant, text);
            break;
        }
        case 'question':
            renderQuestion(event);
            break;
        case 'file':
            renderFile(event);
            break;
        case 'answer': {
            const question = questions.get(event.id);
            question?.classList.add('answered');
            const picked = event.text.split(', ');
            for (const button of question?.querySelectorAll<HTMLButtonElement>('button') ?? []) {
                button.disabled = true;
                if (button.classList.contains('option') && picked.includes(button.lastElementChild!.textContent!)) button.classList.add('picked');
            }
            if (pendingQuestion === event.id) setPendingQuestion(undefined);
            item('user', event.text);
            break;
        }
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
    if (!running) setPendingQuestion(undefined);
    updateComposer();
}

function updateComposer() {
    const answering = pendingQuestion !== undefined;
    sendButton.hidden = running && !answering;
    stopButton.hidden = !running || answering;
    prompt.disabled = running && !answering;
    prompt.placeholder = answering ? 'Type your own answer, or press 1-9 to pick an option' : PROMPT_PLACEHOLDER;
    $<HTMLButtonElement>('#attach').disabled = running;
    if (!prompt.disabled) prompt.focus();
}

function setPendingQuestion(id: string | undefined) {
    pendingQuestion = id;
    updateComposer();
}

function answer(id: string, text: string) {
    if (pendingQuestion !== id || !text.trim()) return;
    send({ type: 'answer', id, text: text.trim() });
}

/** A question from ask_user, with its options as buttons, like Claude Code asks. */
function renderQuestion(event: Extract<AgentEvent, { type: 'question' }>) {
    const li = item('question');
    const text = document.createElement('div');
    text.className = 'markdown question-text';
    renderMarkdown(text, event.question);
    const options = document.createElement('div');
    options.className = 'options';
    const chosen = new Set<string>();
    const submit = document.createElement('button');
    event.options.forEach((option, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'option';
        const number = document.createElement('span');
        number.className = 'option-number';
        number.textContent = String(index + 1);
        const label = document.createElement('span');
        label.textContent = option;
        button.append(number, label);
        button.addEventListener('click', () => {
            if (!event.multiSelect) return answer(event.id, option);
            if (chosen.has(option)) chosen.delete(option);
            else chosen.add(option);
            button.setAttribute('aria-pressed', String(chosen.has(option)));
            submit.disabled = !chosen.size;
        });
        if (event.multiSelect) button.setAttribute('aria-pressed', 'false');
        options.append(button);
    });
    li.append(text, options);
    if (event.multiSelect && event.options.length) {
        submit.type = 'button';
        submit.className = 'button';
        submit.textContent = 'Send';
        submit.disabled = true;
        submit.addEventListener('click', () => answer(event.id, [...chosen].join(', ')));
        li.append(submit);
    }
    questions.set(event.id, li);
    setPendingQuestion(event.id);
}

/** A file the agent made with create_file; it reaches the disk only when the user downloads it. */
function renderFile(file: Extract<AgentEvent, { type: 'file' }>) {
    const li = item('file-card');
    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = file.name;
    const meta = document.createElement('span');
    meta.textContent = `Created by Switchyard · ${formatSize(file.size)}`;
    info.append(name, meta);
    const download = document.createElement('a');
    download.className = 'button outline';
    download.href = `data:${file.mimeType};base64,${file.data}`;
    download.download = file.name;
    download.textContent = 'Download';
    li.append(info, download);
}

function fileChips(files: { name: string; size?: number }[], remove?: (index: number) => void) {
    const list = document.createElement('ul');
    list.className = 'files';
    files.forEach((file, index) => {
        const chip = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = file.name;
        chip.append(name);
        if (file.size !== undefined) {
            const size = document.createElement('span');
            size.className = 'file-size';
            size.textContent = formatSize(file.size);
            chip.append(size);
        }
        if (remove) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'file-remove';
            button.textContent = '×';
            button.setAttribute('aria-label', `Remove ${file.name}`);
            button.addEventListener('click', () => remove(index));
            chip.append(button);
        }
        list.append(chip);
    });
    return list;
}

function showAttachments() {
    fileList.replaceChildren(...fileChips(attachments, (index) => {
        attachments.splice(index, 1);
        showAttachments();
    }).children);
    fileList.hidden = !attachments.length;
}

function readFile(file: File) {
    return new Promise<Attachment>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, mimeType: file.type, size: file.size, data: String(reader.result).split(',')[1] ?? '' });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function attach(files: FileList | File[]) {
    for (const file of files) {
        if (attachments.length >= MAX_FILES) break;
        if (file.size > MAX_ATTACHMENT_BYTES) {
            item('error', `${file.name} is larger than ${formatSize(MAX_ATTACHMENT_BYTES)}.`);
            continue;
        }
        attachments = [...attachments.filter(existing => existing.name !== file.name), await readFile(file)];
    }
    showAttachments();
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
    if (pendingQuestion) {
        if (!text) return;
        answer(pendingQuestion, text);
    } else {
        if (!text && !attachments.length) return;
        send({ type: 'chat', text: text || 'See the attached files.', attachments });
        attachments = [];
        showAttachments();
    }
    prompt.value = '';
    fitPrompt();
});

function fitPrompt() {
    prompt.style.height = 'auto';
    prompt.style.height = `${prompt.scrollHeight}px`;
}

prompt.addEventListener('input', fitPrompt);

prompt.addEventListener('keydown', (event) => {
    const question = pendingQuestion && questions.get(pendingQuestion);
    if (question && !prompt.value && /^[1-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const option = question.querySelectorAll<HTMLButtonElement>('.option')[Number(event.key) - 1];
        if (option) {
            event.preventDefault();
            option.click();
            return;
        }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        composer.requestSubmit();
    }
});

stopButton.addEventListener('click', () => send({ type: 'stop' }));
$('#attach').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
    void attach(fileInput.files ?? []);
    fileInput.value = '';
});
prompt.addEventListener('paste', (event) => {
    const files = event.clipboardData?.files;
    if (files?.length && !running) {
        event.preventDefault();
        void attach(files);
    }
});
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', (event) => {
    event.preventDefault();
    if (event.dataTransfer?.files.length && !running) void attach(event.dataTransfer.files);
});
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
