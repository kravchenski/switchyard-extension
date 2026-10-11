export interface Settings {
    gatewayUrl: string;
    apiKey: string;
    model: string;
    /** Ask once per site before the agent clicks or types there. */
    askBeforeActing: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
    gatewayUrl: 'http://127.0.0.1:3260',
    apiKey: '',
    model: 'agent',
    askBeforeActing: true,
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
