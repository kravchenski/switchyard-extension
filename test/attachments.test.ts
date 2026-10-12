import { describe, expect, test } from 'bun:test';
import { userContent } from '../src/background/agent.ts';
import { askUser } from '../src/tools/ask.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe('userContent', () => {
    test('plain text without attachments', () => {
        expect(userContent('hi')).toBe('hi');
    });

    test('text files inline, images as images, other files as a note', () => {
        const parts = userContent('Fill the form', [
            { name: 'notes.md', mimeType: 'text/markdown', size: 9, data: base64('Имя: Max') },
            { name: 'photo.png', mimeType: 'image/png', size: 3, data: 'AAAA' },
            { name: 'cv.pdf', mimeType: 'application/pdf', size: 2048, data: 'JVBERi0=' },
        ]);
        expect(Array.isArray(parts)).toBe(true);
        const texts = (parts as { type: string; text?: string }[]).filter(part => part.type === 'text').map(part => part.text);
        expect(texts[0]).toBe('Fill the form');
        expect(texts[1]).toContain('<file name="notes.md">\nИмя: Max\n</file>');
        expect(parts).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
        expect(texts.at(-1)).toContain('"cv.pdf" (application/pdf, 2 KB)');
        expect(texts.at(-1)).toContain('upload_file');
    });
});

describe('ask_user', () => {
    const registry = new ToolRegistry().register(askUser);

    test('fails without the side panel', async () => {
        const result = await registry.call('ask_user', { question: 'Name?' }, { source: 'bridge', confirm: async () => true });
        expect(result.isError).toBe(true);
    });

    test('returns the answer and passes trimmed options', async () => {
        let asked: unknown;
        const result = await registry.call('ask_user', { question: 'City?', options: [' Warsaw ', '', 'Kraków'] }, {
            source: 'panel',
            confirm: async () => true,
            ask: async (request) => {
                asked = request;
                return 'Warsaw';
            },
        });
        expect(asked).toEqual({ question: 'City?', options: ['Warsaw', 'Kraków'], multiSelect: false });
        expect(result.content).toEqual([{ type: 'text', text: 'The user answered: Warsaw' }]);
    });
});

describe('create_file', () => {
    test('stores text files for upload_file and rejects bad base64', async () => {
        const { createFile } = await import('../src/tools/files.ts');
        const { getAttachment, onFileCreated } = await import('../src/background/attachments.ts');
        const registry = new ToolRegistry().register(createFile);
        const context = { source: 'panel' as const, confirm: async () => true };
        const created: string[] = [];
        onFileCreated(file => created.push(file.name));

        const result = await registry.call('create_file', { name: 'cover/letter.md', content: 'Привет' }, context);
        expect(result.isError).toBeFalsy();
        const file = getAttachment('cover_letter.md')!;
        expect(file.mimeType).toBe('text/markdown');
        expect(file.size).toBe(12);
        expect(new TextDecoder().decode(Uint8Array.from(atob(file.data), char => char.charCodeAt(0)))).toBe('Привет');
        expect(created).toEqual(['cover_letter.md']);

        const bad = await registry.call('create_file', { name: 'x.bin', content: '!!!', encoding: 'base64' }, context);
        expect(bad.isError).toBe(true);
    });
});
