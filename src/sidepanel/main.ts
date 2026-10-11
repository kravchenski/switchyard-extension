import type { ToolDefinition, ToolResult } from '../tools/registry.ts';
import { PANEL_PORT, type BackgroundToPanel, type PanelToBackground } from '../shared/messages.ts';

const select = document.querySelector<HTMLSelectElement>('#tool')!;
const description = document.querySelector<HTMLParagraphElement>('#tool-description')!;
const argsInput = document.querySelector<HTMLTextAreaElement>('#args')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const output = document.querySelector<HTMLPreElement>('#output')!;
const confirmBox = document.querySelector<HTMLElement>('#confirm')!;
const confirmText = document.querySelector<HTMLParagraphElement>('#confirm-text')!;

let tools: ToolDefinition[] = [];
let pendingConfirm: string | undefined;
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
    if (message.type === 'tools') {
        tools = message.tools;
        const selected = select.value;
        select.replaceChildren(...tools.map(tool => new Option(tool.name, tool.name)));
        if (selected) select.value = selected;
        showDescription();
    } else if (message.type === 'result') {
        runButton.disabled = false;
        showResult(message.result);
    } else if (message.type === 'confirm') {
        pendingConfirm = message.id;
        confirmText.textContent = message.request.summary;
        confirmBox.hidden = false;
    }
}

function showDescription() {
    const tool = tools.find(item => item.name === select.value);
    description.textContent = tool?.description ?? '';
}

function showResult(result: ToolResult) {
    output.classList.toggle('error', !!result.isError);
    output.textContent = result.content
        .map(part => part.type === 'text' ? part.text : `[${part.mimeType} image, ${part.data.length} chars base64]`)
        .join('\n');
}

function answerConfirm(ok: boolean) {
    if (!pendingConfirm) return;
    send({ type: 'confirm-reply', id: pendingConfirm, ok });
    pendingConfirm = undefined;
    confirmBox.hidden = true;
}

select.addEventListener('change', showDescription);
document.querySelector('#confirm-allow')!.addEventListener('click', () => answerConfirm(true));
document.querySelector('#confirm-deny')!.addEventListener('click', () => answerConfirm(false));

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
    send({ type: 'call', id: crypto.randomUUID(), name: select.value, args });
});
