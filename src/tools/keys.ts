export interface KeyPress {
    key: string;
    code: string;
    keyCode: number;
    text?: string;
    modifiers: number;
}

const MODIFIERS: Record<string, number> = {
    alt: 1, option: 1,
    control: 2, ctrl: 2,
    meta: 4, cmd: 4, command: 4, super: 4,
    shift: 8,
};

const NAMED_KEYS: Record<string, Omit<KeyPress, 'modifiers'>> = {
    enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
    return: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
    tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
    escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
    backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
    space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
    arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    home: { key: 'Home', code: 'Home', keyCode: 36 },
    end: { key: 'End', code: 'End', keyCode: 35 },
    pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
};

for (let index = 1; index <= 12; index++) {
    NAMED_KEYS[`f${index}`] = { key: `F${index}`, code: `F${index}`, keyCode: 111 + index };
}

function characterKey(char: string): Omit<KeyPress, 'modifiers'> {
    if (/^[a-z]$/i.test(char)) {
        const upper = char.toUpperCase();
        return { key: char, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: char };
    }
    if (/^[0-9]$/.test(char)) return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0), text: char };
    return { key: char, code: '', keyCode: 0, text: char };
}

/** Parses one combo such as "Enter", "Control+a" or "Shift+Tab". */
export function parseKeyCombo(combo: string): KeyPress {
    const parts = combo.split('+').map(part => part.trim()).filter(Boolean);
    if (combo.endsWith('++')) parts.push('+');
    const name = parts.pop();
    if (!name) throw new Error(`Empty key combo "${combo}"`);
    let modifiers = 0;
    for (const part of parts) {
        const bit = MODIFIERS[part.toLowerCase()];
        if (bit === undefined) throw new Error(`Unknown modifier "${part}" in "${combo}"`);
        modifiers |= bit;
    }
    const named = NAMED_KEYS[name.toLowerCase()];
    if (!named && [...name].length !== 1) throw new Error(`Unknown key "${name}" in "${combo}"`);
    let press = named ?? characterKey(name);
    if (modifiers & MODIFIERS.shift! && press.text && /^[a-z]$/.test(press.text)) {
        press = { ...press, key: press.key.toUpperCase(), text: press.text.toUpperCase() };
    }
    // With Control, Alt or Meta held the key is a shortcut and must not insert text.
    if (modifiers & (MODIFIERS.control! | MODIFIERS.alt! | MODIFIERS.meta!)) {
        const { text: _text, ...rest } = press;
        press = rest;
    }
    return { ...press, modifiers };
}

/** Parses a space-separated sequence of combos, e.g. "Control+a Delete". */
export function parseKeySequence(sequence: string) {
    return sequence.trim().split(/\s+/).filter(Boolean).map(parseKeyCombo);
}
