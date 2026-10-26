import { afterEach, describe, expect, test } from 'bun:test';

/** `bun run build --headless` defines BUILD_DEFAULTS; the default build must keep every approval on. */
declare global { var BUILD_DEFAULTS: unknown }

async function settingsModule() {
    return await import(`../src/shared/settings.ts?${Math.random()}`) as typeof import('../src/shared/settings.ts');
}

afterEach(() => { delete (globalThis as { BUILD_DEFAULTS?: unknown }).BUILD_DEFAULTS; });

describe('settings defaults', () => {
    test('the normal build asks before acting and does not let agents act unattended', async () => {
        const { DEFAULT_SETTINGS } = await settingsModule();
        expect(DEFAULT_SETTINGS.askBeforeActing).toBe(true);
        expect(DEFAULT_SETTINGS.bridgeAutoApprove).toBe(false);
    });

    test('a headless build turns the approvals off and can set the gateway', async () => {
        globalThis.BUILD_DEFAULTS = { askBeforeActing: false, bridgeAutoApprove: true, gatewayUrl: 'http://127.0.0.1:3261' };
        const { DEFAULT_SETTINGS } = await settingsModule();
        expect(DEFAULT_SETTINGS.askBeforeActing).toBe(false);
        expect(DEFAULT_SETTINGS.bridgeAutoApprove).toBe(true);
        expect(DEFAULT_SETTINGS.gatewayUrl).toBe('http://127.0.0.1:3261');
        expect(DEFAULT_SETTINGS.bridgeEnabled).toBe(true);
    });
});
