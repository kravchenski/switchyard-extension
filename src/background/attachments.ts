import type { Attachment } from '../shared/attachments.ts';

// Files attached or created in this conversation, by name, so upload_file can put them into pages.
// They live only in memory; nothing is written to disk unless the user downloads a file from the chat.
const files = new Map<string, Attachment>();
const createdListeners = new Set<(file: Attachment) => void>();

export function addAttachments(attachments: Attachment[]) {
    for (const file of attachments) files.set(file.name, file);
}

/** Stores a file the agent made and tells the chat so the user can see and download it. */
export function addCreatedFile(file: Attachment) {
    files.set(file.name, file);
    for (const listener of createdListeners) listener(file);
}

export function onFileCreated(listener: (file: Attachment) => void) {
    createdListeners.add(listener);
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
