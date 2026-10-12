// Injected with chrome.scripting.executeScript, so it must be self-contained.

/**
 * Puts a file into the file input at or near the element with the ref: the input itself, one inside it
 * (a drop zone), the one its label points to, or the only file input in the same form or page.
 * Without any input, it drops the file onto the element as a drag-and-drop would.
 */
export function uploadToRef(ref: string, name: string, mimeType: string, data: string) {
    const target = document.querySelector(`[data-sy-ref="${CSS.escape(ref)}"]`);
    if (!target) return { ok: false, error: `No element ${ref} on the page; call read_page or find again` };
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type: mimeType }));

    const isFileInput = (element: Element | null): element is HTMLInputElement => element instanceof HTMLInputElement && element.type === 'file';
    const only = (root: ParentNode | null) => {
        const inputs = root ? root.querySelectorAll('input[type="file"]') : [];
        return inputs.length === 1 ? inputs[0] as HTMLInputElement : undefined;
    };
    const labelled = target.closest('label');
    const input = (isFileInput(target) ? target : undefined)
        ?? target.querySelector<HTMLInputElement>('input[type="file"]')
        ?? (labelled?.control && isFileInput(labelled.control) ? labelled.control : undefined)
        ?? only(target.parentElement)
        ?? only(target.closest('form'))
        ?? only(document);

    if (input) {
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
