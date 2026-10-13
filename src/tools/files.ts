import { addCreatedFile, attachmentNames, getAttachment } from '../background/attachments.ts';
import { ensureSiteAllowed } from '../background/permissions.ts';
import { runInTab } from '../background/scripting.ts';
import { workTab } from '../background/session.ts';
import { uploadToRef } from '../content/upload.ts';
import { encodeText, formatSize, MAX_CREATED_BYTES, mimeTypeFor } from '../shared/attachments.ts';
import { json, ToolError, type Tool } from './registry.ts';
import { observedResult, observationProperties } from './observation.ts';

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
    description: 'Upload a file to a page without opening a system file dialog. Pass filePath for an existing absolute path on the computer running Chrome, or file for an attachment/create_file name. Pass a ref from any page outline or find for the file input or upload button; attached files also support drop zones. Returns updated page text and refs. Use exactly one of file or filePath.',
    inputSchema: {
        type: 'object',
        properties: {
            tabId: { type: 'integer', description: 'Tab id. Defaults to the tab the agent is working in.' },
            ref: { type: 'string', description: 'Ref of the file input, upload button or drop zone from a page outline or find.' },
            file: { type: 'string', description: 'Name of an attached file or one made with create_file. Use this or filePath, not both.' },
            filePath: { type: 'string', description: 'Absolute path to an existing file on the computer running Chrome, e.g. /tmp/cv.pdf or C:\\Users\\me\\cv.pdf. Chrome reads it directly; no base64 or create_file call is needed. Use this or file, not both.' },
            ...observationProperties,
        },
        required: ['ref'],
    },
    async run(args, context) {
        if ((args.file !== undefined) === (args.filePath !== undefined)) throw new ToolError('Pass exactly one of file (attachment name) or filePath (absolute path on the computer running Chrome)');
        if (typeof args.filePath === 'string') {
            const filePath = args.filePath;
            if (!filePath || filePath.includes('\0') || !/^(\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(filePath)) throw new ToolError('filePath must be an absolute path on the computer running Chrome; relative paths and ~ are not supported');
            const tab = await workTab(args.tabId as number | undefined, context);
            await ensureSiteAllowed(tab, 'upload_file', `Upload "${filePath}"`, context);
            const { uploadLocalFile } = await import('../background/file-upload.ts');
            await uploadLocalFile(tab, args.ref as string, filePath);
            return observedResult(tab, { uploaded: filePath.split(/[\\/]/).pop(), via: 'input' }, args);
        }
        const file = getAttachment(args.file as string);
        if (!file) {
            const names = attachmentNames();
            throw new ToolError(names.length
                ? `No attached file "${args.file}". Attached: ${names.join(', ')}`
                : 'No files are attached. Use filePath for an existing file on the computer running Chrome, create_file to make one, or ask the user to attach it with + in the side panel.');
        }
        const tab = await workTab(args.tabId as number | undefined, context);
        await ensureSiteAllowed(tab, 'upload_file', `Upload "${file.name}"`, context);
        const result = await runInTab(tab, uploadToRef, args.ref as string, { name: file.name, mimeType: file.mimeType || 'application/octet-stream', data: file.data });
        if (!result.ok) throw new ToolError(result.error!);
        return observedResult(tab, { uploaded: file.name, via: result.via }, args);
    },
};
