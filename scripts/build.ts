import { cp, rm } from 'node:fs/promises';
import { watch } from 'node:fs';

const OUT_DIR = 'dist';
const ENTRYPOINTS = ['src/background/index.ts', 'src/sidepanel/main.ts'];
const OUTPUT_NAMES: Record<string, string> = { index: 'background', main: 'sidepanel' };

async function build() {
    await rm(OUT_DIR, { recursive: true, force: true });
    for (const entry of ENTRYPOINTS) {
        const name = entry.split('/').pop()!.replace(/\.ts$/, '');
        const result = await Bun.build({
            entrypoints: [entry],
            outdir: OUT_DIR,
            target: 'browser',
            format: 'esm',
            naming: `${OUTPUT_NAMES[name] ?? name}.js`,
            sourcemap: 'linked',
        });
        if (!result.success) {
            for (const log of result.logs) console.error(log);
            throw new Error(`Build failed for ${entry}`);
        }
    }
    await cp('static', OUT_DIR, { recursive: true });
    console.log(`Built extension into ${OUT_DIR}/`);
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
