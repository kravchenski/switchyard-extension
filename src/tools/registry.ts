export type JsonSchema = {
    type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
    description?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    items?: JsonSchema;
    enum?: readonly (string | number)[];
    minimum?: number;
    maximum?: number;
    additionalProperties?: boolean;
};

export type ToolContent =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
    content: ToolContent[];
    isError?: boolean;
}

export type ToolSource = 'panel' | 'bridge';

export interface ToolContext {
    source: ToolSource;
    signal?: AbortSignal;
    /** Asks the user before a sensitive action; resolves false when declined. */
    confirm(request: ConfirmRequest): Promise<boolean>;
}

export interface ConfirmRequest {
    tool: string;
    summary: string;
    origin?: string;
}

export type Args = Record<string, unknown>;

export interface Tool {
    name: string;
    description: string;
    inputSchema: JsonSchema & { type: 'object' };
    run(args: Args, context: ToolContext): Promise<ToolResult>;
}

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: JsonSchema;
}

export class ToolError extends Error {}

export function text(value: string): ToolResult {
    return { content: [{ type: 'text', text: value }] };
}

export function json(value: unknown): ToolResult {
    return text(JSON.stringify(value, null, 2));
}

export function validate(schema: JsonSchema, value: unknown, path = 'args'): string[] {
    if (value === undefined) return [];
    const errors: string[] = [];
    switch (schema.type) {
        case 'object': {
            if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path} must be an object`];
            const record = value as Record<string, unknown>;
            for (const key of schema.required ?? []) {
                if (record[key] === undefined) errors.push(`${path}.${key} is required`);
            }
            for (const [key, item] of Object.entries(record)) {
                const property = schema.properties?.[key];
                if (property) errors.push(...validate(property, item, `${path}.${key}`));
                else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
            }
            return errors;
        }
        case 'array':
            if (!Array.isArray(value)) return [`${path} must be an array`];
            if (schema.items) value.forEach((item, index) => errors.push(...validate(schema.items!, item, `${path}[${index}]`)));
            return errors;
        case 'integer':
            if (!Number.isInteger(value)) return [`${path} must be an integer`];
            break;
        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path} must be a number`];
            break;
        case 'string':
            if (typeof value !== 'string') return [`${path} must be a string`];
            break;
        case 'boolean':
            if (typeof value !== 'boolean') return [`${path} must be a boolean`];
            break;
    }
    if (schema.enum && !schema.enum.includes(value as string | number)) {
        errors.push(`${path} must be one of ${schema.enum.join(', ')}`);
    }
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
        if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
    }
    return errors;
}

export class ToolRegistry {
    private readonly tools = new Map<string, Tool>();

    register(...tools: Tool[]) {
        for (const tool of tools) {
            if (this.tools.has(tool.name)) throw new Error(`Duplicate tool ${tool.name}`);
            this.tools.set(tool.name, tool);
        }
        return this;
    }

    definitions(): ToolDefinition[] {
        return [...this.tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    }

    async call(name: string, args: unknown, context: ToolContext): Promise<ToolResult> {
        const tool = this.tools.get(name);
        if (!tool) return errorResult(`Unknown tool ${name}`);
        const input = args ?? {};
        const errors = validate(tool.inputSchema, input);
        if (errors.length) return errorResult(`Invalid arguments: ${errors.join('; ')}`);
        try {
            return await tool.run(input as Args, context);
        } catch (error) {
            return errorResult(error instanceof Error ? error.message : String(error));
        }
    }
}

export function errorResult(message: string): ToolResult {
    return { content: [{ type: 'text', text: message }], isError: true };
}
