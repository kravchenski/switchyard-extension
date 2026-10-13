import { uploadToRef } from '../content/upload.ts';
import { ToolError } from '../tools/registry.ts';
import { cdp } from './debugger.ts';
import { runInTab } from './scripting.ts';

interface DomNode {
    backendNodeId: number;
    attributes?: string[];
    children?: DomNode[];
    shadowRoots?: DomNode[];
}

/** Chrome reads the path on its own computer; file bytes never enter the model's context. */
export async function uploadLocalFile(tab: chrome.tabs.Tab & { id: number }, ref: string, filePath: string) {
    const target = await runInTab(tab, uploadToRef, ref, { prepare: true });
    if (!target.ok || !target.inputRef) throw new ToolError(target.error ?? 'Could not locate a file input');
    const { root } = await cdp<{ root: DomNode }>(tab.id, 'DOM.getDocument', { depth: -1, pierce: true });
    const find = (node: DomNode): DomNode | undefined => {
        const attributes = node.attributes ?? [];
        for (let index = 0; index < attributes.length; index += 2) {
            if (attributes[index] === 'data-sy-ref' && attributes[index + 1] === target.inputRef) return node;
        }
        for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
            const found = find(child);
            if (found) return found;
        }
        return undefined;
    };
    const input = find(root);
    if (!input) throw new ToolError('The file input disappeared before uploading; call find or read_page again');
    await cdp(tab.id, 'DOM.setFileInputFiles', { backendNodeId: input.backendNodeId, files: [filePath] });
}
