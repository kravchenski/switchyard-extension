import type { ToolContext, ToolDefinition, ToolResult } from '../tools/registry.ts';
import type { BridgeStatus } from '../shared/messages.ts';

const PING_INTERVAL_MS = 20_000;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export interface BridgeOptions {
    gatewayUrl: string;
    apiKey: string;
    enabled: boolean;
}

export interface BridgeDeps {
    version: string;
    tools: { definitions(): ToolDefinition[]; call(name: string, args: unknown, context: ToolContext): Promise<ToolResult> };
    context: ToolContext;
    onStatus(status: BridgeStatus): void;
    onCallStart?(id: string, name: string, args: unknown): void;
    onCallEnd?(id: string, result: ToolResult): void;
}

type HubMessage =
    | { type: 'call'; id: string; name: string; args: unknown }
    | { type: 'pong' };

export function bridgeUrl({ gatewayUrl, apiKey }: Pick<BridgeOptions, 'gatewayUrl' | 'apiKey'>) {
    const url = new URL('/browser/ws', gatewayUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (apiKey) url.searchParams.set('key', apiKey);
    return url.toString();
}

/** Keeps a WebSocket to Switchyard open and runs the tool calls coding agents send through it. */
export class BridgeClient {
    private socket: WebSocket | undefined;
    private options: BridgeOptions = { gatewayUrl: '', apiKey: '', enabled: false };
    private retryMs = MIN_RETRY_MS;
    private retryTimer: ReturnType<typeof setTimeout> | undefined;
    private pingTimer: ReturnType<typeof setInterval> | undefined;
    private status: BridgeStatus = { enabled: false, connected: false };

    constructor(private readonly deps: BridgeDeps) {}

    currentStatus() {
        return this.status;
    }

    /** Applies new settings, reconnecting when the address or key changed. */
    configure(options: BridgeOptions) {
        const changed = options.gatewayUrl !== this.options.gatewayUrl || options.apiKey !== this.options.apiKey || options.enabled !== this.options.enabled;
        this.options = options;
        if (!changed) return;
        this.disconnect();
        this.retryMs = MIN_RETRY_MS;
        this.setStatus({ enabled: options.enabled, connected: false });
        this.ensure();
    }

    /** Connects if enabled and not already connected or connecting; safe to call often, e.g. from an alarm. */
    ensure() {
        if (!this.options.enabled || this.socket || this.retryTimer) return;
        let socket: WebSocket;
        try {
            socket = new WebSocket(bridgeUrl(this.options));
        } catch (error) {
            this.setStatus({ enabled: true, connected: false, error: (error as Error).message });
            this.scheduleRetry();
            return;
        }
        this.socket = socket;
        socket.onopen = () => {
            this.retryMs = MIN_RETRY_MS;
            socket.send(JSON.stringify({ type: 'hello', version: this.deps.version, tools: this.deps.tools.definitions() }));
            // Traffic every 20 s also keeps the MV3 service worker alive.
            this.pingTimer = setInterval(() => socket.send(JSON.stringify({ type: 'ping' })), PING_INTERVAL_MS);
            this.setStatus({ enabled: true, connected: true });
        };
        socket.onmessage = (event) => {
            let message: HubMessage;
            try {
                message = JSON.parse(String(event.data)) as HubMessage;
            } catch {
                return;
            }
            if (message.type === 'call') void this.run(socket, message);
        };
        socket.onclose = (event) => {
            if (this.socket !== socket) return;
            this.socket = undefined;
            clearInterval(this.pingTimer);
            const error = event.code === 1000 ? undefined : `Switchyard is not reachable at ${this.options.gatewayUrl}`;
            this.setStatus({ enabled: this.options.enabled, connected: false, error });
            this.scheduleRetry();
        };
    }

    disconnect() {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
        clearInterval(this.pingTimer);
        const socket = this.socket;
        this.socket = undefined;
        socket?.close(1000);
    }

    private async run(socket: WebSocket, message: { id: string; name: string; args: unknown }) {
        this.deps.onCallStart?.(message.id, message.name, message.args);
        const result = await this.deps.tools.call(message.name, message.args, this.deps.context);
        this.deps.onCallEnd?.(message.id, result);
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'result', id: message.id, result }));
    }

    private scheduleRetry() {
        if (!this.options.enabled || this.retryTimer) return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            this.ensure();
        }, this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    }

    private setStatus(status: BridgeStatus) {
        this.status = status;
        this.deps.onStatus(status);
    }
}
