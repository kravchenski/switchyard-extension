import { describe, expect, test } from 'bun:test';
import { filterModels } from '../src/sidepanel/model-filter.ts';

const ids = ['agent', 'auto', 'qwen-chat/qwen3.8-max', 'z-ai/glm-5.3', 'tokenharbor/claude-haiku-5.5:free', 'arena-chat/claude-sonnet-4-6'];

describe('model search', () => {
    test('keeps every model for an empty query', () => {
        expect(filterModels(ids, '  ')).toEqual(ids);
    });

    test('matches every word in any order and ignores case', () => {
        expect(filterModels(ids, 'Claude')).toEqual(['tokenharbor/claude-haiku-5.5:free', 'arena-chat/claude-sonnet-4-6']);
        expect(filterModels(ids, 'free haiku')).toEqual(['tokenharbor/claude-haiku-5.5:free']);
    });

    test('returns nothing when a word does not match', () => {
        expect(filterModels(ids, 'glm gpt')).toEqual([]);
    });
});
