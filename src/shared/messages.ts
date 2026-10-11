import type { ConfirmRequest, ToolDefinition, ToolResult } from '../tools/registry.ts';

export const PANEL_PORT = 'panel';

export type PanelToBackground =
    | { type: 'call'; id: string; name: string; args: unknown }
    | { type: 'confirm-reply'; id: string; ok: boolean };

export type BackgroundToPanel =
    | { type: 'tools'; tools: ToolDefinition[] }
    | { type: 'result'; id: string; result: ToolResult }
    | { type: 'confirm'; id: string; request: ConfirmRequest };
