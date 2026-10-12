import { addCreatedFile, attachmentNames, getAttachment } from '../background/attachments.ts';
import { ensureSiteAllowed } from '../background/permissions.ts';
import { runInTab } from '../background/scripting.ts';
import { workTab } from '../background/session.ts';
import { uploadToRef } from '../content/upload.ts';
import { encodeText, formatSize, MAX_CREATED_BYTES, mimeTypeFor } from '../shared/attachments.ts';
import { json, ToolError, type Tool } from './registry.ts';

export const createFile: Tool = {
    name: 'create_file',
    description: 'Create a file the user can download from the chat and that upload_file can put into a page, e.g. a cover letter or a CSV. Text content by default; pass base64 for binary files. Creating a file with an existing name replaces it.',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'File name with extension, e.g. cover-letter.md.' },
            content: { type: 'string', description: 'The file contents.' },
            encoding: { type: 'string', enum: ['text', 'base64'], description: 'How content is encoded (default text).' },
            mimeType: { type: 'string', description: 'Defaults to a type guessed from the extension.' },
        },
        required: ['name', 'content'],
    },
    async run(args) {
        const name = (args.name as string).trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
        if (!name) throw new ToolError('Give the file a name');
        let data: string;
        let size: number;
        if (args.encoding === 'base64') {
            data = (args.content as string).replace(/\s/g, '');
            try {
                size = atob(data).length;
            } catch {
                throw new ToolError('content is not valid base64');
            }
        } else {
            ({ data, size } = encodeText(args.content as string));
        }
        if (size > MAX_CREATED_BYTES) throw new ToolError(`The file is ${formatSize(size)}; the limit is ${formatSize(MAX_CREATED_BYTES)}`);
        const mimeType = (args.mimeType as string | undefined) || mimeTypeFor(name);
        addCreatedFile({ name, mimeType, size, data });
        return json({ created: name, mimeType, size });
    },
};

export const uploadFile: Tool = {
    name: 'upload_file',
    description: 'Put a file the user attached, or one made with create_file, into a file field on the page, e.g. a CV. Pass the ref of the file input, its upload button or drop zone from read_page or find.',
    inputSchema: {
        type: 'object',
        properties: {
            tabId: { type: 'integer', description: 'Tab id. Defaults to the tab the agent is working in.' },
            ref: { type: 'string', description: 'Ref of the file input, upload button or drop zone.' },
            file: { type: 'string', description: 'Name of the attached file.' },
        },
        required: ['ref', 'file'],
    },
    async run(args, context) {
        const file = getAttachment(args.file as string);
        if (!file) {
            const names = attachmentNames();
            throw new ToolError(names.length
                ? `No attached file "${args.file}". Attached: ${names.join(', ')}`
                : 'The user has not attached any files. Ask them to attach it with + in the side panel.');
        }
        const tab = await workTab(args.tabId as number | undefined, context);
        await ensureSiteAllowed(tab, 'upload_file', `Upload "${file.name}"`, context);
        const result = await runInTab(tab, uploadToRef, args.ref as string, file.name, file.mimeType || 'application/octet-stream', file.data);
        if (!result.ok) throw new ToolError(result.error!);
        return json({ uploaded: file.name, via: result.via });
    },
};
