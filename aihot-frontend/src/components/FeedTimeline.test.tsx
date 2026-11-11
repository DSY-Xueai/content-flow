import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeedTimeline } from './FeedTimeline';

describe('FeedTimeline', () => {
  it('displays the source discovery timeline rather than making newly collected old articles look stale', () => {
    render(<FeedTimeline items={[{ id: 'new', title: '刚收录的旧原文', source: '来源', url: 'https://example.com', publishedAt: '2026-10-01T00:00:00Z', discoveredAt: '2026-11-03T01:00:00Z' }]} materialIds={new Set()} onAddMaterial={vi.fn()} />);
    expect(screen.getByRole('region', { name: '2026年11月3日' })).toBeInTheDocument();
    expect(screen.getByText('09:00')).toHaveAttribute('title', '原文发布时间：10/1 08:00');
  });
  it('groups publication times by Beijing day across midnight', () => {
    const items = [
      { id: '1', title: '第一条', publishedAt: '2026-11-02T16:30:00Z' },
      { id: '2', title: '第二条', publishedAt: '2026-11-03T01:00:00Z' },
      { id: '3', title: '前一天', publishedAt: '2026-11-02T15:30:00Z' }
    ].map((item) => ({ ...item, source: '来源', url: 'https://example.com' }));

    render(<FeedTimeline items={items} materialIds={new Set()} onAddMaterial={vi.fn()} />);

    const currentDay = screen.getByRole('region', { name: '2026年11月3日' });
    expect(within(currentDay).getAllByRole('article')).toHaveLength(2);
    expect(within(currentDay).getByText('00:30')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '2026年11月2日' })).getAllByRole('article')).toHaveLength(1);
  });

  it('keeps undated items readable and preserves collected material state', () => {
    render(<FeedTimeline
      items={[{ id: 'unknown', title: '没有时间的资讯', source: '来源', url: 'https://example.com' }]}
      materialIds={new Set(['aihot:unknown'])}
      onAddMaterial={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: '时间未知' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已加入素材：没有时间的资讯' })).toBeDisabled();
  });
});
