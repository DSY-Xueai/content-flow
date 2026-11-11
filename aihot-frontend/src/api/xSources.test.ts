import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_X_HANDLES,
  buildLatestXPostsUrl,
  fetchLatestXPosts,
  fetchStoredXHandles,
  fillMissingXSourceItems,
  loadPersistedXHandles,
  mergeXHandles,
  normalizeXHandle,
  readStoredXHandles,
  resetXSourceRequestStateForTests,
  saveStoredXHandles,
  writeStoredXHandles
} from './xSources';

afterEach(() => {
  resetXSourceRequestStateForTests();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('xSources', () => {
  it('normalizes X profile URLs and handles', () => {
    expect(normalizeXHandle('https://x.com/GoogleAIStudio')).toBe('GoogleAIStudio');
    expect(normalizeXHandle('https://twitter.com/AnthropicAI?s=20')).toBe('AnthropicAI');
    expect(normalizeXHandle('@OpenAI')).toBe('OpenAI');
    expect(normalizeXHandle('x.com/github/status/123')).toBe('github');
    expect(normalizeXHandle('https://x.com/nytimes/')).toBe('nytimes');
  });

  it('rejects invalid or reserved X paths', () => {
    expect(normalizeXHandle('')).toBeNull();
    expect(normalizeXHandle('https://x.com/home')).toBeNull();
    expect(normalizeXHandle('https://x.com/i/flow/login')).toBeNull();
    expect(normalizeXHandle('not a handle')).toBeNull();
  });

  it('merges handles without duplicates while preserving original casing', () => {
    expect(mergeXHandles(['OpenAI', 'github'], ['openai', 'AnthropicAI'])).toEqual([
      'OpenAI',
      'github',
      'AnthropicAI'
    ]);
  });

  it('stores normalized custom handles in localStorage', () => {
    localStorage.clear();

    writeStoredXHandles(['OpenAI', 'https://x.com/github', 'bad handle', 'openai']);

    expect(readStoredXHandles()).toEqual(['OpenAI', 'github']);
  });

  it('fetches stored custom handles from the local source API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ handles: ['huggingface', 'bad handle', 'OpenAI'] }), { status: 200 })
    );

    await expect(fetchStoredXHandles()).resolves.toEqual(['huggingface', 'OpenAI']);
    expect(fetchMock).toHaveBeenCalledWith('/api/x/handles');
  });

  it('saves normalized custom handles through the local source API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ handles: ['OpenAI', 'github'] }), { status: 200 })
    );

    await expect(saveStoredXHandles(['OpenAI', 'https://x.com/github', 'bad handle'])).resolves.toEqual([
      'OpenAI',
      'github'
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/x/handles', {
      body: JSON.stringify({ handles: ['OpenAI', 'github'] }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'PUT'
    });
  });

  it('migrates browser-only custom handles into the local source API', async () => {
    localStorage.setItem('x-specific-source-handles', JSON.stringify(['huggingface', 'MistralAI']));
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ handles: ['cursor_ai'] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ handles: ['cursor_ai', 'huggingface', 'MistralAI'] }), { status: 200 })
      );

    await expect(loadPersistedXHandles()).resolves.toEqual(['cursor_ai', 'huggingface', 'MistralAI']);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/x/handles');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/x/handles', {
      body: JSON.stringify({ handles: ['cursor_ai', 'huggingface', 'MistralAI'] }),
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'PUT'
    });
  });

  it('builds the latest posts API URL from handles', () => {
    expect(buildLatestXPostsUrl(['OpenAI', 'github'])).toBe('/api/x/latest?handles=OpenAI%2Cgithub');
  });

  it('adds a refresh flag when building a forced latest posts API URL', () => {
    expect(buildLatestXPostsUrl(['OpenAI'], true)).toBe('/api/x/latest?handles=OpenAI&refresh=1');
  });

  it('fetches and normalizes latest X posts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              handle: 'OpenAI',
              displayName: 'OpenAI',
              profileUrl: 'https://x.com/OpenAI',
              latestPost: {
                id: '123',
                text: 'New model update',
                translatedText: '新的模型更新',
                createdAt: '2026-05-21T01:00:00.000Z',
                url: 'https://x.com/OpenAI/status/123',
                media: [
                  {
                    url: 'https://pbs.twimg.com/media/model.jpg',
                    type: 'photo'
                  }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    const result = await fetchLatestXPosts(['OpenAI']);

    expect(result[0]).toMatchObject({
      handle: 'OpenAI',
      displayName: 'OpenAI',
      profileUrl: 'https://x.com/OpenAI',
      latestPost: {
        id: '123',
        text: 'New model update',
        translatedText: '新的模型更新',
        media: [
          {
            url: 'https://pbs.twimg.com/media/model.jpg',
            type: 'photo'
          }
        ],
        url: 'https://x.com/OpenAI/status/123'
      }
    });
  });

  it('deduplicates concurrent latest post requests for the same handles', async () => {
    const resolveFetches: Array<(response: Response) => void> = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetches.push(resolve);
        })
    );

    const firstRequest = fetchLatestXPosts(['OpenAI']);
    const secondRequest = fetchLatestXPosts(['OpenAI']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const responseBody = JSON.stringify({
      items: [
        {
          handle: 'OpenAI',
          displayName: 'OpenAI',
          profileUrl: 'https://x.com/OpenAI',
          latestPost: {
            id: '123',
            text: 'New model update',
            createdAt: '2026-05-21T01:00:00.000Z',
            url: 'https://x.com/OpenAI/status/123',
            media: []
          }
        }
      ]
    });
    for (const resolveFetch of resolveFetches) {
      resolveFetch(
        new Response(responseBody, { status: 200 })
      );
    }

    await expect(firstRequest).resolves.toHaveLength(1);
    await expect(secondRequest).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('starts a new latest post request after the previous one completes', async () => {
    const responseBody = JSON.stringify({
      items: [
        {
          handle: 'OpenAI',
          displayName: 'OpenAI',
          profileUrl: 'https://x.com/OpenAI',
          latestPost: {
            id: '123',
            text: 'New model update',
            createdAt: '2026-05-21T01:00:00.000Z',
            url: 'https://x.com/OpenAI/status/123',
            media: []
          }
        }
      ]
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(responseBody, { status: 200 })
      )
    );

    await fetchLatestXPosts(['OpenAI']);
    await fetchLatestXPosts(['OpenAI']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serializes different latest post requests to avoid competing source reads', async () => {
    const resolveFetches: Array<(response: Response) => void> = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetches.push(resolve);
        })
    );
    const responseBody = JSON.stringify({
      items: [
        {
          handle: 'OpenAI',
          displayName: 'OpenAI',
          profileUrl: 'https://x.com/OpenAI',
          latestPost: {
            id: '123',
            text: 'New model update',
            createdAt: '2026-05-21T01:00:00.000Z',
            url: 'https://x.com/OpenAI/status/123',
            media: []
          }
        }
      ]
    });

    const firstRequest = fetchLatestXPosts(['OpenAI']);
    const secondRequest = fetchLatestXPosts(['OpenAI', 'drfeifei']);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFetches[0](new Response(responseBody, { status: 200 }));
    await expect(firstRequest).resolves.toHaveLength(1);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolveFetches[1](new Response(responseBody, { status: 200 }));
    await expect(secondRequest).resolves.toHaveLength(2);
  });

  it('keeps the requested handle when one account fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              handle: 'MissingAccount',
              profileUrl: 'https://x.com/MissingAccount',
              error: '未找到账号'
            }
          ]
        }),
        { status: 200 }
      )
    );

    const result = await fetchLatestXPosts(['MissingAccount']);

    expect(result[0]).toMatchObject({
      handle: 'MissingAccount',
      error: '未找到账号',
      latestPost: null
    });
  });

  it('adds an error placeholder when the latest posts API omits a requested handle', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              handle: 'OpenAI',
              displayName: 'OpenAI',
              profileUrl: 'https://x.com/OpenAI',
              latestPost: {
                id: '123',
                text: 'New model update',
                createdAt: '2026-05-21T01:00:00.000Z',
                url: 'https://x.com/OpenAI/status/123',
                media: []
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    const result = await fetchLatestXPosts(['OpenAI', 'huggingface']);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      handle: 'huggingface',
      profileUrl: 'https://x.com/huggingface',
      latestPost: null,
      error: '没有可展示的最新发布'
    });
  });

  it('fills missing source items before the latest posts API returns', () => {
    const result = fillMissingXSourceItems(['OpenAI', 'huggingface'], [
      {
        handle: 'OpenAI',
        displayName: 'OpenAI',
        profileUrl: 'https://x.com/OpenAI',
        latestPost: {
          id: '123',
          text: 'New model update',
          createdAt: '2026-05-21T01:00:00.000Z',
          url: 'https://x.com/OpenAI/status/123',
          media: []
        }
      }
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].latestPost?.text).toBe('New model update');
    expect(result[1]).toMatchObject({
      handle: 'huggingface',
      latestPost: null,
      error: '没有可展示的最新发布'
    });
  });

  it('includes the provided default handles', () => {
    expect(DEFAULT_X_HANDLES).toContain('GoogleAIStudio');
    expect(DEFAULT_X_HANDLES).toContain('nytimes');
    expect(DEFAULT_X_HANDLES).toHaveLength(18);
  });
});
