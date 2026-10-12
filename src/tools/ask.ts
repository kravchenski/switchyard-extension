import { text, ToolError, type Tool } from './registry.ts';

export const askUser: Tool = {
    name: 'ask_user',
    description: 'Ask the user a question in the side panel and wait for the answer. Offer 2-6 short options when you can guess likely answers; the user can pick one with a click or type their own. Use it for details only the user knows, such as form fields, and for choices. One question per call.',
    inputSchema: {
        type: 'object',
        properties: {
            question: { type: 'string', description: 'The question, short and specific.' },
            options: { type: 'array', items: { type: 'string' }, description: 'Likely answers, each a few words.' },
            multiSelect: { type: 'boolean', description: 'Let the user pick several options.' },
        },
        required: ['question'],
    },
    async run(args, context) {
        if (!context.ask) throw new ToolError('ask_user only works in the Switchyard side panel chat; ask your user directly.');
        const options = ((args.options as string[] | undefined) ?? []).map(option => option.trim()).filter(Boolean).slice(0, 6);
        const answer = await context.ask({ question: args.question as string, options, multiSelect: !!args.multiSelect }, context.signal);
        return text(`The user answered: ${answer}`);
    },
};
