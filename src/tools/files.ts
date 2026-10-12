import { getAttachment, attachmentNames } from '../background/attachments.ts';
import { ensureSiteAllowed } from '../background/permissions.ts';
import { runInTab } from '../background/scripting.ts';
import { workTab } from '../background/session.ts';
import { uploadToRef } from '../content/upload.ts';
import { json, ToolError, type Tool } from './registry.ts';

export const uploadFile: Tool = {
    name: 'upload_file',
    description: 'Put a file the user attached in the side panel into a file field on the page, e.g. a CV. Pass the ref of the file input, its upload button or drop zone from read_page or find.',
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
