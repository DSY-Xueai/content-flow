import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HotTopicsData } from '../api/features';
import { HotTopicsPanel } from './HotTopicsPanel';

const topic = {
  rank: 1, id: 'hot-1', title: '热点事件', source: { name: '官方博客' },
  links: { aihot: 'https://aihot.news/items/hot-1', original: 'https://example.com/news', story: 'https://aihot.news/story/story-1' },
  sourceCount: 3, signalCount: 8, participantCount: 10, sourceNames: ['官方博客', '科技媒体'], latestAt: '2026-11-04T08:00:00Z'
};
const data: HotTopicsData = { schemaVersion: 1, count: 1, items: [topic] };
const props = () => ({ refreshKey: 0, materialIds: new Set<string>(), bookmarkIds: new Set<string>(), onAddMaterial: vi.fn(), onToggleBookmark: vi.fn(), onStateChange: vi.fn() });
const response = (body: unknown = data, status = 200, headers = {}) => new Response(status === 304 ? null : JSON.stringify(body), { status, headers });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('HotTopicsPanel', () => {
  it('uses the official rank, story and source links and connects bookmarks and materials', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    const actions = props();
    const { rerender } = render(<HotTopicsPanel {...actions} />);
    expect(await screen.findByRole('link', { name: topic.title })).toHaveAttribute('href', topic.links.story);
    expect(screen.getByLabelText('第 1 名')).toHaveTextContent('01');
    expect(screen.getByText('3 个报道来源')).toBeInTheDocument();
    expect(screen.getByText('10 位讨论参与者')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '原文 ↗' })).toHaveAttribute('href', topic.links.original);
    fireEvent.click(screen.getByRole('button', { name: '收藏：热点事件' }));
    fireEvent.click(screen.getByRole('button', { name: '加入素材：热点事件' }));
    const item = { id: topic.id, title: topic.title, source: topic.source.name, url: topic.links.aihot };
    expect(actions.onToggleBookmark).toHaveBeenCalledWith(item);
    expect(actions.onAddMaterial).toHaveBeenCalledWith(item);
    rerender(<HotTopicsPanel {...actions} materialIds={new Set(['aihot:hot-1'])} bookmarkIds={new Set(['hot-1'])} />);
    expect(screen.getByRole('button', { name: '已加入素材：热点事件' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消收藏：热点事件' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('revalidates every minute, replaces the complete ranking, pauses when hidden, and preserves data on failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T08:00:00Z'));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const changed = { ...data, items: [{ ...topic, id: 'hot-2', title: '新榜首' }] };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(data, 200, { ETag: '"hot-v1"', 'Cache-Control': 'max-age=60' }))
      .mockResolvedValueOnce(response(null, 304))
      .mockResolvedValueOnce(response(changed))
      .mockResolvedValueOnce(response({}, 503, { 'Retry-After': '120' }))
      .mockResolvedValueOnce(response(data));
    const { unmount } = render(<HotTopicsPanel {...props()} />);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/hot-topics', expect.objectContaining({ headers: { 'If-None-Match': '"hot-v1"' } }));
    expect(screen.getByRole('link', { name: topic.title })).toBeInTheDocument();
    visibility.mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByRole('link', { name: '新榜首' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: topic.title })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(screen.getByText('同步失败，正在显示上次数据')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1);
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(60000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(screen.getByRole('link', { name: topic.title })).toBeInTheDocument();
    expect(screen.queryByText('同步失败，正在显示上次数据')).not.toBeInTheDocument();
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); window.dispatchEvent(new Event('focus')); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('handles an empty ranking and a missing story or participant count', async () => {
    const { story: _story, ...links } = topic.links;
    const { participantCount: _participants, ...withoutParticipants } = topic;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ ...data, items: [{ ...withoutParticipants, links }] })).mockResolvedValueOnce(response({ ...data, count: 0, items: [] }));
    let now = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const actions = props();
    const { rerender } = render(<HotTopicsPanel {...actions} />);
    expect(await screen.findByRole('link', { name: topic.title })).toHaveAttribute('href', links.aihot);
    expect(screen.queryByText(/位讨论参与者/)).not.toBeInTheDocument();
    now += 60000;
    rerender(<HotTopicsPanel {...actions} refreshKey={1} />);
    expect(await screen.findByText('暂无热点')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: topic.title })).not.toBeInTheDocument();
  });
});
