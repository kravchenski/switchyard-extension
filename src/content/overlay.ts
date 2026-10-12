// Injected with chrome.scripting.executeScript, so every function must be self-contained.
// The overlay never takes pointer events, so clicks still reach the page under it.

/** Shows the frame around the page and the status bar; Stop only works for the side panel agent. */
export function showOverlay(label: string, stoppable: boolean) {
    const id = 'switchyard-overlay';
    let host = document.getElementById(id);
    if (!host) {
        host = document.createElement('div');
        host.id = id;
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `
            <style>
                .frame { position: fixed; inset: 0; box-shadow: inset 0 0 0 3px #34a873, inset 0 0 18px rgb(52 168 115 / 0.35); }
                .bar {
                    position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
                    display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 14px;
                    border: 1px solid #272b32; border-radius: 999px; background: #171a1f; color: #e8eaed;
                    font: 500 13px/1.4 system-ui, sans-serif; box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
                    pointer-events: auto; white-space: nowrap;
                }
                .bar:not(.stoppable) { padding-right: 14px; }
                .bar button {
                    height: 26px; padding: 0 12px; border: 1px solid #3b414a; border-radius: 999px;
                    background: #1e2228; color: #e8eaed; font: inherit; cursor: pointer;
                }
                .bar:not(.stoppable) button { display: none; }
                .cursor { position: fixed; left: 0; top: 0; width: 24px; height: 24px; opacity: 0; overflow: visible; filter: drop-shadow(0 0 3px #2fbf7f) drop-shadow(0 0 8px rgb(47 191 127 / 0.7)); transition: transform 0.4s cubic-bezier(0.3, 0.7, 0.4, 1), opacity 0.2s; }
                .ripple { position: fixed; width: 28px; height: 28px; margin: -14px 0 0 -14px; border: 2px solid #34a873; border-radius: 50%; animation: ripple 0.45s ease-out forwards; }
                @keyframes ripple { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
                @media (prefers-reduced-motion: reduce) { .cursor { transition: opacity 0.2s; } .ripple { animation-duration: 0.01s; } }
            </style>
            <div class="frame" hidden></div>
            <div class="bar" hidden><span class="label"></span><button type="button">Stop</button></div>
            <svg class="cursor" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.4 2.9 6.6 3.1-1.4-2.9-6.5H18z" fill="#ffffff" stroke="#2fbf7f" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
        root.querySelector('button')!.addEventListener('click', () => {
            void chrome.runtime.sendMessage({ type: 'stop-agent' });
        });
        document.documentElement.append(host);
    }
    const root = host.shadowRoot!;
    root.querySelector<HTMLElement>('.frame')!.hidden = false;
    const bar = root.querySelector<HTMLElement>('.bar')!;
    bar.hidden = false;
    bar.classList.toggle('stoppable', stoppable);
    bar.querySelector('.label')!.textContent = label;
}

export function hideOverlay() {
    document.getElementById('switchyard-overlay')?.remove();
}

/** Hides the overlay while a screenshot is taken so the model sees the page as it is. */
export function setOverlayVisible(visible: boolean) {
    const host = document.getElementById('switchyard-overlay');
    if (host) host.style.visibility = visible ? 'visible' : 'hidden';
}

/** Glides the cursor to a viewport point and, for a click, draws a ripple there. Resolves when it has arrived. */
export async function moveCursor(x: number, y: number, press: boolean) {
    const root = document.getElementById('switchyard-overlay')?.shadowRoot;
    const cursor = root?.querySelector<SVGElement>('.cursor');
    if (!root || !cursor) return;
    const first = cursor.style.opacity !== '1';
    if (first) {
        cursor.style.transition = 'none';
        cursor.style.transform = `translate(${x - 80}px, ${y + 60}px)`;
        cursor.getBoundingClientRect();
        cursor.style.transition = '';
    }
    cursor.style.opacity = '1';
    cursor.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    await new Promise(resolve => setTimeout(resolve, reduced ? 0 : 420));
    if (!press) return;
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    root.append(ripple);
    setTimeout(() => ripple.remove(), 500);
}
