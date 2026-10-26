import { cp, rm } from 'node:fs/promises';
import { watch } from 'node:fs';

/**
 * `--headless` builds `dist-headless/` for a server with no one to click an approval: the agent may act on any site
 * without asking, and the gateway address and key come from SWITCHYARD_GATEWAY_URL and SWITCHYARD_API_KEY. The
 * result carries that key: it stays on the server and is never published.
 */
const HEADLESS = process.argv.includes('--headless') || process.env.SWITCHYARD_HEADLESS === '1';
const OUT_DIR = HEADLESS ? 'dist-headless' : 'dist';
const BUILD_DEFAULTS = HEADLESS
    ? {
        askBeforeActing: false,
        bridgeAutoApprove: true,
        ...(process.env.SWITCHYARD_GATEWAY_URL ? { gatewayUrl: process.env.SWITCHYARD_GATEWAY_URL } : {}),
        ...(process.env.SWITCHYARD_API_KEY ? { apiKey: process.env.SWITCHYARD_API_KEY } : {}),
    }
    : undefined;
const ENTRYPOINTS: Record<string, string> = {
    background: 'src/background/index.ts',
    sidepanel: 'src/sidepanel/main.ts',
    options: 'src/options/main.ts',
};

async function build() {
    await rm(OUT_DIR, { recursive: true, force: true });
    for (const [name, entry] of Object.entries(ENTRYPOINTS)) {
        const result = await Bun.build({
            entrypoints: [entry],
            outdir: OUT_DIR,
            target: 'browser',
            format: 'esm',
            naming: `${name}.js`,
            sourcemap: 'linked',
            define: { BUILD_DEFAULTS: JSON.stringify(BUILD_DEFAULTS ?? null) },
        });
        if (!result.success) {
            for (const log of result.logs) console.error(log);
            throw new Error(`Build failed for ${entry}`);
        }
    }
    await cp('static', OUT_DIR, { recursive: true });
    console.log(`Built extension into ${OUT_DIR}/${HEADLESS ? ' (headless: acts on any site without asking)' : ''}`);
}

await build();

if (process.argv.includes('--watch')) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rebuild = () => {
        clearTimeout(timer);
        timer = setTimeout(() => build().catch(console.error), 100);
    };
    watch('src', { recursive: true }, rebuild);
    watch('static', { recursive: true }, rebuild);
    console.log('Watching for changes…');
}
