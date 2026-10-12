import type { AgentEvent } from '../background/agent.ts';
import type { ConfirmRequest } from '../tools/registry.ts';

export const PANEL_PORT = 'panel';

export type PanelToBackground =
    | { type: 'confirm-reply'; id: string; ok: boolean }
    | { type: 'chat'; text: string }
    | { type: 'stop' }
    | { type: 'reset' }
    | { type: 'list-models' };

export type BackgroundToPanel =
    | { type: 'confirm'; id: string; request: ConfirmRequest }
    | { type: 'transcript'; events: AgentEvent[]; running: boolean }
    | { type: 'agent'; event: AgentEvent }
    | { type: 'models'; models: string[]; error?: string }
    | { type: 'bridge'; status: BridgeStatus };

export interface BridgeStatus {
    enabled: boolean;
    connected: boolean;
    error?: string;
}
