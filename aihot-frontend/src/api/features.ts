import type { AihotItem, AihotMedia } from './aihot';

export interface HotTopic {
  rank: number;
  id: string;
  title: string;
  source: { name: string };
  links: { aihot: string; original: string; story?: string };
  sourceCount: number;
  signalCount: number;
  participantCount?: number;
  sourceNames: string[];
  latestAt: string;
}
export interface HotTopicsData {
  schemaVersion: 1;
  count: number;
  items: HotTopic[];
}

export interface Topic {
  slug: string;
  name: string;
  group: string;
  definition: string;
  brand: { src: string | null; monogram: string } | null;
  total: number;
  recent: number;
  latest: { title: string; at: string } | null;
}
export interface TopicsData {
  groups: Array<{ key: string; name: string; blurb: string }>;
  topics: Topic[];
}
export interface SiteItem {
  id: string; title: string; summary?: string; reason?: string;
  source: { name: string }; publishedAt: string | null; timelineAt?: string;
  category?: string; tags?: string[]; score?: number;
  x?: { authorName: string; avatarUrl: string; media: AihotMedia[] } | null;
}
export interface TopicData {
  topic: Topic;
  items: SiteItem[];
  page: number;
  pageCount: number;
  modules?: { chronicle?: { milestones: Array<{ date: string; title: string; summary?: string; href?: string; major?: boolean }> } };
}
export function siteAsset(url: string) {
  if (url.startsWith('/model-providers/') || url.startsWith('/api/img-proxy?')) return url;
  return new URL(url, 'https://aihot.news').href;
}
export function normalizeSiteItem(item: SiteItem): AihotItem {
  return {
    ...item,
    source: item.source.name,
    url: `https://aihot.news/items/${encodeURIComponent(item.id)}`,
    discoveredAt: item.timelineAt,
    authorAvatar: item.x?.avatarUrl ? siteAsset(item.x.avatarUrl) : null,
    media: item.x?.media?.map((media) => ({ ...media, url: siteAsset(media.url) })) ?? []
  };
}

export interface ModelInfo {
  model: { slug: string; name: string; provider: string; releasedAt: string | null; aliases: string[]; brand: { src: string | null; monogram: string } | null };
  price: { currency: string; input: number | null; output: number | null; cached: number | null; inputCny: number | null; outputCny: number | null; cachedCny: number | null; officialUrl: string | null; note: string | null } | null;
  access: { domestic: boolean; weightsUrl: string | null } | null;
}
export interface BoardEntry { slug: string; rank: number; score: number; coverage: number; sourceCount: number }
export interface LeaderboardData {
  run: { generatedAt: string; methodologyVersion: string; fx: { rate: number; asOf: string; sourceName: string } };
  models: Record<string, ModelInfo>;
  boards: Array<{
    board: { key: string; name: string; description: string; howToRead: string; sourceCount: number; operatorCount: number };
    entries: BoardEntry[];
    filterEntries: BoardEntry[];
    pending: Array<{ slug: string; score: number; sources: number; reason: string }>;
  }>;
}

export interface ResetPost {
  id: string; publishedAt: string | null; stage: string;
  text: string | null; originalText: string; fullText?: string; fullOriginalText?: string; url: string;
}
export interface ResetEvent {
  id: string; type: 'direct_reset' | 'reset_credit'; displayLabel: string; title: string; scope: string;
  status: 'announced' | 'confirmed'; confirmedAt: string | null; createdAt: string | null; updatedAt: string | null; occurredOn: string | null;
  confirmationBasis?: 'source_post' | 'receipt_review' | null;
  presentation?: { status: 'announced' | 'in_progress' | 'confirmed' | 'expired_unconfirmed' | 'likely_completed'; scopeLabel: string | null };
  estimate: { from: string | null; through: string | null; label: string; reason: string } | null;
  schedule: { from: string | null; through: string | null; label: string } | null;
  posts: ResetPost[];
}
export interface ResetsData {
  today?: string; checkedAt: string | null; count: number; events: ResetEvent[];
  monitor?: { status: 'healthy' | 'delayed' | 'attention' | 'unknown'; lastAttemptAt: string | null; lastCollectedAt: string | null; lastVerifiedAt: string | null; pendingCount: number; heldWindowCount: number; reviewCount: number } | null;
  outage?: { text?: string; originalText: string; publishedAt: string; url: string; recoveredAt: string | null } | null;
}
