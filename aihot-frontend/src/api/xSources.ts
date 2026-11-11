export const DEFAULT_X_HANDLES = [
  'GoogleAIStudio',
  'AnthropicAI',
  'Alibaba_Qwen',
  'GeminiApp',
  'github',
  'ilyasut',
  'Zai_org',
  'AndrewYNg',
  'rasbt',
  'GoogleDeepMind',
  'fchollet',
  'ylecun',
  'gdb',
  '_akhaliq',
  'karpathy',
  'OpenAI',
  'claudeai',
  'nytimes'
];

const STORAGE_KEY = 'x-specific-source-handles';
const RESERVED_PATHS = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'login', 'signup']);
const inFlightLatestRequests = new Map<string, Promise<XSourceItem[]>>();
let latestRequestQueue: Promise<unknown> = Promise.resolve();

export interface XLatestPost {
  id: string;
  text: string;
  translatedText?: string | null;
  createdAt?: string | null;
  url: string;
  media?: XSourceMedia[];
}

export interface XSourceMedia {
  url: string;
  type: 'photo' | 'video';
  embedUrl?: string | null;
  videoUrl?: string | null;
}

export interface XSourceItem {
  handle: string;
  displayName?: string | null;
  profileUrl: string;
  latestPost: XLatestPost | null;
  error?: string | null;
}

export function normalizeXHandle(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const withoutAt = trimmed.replace(/^@/, '');
  const urlLike = withoutAt.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)/i);
  const candidate = urlLike ? urlLike[1] : withoutAt;

  if (!/^[A-Za-z0-9_]{1,15}$/.test(candidate)) {
    return null;
  }

  if (RESERVED_PATHS.has(candidate.toLowerCase())) {
    return null;
  }

  return candidate;
}

export function mergeXHandles(baseHandles: string[], incomingHandles: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const handle of [...baseHandles, ...incomingHandles]) {
    const normalized = normalizeXHandle(handle);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(normalized);
    }
  }

  return merged;
}

export function readStoredXHandles(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? mergeXHandles([], parsed.filter((item): item is string => typeof item === 'string')) : [];
  } catch {
    return [];
  }
}

export function writeStoredXHandles(handles: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mergeXHandles([], handles)));
}

export async function fetchStoredXHandles(): Promise<string[]> {
  const response = await fetch('/api/x/handles');
  if (!response.ok) {
    throw new Error(`特定来源账号读取失败：${response.status}`);
  }

  const data = (await response.json()) as { handles?: unknown[] };
  return Array.isArray(data.handles)
    ? mergeXHandles([], data.handles.filter((item): item is string => typeof item === 'string'))
    : [];
}

export async function saveStoredXHandles(handles: string[]): Promise<string[]> {
  const normalized = mergeXHandles([], handles);
  const response = await fetch('/api/x/handles', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ handles: normalized })
  });
  if (!response.ok) {
    throw new Error(`特定来源账号保存失败：${response.status}`);
  }

  const data = (await response.json()) as { handles?: unknown[] };
  const savedHandles = Array.isArray(data.handles)
    ? mergeXHandles([], data.handles.filter((item): item is string => typeof item === 'string'))
    : normalized;
  writeStoredXHandles(savedHandles);
  return savedHandles;
}

export async function loadPersistedXHandles(): Promise<string[]> {
  const browserHandles = readStoredXHandles();

  try {
    const serverHandles = await fetchStoredXHandles();
    const mergedHandles = mergeXHandles(serverHandles, browserHandles);
    if (!sameHandles(serverHandles, mergedHandles)) {
      return saveStoredXHandles(mergedHandles);
    }

    writeStoredXHandles(serverHandles);
    return serverHandles;
  } catch {
    return browserHandles;
  }
}

export function buildLatestXPostsUrl(handles: string[], forceRefresh = false): string {
  const normalized = mergeXHandles([], handles);
  const params = new URLSearchParams();
  params.set('handles', normalized.join(','));
  if (forceRefresh) {
    params.set('refresh', '1');
  }
  return `/api/x/latest?${params.toString()}`;
}

export async function fetchLatestXPosts(handles: string[], forceRefresh = false): Promise<XSourceItem[]> {
  const requestedHandles = mergeXHandles([], handles);
  const requestUrl = buildLatestXPostsUrl(requestedHandles, forceRefresh);
  const inFlightRequest = inFlightLatestRequests.get(requestUrl);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const queuedRequest = latestRequestQueue.catch(() => undefined).then(() => fetchLatestXPostsRequest(requestUrl, requestedHandles));
  latestRequestQueue = queuedRequest;
  inFlightLatestRequests.set(requestUrl, queuedRequest);
  return queuedRequest;
}

async function fetchLatestXPostsRequest(requestUrl: string, requestedHandles: string[]): Promise<XSourceItem[]> {
  return fetch(requestUrl)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`特定来源读取失败：${response.status}`);
      }

      const data = (await response.json()) as { items?: unknown[] };
      const returnedItems: XSourceItem[] = Array.isArray(data.items)
        ? data.items.map((item) => normalizeXSourceItem(item as Partial<XSourceItem>))
        : [];
      return fillMissingXSourceItems(requestedHandles, returnedItems);
    })
    .finally(() => {
      inFlightLatestRequests.delete(requestUrl);
    });
}

export function fillMissingXSourceItems(handles: string[], items: XSourceItem[]): XSourceItem[] {
  const requestedHandles = mergeXHandles([], handles);
  const itemByHandle = new Map(items.map((item) => [item.handle.toLowerCase(), item]));
  return requestedHandles.map((handle) => itemByHandle.get(handle.toLowerCase()) ?? createMissingSourceItem(handle));
}

export function resetXSourceRequestStateForTests(): void {
  inFlightLatestRequests.clear();
  latestRequestQueue = Promise.resolve();
}

function normalizeXSourceItem(raw: Partial<XSourceItem>): XSourceItem {
  const handle = raw.handle ? normalizeXHandle(raw.handle) ?? raw.handle : 'unknown';
  const latestPost = raw.latestPost
    ? {
        id: raw.latestPost.id,
        text: raw.latestPost.text,
        translatedText: raw.latestPost.translatedText ?? null,
        createdAt: raw.latestPost.createdAt ?? null,
        url: raw.latestPost.url,
        media: raw.latestPost.media ?? []
      }
    : null;

  return {
    handle,
    displayName: raw.displayName ?? handle,
    profileUrl: raw.profileUrl ?? `https://x.com/${handle}`,
    latestPost,
    error: raw.error ?? null
  };
}

function createMissingSourceItem(handle: string): XSourceItem {
  return {
    handle,
    displayName: handle,
    profileUrl: `https://x.com/${handle}`,
    latestPost: null,
    error: '没有可展示的最新发布'
  };
}

function sameHandles(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((handle, index) => handle === right[index]);
}
