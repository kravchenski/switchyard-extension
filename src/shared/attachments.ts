/** A file the user attached in the side panel, kept as base64 so it can travel over extension messaging. */
export interface Attachment {
    name: string;
    mimeType: string;
    size: number;
    data: string;
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CREATED_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|toml|ini|log|html?|css|js|ts|py|sql)$/i;

export function isImage(file: Pick<Attachment, 'mimeType'>) {
    return /^image\/(png|jpe?g|gif|webp)$/.test(file.mimeType);
}

export function isText(file: Pick<Attachment, 'name' | 'mimeType'>) {
    return file.mimeType.startsWith('text/') || /json|xml|yaml|csv/.test(file.mimeType) || TEXT_EXTENSIONS.test(file.name);
}

export function encodeText(text: string) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return { data: btoa(binary), size: bytes.length };
}

const MIME_TYPES: Record<string, string> = {
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
    html: 'text/html', htm: 'text/html', xml: 'application/xml', yaml: 'application/yaml', yml: 'application/yaml',
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
};

export function mimeTypeFor(name: string) {
    return MIME_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export function decodeText(data: string) {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n[truncated]` : text;
}

export function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
