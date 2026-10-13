import { describe, expect, test } from 'bun:test';
import { ToolRegistry, validate, type Tool, type ToolContext } from '../src/tools/registry.ts';

const context: ToolContext = { source: 'panel', confirm: async () => true };

const echo: Tool = {
    name: 'echo',
    description: 'Echo',
    inputSchema: {
        type: 'object',
        properties: {
            text: { type: 'string' },
            count: { type: 'integer', minimum: 1 },
            mode: { type: 'string', enum: ['a', 'b'] },
            ids: { type: 'array', items: { type: 'integer' } },
        },
        required: ['text'],
    },
    async run(args) {
        return { content: [{ type: 'text', text: String(args.text) }] };
    },
};

describe('validate', () => {
    test('accepts valid input', () => {
        expect(validate(echo.inputSchema, { text: 'hi', count: 2, mode: 'a', ids: [1, 2] })).toEqual([]);
    });

    test('reports missing, mistyped and out-of-range fields', () => {
        expect(validate(echo.inputSchema, { count: 0, mode: 'c', ids: [1, 'x'] })).toEqual([
            'args.text is required',
            'args.count must be >= 1',
            'args.mode must be one of a, b',
            'args.ids[1] must be an integer',
        ]);
    });

    test('rejects non-objects', () => {
        expect(validate(echo.inputSchema, [])).toEqual(['args must be an object']);
    });
});

describe('ToolRegistry', () => {
    const registry = new ToolRegistry().register(echo);

    test('runs a tool with valid arguments', async () => {
        expect(await registry.call('echo', { text: 'hi' }, context)).toEqual({ content: [{ type: 'text', text: 'hi' }] });
    });

    test('returns an error result instead of throwing', async () => {
        expect((await registry.call('echo', {}, context)).isError).toBe(true);
        const missing = await registry.call('missing', {}, context);
        expect(missing.isError).toBe(true);
        expect(missing.content[0]).toEqual({ type: 'text', text: 'Unknown tool missing. Available tools: echo' });
    });

    test('suggests similar tools for a near-miss name', async () => {
        const many = new ToolRegistry().register(echo, { ...echo, name: 'read_page', run: async () => ({ content: [] }) });
        const result = await many.call('readpage', {}, context);
        expect(result.isError).toBe(true);
        expect(result.content[0]).toMatchObject({ type: 'text' });
        expect((result.content[0] as { text: string }).text).toContain('Did you mean: read_page');
    });

    test('turns thrown errors into error results', async () => {
        const failing = new ToolRegistry().register({ ...echo, name: 'fail', run: async () => { throw new Error('boom'); } });
        expect(await failing.call('fail', { text: 'x' }, context)).toEqual({ content: [{ type: 'text', text: 'boom' }], isError: true });
    });

    test('rejects duplicate names', () => {
        expect(() => new ToolRegistry().register(echo, echo)).toThrow('Duplicate tool echo');
    });

    test('lists definitions without the run function', () => {
        expect(registry.definitions()).toEqual([{ name: 'echo', description: 'Echo', inputSchema: echo.inputSchema }]);
    });
});
