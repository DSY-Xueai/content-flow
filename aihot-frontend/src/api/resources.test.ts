import { afterEach, describe, expect, it, vi } from 'vitest';
import { readResource, resetResourceCache } from './resources';

afterEach(() => { vi.restoreAllMocks(); resetResourceCache(); });

describe('AIHOT resource synchronization', () => {
  it('keeps the real upstream success time and stale warning when restoring a disk snapshot', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { headers: { 'X-Aihot-Synced-At': '1000000', 'X-Aihot-Stale': '1' } }));
    const result = await readResource('/cached-resource');
    expect(result.syncedAt).toBe(1000000);
    expect(result.warning).toContain('上次有效缓存');
    expect(await readResource('/cached-resource')).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete hot rankings without replacing the previous valid snapshot', async () => {
    let now = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const valid = { schemaVersion: 1, count: 0, items: [] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(valid))).mockResolvedValueOnce(new Response('{"schemaVersion":1,"count":1,"items":[{"rank":1,"title":"broken"}]}'));
    const first = await readResource('/api/v1/hot-topics');
    now += 60000;
    await expect(readResource('/api/v1/hot-topics')).rejects.toThrow('items[0].id');
    expect(first.data).toEqual(valid);
    expect(first.syncedAt).toBe(1000000);
  });

  it('deduplicates simultaneous reads and keeps the real synchronization time', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ version: 1 }), { headers: { 'Cache-Control': 'max-age=60', ETag: '"v1"' } }));
    const [first, second] = await Promise.all([readResource('/resource'), readResource('/resource')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(await readResource('/resource')).toMatchObject({ data: { version: 1 }, syncedAt: first.syncedAt });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('subtracts upstream Age without adding another full shared-cache lifetime', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000000);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { headers: { 'Cache-Control': 'max-age=120, s-maxage=300', Age: '180' } }));
    const result = await readResource('/aged-resource');
    expect(result.expiresAt).toBe(1120000);
  });

  it('revalidates expired data with ETag and handles 304 without losing the body', async () => {
    let now = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"items":[1]}', { headers: { ETag: '"v1"' } })).mockResolvedValueOnce(new Response(null, { status: 304 }));
    await readResource('/resource');
    now += 61000;
    expect(await readResource('/resource')).toMatchObject({ data: { items: [1] }, syncedAt: now });
    expect(fetchMock).toHaveBeenLastCalledWith('/resource', expect.objectContaining({ headers: { 'If-None-Match': '"v1"' }, cache: 'no-cache' }));
  });

  it('respects Retry-After across repeated callers instead of retrying in parallel', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '600' } }));
    await expect(readResource('/limited')).rejects.toThrow('429');
    await expect(readResource('/limited')).rejects.toThrow('请求受限');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not mark a failed refresh as newly synchronized', async () => {
    let now = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}')).mockRejectedValueOnce(new Error('offline'));
    const first = await readResource('/resource');
    now += 61000;
    await expect(readResource('/resource')).rejects.toThrow('offline');
    expect(first.syncedAt).toBe(1000000);
  });

  it('rejects a changed site API contract before replacing a valid snapshot', async () => {
    let now = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"groups":[],"topics":[]}')).mockResolvedValueOnce(new Response('{"error":"changed contract"}'));
    const first = await readResource('/api/site/topics');
    now += 61000;
    await expect(readResource('/api/site/topics')).rejects.toThrow('未覆盖上次有效数据');
    expect(first.data).toEqual({ groups: [], topics: [] });
    expect(first.syncedAt).toBe(1000000);
  });
});
