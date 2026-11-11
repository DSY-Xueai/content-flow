import { describe, expect, it } from 'vitest';
import { validateAihotPayload } from './aihotContract';

describe('shared AIHOT contracts', () => {
  it('rejects missing feed items instead of silently treating a contract error as an empty feed', () => {
    expect(() => validateAihotPayload('/api/v1/items?mode=selected', { renamedItems: [] })).toThrow('items');
    expect(() => validateAihotPayload('/api/v1/items', { items: [{ id: '1', title: '标题', links: { aihot: 'https://aihot.news/items/1' } }] })).toThrow('items[0].source');
    expect(() => validateAihotPayload('/api/v1/items', { items: [], extraField: true })).not.toThrow();
    expect(() => validateAihotPayload('/api/v1/items', { schemaVersion: 2, items: [] })).toThrow('schemaVersion');
  });

  it('reports a precise nested field when a daily report or topic changes', () => {
    expect(() => validateAihotPayload('/api/v1/dailies/latest', { report: { date: '2026-11-04', sections: [{ label: '行业', renamedItems: [] }] } })).toThrow('report.sections[0].items');
    expect(() => validateAihotPayload('/api/site/topics', { groups: [], topics: [{ slug: 'openai' }] })).toThrow('topics[0].name');
    expect(() => validateAihotPayload('/api/site/topics/openai?page=2', { topic: { slug: 'openai', name: 'OpenAI', group: 'company', definition: '介绍', total: 1, recent: 1 }, page: 2, pageCount: 2, items: [{ title: '标题' }] })).toThrow('items[0].id');
  });
});
