import { describe, expect, test } from 'bun:test';
import { parseKeyCombo, parseKeySequence } from '../src/tools/keys.ts';

describe('parseKeyCombo', () => {
    test('named keys', () => {
        expect(parseKeyCombo('Enter')).toEqual({ key: 'Enter', code: 'Enter', keyCode: 13, text: '\r', modifiers: 0 });
        expect(parseKeyCombo('escape')).toEqual({ key: 'Escape', code: 'Escape', keyCode: 27, modifiers: 0 });
        expect(parseKeyCombo('F5')).toEqual({ key: 'F5', code: 'F5', keyCode: 116, modifiers: 0 });
    });

    test('letters and digits insert text', () => {
        expect(parseKeyCombo('a')).toEqual({ key: 'a', code: 'KeyA', keyCode: 65, text: 'a', modifiers: 0 });
        expect(parseKeyCombo('7')).toEqual({ key: '7', code: 'Digit7', keyCode: 55, text: '7', modifiers: 0 });
    });

    test('shortcuts drop text and set modifier bits', () => {
        expect(parseKeyCombo('Control+a')).toEqual({ key: 'a', code: 'KeyA', keyCode: 65, modifiers: 2 });
        expect(parseKeyCombo('Ctrl+Shift+Tab')).toEqual({ key: 'Tab', code: 'Tab', keyCode: 9, modifiers: 10 });
        expect(parseKeyCombo('Meta+Enter').text).toBeUndefined();
    });

    test('shift uppercases letters', () => {
        expect(parseKeyCombo('Shift+a')).toEqual({ key: 'A', code: 'KeyA', keyCode: 65, text: 'A', modifiers: 8 });
    });

    test('plus as a key', () => {
        expect(parseKeyCombo('Control++')).toMatchObject({ key: '+', modifiers: 2 });
    });

    test('rejects unknown names', () => {
        expect(() => parseKeyCombo('Hyper+a')).toThrow('Unknown modifier');
        expect(() => parseKeyCombo('Banana')).toThrow('Unknown key');
    });
});

test('parseKeySequence splits on whitespace', () => {
    expect(parseKeySequence(' Control+a  Delete ').map(press => press.key)).toEqual(['a', 'Delete']);
});
