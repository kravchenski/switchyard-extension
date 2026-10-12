import type { Attachment } from '../shared/attachments.ts';

// Files attached in this conversation, by name, so upload_file can put them into pages.
const files = new Map<string, Attachment>();

export function addAttachments(attachments: Attachment[]) {
    for (const file of attachments) files.set(file.name, file);
}

export function getAttachment(name: string) {
    return files.get(name);
}

export function attachmentNames() {
    return [...files.keys()];
}

export function clearAttachments() {
    files.clear();
}
