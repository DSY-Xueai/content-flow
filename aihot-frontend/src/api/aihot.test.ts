import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildItemsUrl, fetchDaily, fetchItems, normalizeFeedItem } from './aihot';

afterEach(() => vi.restoreAllMocks());

describe('buildItemsUrl', () => {
  it('builds selected feed URL with category and search query', () => {
    const url = buildItemsUrl({
      mode: 'selected',
      category: 'paper',
      q: 'OpenAI',
      take: 30
    });

    expect(url).toBe('/api/v1/items?mode=selected&by=timeline&category=paper&q=OpenAI&limit=30');
  });

  it('omits all category from URL because it means no category filter', () => {
    const url = buildItemsUrl({
      mode: 'all',
      category: 'all',
      take: 100
    });

    expect(url).toBe('/api/v1/items?mode=all&by=timeline&limit=100');
  });

  it('builds feed URL with cursor pagination', () => {
    const url = buildItemsUrl({
      mode: 'selected',
      category: 'paper',
      take: 40,
      cursor: 'it3.opaque-cursor'
    });

    expect(url).toBe(
      '/api/v1/items?mode=selected&by=timeline&category=paper&limit=40&cursor=it3.opaque-cursor'
    );
  });

  it('rejects keywords outside the public API length limits', () => {
    for (const q of ['中', 'a'.repeat(201)]) {
      expect(() => buildItemsUrl({ mode: 'selected', q })).toThrow('2–200');
    }
    expect(buildItemsUrl({ mode: 'selected', q: '  中文  ' })).toContain('q=%E4%B8%AD%E6%96%87');
  });
});

describe('public API v1', () => {
  const publicItem = {
    id: 'item-1',
    title: '中文资讯',
    summary: '资讯摘要',
    source: { name: '官方博客' },
    links: { original: 'https://example.com/news', aihot: 'https://aihot.news/items/item-1' },
    score: 76,
    reason: '推荐理由',
    attribution: { name: 'AIHOT', url: 'https://aihot.news/items/item-1' }
  };

  it('maps public links and page cursors without requiring legacy media fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      items: [publicItem],
      page: { count: 1, hasMore: true, nextCursor: 'it3.next' }
    })));

    const result = await fetchItems({ mode: 'selected' });
    expect(result).toMatchObject({
      items: [{
        title: '中文资讯',
        source: '官方博客',
        url: 'https://example.com/news',
        sourceUrl: 'https://example.com/news',
        media: [],
        links: publicItem.links,
        attribution: publicItem.attribution,
        score: 76,
        reason: '推荐理由'
      }],
      hasNext: true,
      nextCursor: 'it3.next'
    });
  });

  it('ends pagination when the public API has no more items', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      items: [], page: { count: 0, hasMore: false, nextCursor: null }
    })));
    expect(await fetchItems({ mode: 'all' })).toEqual({ items: [], hasNext: false, nextCursor: null });
  });

  it('unwraps the daily report and keeps section source links', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      report: {
        date: '2026-11-03',
        lead: { title: '今日要闻', leadParagraph: '导读' },
        sections: [{ label: '行业动态', items: [publicItem] }]
      }
    })));

    expect(await fetchDaily()).toMatchObject({
      date: '2026-11-03',
      lead: { title: '今日要闻' },
      sections: [{ label: '行业动态', items: [{ sourceName: '官方博客', sourceUrl: 'https://example.com/news' }] }]
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/dailies/latest');
  });

  it('keeps an empty daily edition readable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      report: { date: '2026-11-03', lead: null, sections: [] }
    })));
    expect(await fetchDaily()).toMatchObject({ date: '2026-11-03', lead: null, sections: [] });
  });

  it('surfaces failed feed and daily requests', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('unavailable', { status: 503 }));
    await expect(fetchItems({ mode: 'selected' })).rejects.toThrow('AI HOT 请求失败：503');
    await expect(fetchDaily()).rejects.toThrow('AI HOT 日报请求失败：503');
  });
});

describe('normalizeFeedItem', () => {
  it('maps feed media and author avatar into the card model', () => {
    const item = normalizeFeedItem({
      id: 'media-item',
      url: 'https://x.com/example/status/1',
      title: 'Original title',
      titleZh: '中文标题',
      summaryZh: '中文摘要',
      publishedAt: '2026-05-20T15:00:34.000Z',
      finalScore: 64,
      aiSelectedReason: '值得看',
      aiTags: [{ tag: '视频' }, { tag: '产品更新' }],
      source: { name: 'X：Example (@example)' },
      rawJson: {
        author: {
          name: 'Example',
          avatar: 'https://pbs.twimg.com/profile_images/example.jpg'
        },
        media: [
          {
            url: 'https://pbs.twimg.com/ext_tw_video_thumb/example.jpg',
            type: 'video',
            width: 1080,
            height: 1440
          }
        ]
      }
    });

    expect(item.title).toBe('中文标题');
    expect(item.source).toBe('X：Example (@example)');
    expect(item.tags).toEqual(['视频', '产品更新']);
    expect(item.authorAvatar).toBe('https://pbs.twimg.com/profile_images/example.jpg');
    expect(item.media).toEqual([
      {
        url: 'https://pbs.twimg.com/ext_tw_video_thumb/example.jpg',
        type: 'video',
        width: 1080,
        height: 1440
      }
    ]);
  });
});
