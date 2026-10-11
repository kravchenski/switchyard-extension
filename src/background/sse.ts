/** Yields the data payload of each server-sent event, stopping at [DONE]. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data: string[] = [];
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline: number;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline).replace(/\r$/, '');
                buffer = buffer.slice(newline + 1);
                if (line === '') {
                    if (data.length) {
                        const payload = data.join('\n');
                        data = [];
                        if (payload === '[DONE]') return;
                        yield payload;
                    }
                } else if (line.startsWith('data:')) {
                    data.push(line.slice(5).replace(/^ /, ''));
                }
            }
        }
        const tail = buffer.startsWith('data:') ? [...data, buffer.slice(5).replace(/^ /, '')] : data;
        const payload = tail.join('\n');
        if (payload && payload !== '[DONE]') yield payload;
    } finally {
        reader.releaseLock();
    }
}
