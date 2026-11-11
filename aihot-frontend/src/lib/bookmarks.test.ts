import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBookmarks, useBookmarks } from './bookmarks';

const item = { id: '1', title: '测试收藏', source: '来源', url: 'https://example.com/news', summary: '摘要' };
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('local bookmarks', () => {
  it('saves a snapshot, restores it after remounting, and removes it', () => {
    const first = renderHook(useBookmarks);
    act(() => first.result.current.toggle(item));
    expect(first.result.current.items).toHaveLength(1);
    first.unmount();
    const restored = renderHook(useBookmarks);
    expect(restored.result.current.items[0].item).toMatchObject(item);
    act(() => restored.result.current.toggle(item));
    expect(restored.result.current.items).toHaveLength(0);
  });

  it('merges imported records without duplicating existing bookmarks', () => {
    const { result } = renderHook(useBookmarks);
    act(() => result.current.toggle(item));
    const backup = JSON.stringify({ version: 1, bookmarks: [{ item, savedAt: '2026-11-03T00:00:00Z' }, { item: { ...item, id: '2' }, savedAt: '2026-11-02T00:00:00Z' }] });
    act(() => result.current.importBackup(backup));
    expect(result.current.items).toHaveLength(2);
    act(() => result.current.importBackup('not json'));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.notice).toContain('原收藏未修改');
  });

  it('rejects unsafe links and malformed snapshots', () => {
    expect(() => parseBookmarks([{ item: { ...item, url: 'javascript:alert(1)' }, savedAt: '2026-11-03T00:00:00Z' }])).toThrow('不安全');
    expect(() => parseBookmarks([{ item, savedAt: 'invalid' }])).toThrow();
    expect(() => parseBookmarks({})).toThrow('格式');
  });

  it('keeps the page usable when an upstream article lacks a usable link', () => {
    const { result } = renderHook(useBookmarks);
    act(() => result.current.toggle({ ...item, url: '#' }));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.notice).toContain('未保存收藏');
  });

  it('does not claim success when browser storage fails', () => {
    const { result } = renderHook(useBookmarks);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    act(() => result.current.toggle(item));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.notice).toContain('未保存');
  });

  it('reflects changes from another browser tab', () => {
    const { result } = renderHook(useBookmarks);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'paixiaoxin.bookmarks', newValue: JSON.stringify([{ item, savedAt: '2026-11-03T00:00:00Z' }]) })));
    expect(result.current.items).toHaveLength(1);
  });
});
