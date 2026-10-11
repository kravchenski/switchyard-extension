// Functions in this file are injected with chrome.scripting.executeScript({ func }).
// Chrome serializes each one on its own, so every helper must live inside the function body.

export interface SnapshotOptions {
    mode: 'interactive' | 'all';
    maxChars: number;
    query?: string;
    limit?: number;
}

export interface Snapshot {
    url: string;
    title: string;
    viewport: { width: number; height: number; scrollX: number; scrollY: number; pageHeight: number };
    text: string;
    truncated: boolean;
}

export function snapshotPage(options: SnapshotOptions): Snapshot {
    const REF_ATTRIBUTE = 'data-sy-ref';
    const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'switch', 'textbox', 'combobox', 'searchbox', 'slider', 'spinbutton', 'treeitem']);
    const LANDMARKS = new Set(['main', 'navigation', 'banner', 'contentinfo', 'complementary', 'form', 'search', 'dialog', 'region', 'heading', 'list', 'table', 'row', 'img']);
    const TAG_ROLES: Record<string, string> = {
        a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', summary: 'button',
        h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
        nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary',
        form: 'form', dialog: 'dialog', ul: 'list', ol: 'list', table: 'table', tr: 'row', img: 'img', option: 'option',
    };
    const INPUT_ROLES: Record<string, string> = {
        checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox',
        button: 'button', submit: 'button', reset: 'button', image: 'button',
    };
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'HEAD', 'META', 'LINK']);

    const state = window as unknown as { __syRefCounter?: number };
    state.__syRefCounter ??= 0;

    const clean = (value: string | null | undefined, max = 100) => {
        const text = (value ?? '').replace(/\s+/g, ' ').trim();
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    };

    const roleOf = (element: Element) => {
        const explicit = element.getAttribute('role');
        if (explicit) return explicit.split(' ')[0]!;
        const tag = element.tagName.toLowerCase();
        if (tag === 'input') {
            const type = (element as HTMLInputElement).type;
            return type === 'hidden' ? '' : INPUT_ROLES[type] ?? 'textbox';
        }
        if (tag === 'a' && !element.hasAttribute('href')) return '';
        if ((element as HTMLElement).isContentEditable && element.getAttribute('contenteditable') !== null) return 'textbox';
        return TAG_ROLES[tag] ?? '';
    };

    const isInteractive = (element: Element, role: string) => {
        if (INTERACTIVE_ROLES.has(role)) return true;
        const tabIndex = element.getAttribute('tabindex');
        return tabIndex !== null && Number(tabIndex) >= 0;
    };

    const isVisible = (element: Element) => {
        if (element.getAttribute('aria-hidden') === 'true') return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };

    const nameOf = (element: Element, role: string) => {
        const label = element.getAttribute('aria-label');
        if (label) return clean(label);
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
            if (text.trim()) return clean(text);
        }
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
            const labels = element.labels ? [...element.labels].map(item => item.textContent).join(' ') : '';
            if (labels.trim()) return clean(labels);
            if ('placeholder' in element && element.placeholder) return clean(element.placeholder);
        }
        const alt = element.getAttribute('alt') ?? element.getAttribute('title');
        if (alt) return clean(alt);
        // Containers would otherwise be named after all the text inside them.
        if (!role || (LANDMARKS.has(role) && role !== 'heading' && role !== 'img')) return '';
        const text = clean((element as HTMLElement).innerText ?? element.textContent);
        if (text) return text;
        const labelled = element.querySelector('img[alt], [aria-label], [title]');
        return clean(labelled?.getAttribute('alt') || labelled?.getAttribute('aria-label') || labelled?.getAttribute('title'));
    };

    const refOf = (element: Element) => {
        let ref = element.getAttribute(REF_ATTRIBUTE);
        if (!ref) {
            ref = `ref_${++state.__syRefCounter!}`;
            element.setAttribute(REF_ATTRIBUTE, ref);
        }
        return ref;
    };

    const describe = (element: Element, role: string) => {
        const parts = [`[${refOf(element)}]`, role || element.tagName.toLowerCase()];
        const name = nameOf(element, role);
        if (name) parts.push(JSON.stringify(name));
        if (role === 'heading') parts.push(`level=${element.tagName.slice(1)}`);
        if (element instanceof HTMLAnchorElement && element.href) parts.push(`href=${clean(element.href, 120)}`);
        if (element instanceof HTMLInputElement) {
            if (element.type === 'checkbox' || element.type === 'radio') parts.push(element.checked ? 'checked' : 'unchecked');
            else if (element.type !== 'password' && element.value) parts.push(`value=${JSON.stringify(clean(element.value, 60))}`);
            if (!['text', 'checkbox', 'radio', 'submit', 'button'].includes(element.type)) parts.push(`type=${element.type}`);
        }
        if (element instanceof HTMLTextAreaElement && element.value) parts.push(`value=${JSON.stringify(clean(element.value, 60))}`);
        if (element instanceof HTMLSelectElement) parts.push(`value=${JSON.stringify(clean(element.selectedOptions[0]?.textContent, 60))}`);
        if ((element as HTMLButtonElement).disabled) parts.push('disabled');
        const expanded = element.getAttribute('aria-expanded');
        if (expanded) parts.push(`expanded=${expanded}`);
        return parts.join(' ');
    };

    const lines: string[] = [];
    let length = 0;
    let truncated = false;
    const push = (line: string) => {
        if (truncated) return;
        if (length + line.length + 1 > options.maxChars) {
            truncated = true;
            return;
        }
        lines.push(line);
        length += line.length + 1;
    };

    if (options.query) {
        const needle = options.query.toLowerCase();
        const matches: { element: Element; role: string; score: number }[] = [];
        for (const element of document.body.querySelectorAll('*')) {
            if (SKIP_TAGS.has(element.tagName.toUpperCase())) continue;
            const role = roleOf(element);
            const interactive = isInteractive(element, role);
            if (!interactive && role !== 'heading' && role !== 'img') continue;
            const haystack = [nameOf(element, role || 'button'), element.getAttribute('placeholder'), element.id, element.getAttribute('name')]
                .join(' ').toLowerCase();
            if (!haystack.includes(needle) || !isVisible(element)) continue;
            matches.push({ element, role, score: interactive ? 0 : 1 });
        }
        matches.sort((a, b) => a.score - b.score);
        for (const match of matches.slice(0, options.limit ?? 20)) push(describe(match.element, match.role));
        if (!lines.length) push(`No visible elements match ${JSON.stringify(options.query)}`);
    } else {
        const walk = (node: Element, depth: number) => {
            if (truncated || SKIP_TAGS.has(node.tagName.toUpperCase())) return;
            if (!isVisible(node) && node !== document.body) return;
            const role = roleOf(node);
            const interactive = isInteractive(node, role);
            const shown = interactive || LANDMARKS.has(role);
            if (shown) push(`${'  '.repeat(depth)}${describe(node, role)}`);
            if (interactive && role !== 'textbox' && role !== 'combobox' && node.children.length === 0) return;
            if (options.mode === 'all' && !interactive) {
                for (const child of node.childNodes) {
                    if (child.nodeType === Node.TEXT_NODE) {
                        const text = clean(child.textContent, 300);
                        if (text) push(`${'  '.repeat(depth + (shown ? 1 : 0))}${text}`);
                    } else if (child instanceof Element) {
                        walk(child, depth + (shown ? 1 : 0));
                    }
                }
                return;
            }
            for (const child of node.children) walk(child, depth + (shown ? 1 : 0));
        };
        walk(document.body, 0);
    }

    return {
        url: location.href,
        title: document.title,
        viewport: {
            width: innerWidth,
            height: innerHeight,
            scrollX: Math.round(scrollX),
            scrollY: Math.round(scrollY),
            pageHeight: document.documentElement.scrollHeight,
        },
        text: lines.join('\n'),
        truncated,
    };
}

export interface ElementTarget {
    x: number;
    y: number;
    tag: string;
    editable: boolean;
    /** The center is outside the viewport even after scrolling, e.g. inside a clipped fixed sidebar. */
    offscreen: boolean;
}

/** Scrolls the element with this ref into view and returns its center in viewport CSS pixels. */
export function locateRef(ref: string): ElementTarget | null {
    const element = document.querySelector(`[data-sy-ref="${CSS.escape(ref)}"]`);
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const html = element as HTMLElement;
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    return {
        x,
        y,
        tag: element.tagName.toLowerCase(),
        editable: html.isContentEditable || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement,
        offscreen: x < 0 || y < 0 || x >= innerWidth || y >= innerHeight,
    };
}

export function pageText(maxChars: number) {
    const text = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim();
    return {
        url: location.href,
        title: document.title,
        text: text.slice(0, maxChars),
        truncated: text.length > maxChars,
    };
}
