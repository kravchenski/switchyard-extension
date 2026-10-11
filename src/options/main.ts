import type { BridgeStatus } from '../shared/messages.ts';
import { loadSettings, saveSettings } from '../shared/settings.ts';

const form = document.querySelector<HTMLFormElement>('#settings')!;
const gatewayUrl = document.querySelector<HTMLInputElement>('#gateway-url')!;
const apiKey = document.querySelector<HTMLInputElement>('#api-key')!;
const askBeforeActing = document.querySelector<HTMLInputElement>('#ask-before-acting')!;
const bridgeEnabled = document.querySelector<HTMLInputElement>('#bridge-enabled')!;
const bridgeAutoApprove = document.querySelector<HTMLInputElement>('#bridge-auto-approve')!;
const bridgeStatus = document.querySelector<HTMLParagraphElement>('#bridge-status')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;

document.querySelector('#origin')!.textContent = `chrome-extension://${chrome.runtime.id}`;

function showStatus(text: string, kind: 'ok' | 'error' | '' = '') {
    status.textContent = text;
    status.className = `status ${kind}`;
}

async function save() {
    await saveSettings({
        gatewayUrl: gatewayUrl.value.trim().replace(/\/+$/, ''),
        apiKey: apiKey.value.trim(),
        askBeforeActing: askBeforeActing.checked,
        bridgeEnabled: bridgeEnabled.checked,
        bridgeAutoApprove: bridgeAutoApprove.checked,
    });
    setTimeout(refreshBridgeStatus, 1_000);
}

async function refreshBridgeStatus() {
    const status = await chrome.runtime.sendMessage({ type: 'bridge-status' }) as BridgeStatus;
    if (!status.enabled) bridgeStatus.textContent = 'Bridge is off.';
    else if (status.connected) bridgeStatus.textContent = 'Bridge connected to Switchyard.';
    else bridgeStatus.textContent = `Bridge not connected${status.error ? `: ${status.error}` : ''}.`;
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await save();
    showStatus('Saved.', 'ok');
});

document.querySelector('#test')!.addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    await save();
    showStatus('Connecting…');
    const reply = await chrome.runtime.sendMessage({ type: 'list-models' }) as { models: string[]; error?: string };
    if (reply.error) showStatus(reply.error, 'error');
    else showStatus(`Connected. ${reply.models.length} models available.`, 'ok');
});

loadSettings().then((settings) => {
    gatewayUrl.value = settings.gatewayUrl;
    apiKey.value = settings.apiKey;
    askBeforeActing.checked = settings.askBeforeActing;
    bridgeEnabled.checked = settings.bridgeEnabled;
    bridgeAutoApprove.checked = settings.bridgeAutoApprove;
});
refreshBridgeStatus();
