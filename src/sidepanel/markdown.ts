// A small Markdown subset for model answers. It builds DOM nodes, never HTML strings,
// so text from the model or from web pages cannot inject markup into the panel.

export type Inline =
    | { type: 'text'; text: string }
    | { type: 'strong' | 'em'; children: Inline[] }
    | { type: 'code'; text: string }
    | { type: 'link'; href: string; children: Inline[] }
    | { type: 'br' };

export type Block =
    | { type: 'p'; inline: Inline[] }
    | { type: 'h'; level: number; inline: Inline[] }
    | { type: 'code'; lang: string; text: string }
    | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
    | { type: 'quote'; blocks: Block[] }
    | { type: 'hr' }
    | { type: 'table'; head: Inline[][]; rows: Inline[][][] };

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function parseInline(source: string): Inline[] {
    const out: Inline[] = [];
    let text = '';
    const flush = () => {
        if (text) out.push({ type: 'text', text });
        text = '';
    };
    let index = 0;
    while (index < source.length) {
        const rest = source.slice(index);
        let match: RegExpMatchArray | null;
        if ((match = rest.match(/^`([^`]+)`/))) {
            flush();
            out.push({ type: 'code', text: match[1]! });
        } else if ((match = rest.match(/^(\*\*|__)(?=\S)([\s\S]*?\S)\1/))) {
            flush();
            out.push({ type: 'strong', children: parseInline(match[2]!) });
        } else if ((match = rest.match(/^([*_])(?=\S)([\s\S]*?\S)\1(?![*_\w])/)) && !/\w/.test(source[index - 1] ?? '')) {
            flush();
            out.push({ type: 'em', children: parseInline(match[2]!) });
        } else if ((match = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/)) && /^https?:\/\//i.test(match[2]!)) {
            flush();
            out.push({ type: 'link', href: match[2]!, children: parseInline(match[1]!) });
        } else if ((match = rest.match(/^\n/))) {
            flush();
            out.push({ type: 'br' });
        } else {
            text += source[index];
            index++;
            continue;
        }
        index += match[0].length;
    }
    flush();
    return out;
}

function cells(line: string) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => parseInline(cell.trim()));
}

function indentOf(line: string) {
    return line.match(/^\s*/)![0].replace(/\t/g, '    ').length;
}

export function parseMarkdown(source: string): Block[] {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const blocks: Block[] = [];
    let index = 0;
    while (index < lines.length) {
        const line = lines[index]!;
        if (!line.trim()) {
            index++;
            continue;
        }
        const fence = line.match(/^\s*(```|~~~)\s*(\S*)/);
        if (fence) {
            const body: string[] = [];
            index++;
            while (index < lines.length && !lines[index]!.trim().startsWith(fence[1]!)) body.push(lines[index++]!);
            index++;
            blocks.push({ type: 'code', lang: fence[2]!, text: body.join('\n') });
            continue;
        }
        const heading = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
        if (heading) {
            blocks.push({ type: 'h', level: heading[1]!.length, inline: parseInline(heading[2]!) });
            index++;
            continue;
        }
        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
            blocks.push({ type: 'hr' });
            index++;
            continue;
        }
        if (/^\s*>/.test(line)) {
            const quoted: string[] = [];
            while (index < lines.length && /^\s*>/.test(lines[index]!)) quoted.push(lines[index++]!.replace(/^\s*>\s?/, ''));
            blocks.push({ type: 'quote', blocks: parseMarkdown(quoted.join('\n')) });
            continue;
        }
        if (line.includes('|') && TABLE_SEPARATOR.test(lines[index + 1] ?? '')) {
            const head = cells(line);
            const rows: Inline[][][] = [];
            index += 2;
            while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) rows.push(cells(lines[index++]!));
            blocks.push({ type: 'table', head, rows });
            continue;
        }
        const item = line.match(LIST_ITEM);
        if (item) {
            const baseIndent = indentOf(line);
            const ordered = /\d/.test(item[2]!);
            const items: Block[][] = [];
            let current: string[] | undefined;
            const finish = () => {
                if (current) items.push(parseMarkdown(current.join('\n')));
            };
            while (index < lines.length) {
                const next = lines[index]!;
                const nextItem = next.match(LIST_ITEM);
                if (nextItem && indentOf(next) <= baseIndent + 1 && /\d/.test(nextItem[2]!) === ordered) {
                    finish();
                    current = [nextItem[3]!];
                } else if (next.trim() && (indentOf(next) > baseIndent || (!nextItem && current && !/^\s*(#|>|```)/.test(next) && lines[index - 1]!.trim()))) {
                    current!.push(next.slice(Math.min(indentOf(next), baseIndent + 2)));
                } else if (!next.trim() && (lines[index + 1] ?? '').match(LIST_ITEM) && indentOf(lines[index + 1]!) >= baseIndent) {
                    // A blank line between items keeps the list going.
                } else {
                    break;
                }
                index++;
            }
            finish();
            blocks.push({ type: 'list', ordered, start: ordered ? parseInt(item[2]!, 10) : 1, items });
            continue;
        }
        const paragraph: string[] = [];
        while (index < lines.length && lines[index]!.trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[index]!) && !(paragraph.length && LIST_ITEM.test(lines[index]!))) {
            paragraph.push(lines[index++]!.trim());
        }
        blocks.push({ type: 'p', inline: parseInline(paragraph.join('\n')) });
    }
    return blocks;
}

function inlineNodes(inline: Inline[]): Node[] {
    return inline.map((node) => {
        switch (node.type) {
            case 'text':
                return document.createTextNode(node.text);
            case 'br':
                return document.createElement('br');
            case 'code': {
                const code = document.createElement('code');
                code.textContent = node.text;
                return code;
            }
            case 'link': {
                const link = document.createElement('a');
                link.href = node.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.append(...inlineNodes(node.children));
                return link;
            }
            default: {
                const element = document.createElement(node.type);
                element.append(...inlineNodes(node.children));
                return element;
            }
        }
    });
}

function blockNode(block: Block): Node {
    switch (block.type) {
        case 'p': {
            const p = document.createElement('p');
            p.append(...inlineNodes(block.inline));
            return p;
        }
        case 'h': {
            const heading = document.createElement(`h${Math.min(block.level + 2, 6)}`);
            heading.append(...inlineNodes(block.inline));
            return heading;
        }
        case 'code': {
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.textContent = block.text;
            pre.append(code);
            return pre;
        }
        case 'list': {
            const list = document.createElement(block.ordered ? 'ol' : 'ul');
            if (block.ordered && block.start !== 1) list.setAttribute('start', String(block.start));
            for (const item of block.items) {
                const li = document.createElement('li');
                // A single paragraph item renders inline so lists stay compact.
                const only = item.length === 1 && item[0]!.type === 'p' ? item[0] : undefined;
                if (only?.type === 'p') li.append(...inlineNodes(only.inline));
                else li.append(...item.map(blockNode));
                list.append(li);
            }
            return list;
        }
        case 'quote': {
            const quote = document.createElement('blockquote');
            quote.append(...block.blocks.map(blockNode));
            return quote;
        }
        case 'hr':
            return document.createElement('hr');
        case 'table': {
            const wrap = document.createElement('div');
            wrap.className = 'table';
            const table = document.createElement('table');
            const head = table.createTHead().insertRow();
            for (const cell of block.head) {
                const th = document.createElement('th');
                th.append(...inlineNodes(cell));
                head.append(th);
            }
            const body = table.createTBody();
            for (const row of block.rows) {
                const tr = body.insertRow();
                for (const cell of row) tr.insertCell().append(...inlineNodes(cell));
            }
            wrap.append(table);
            return wrap;
        }
    }
}

export function renderMarkdown(target: HTMLElement, source: string) {
    target.replaceChildren(...parseMarkdown(source).map(blockNode));
}
