import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAihotSyncService, MAX_CACHE_BYTES } from './aihotMonitor';

const hotPath = '/api/v1/hot-topics';
const validHot = { schemaVersion: 1, count: 0, items: [] };
const spec = { paths: Object.fromEntries(['/api/v1/items', hotPath, '/api/v1/dailies/latest', '/api/v1/codex-resets'].map((key) => [key, { get: { responses: { '200': {} } } }])), components: { schemas: {} } };
const payload = (url: string): unknown => {
  if (url.includes('/api/v1/items')) return { items: [], page: { hasMore: false, nextCursor: null } };
  if (url.includes(hotPath)) return validHot;
  if (url.includes('/dailies/')) return { report: { date: '2026-11-04', sections: [] } };
  if (url.includes('/topics')) return { groups: [], topics: [] };
  if (url.includes('/boards')) return { boards: [], models: {}, run: { generatedAt: '2026-11-04T08:00:00Z', fx: { rate: 7 } } };
  if (url.includes('/codex-resets')) return { events: [] };
  return spec;
};
const json = (data: unknown, headers = {}) => new Response(JSON.stringify(data), { headers });
function exchange(url = hotPath, etag?: string, method = 'GET') {
  const req = { url, method, headers: etag ? { 'if-none-match': etag } : {} } as IncomingMessage;
  const headers: Record<string, string> = {};
  const res = { statusCode: 200, setHeader: (key: string, value: string) => { headers[key] = value; }, end: vi.fn() };
  return { req, res, response: res as unknown as ServerResponse, headers };
}
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aihot-sync-')); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); fs.rmSync(directory, { recursive: true, force: true }); });
const file = () => path.join(directory, 'cache.json');

// These tests exercise the actual scheduler, HTTP middleware and disk snapshots together.
describe('local AIHOT synchronization', () => {
  it('polls without browser requests, respects per-resource cadence and stops with the service', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
    const upstream = vi.fn(async (input: string | URL | Request) => json(payload(String(input)), { ETag: '"v1"' }));
    const service = createAihotSyncService(file(), upstream);
    service.start();
    await service.syncAll();
    expect(upstream).toHaveBeenCalledTimes(8);
    expect(service.status().resources.every((entry) => entry.lastSuccessAt === 1000000)).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(upstream).toHaveBeenCalledTimes(12);
    expect(upstream.mock.calls.filter(([url]) => String(url).includes('codex-resets'))).toHaveLength(1);
    service.stop();
    await vi.advanceTimersByTimeAsync(600000);
    expect(upstream).toHaveBeenCalledTimes(12);
  });

  it('shares requests across callers and restores data, cooldown and ETag after restart', async () => {
    let now = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const upstream = vi.fn().mockResolvedValueOnce(json(validHot, { ETag: '"v1"' })).mockResolvedValueOnce(new Response(null, { status: 304 }));
    const service = createAihotSyncService(file(), upstream);
    const first = exchange(), second = exchange();
    await Promise.all([service.middleware(first.req, first.response, vi.fn()), service.middleware(second.req, second.response, vi.fn())]);
    expect(upstream).toHaveBeenCalledTimes(1);
    const restarted = createAihotSyncService(file(), upstream);
    const restored = exchange(hotPath, '"v1"');
    await restarted.middleware(restored.req, restored.response, vi.fn());
    expect(restored.res.statusCode).toBe(304);
    expect(upstream).toHaveBeenCalledTimes(1);
    now += 60000;
    const updated = exchange();
    await restarted.middleware(updated.req, updated.response, vi.fn());
    expect(upstream.mock.calls[1][1].headers['If-None-Match']).toBe('"v1"');
    expect(updated.res.end).toHaveBeenCalledWith(JSON.stringify(validHot));
    expect(updated.headers['X-Aihot-Synced-At']).toBe(String(now));
    expect(fs.existsSync(`${file()}.tmp`)).toBe(false);
  });

  it('preserves the snapshot on contract errors and persists the precise failure across restarts', async () => {
    let now = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const upstream = vi.fn().mockResolvedValueOnce(json(validHot)).mockResolvedValueOnce(json({ ...validHot, items: [{ title: 'broken' }] }));
    const service = createAihotSyncService(file(), upstream);
    let request = exchange();
    await service.middleware(request.req, request.response, vi.fn());
    now += 60000;
    request = exchange();
    await service.middleware(request.req, request.response, vi.fn());
    expect(request.res.statusCode).toBe(200);
    expect(request.headers['X-Aihot-Stale']).toBe('1');
    expect(request.headers['X-Aihot-Synced-At']).toBe('1000000');
    expect(request.res.end).toHaveBeenCalledWith(JSON.stringify(validHot));
    const restarted = createAihotSyncService(file(), upstream);
    expect(restarted.status().resources.find((entry) => entry.path === hotPath)).toMatchObject({ consecutiveFailures: 1, lastSuccessAt: 1000000, error: expect.stringContaining('items[0].id') });
    request = exchange();
    await restarted.middleware(request.req, request.response, vi.fn());
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After, backs off repeated failures, and recovers without resetting other resources', async () => {
    let now = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const upstream = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '900' } })).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(json(validHot));
    const service = createAihotSyncService(file(), upstream);
    const request = exchange();
    await service.middleware(request.req, request.response, vi.fn());
    expect(request.res.statusCode).toBe(503);
    expect(request.headers['Retry-After']).toBe('900');
    now += 60000;
    const waiting = exchange();
    await service.middleware(waiting.req, waiting.response, vi.fn());
    expect(upstream).toHaveBeenCalledTimes(1);
    now += 840000;
    const retry = exchange();
    await service.middleware(retry.req, retry.response, vi.fn());
    expect(service.status().resources[2]).toMatchObject({ consecutiveFailures: 2, nextAttemptAt: now + 120000 });
    now += 120000;
    const recovered = exchange();
    await service.middleware(recovered.req, recovered.response, vi.fn());
    expect(service.status().resources[2]).toMatchObject({ consecutiveFailures: 0, error: null, lastSuccessAt: now });
  });

  it('rejects oversized responses before replacing data and never caches searches or pagination', async () => {
    const upstream = vi.fn().mockResolvedValueOnce(json(validHot)).mockResolvedValueOnce(new Response('x', { headers: { 'Content-Length': String(3 * 1024 * 1024) } }));
    let now = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const service = createAihotSyncService(file(), upstream);
    let request = exchange();
    await service.middleware(request.req, request.response, vi.fn());
    now += 60000;
    request = exchange();
    await service.middleware(request.req, request.response, vi.fn());
    expect(request.res.end).toHaveBeenCalledWith(JSON.stringify(validHot));
    expect(service.status().resources[2].error).toContain('2 MB');
    expect(fs.statSync(file()).size).toBeLessThan(MAX_CACHE_BYTES);
    for (const url of ['/api/v1/items?mode=selected&by=timeline&q=OpenAI&limit=40', '/api/v1/items?mode=all&by=timeline&limit=40&cursor=next', '/api/site/topics/openai?page=2']) {
      const other = exchange(url);
      const next = vi.fn();
      await service.middleware(other.req, other.response, next);
      expect(next).toHaveBeenCalledOnce();
    }
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('detects official schema changes hourly, ignores description edits and retains warnings after restart', async () => {
    let now = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let document = spec;
    const upstream = vi.fn(async (input: string | URL | Request) => json(String(input).endsWith('.json') ? document : payload(String(input))));
    const service = createAihotSyncService(file(), upstream);
    await service.syncAll();
    document = { ...spec, components: { schemas: {}, description: 'new prose' } };
    now += 3600000;
    await service.syncAll();
    expect(service.status().resources.at(-1)?.warning).toBeNull();
    document = { ...spec, components: { schemas: { HotTopic: { type: 'array' } } } };
    now += 3600000;
    await service.syncAll();
    expect(service.status().resources.at(-1)?.warning).toContain('API 定义');
    const restarted = createAihotSyncService(file(), upstream);
    expect(restarted.status().resources.at(-1)?.warning).toContain('API 定义');
  });

  it('keeps aggregate snapshots below the disk budget and bounds streaming responses without Content-Length', async () => {
    const padding = 'x'.repeat(1800000);
    const upstream = vi.fn(async (input: string | URL | Request) => json({ ...payload(String(input)) as object, padding }));
    const service = createAihotSyncService(file(), upstream);
    await service.syncAll();
    const health = service.status();
    expect(health.resources.some((entry) => entry.error?.includes('容量上限'))).toBe(true);
    expect(health.cache.bytes).toBeLessThan(MAX_CACHE_BYTES);
    expect(fs.statSync(file()).size).toBeLessThan(MAX_CACHE_BYTES);
    expect(fs.existsSync(`${file()}.tmp`)).toBe(false);
    const streamed = createAihotSyncService(path.join(directory, 'streamed.json'), vi.fn().mockImplementation(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); controller.close(); } }))));
    const request = exchange();
    await streamed.middleware(request.req, request.response, vi.fn());
    expect(streamed.status().resources[2].error).toContain('2 MB');
    expect(streamed.status().resources[2].cached).toBe(false);
  });

  it('reports disk write failures while keeping the bounded valid in-memory snapshot available', async () => {
    const cacheFile = file();
    fs.mkdirSync(cacheFile);
    const service = createAihotSyncService(cacheFile, vi.fn().mockResolvedValue(json(validHot)));
    const request = exchange();
    await service.middleware(request.req, request.response, vi.fn());
    expect(request.res.end).toHaveBeenCalledWith(JSON.stringify(validHot));
    expect(service.status().cache.error).toBeTruthy();
  });

  it('aborts in-flight requests on shutdown and reports timeouts instead of hanging', async () => {
    vi.useFakeTimers();
    const upstream = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')));
    }));
    const service = createAihotSyncService(file(), upstream);
    let request = exchange();
    const pending = service.middleware(request.req, request.response, vi.fn());
    await vi.advanceTimersByTimeAsync(20000);
    await pending;
    expect(service.status().resources[2].consecutiveFailures).toBe(1);
    await vi.advanceTimersByTimeAsync(60000);
    request = exchange();
    const shutdown = service.middleware(request.req, request.response, vi.fn());
    service.stop();
    await shutdown;
    expect(upstream.mock.calls[1][1]?.signal?.aborted).toBe(true);
  });
});
