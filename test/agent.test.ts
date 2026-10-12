import { describe, expect, test } from 'bun:test';
import { Agent, ToolCallAccumulator, type AgentEvent } from '../src/background/agent.ts';
import type { ChatChunk, ChatRequest } from '../src/background/gateway.ts';
import { ToolRegistry, type Tool } from '../src/tools/registry.ts';

const echo: Tool = {
    name: 'echo',
    description: 'Echo text',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    async run(args) {
        return { content: [{ type: 'text', text: `echo:${args.text}` }] };
    },
};

const shot: Tool = {
    name: 'shot',
    description: 'Screenshot',
    inputSchema: { type: 'object', properties: {} },
    async run() {
        return { content: [{ type: 'text', text: 'ok' }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] };
    },
};

function toolCallChunks(id: string, name: string, args: string): ChatChunk[] {
    const half = Math.floor(args.length / 2);
    return [
        { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args.slice(0, half) } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] } }] },
    ];
}

function textChunks(text: string): ChatChunk[] {
    return [...text].map(char => ({ choices: [{ delta: { content: char } }] }));
}

function setup(turns: ChatChunk[][], tools: Tool[] = [echo, shot]) {
    const requests: ChatRequest[] = [];
    const events: AgentEvent[] = [];
    const agent = new Agent({
        stream: () => async function* (request) {
            requests.push(structuredClone(request));
            const turn = turns.shift();
            if (!turn) throw new Error('no more turns');
            yield* turn;
        },
        tools: new ToolRegistry().register(...tools),
        context: { source: 'panel', confirm: async () => true },
        model: () => 'agent',
        describeEnvironment: async () => 'Current tab: 1',
        emit: event => events.push(event),
    });
    return { agent, requests, events };
}

describe('ToolCallAccumulator', () => {
    test('joins fragments by index', () => {
        const calls = new ToolCallAccumulator();
        calls.push([{ index: 0, id: 'a', function: { name: 'echo', arguments: '{"te' } }, { index: 1, id: 'b', function: { name: 'shot' } }]);
        calls.push([{ index: 0, function: { arguments: 'xt":"x"}' } }]);
        expect(calls.result()).toEqual([
            { id: 'a', type: 'function', function: { name: 'echo', arguments: '{"text":"x"}' } },
            { id: 'b', type: 'function', function: { name: 'shot', arguments: '{}' } },
        ]);
    });
});

describe('Agent', () => {
    test('runs tools until the model answers in text', async () => {
        const { agent, requests, events } = setup([toolCallChunks('call_1', 'echo', '{"text":"hi"}'), textChunks('Done')]);
        await agent.send('say hi');

        expect(requests).toHaveLength(2);
        expect(requests[0]!.model).toBe('agent');
        expect(requests[0]!.messages[0]).toMatchObject({ role: 'system' });
        expect((requests[0]!.messages[0]!.content as string)).toContain('Current tab: 1');
        expect(requests[0]!.tools!.map(tool => tool.function.name)).toEqual(['echo', 'shot']);
        expect(requests[1]!.messages.slice(1)).toEqual([
            { role: 'user', content: 'say hi' },
            { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'echo', arguments: '{"text":"hi"}' } }] },
            { role: 'tool', tool_call_id: 'call_1', content: 'echo:hi' },
        ]);
        expect(events.filter(event => event.type !== 'assistant')).toEqual([
            { type: 'running', running: true },
            { type: 'user', text: 'say hi' },
            { type: 'tool-start', id: 'call_1', name: 'echo', args: '{"text":"hi"}' },
            { type: 'tool-end', id: 'call_1', text: 'echo:hi', images: [], isError: false },
            { type: 'running', running: false },
        ]);
        expect(events.filter(event => event.type === 'assistant').map(event => (event as { text: string }).text).join('')).toBe('Done');
    });

    test('reports invalid JSON arguments back to the model', async () => {
        const { agent, requests } = setup([toolCallChunks('c', 'echo', '{bad'), textChunks('ok')]);
        await agent.send('x');
        expect(requests[1]!.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c' });
        expect(requests[1]!.messages.at(-1)!.content).toStartWith('Error: Arguments are not valid JSON');
    });

    test('sends screenshots as a user image message and drops older ones', async () => {
        const { agent, requests } = setup([
            toolCallChunks('s1', 'shot', '{}'),
            toolCallChunks('s2', 'shot', '{}'),
            textChunks('seen'),
        ]);
        await agent.send('look');
        const last = requests[2]!.messages;
        const imageMessages = last.filter(message => message.role === 'user' && Array.isArray(message.content));
        expect(imageMessages).toHaveLength(2);
        expect(imageMessages[0]!.content).toEqual([
            { type: 'text', text: 'Screenshot from the last tool call:' },
            { type: 'text', text: '[earlier image removed]' },
        ]);
        expect(imageMessages[1]!.content).toEqual([
            { type: 'text', text: 'Screenshot from the last tool call:' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
        ]);
    });

    test('surfaces stream errors and can run again', async () => {
        const { agent, events } = setup([]);
        await agent.send('x');
        expect(events).toContainEqual({ type: 'error', message: 'no more turns' });
        expect(agent.running).toBe(false);
    });

    test('stop aborts a running turn', async () => {
        let release: () => void = () => {};
        const events: AgentEvent[] = [];
        const agent = new Agent({
            stream: () => async function* (_request, signal) {
                await new Promise<void>((resolve) => {
                    release = resolve;
                    signal.addEventListener('abort', () => resolve());
                });
                if (signal.aborted) throw new DOMException('aborted', 'AbortError');
            },
            tools: new ToolRegistry(),
            context: { source: 'panel', confirm: async () => true },
            model: () => 'agent',
            describeEnvironment: async () => '',
            emit: event => events.push(event),
        });
        const run = agent.send('wait');
        await Bun.sleep(1);
        expect(agent.running).toBe(true);
        agent.stop();
        await run;
        release();
        expect(events).toContainEqual({ type: 'error', message: 'Stopped.' });
        expect(agent.running).toBe(false);
    });
});
