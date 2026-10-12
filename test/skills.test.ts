import { describe, expect, test } from 'bun:test';
import { SYSTEM_PROMPT } from '../src/background/agent.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { useSkill } from '../src/tools/skills.ts';

describe('skills', () => {
    const registry = new ToolRegistry().register(useSkill);
    const context = { source: 'panel' as const, confirm: async () => true };

    test('the system prompt lists the resume skill', () => {
        expect(SYSTEM_PROMPT).toContain('- resume: ');
    });

    test('use_skill returns the instructions', async () => {
        const result = await registry.call('use_skill', { name: 'resume' }, context);
        const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
        expect(text).toContain('Never invent employers');
        expect(text).toContain('Hidden or white text');
    });

    test('unknown skills are rejected by the schema', async () => {
        const result = await registry.call('use_skill', { name: 'nope' }, context);
        expect(result.isError).toBe(true);
    });
});
