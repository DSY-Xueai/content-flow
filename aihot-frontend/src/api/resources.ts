import { validateAihotPayload } from './aihotContract';

interface CachedResource {
  data?: unknown;
  syncedAt: number;
  expiresAt: number;
  retryAt: number;
  etag?: string;
  warning?: string;
  pending?: Promise<Resource<unknown>>;
}

export interface Resource<T> {
  data: T;
  syncedAt: number;
  expiresAt: number;
  warning?: string;
}

const cache = new Map<string, CachedResource>();

export function resetResourceCache() {
  cache.clear();
}

export async function readResource<T>(url: string, minimumInterval = 60000): Promise<Resource<T>> {
  let entry = cache.get(url);
  if (!entry) {
    entry = { syncedAt: 0, expiresAt: 0, retryAt: 0 };
    cache.set(url, entry);
  }
  const current = entry;
  if (current.pending) return current.pending as Promise<Resource<T>>;
  if (current.retryAt > Date.now()) throw new Error(`请求受限，请在 ${new Date(current.retryAt).toLocaleTimeString('zh-CN')} 后重试`);
  if (current.data !== undefined && current.expiresAt > Date.now()) return { data: current.data as T, syncedAt: current.syncedAt, expiresAt: current.expiresAt, warning: current.warning };

  current.pending = (async () => {
    const response = await fetch(url, {
      cache: 'no-cache',
      headers: current.etag ? { 'If-None-Match': current.etag } : undefined,
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok && response.status !== 304) {
      const retry = response.headers.get('Retry-After');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
      current.retryAt = Date.now() + Math.max(minimumInterval, Number.isFinite(seconds) ? seconds : 0);
      throw new Error(`AIHOT 同步失败（HTTP ${response.status}），请稍后重试`);
    }
    if (response.status !== 304) {
      const data = await response.json();
      validateAihotPayload(url, data);
      current.data = data;
    }
    if (current.data === undefined) throw new Error('AIHOT 返回了空数据，请重试');
    const control = response.headers.get('Cache-Control');
    const ttl = control?.match(/s-maxage=(\d+)/)?.[1] ?? control?.match(/max-age=(\d+)/)?.[1];
    const age = Number(response.headers.get('Age') ?? 0);
    current.syncedAt = Date.now();
    current.expiresAt = current.syncedAt + Math.max(minimumInterval, (Number(ttl ?? 0) - age) * 1000);
    current.retryAt = 0;
    current.etag = response.headers.get('ETag') ?? current.etag;
    const checkedAt = response.headers.get('X-Aihot-Synced-At');
    if (checkedAt) current.syncedAt = Number(checkedAt);
    current.warning = response.headers.get('X-Aihot-Stale') === '1' ? '上游同步失败，正在显示上次有效缓存，详情见同步状态。' : undefined;
    return { data: current.data, syncedAt: current.syncedAt, expiresAt: current.expiresAt, warning: current.warning };
  })();
  try {
    return await current.pending as Resource<T>;
  } finally {
    current.pending = undefined;
  }
}
