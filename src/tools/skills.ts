import { SKILLS } from '../skills/index.ts';
import { text, ToolError, type Tool } from './registry.ts';

export const useSkill: Tool = {
    name: 'use_skill',
    description: `Load step-by-step instructions for a kind of task before doing it. Skills: ${SKILLS.map(skill => `${skill.name} (${skill.description})`).join('; ')}`,
    inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', enum: SKILLS.map(skill => skill.name) } },
        required: ['name'],
    },
    async run(args) {
        const skill = SKILLS.find(entry => entry.name === args.name);
        if (!skill) throw new ToolError(`No skill "${args.name}"`);
        return text(skill.instructions);
    },
};
