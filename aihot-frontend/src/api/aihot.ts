import type { CategoryId } from '../lib/categories';
import { validateAihotPayload } from './aihotContract';

export type FeedMode = 'selected' | 'all';

export interface FeedQuery {
  mode: FeedMode;
  category?: CategoryId;
  q?: string;
  take?: number;
  cursor?: FeedCursor | null;
}

export type FeedCursor = string;

export interface AihotItem {
  id: string;
  title: string;
  url: string;
  source: string;
  summary?: string | null;
  publishedAt?: string | null;
  discoveredAt?: string | null;
  category?: string | null;
  score?: number | null;
  tags?: string[];
  reason?: string | null;
  sourceUrl?: string | null;
  authorName?: string | null;
  authorAvatar?: string | null;
  media?: AihotMedia[];
  links?: { original?: string; aihot: string };
  attribution?: { name: string; url: string };
}

export interface AihotMedia {
  url: string;
  type?: 'photo' | 'video' | 'animated_gif' | string;
  width?: number;
  height?: number;
}

export interface FeedResponse {
  items: AihotItem[];
  hasNext?: boolean;
  nextCursor?: FeedCursor | null;
  syncedAt?: number;
  syncWarning?: string;
}

export interface DailySection {
  label: string;
  items: Array<{
    title: string;
    summary?: string | null;
    sourceName?: string | null;
    sourceUrl?: string | null;
  }>;
}

export interface DailyResponse {
  syncedAt?: number;
  syncWarning?: string;
  date: string;
  lead?: {
    title?: string;
    leadParagraph?: string;
  } | null;
  sections: DailySection[];
}

export function buildItemsUrl(query: FeedQuery): string {
  const params = new URLSearchParams();
  params.set('mode', query.mode);
  params.set('by', 'timeline');

  if (query.category && query.category !== 'all') {
    params.set('category', query.category);
  }

  const keyword = query.q?.trim();
  if (keyword) {
    if ([...keyword].length < 2 || [...keyword].length > 200) {
      throw new Error('AI HOT 搜索关键词需为 2–200 个字符');
    }
    params.set('q', keyword);
  }

  params.set('limit', String(query.take ?? 50));

  if (query.cursor) {
    params.set('cursor', query.cursor);
  }

  return `/api/v1/items?${params.toString()}`;
}

export async function fetchItems(query: FeedQuery): Promise<FeedResponse> {
  const response = await fetch(buildItemsUrl(query));
  if (!response.ok) {
    throw new Error(`AI HOT 请求失败：${response.status}`);
  }

  const data = await response.json();
  validateAihotPayload('/api/v1/items', data);
  return {
    items: data.items.map(normalizeFeedItem),
    ...syncMetadata(response),
    hasNext: Boolean(data.page?.hasMore),
    nextCursor: typeof data.page?.nextCursor === 'string' ? data.page.nextCursor : null
  };
}

type FeedItemInput = Omit<Partial<AihotItem>, 'source'> & {
  titleZh?: string | null;
  summaryZh?: string | null;
  aiSelectedReason?: string | null;
  finalScore?: number | null;
  qualityScore?: number | null;
  aiTags?: Array<{ tag?: string | null }> | null;
  source?: string | { name?: string | null } | null;
  rawJson?: {
    author?: {
      name?: string | null;
      screenName?: string | null;
      avatar?: string | null;
    } | null;
    media?: AihotMedia[] | null;
  } | null;
};

export function normalizeFeedItem(raw: FeedItemInput): AihotItem {
  const source = typeof raw.source === 'string' ? raw.source : raw.source?.name;
  const tags =
    raw.tags ??
    raw.aiTags
      ?.map((item) => item.tag)
      .filter((tag): tag is string => Boolean(tag));

  return {
    id: raw.id ?? raw.url ?? crypto.randomUUID(),
    title: raw.titleZh || raw.title || '未命名动态',
    url: raw.links?.original ?? raw.links?.aihot ?? raw.url ?? '#',
    source: source || '未知来源',
    summary: raw.summaryZh ?? raw.summary ?? null,
    publishedAt: raw.publishedAt ?? null,
    discoveredAt: raw.discoveredAt ?? null,
    category: raw.category ?? null,
    score: raw.score ?? raw.finalScore ?? raw.qualityScore ?? null,
    tags,
    reason: raw.reason ?? raw.aiSelectedReason ?? null,
    sourceUrl: raw.links?.original ?? raw.links?.aihot ?? raw.sourceUrl ?? raw.url ?? null,
    authorName: raw.authorName ?? raw.rawJson?.author?.name ?? raw.rawJson?.author?.screenName ?? null,
    authorAvatar: raw.authorAvatar ?? raw.rawJson?.author?.avatar ?? null,
    media: raw.media ?? raw.rawJson?.media ?? [],
    links: raw.links,
    attribution: raw.attribution
  };
}

export async function fetchDaily(): Promise<DailyResponse> {
  const response = await fetch('/api/v1/dailies/latest');
  if (!response.ok) {
    throw new Error(`AI HOT 日报请求失败：${response.status}`);
  }

  const data: {
    report: Omit<DailyResponse, 'sections'> & {
      sections: Array<{
        label: string;
        items: Array<{
          title: string;
          summary?: string | null;
          source: { name: string };
          links: { original?: string; aihot: string };
        }>;
      }>;
    };
  } = await response.json();
  validateAihotPayload('/api/v1/dailies/latest', data);

  return {
    ...data.report,
    ...syncMetadata(response),
    sections: data.report.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        sourceName: item.source.name,
        sourceUrl: item.links.original ?? item.links.aihot
      }))
    }))
  };
}

function syncMetadata(response: Response) {
  const checkedAt = response.headers.get('X-Aihot-Synced-At');
  return {
    ...(checkedAt ? { syncedAt: Number(checkedAt) } : {}),
    ...(response.headers.get('X-Aihot-Stale') === '1' ? { syncWarning: '上游同步失败，正在显示上次有效缓存，详情见同步状态。' } : {})
  };
}
