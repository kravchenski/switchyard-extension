import type { Settings } from '../shared/settings.ts';
import { sseData } from './sse.ts';

export interface ChatToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

export type ChatContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage =
    | { role: 'system' | 'user'; content: string | ChatContentPart[] }
    | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
    | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatTool {
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
}

export interface ChatRequest {
    model: string;
    messages: ChatMessage[];
    tools?: ChatTool[];
}

export interface ChatChunk {
    choices?: {
        delta?: {
            content?: string | null;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
        finish_reason?: string | null;
    }[];
    error?: { message?: string };
}

export type ChatStream = (request: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatChunk>;

function headers(settings: Settings) {
    const result: Record<string, string> = { 'content-type': 'application/json' };
    if (settings.apiKey) result.authorization = `Bearer ${settings.apiKey}`;
    return result;
}

function endpoint(settings: Settings, path: string) {
    return `${settings.gatewayUrl.replace(/\/+$/, '')}${path}`;
}

async function failure(response: Response) {
    let message = `${response.status} ${response.statusText}`;
    try {
        const body = await response.json() as { error?: { message?: string } | string };
        const detail = typeof body.error === 'string' ? body.error : body.error?.message;
        if (detail) message = `${message}: ${detail}`;
    } catch {
        // Keep the status line.
    }
    if (response.status === 403) message += '. Allow this extension in Switchyard or set an API key in the extension options.';
    return new Error(`Switchyard ${message}`);
}

async function request(settings: Settings, path: string, init: RequestInit) {
    try {
        return await fetch(endpoint(settings, path), init);
    } catch (error) {
        throw new Error(`Cannot reach Switchyard at ${settings.gatewayUrl}. Is it running? (${(error as Error).message})`);
    }
}

export async function listModels(settings: Settings): Promise<string[]> {
    const response = await request(settings, '/v1/models', { headers: headers(settings) });
    if (!response.ok) throw await failure(response);
    const body = await response.json() as { data?: { id: string }[] };
    return (body.data ?? []).map(model => model.id);
}

export function chatStream(settings: Settings): ChatStream {
    return async function* (chat, signal) {
        const response = await request(settings, '/v1/chat/completions', {
            method: 'POST',
            headers: headers(settings),
            body: JSON.stringify({ ...chat, stream: true }),
            signal,
        });
        if (!response.ok) throw await failure(response);
        if (!response.body) throw new Error('Switchyard returned an empty response');
        for await (const data of sseData(response.body)) {
            let chunk: ChatChunk;
            try {
                chunk = JSON.parse(data) as ChatChunk;
            } catch {
                continue;
            }
            if (chunk.error) throw new Error(`Switchyard: ${chunk.error.message ?? 'stream error'}`);
            yield chunk;
        }
    };
}
