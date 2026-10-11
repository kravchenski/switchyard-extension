import { expect, test } from 'bun:test';
import { sseData } from '../src/background/sse.ts';

function streamOf(...chunks: string[]) {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
}

async function collect(stream: ReadableStream<Uint8Array>) {
    const result: string[] = [];
    for await (const data of sseData(stream)) result.push(data);
    return result;
}

test('yields data payloads split across chunks', async () => {
    expect(await collect(streamOf('data: {"a"', ':1}\n\n', 'data: {"b":2}\r\n\r\n'))).toEqual(['{"a":1}', '{"b":2}']);
});

test('ignores comments and other fields', async () => {
    expect(await collect(streamOf(': keepalive\n\nevent: message\nid: 3\ndata: x\n\n'))).toEqual(['x']);
});

test('joins multi-line data', async () => {
    expect(await collect(streamOf('data: one\ndata: two\n\n'))).toEqual(['one\ntwo']);
});

test('stops at [DONE]', async () => {
    expect(await collect(streamOf('data: a\n\ndata: [DONE]\n\ndata: b\n\n'))).toEqual(['a']);
});

test('flushes a final event without a blank line', async () => {
    expect(await collect(streamOf('data: a\n\ndata: tail'))).toEqual(['a', 'tail']);
});
