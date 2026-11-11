import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateAihotPayload } from '../src/api/aihotContract';
import type { SyncEntryStatus, SyncHealth } from '../src/api/sync';

// Half of the 10 MB disk budget is reserved for the atomic-write temporary file.
export const MAX_CACHE_BYTES = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const definitions = [
  { name: '精选', path: '/api/v1/items?mode=selected&by=timeline&limit=40', interval: 60000 },
  { name: '全部动态', path: '/api/v1/items?mode=all&by=timeline&limit=40', interval: 60000 },
  { name: '热点榜', path: '/api/v1/hot-topics', interval: 60000 },
  { name: 'AI 日报', path: '/api/v1/dailies/latest', interval: 60000 },
  { name: '主题列表', path: '/api/site/topics', interval: 300000 },
  { name: '模型榜', path: '/api/site/leaderboard/boards', interval: 300000 },
  { name: '重置监控', path: '/api/v1/codex-resets', interval: 600000 },
  { name: 'API 定义检查', path: '/openapi-v1.json', interval: 3600000 }
];

interface Entry extends SyncEntryStatus {
  interval: number;
  body?: string;
  etag?: string;
  baselineHash?: string;
  pending?: Promise<void>;
}

export function createAihotSyncService(cacheFile: string, fetchImpl: typeof fetch = fetch) {
  const entries: Entry[] = definitions.map((entry) => ({ ...entry, lastAttemptAt: 0, lastSuccessAt: 0, nextAttemptAt: 0, consecutiveFailures: 0, error: null, lastFailureAt: 0, lastFailure: null, warning: null, cached: false }));
  let cacheError: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  const controllers = new Set<AbortController>();
  const serialize = () => JSON.stringify({ version: 1, entries: entries.map(({ pending: _pending, ...entry }) => entry) });
  try {
    if (fs.existsSync(cacheFile)) {
      if (fs.statSync(cacheFile).size > MAX_CACHE_BYTES) throw new Error('同步缓存超过容量上限，未加载');
      const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.entries)) throw new Error('同步缓存格式不正确，正在重新获取');
      for (const entry of entries) {
        const old = saved.entries.find((item: { path?: string }) => item.path === entry.path);
        if (!old) continue;
        if (old.body !== undefined) validateAihotPayload(entry.path, JSON.parse(old.body));
        for (const key of ['lastAttemptAt', 'lastSuccessAt', 'nextAttemptAt', 'consecutiveFailures'] as const) {
          if (typeof old[key] !== 'number' || !Number.isFinite(old[key]) || old[key] < 0) throw new Error('同步缓存时间记录不正确');
          entry[key] = old[key];
        }
        entry.body = old.body;
        entry.etag = typeof old.etag === 'string' ? old.etag : undefined;
        entry.baselineHash = typeof old.baselineHash === 'string' ? old.baselineHash : undefined;
        entry.error = typeof old.error === 'string' ? old.error : null;
        entry.lastFailureAt = typeof old.lastFailureAt === 'number' ? old.lastFailureAt : 0;
        entry.lastFailure = typeof old.lastFailure === 'string' ? old.lastFailure : null;
        entry.warning = typeof old.warning === 'string' ? old.warning : null;
        entry.cached = !!entry.body;
      }
    }
  } catch (error) { cacheError = message(error); }

  function persist() {
    try {
      const body = serialize();
      if (Buffer.byteLength(body) > MAX_CACHE_BYTES) throw new Error('同步缓存超过容量上限，未覆盖磁盘快照');
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(`${cacheFile}.tmp`, body, 'utf8');
      fs.renameSync(`${cacheFile}.tmp`, cacheFile);
      cacheError = null;
    } catch (error) { cacheError = message(error); }
  }

  async function sync(entry: Entry) {
    if (entry.pending) return entry.pending;
    if (stopped || Date.now() < entry.nextAttemptAt) return;
    entry.pending = (async () => {
      entry.lastAttemptAt = Date.now();
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetchImpl(`https://aihot.news${entry.path}`, {
          headers: { 'User-Agent': 'wechat-text-workbench/1.0', ...(entry.etag ? { 'If-None-Match': entry.etag } : {}) },
          signal: controller.signal
        });
        if (!response.ok && response.status !== 304) {
          entry.nextAttemptAt = Date.now() + Math.max(entry.interval, retryDelay(response.headers.get('Retry-After')));
          throw new Error(`HTTP ${response.status}`);
        }
        if (response.status === 304) {
          if (!entry.body && !entry.baselineHash) throw new Error('接口返回 304，但本地没有有效快照');
        } else {
          const body = await readBounded(response);
          let data: unknown;
          try { data = JSON.parse(body); } catch { throw new Error('响应不是有效 JSON，未覆盖上次有效数据'); }
          if (entry.path === '/openapi-v1.json') {
            const hash = contractHash(data);
            entry.baselineHash ??= hash;
            entry.warning = hash === entry.baselineHash ? null : '官方 API 定义与首次记录不同，请检查接口兼容性；当前数据仍按本地规则校验。';
          } else {
            validateAihotPayload(entry.path, data);
            const previous = entry.body;
            entry.body = body;
            if (Buffer.byteLength(serialize()) > MAX_CACHE_BYTES - 65536) {
              entry.body = previous;
              throw new Error('同步缓存已达容量上限，保留上次有效快照');
            }
            entry.cached = true;
          }
          entry.etag = response.headers.get('ETag') ?? undefined;
        }
        const control = response.headers.get('Cache-Control');
        const ttl = control?.match(/s-maxage=(\d+)/)?.[1] ?? control?.match(/max-age=(\d+)/)?.[1];
        const age = Number(response.headers.get('Age') ?? 0);
        entry.lastSuccessAt = Date.now();
        entry.nextAttemptAt = Date.now() + Math.max(entry.interval, (Number(ttl ?? 0) - (Number.isFinite(age) ? age : 0)) * 1000);
        entry.consecutiveFailures = 0;
        entry.error = null;
      } catch (error) {
        if (!stopped) {
          entry.consecutiveFailures += 1;
          entry.error = message(error);
          entry.lastFailure = entry.error;
          entry.lastFailureAt = Date.now();
          entry.nextAttemptAt = Math.max(entry.nextAttemptAt, Date.now() + Math.min(3600000, entry.interval * 2 ** Math.min(entry.consecutiveFailures - 1, 6)));
        }
      } finally {
        clearTimeout(timeout);
        controllers.delete(controller);
        if (!stopped) persist();
      }
    })();
    try { await entry.pending; } finally { entry.pending = undefined; }
  }

  async function syncAll() {
    await Promise.all(entries.map(sync));
  }

  function status(): SyncHealth {
    return {
      resources: entries.map(({ name, path, lastAttemptAt, lastSuccessAt, nextAttemptAt, consecutiveFailures, error, lastFailureAt, lastFailure, warning, cached, pending }) => ({ name, path, lastAttemptAt, lastSuccessAt, nextAttemptAt, consecutiveFailures, error, lastFailureAt, lastFailure, warning: warning ?? (!pending && lastAttemptAt && Date.now() > nextAttemptAt + 60000 ? '已超过计划检查时间，等待后台同步。' : null), cached })),
      cache: { bytes: Buffer.byteLength(serialize()), limitBytes: MAX_CACHE_BYTES, diskBudgetBytes: 2 * MAX_CACHE_BYTES, error: cacheError }
    };
  }

  async function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { next(); return; }
    if (url.pathname === '/api/aihot-sync/status') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(status()));
      return;
    }
    const entry = entries.find((item) => item.path !== '/openapi-v1.json' && sameResource(url, item.path));
    if (!entry) { next(); return; }
    await sync(entry);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (!entry.body) {
      res.statusCode = 503;
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.nextAttemptAt - Date.now()) / 1000))));
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: entry.error ?? '正在首次同步，请稍后重试' }));
      return;
    }
    res.setHeader('X-Aihot-Synced-At', String(entry.lastSuccessAt));
    res.setHeader('X-Aihot-Stale', entry.error ? '1' : '0');
    if (entry.etag) res.setHeader('ETag', entry.etag);
    if (!entry.error && entry.etag && req.headers['if-none-match'] === entry.etag) {
      res.statusCode = 304;
      res.end();
    } else res.end(req.method === 'HEAD' ? undefined : entry.body);
  }

  return {
    middleware, status, syncAll,
    start() {
      if (timer) return;
      stopped = false;
      void syncAll();
      timer = setInterval(() => { void syncAll(); }, 10000);
      timer.unref();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      for (const controller of controllers) controller.abort();
    }
  };
}

function sameResource(url: URL, resource: string) {
  const target = new URL(resource, 'http://localhost');
  url.searchParams.sort();
  target.searchParams.sort();
  return url.pathname === target.pathname && url.searchParams.toString() === target.searchParams.toString();
}

function retryDelay(value: string | null) {
  if (!value) return 0;
  const duration = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

function message(error: unknown) {
  return (error instanceof Error ? error.message : '同步失败').slice(0, 500);
}

async function readBounded(response: Response) {
  if (Number(response.headers.get('Content-Length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('接口响应超过 2 MB 上限，未覆盖上次有效数据');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('接口返回空响应');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('接口响应超过 2 MB 上限，未覆盖上次有效数据');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel(); reader.releaseLock(); }
}

function contractHash(data: unknown) {
  const doc = data as { paths?: Record<string, unknown>; components?: unknown };
  if (!doc?.paths || !doc.components) throw new Error('官方 API 定义格式发生变化');
  const paths = Object.fromEntries(definitions.filter((item) => item.path.startsWith('/api/v1/')).map((item) => {
    const pathname = item.path.split('?')[0];
    if (!doc.paths?.[pathname]) throw new Error(`官方 API 定义缺少 ${pathname}`);
    return [pathname, doc.paths[pathname]];
  }));
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['description', 'summary', 'example', 'examples', 'title'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  };
  return createHash('sha256').update(JSON.stringify(normalize({ paths, components: doc.components }))).digest('hex');
}
