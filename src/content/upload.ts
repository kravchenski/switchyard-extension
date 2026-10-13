// Injected with chrome.scripting.executeScript, so it must be self-contained.

/**
 * Puts a file into the file input at or near the element with the ref: the input itself, one inside it
 * (a drop zone), the one its label points to, or the only file input in the same form or page.
 * Without any input, it drops the file onto the element as a drag-and-drop would.
 */
export function uploadToRef(ref: string, source: { name: string; mimeType: string; data: string } | { prepare: true }) {
    // File inputs and their upload buttons can live inside open shadow roots.
    const find = (root: Document | ShadowRoot | Element, selector: string): Element | null => {
        const direct = root.querySelector(selector);
        if (direct) return direct;
        if (root instanceof Element && root.shadowRoot) {
            const match = find(root.shadowRoot, selector);
            if (match) return match;
        }
        for (const host of root.querySelectorAll('*')) {
            if (!host.shadowRoot) continue;
            const match = find(host.shadowRoot, selector);
            if (match) return match;
        }
        return null;
    };
    const target = find(document, `[data-sy-ref="${CSS.escape(ref)}"]`);
    if (!target) return { ok: false, error: `No element ${ref} on the page; call read_page or find again` };

    const isFileInput = (element: Element | null): element is HTMLInputElement => element instanceof HTMLInputElement && element.type === 'file';
    const only = (root: ParentNode | null) => {
        const inputs = root ? root.querySelectorAll('input[type="file"]') : [];
        return inputs.length === 1 ? inputs[0] as HTMLInputElement : undefined;
    };
    const labelled = target.closest('label');
    const input = (isFileInput(target) ? target : undefined)
        ?? (find(target, 'input[type="file"]') as HTMLInputElement | null)
        ?? (labelled?.control && isFileInput(labelled.control) ? labelled.control : undefined)
        ?? only(target.parentElement)
        ?? only(target.closest('form'))
        ?? only(target.getRootNode() as Document | ShadowRoot)
        ?? only(document);

    if ('prepare' in source) {
        if (!input) return { ok: false, error: `No unambiguous file input near ${ref}; pass the ref of its file input or upload button. For a drop-only area, use an attached file with file instead of filePath.` };
        if (input.disabled) return { ok: false, error: `The file input near ${ref} is disabled` };
        // Extension reloads reset isolated-world state but leave DOM refs behind.
        // Use an independent unique ref if a hidden input needs one or its ref collides.
        let inputRef = input.getAttribute('data-sy-ref');
        if (!inputRef || find(document, `[data-sy-ref="${CSS.escape(inputRef)}"]`) !== input) {
            const state = window as unknown as { __syRefCounter?: number };
            state.__syRefCounter ??= 0;
            do {
                inputRef = `ref_${++state.__syRefCounter}`;
            } while (find(document, `[data-sy-ref="${inputRef}"]`));
            input.setAttribute('data-sy-ref', inputRef);
        }
        return { ok: true, inputRef };
    }

    const { name, mimeType, data } = source;
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type: mimeType }));

    if (input) {
        if (input.disabled) return { ok: false, error: `The file input near ${ref} is disabled` };
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, via: 'input', name };
    }
    for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
    return { ok: true, via: 'drop', name };
}
