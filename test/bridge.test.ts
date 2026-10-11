import { afterEach, describe, expect, test } from 'bun:test';
import { BridgeClient, bridgeUrl } from '../src/background/bridge.ts';
import type { BridgeStatus } from '../src/shared/messages.ts';
import { ToolRegistry, type Tool } from '../src/tools/registry.ts';

const echo: Tool = {
    name: 'echo',
    description: 'Echo',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    async run(args, context) {
        return { content: [{ type: 'text', text: `${context.source}:${args.text}` }] };
    },
};

test('bridgeUrl maps http to ws and passes the key', () => {
    expect(bridgeUrl({ gatewayUrl: 'http://127.0.0.1:3260', apiKey: '' })).toBe('ws://127.0.0.1:3260/browser/ws');
    expect(bridgeUrl({ gatewayUrl: 'https://gw.example/', apiKey: 'a b' })).toBe('wss://gw.example/browser/ws?key=a+b');
});

describe('BridgeClient', () => {
    let server: ReturnType<typeof Bun.serve> | undefined;
    let client: BridgeClient | undefined;

    afterEach(() => {
        client?.disconnect();
        server?.stop(true);
    });

    test('says hello with its tools and answers calls', async () => {
        const received: any[] = [];
        let hubSocket: any;
        server = Bun.serve({
            port: 0,
            fetch: (request, srv) => srv.upgrade(request, { data: undefined }) ? undefined : new Response('no', { status: 400 }),
            websocket: {
                open(ws) {
                    hubSocket = ws;
                },
                message(_ws, data) {
                    received.push(JSON.parse(String(data)));
                },
            },
        });
        const statuses: BridgeStatus[] = [];
        const calls: string[] = [];
        client = new BridgeClient({
            version: '0.1.0',
            tools: new ToolRegistry().register(echo),
            context: { source: 'bridge', confirm: async () => true },
            onStatus: status => statuses.push(status),
            onCallStart: (id, name) => calls.push(`start ${id} ${name}`),
            onCallEnd: id => calls.push(`end ${id}`),
        });
        client.configure({ gatewayUrl: `http://127.0.0.1:${server.port}`, apiKey: '', enabled: true });
        await waitFor(() => received.length >= 1);
        expect(received[0]).toEqual({ type: 'hello', version: '0.1.0', tools: [{ name: 'echo', description: 'Echo', inputSchema: echo.inputSchema }] });
        expect(statuses.at(-1)).toEqual({ enabled: true, connected: true });

        hubSocket.send(JSON.stringify({ type: 'call', id: '7', name: 'echo', args: { text: 'hi' } }));
        await waitFor(() => received.length >= 2);
        expect(received[1]).toEqual({ type: 'result', id: '7', result: { content: [{ type: 'text', text: 'bridge:hi' }] } });
        expect(calls).toEqual(['start 7 echo', 'end 7']);
    });

    test('reports a lost connection and reconnects', async () => {
        let opens = 0;
        server = Bun.serve({
            port: 0,
            fetch: (request, srv) => srv.upgrade(request, { data: undefined }) ? undefined : new Response('no', { status: 400 }),
            websocket: {
                open(ws) {
                    opens++;
                    if (opens === 1) ws.close(1011, 'restart');
                },
                message() {},
            },
        });
        const statuses: BridgeStatus[] = [];
        client = new BridgeClient({
            version: '0.1.0',
            tools: new ToolRegistry(),
            context: { source: 'bridge', confirm: async () => true },
            onStatus: status => statuses.push(status),
        });
        client.configure({ gatewayUrl: `http://127.0.0.1:${server.port}`, apiKey: '', enabled: true });
        await waitFor(() => opens >= 2, 3_000);
        expect(statuses.some(status => !status.connected && status.error)).toBeTrue();
        await waitFor(() => statuses.at(-1)?.connected === true);
    });

    test('does nothing while disabled', async () => {
        const statuses: BridgeStatus[] = [];
        client = new BridgeClient({
            version: '0.1.0',
            tools: new ToolRegistry(),
            context: { source: 'bridge', confirm: async () => true },
            onStatus: status => statuses.push(status),
        });
        client.configure({ gatewayUrl: 'http://127.0.0.1:1', apiKey: '', enabled: false });
        client.ensure();
        expect(statuses).toEqual([{ enabled: false, connected: false }]);
    });
});

async function waitFor(condition: () => boolean, timeoutMs = 1_000) {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
        await Bun.sleep(10);
    }
}
