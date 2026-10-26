export interface Settings {
    gatewayUrl: string;
    apiKey: string;
    model: string;
    /** Ask once per site before the agent clicks or types there. */
    askBeforeActing: boolean;
    /** Keep a connection to Switchyard so coding agents can use the browser tools over MCP. */
    bridgeEnabled: boolean;
    /** Let agents act on new sites without asking when the side panel is closed. */
    bridgeAutoApprove: boolean;
}

/** Filled in by `bun run build --headless`: a build for a server, where nobody can click an approval. */
declare const BUILD_DEFAULTS: Partial<Settings> | null | undefined;

export const DEFAULT_SETTINGS: Settings = {
    gatewayUrl: 'http://127.0.0.1:3260',
    apiKey: '',
    model: 'agent',
    askBeforeActing: true,
    bridgeEnabled: true,
    bridgeAutoApprove: false,
    ...(typeof BUILD_DEFAULTS === 'undefined' ? {} : BUILD_DEFAULTS ?? {}),
};

export async function loadSettings(): Promise<Settings> {
    const { settings } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>) {
    const settings = { ...await loadSettings(), ...patch };
    await chrome.storage.local.set({ settings });
    return settings;
}
