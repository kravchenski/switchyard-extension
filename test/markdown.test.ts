import { describe, expect, test } from 'bun:test';
import { parseInline, parseMarkdown } from '../src/sidepanel/markdown.ts';

describe('parseInline', () => {
    test('bold, italic, code and links', () => {
        expect(parseInline('**Имя** (Given Name), *opt* `code` [docs](https://example.com)')).toEqual([
            { type: 'strong', children: [{ type: 'text', text: 'Имя' }] },
            { type: 'text', text: ' (Given Name), ' },
            { type: 'em', children: [{ type: 'text', text: 'opt' }] },
            { type: 'text', text: ' ' },
            { type: 'code', text: 'code' },
            { type: 'text', text: ' ' },
            { type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'docs' }] },
        ]);
    });

    test('keeps unsafe links and snake_case as text', () => {
        expect(parseInline('[x](javascript:alert(1)) snake_case_name')).toEqual([
            { type: 'text', text: '[x](javascript:alert(1)) snake_case_name' },
        ]);
    });
});

describe('parseMarkdown', () => {
    test('paragraphs, ordered and unordered lists', () => {
        const blocks = parseMarkdown([
            '**Обязательные поля:**',
            '1. **Имя** (Given Name)',
            '2. **Email**',
            '',
            '**Дополнительно:**',
            '- LinkedIn профиль',
            '- Дата начала работы',
            '',
            'Также нужно загрузить резюме.',
        ].join('\n'));
        expect(blocks.map(block => block.type)).toEqual(['p', 'list', 'p', 'list', 'p']);
        const ordered = blocks[1] as Extract<typeof blocks[number], { type: 'list' }>;
        expect(ordered.ordered).toBe(true);
        expect(ordered.items).toHaveLength(2);
        const bullets = blocks[3] as Extract<typeof blocks[number], { type: 'list' }>;
        expect(bullets.ordered).toBe(false);
        expect(bullets.items).toHaveLength(2);
    });

    test('nested lists, headings, code and tables', () => {
        const blocks = parseMarkdown([
            '## Steps',
            '- one',
            '  - inner',
            '- two',
            '```ts',
            'const a = 1;',
            '```',
            '| Field | Required |',
            '| --- | --- |',
            '| Email | yes |',
        ].join('\n'));
        expect(blocks.map(block => block.type)).toEqual(['h', 'list', 'code', 'table']);
        const list = blocks[1] as Extract<typeof blocks[number], { type: 'list' }>;
        expect(list.items).toHaveLength(2);
        expect(list.items[0]!.map(block => block.type)).toEqual(['p', 'list']);
        expect(blocks[2]).toEqual({ type: 'code', lang: 'ts', text: 'const a = 1;' });
        const table = blocks[3] as Extract<typeof blocks[number], { type: 'table' }>;
        expect(table.head).toHaveLength(2);
        expect(table.rows).toHaveLength(1);
    });

    test('an unclosed fence while streaming still renders as code', () => {
        expect(parseMarkdown('```\npartial')).toEqual([{ type: 'code', lang: '', text: 'partial' }]);
    });
});
