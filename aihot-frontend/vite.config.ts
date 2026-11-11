import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import {
  buildJinaProfileUrl,
  buildJinaStatusUrl,
  buildNitterProfileUrl,
  buildRssHubUserUrl,
  choosePreferredPost,
  choosePreferredPostFromReaders,
  hasLowInformationContent,
  normalizeRssHubItem,
  parseJinaProfileMarkdown,
  parseJinaStatusMarkdown,
  parseNitterProfileHtml
} from './src/api/sourceReaders';
import {
  buildGoogleTranslateUrls,
  buildMyMemoryTranslateUrl,
  isUsefulSimplifiedChineseTranslation,
  parseGoogleTranslateResponse,
  parseMyMemoryTranslateResponse
} from './src/api/translation';
import { createAgentMiddleware } from './server/agentPipeline/routes';
import { loadAgentEnv } from './server/agentPipeline/env';
import { createAihotSyncService } from './server/aihotMonitor';

declare const process: {
  env: Record<string, string | undefined>;
  cwd: () => string;
};

const SOURCE_BATCH_SIZE = 6;
const SOURCE_REQUEST_TIMEOUT_MS = 12000;
const SOURCE_READER_TIMEOUT_MS = 10000;
const SOURCE_STATUS_TIMEOUT_MS = 8000;
const SOURCE_ACCOUNT_TIMEOUT_MS = 20000;
const SOURCE_SERVER_CACHE_TTL_MS = 5 * 60 * 1000;
const X_SOURCE_STORE_DIR = 'data';
const X_SOURCE_STORE_FILE = 'x-sources-store.json';

interface XSourceStore {
  handles: string[];
  latestByHandle: Record<string, CachedXSourceItem>;
}

interface CachedXSourceItem {
  cachedAt: number;
  item: unknown;
}

export default defineConfig(({ mode }) => {
  const env = loadAgentEnv(mode, process.cwd(), loadEnv);
  const jinaBaseUrl = env.X_SOURCE_READER_BASE_URL || 'https://r.jina.ai/http://';
  const rssHubBaseUrl = env.RSSHUB_BASE_URL || 'https://rsshub-boost.23751.net';
  const nitterBaseUrl = env.NITTER_BASE_URL || 'https://nitter.tiekoetter.com';
  const sourceProxyUrl = env.X_SOURCE_PROXY_URL || env.HTTPS_PROXY || env.HTTP_PROXY || 'http://127.0.0.1:7897';

  return {
    plugins: [
      react(),
      {
        name: 'agent-pipeline-dev-api',
        configureServer(server) {
          const sync = createAihotSyncService('data/aihot-sync-cache.json');
          server.middlewares.use(sync.middleware);
          server.httpServer?.once('listening', () => sync.start());
          server.httpServer?.once('close', () => sync.stop());
          server.watcher.once('close', () => sync.stop());
          server.middlewares.use(createAgentMiddleware({ modelEnv: env }));
        }
      },
      {
        name: 'x-latest-dev-api',
        configureServer(server) {
          server.middlewares.use('/api/x/handles', async (req: { method?: string; on?: (...args: any[]) => void }, res) => {
            try {
              const store = await readXSourceStore();

              if (req.method === 'GET') {
                sendJson(res, 200, { handles: store.handles });
                return;
              }

              if (req.method === 'PUT') {
                const body = (await readRequestJson(req)) as { handles?: unknown };
                store.handles = normalizeHandleArray(body.handles);
                await writeXSourceStore(store);
                sendJson(res, 200, { handles: store.handles });
                return;
              }

              sendJson(res, 405, { error: 'Method not allowed' });
            } catch (error) {
              sendJson(res, 500, {
                error: error instanceof Error ? error.message : '特定来源账号存储失败'
              });
            }
          });

          server.middlewares.use('/api/x/latest', async (req: { url?: string }, res) => {
            try {
              const requestUrl = new URL(req.url ?? '', 'http://localhost');
              const handles = normalizeHandles(requestUrl.searchParams.get('handles') ?? '');
              const forceRefresh = requestUrl.searchParams.get('refresh') === '1';

              if (!handles.length) {
                sendJson(res, 200, { items: [] });
                return;
              }

              const store = await readXSourceStore();
              let storeChanged = false;
              const items = [];
              for (let index = 0; index < handles.length; index += SOURCE_BATCH_SIZE) {
                const batch = handles.slice(index, index + SOURCE_BATCH_SIZE);
                items.push(
                  ...(await Promise.all(
                    batch.map(async (handle) => {
                      const cachedItem = forceRefresh ? null : readFreshCachedSourceItem(store, handle);
                      if (cachedItem) {
                        return cachedItem;
                      }

                      const item = await withTimeout(
                        fetchSourceItem(handle, jinaBaseUrl, rssHubBaseUrl, nitterBaseUrl, sourceProxyUrl),
                        SOURCE_ACCOUNT_TIMEOUT_MS,
                        createSourceErrorItem(handle, '读取超时')
                      );
                      store.latestByHandle[handle.toLowerCase()] = {
                        cachedAt: Date.now(),
                        item
                      };
                      storeChanged = true;
                      return item;
                    })
                  ))
                );
              }

              if (storeChanged) {
                pruneCachedSourceItems(store, handles);
                await writeXSourceStore(store);
              }

              sendJson(res, 200, { items });
            } catch (error) {
              sendJson(res, 502, {
                error: error instanceof Error ? error.message : '特定来源读取失败',
                items: []
              });
            }
          });
        }
      },
    ],
    server: {
      port: 5177,
      proxy: {
        '/model-providers': {
          target: 'https://aihot.news', changeOrigin: true, secure: true,
          headers: { 'User-Agent': 'wechat-text-workbench/1.0' }
        },
        // Forward signed media URLs supplied by the site API without changing their signatures.
        '/api/img-proxy': {
          target: 'https://aihot.news', changeOrigin: true, secure: true,
          headers: { 'User-Agent': 'wechat-text-workbench/1.0' }
        },
        '/api/site': {
          target: 'https://aihot.news',
          changeOrigin: true,
          secure: true,
          headers: { 'User-Agent': 'wechat-text-workbench/1.0' }
        },
        '/api/v1': {
          target: 'https://aihot.news',
          changeOrigin: true,
          secure: true,
          headers: {
            'User-Agent': 'wechat-text-workbench/1.0'
          }
        }
      }
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts'
    }
  };
});

function normalizeHandles(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((handle) => handle.trim())
    .filter((handle) => /^[A-Za-z0-9_]{1,15}$/.test(handle))
    .filter((handle) => {
      const key = handle.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeHandleArray(value: unknown): string[] {
  return Array.isArray(value)
    ? normalizeHandles(value.filter((item): item is string => typeof item === 'string').join(','))
    : [];
}

async function readXSourceStore(): Promise<XSourceStore> {
  const { fs } = await loadNodeStorageModules();
  const storePath = await getXSourceStorePath();

  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const data = JSON.parse(raw) as Partial<XSourceStore>;
    return {
      handles: normalizeHandleArray(data.handles),
      latestByHandle: normalizeCachedSourceItems(data.latestByHandle)
    };
  } catch {
    return {
      handles: [],
      latestByHandle: {}
    };
  }
}

async function writeXSourceStore(store: XSourceStore): Promise<void> {
  const { fs, path } = await loadNodeStorageModules();
  const storePath = await getXSourceStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(
    storePath,
    JSON.stringify(
      {
        handles: normalizeHandleArray(store.handles),
        latestByHandle: normalizeCachedSourceItems(store.latestByHandle)
      },
      null,
      2
    ),
    'utf8'
  );
}

function readFreshCachedSourceItem(store: XSourceStore, handle: string): unknown | null {
  const cached = store.latestByHandle[handle.toLowerCase()];
  if (!cached || Date.now() - cached.cachedAt >= SOURCE_SERVER_CACHE_TTL_MS) {
    return null;
  }

  return cached.item;
}

function pruneCachedSourceItems(store: XSourceStore, activeHandles: string[]): void {
  const allowedKeys = new Set(mergeServerHandles(store.handles, activeHandles).map((handle) => handle.toLowerCase()));
  for (const key of Object.keys(store.latestByHandle)) {
    if (!allowedKeys.has(key)) {
      delete store.latestByHandle[key];
    }
  }
}

function mergeServerHandles(baseHandles: string[], incomingHandles: string[]): string[] {
  return normalizeHandles([...baseHandles, ...incomingHandles].join(','));
}

function normalizeCachedSourceItems(value: unknown): Record<string, CachedXSourceItem> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const normalized: Record<string, CachedXSourceItem> = {};
  for (const [handle, cached] of Object.entries(value as Record<string, Partial<CachedXSourceItem>>)) {
    const normalizedHandle = normalizeHandles(handle)[0];
    if (!normalizedHandle || !cached || typeof cached.cachedAt !== 'number' || !Number.isFinite(cached.cachedAt)) {
      continue;
    }

    normalized[normalizedHandle.toLowerCase()] = {
      cachedAt: cached.cachedAt,
      item: cached.item
    };
  }

  return normalized;
}

async function getXSourceStorePath(): Promise<string> {
  const { path } = await loadNodeStorageModules();
  return path.join(process.cwd(), X_SOURCE_STORE_DIR, X_SOURCE_STORE_FILE);
}

async function readRequestJson(req: { on?: (...args: any[]) => void }): Promise<unknown> {
  const raw = await new Promise<string>((resolve, reject) => {
    let body = '';
    req.on?.('data', (chunk: { toString: () => string } | string) => {
      body += chunk.toString();
    });
    req.on?.('end', () => resolve(body));
    req.on?.('error', reject);
  });

  return raw ? JSON.parse(raw) : {};
}

async function fetchSourceItem(handle: string, jinaBaseUrl: string, rssHubBaseUrl: string, nitterBaseUrl: string, proxyUrl: string) {
  try {
    const latestPost = await fetchLatestPublicPost(handle, jinaBaseUrl, rssHubBaseUrl, nitterBaseUrl, proxyUrl);
    const translatedText = latestPost ? await translateToSimplifiedChinese(latestPost.text) : null;
    return {
      handle,
      displayName: handle,
      profileUrl: `https://x.com/${handle}`,
      latestPost: latestPost ? { ...latestPost, translatedText } : null,
      error: latestPost ? null : '没有可展示的最新发布'
    };
  } catch (error) {
    return {
      handle,
      displayName: handle,
      profileUrl: `https://x.com/${handle}`,
      latestPost: null,
      error: error instanceof Error ? error.message : '读取失败'
    };
  }
}

function createSourceErrorItem(handle: string, error: string) {
  return {
    handle,
    displayName: handle,
    profileUrl: `https://x.com/${handle}`,
    latestPost: null,
    error
  };
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(fallback), timeoutMs);
    task
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timeout));
  });
}

async function fetchLatestPublicPost(handle: string, jinaBaseUrl: string, rssHubBaseUrl: string, nitterBaseUrl: string, proxyUrl: string) {
  const latestPost = await choosePreferredPostFromReaders(
    [
      () => fetchRssHubPost(handle, rssHubBaseUrl, proxyUrl),
      () => fetchJinaPost(handle, jinaBaseUrl, proxyUrl),
      () => fetchNitterPost(handle, nitterBaseUrl, proxyUrl)
    ],
    SOURCE_READER_TIMEOUT_MS
  );
  if (!latestPost || !hasLowInformationContent(latestPost) || !latestPost.url.includes('/status/')) {
    return latestPost;
  }

  const statusPost = await withTimeout(
    fetchJinaStatusPost(handle, latestPost.url, jinaBaseUrl, proxyUrl),
    SOURCE_STATUS_TIMEOUT_MS,
    null
  );
  return choosePreferredPost(latestPost, statusPost);
}

async function fetchJinaPost(handle: string, jinaBaseUrl: string, proxyUrl: string) {
  const response = await requestText(buildJinaProfileUrl(jinaBaseUrl, handle), {
    Accept: 'text/markdown, text/plain;q=0.9'
  }, proxyUrl);

  if (!response.ok) {
    return null;
  }

  return parseJinaProfileMarkdown(handle, response.body);
}

async function fetchJinaStatusPost(handle: string, statusUrl: string, jinaBaseUrl: string, proxyUrl: string) {
  const response = await requestText(buildJinaStatusUrl(jinaBaseUrl, statusUrl), {
    Accept: 'text/markdown, text/plain;q=0.9'
  }, proxyUrl);

  if (!response.ok) {
    return null;
  }

  return parseJinaStatusMarkdown(handle, statusUrl, response.body);
}

async function fetchRssHubPost(handle: string, rssHubBaseUrl: string, proxyUrl: string) {
  const response = await requestText(buildRssHubUserUrl(rssHubBaseUrl, handle), {
    Accept: 'application/feed+json, application/json;q=0.9'
  }, proxyUrl);

  if (!response.ok) {
    return null;
  }

  const data = JSON.parse(response.body) as { items?: unknown[] };
  const firstItem = data.items?.[0];
  return firstItem && typeof firstItem === 'object' ? normalizeRssHubItem(handle, firstItem) : null;
}

async function fetchNitterPost(handle: string, nitterBaseUrl: string, proxyUrl: string) {
  const response = await requestText(buildNitterProfileUrl(nitterBaseUrl, handle), {
    Accept: 'text/html, application/xhtml+xml;q=0.9',
    'User-Agent': 'curl/8.0.0'
  }, proxyUrl);

  if (!response.ok) {
    return null;
  }

  return parseNitterProfileHtml(handle, response.body);
}

async function translateToSimplifiedChinese(text: string): Promise<string | null> {
  if (!text.trim() || /[\u4e00-\u9fff]/.test(text)) {
    return text;
  }

  const proxyUrl = process.env.X_SOURCE_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7897';
  for (const url of buildGoogleTranslateUrls(text)) {
    try {
      const response = await requestTextViaFetchProxy(url, {
        Accept: 'application/json, text/javascript;q=0.9'
      }, proxyUrl);
      if (!response.ok) {
        continue;
      }

      const translated = parseGoogleTranslateResponse(response.body);
      if (isUsefulSimplifiedChineseTranslation(text, translated)) {
        return translated;
      }
    } catch {
      continue;
    }
  }

  try {
    const response = await requestTextDirect(buildMyMemoryTranslateUrl(text), {
      Accept: 'application/json'
    });
    if (response.ok) {
      const translated = parseMyMemoryTranslateResponse(response.body);
      if (isUsefulSimplifiedChineseTranslation(text, translated)) {
        return translated;
      }
    }
  } catch {
    // Keep the original post text when the fallback translator is unavailable.
  }

  return text;
}

function sendJson(res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void }, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function requestText(url: string, headers: Record<string, string>, proxyUrl: string) {
  if (!proxyUrl) {
    return requestTextDirect(url, headers);
  }

  return requestTextViaFastestPath(url, headers, proxyUrl);
}

async function requestTextViaFastestPath(url: string, headers: Record<string, string>, proxyUrl: string) {
  const direct = requestTextDirect(url, headers);
  const proxied = requestTextViaProxy(url, headers, proxyUrl);
  const attempts = [direct, proxied];

  try {
    return await Promise.any(attempts.map((attempt) => attempt.then((response) => (response.ok ? response : Promise.reject(response)))));
  } catch {
    const settled = await Promise.allSettled(attempts);
    const response = settled.find(
      (item): item is PromiseFulfilledResult<{ ok: boolean; status: number; body: string }> => item.status === 'fulfilled'
    )?.value;
    if (response) {
      return response;
    }

    const rejection = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected')?.reason;
    throw rejection instanceof Error ? rejection : new Error(`Request failed: ${url}`);
  }
}

async function requestTextViaFetchProxy(url: string, headers: Record<string, string>, proxyUrl: string): Promise<{ ok: boolean; status: number; body: string }> {
  if (!proxyUrl) {
    return requestTextDirect(url, headers);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_REQUEST_TIMEOUT_MS);

  try {
    const response = await undiciFetch(url, {
      headers,
      signal: controller.signal,
      dispatcher: new ProxyAgent(proxyUrl)
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.text()
    };
  } catch {
    return requestTextDirect(url, headers);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestTextDirect(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text()
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestTextViaProxy(url: string, headers: Record<string, string>, proxyUrl: string): Promise<{ ok: boolean; status: number; body: string }> {
  const target = new URL(url);
  const proxy = new URL(proxyUrl);
  const port = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));

  if (target.protocol !== 'https:' || proxy.protocol !== 'http:') {
    return requestTextDirect(url, headers);
  }

  const { http, tls } = await loadNodeNetworkModules();

  return new Promise((resolve, reject) => {
    const connectRequest = http.request({
      host: proxy.hostname,
      port,
      method: 'CONNECT',
      path: `${target.hostname}:443`,
      headers: {
        Host: `${target.hostname}:443`
      },
      timeout: Math.min(10000, SOURCE_REQUEST_TIMEOUT_MS)
    });

    connectRequest.on('connect', (connectResponse: any, socket: any) => {
      if (connectResponse.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed: ${connectResponse.statusCode}`));
        return;
      }

      const tlsSocket = tls.connect({
        socket,
        servername: target.hostname
      });
      let raw = '';

      tlsSocket.setEncoding('utf8');
      tlsSocket.setTimeout(SOURCE_REQUEST_TIMEOUT_MS);
      tlsSocket.once('secureConnect', () => {
        const requestPath = `${target.pathname}${target.search}`;
        const userAgent = headers['User-Agent'] ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        const requestHeaders = [
          `GET ${requestPath} HTTP/1.1`,
          `Host: ${target.hostname}`,
          'Connection: close',
          `User-Agent: ${userAgent}`,
          'Accept-Encoding: identity',
          ...Object.entries(headers)
            .filter(([name]) => name.toLowerCase() !== 'user-agent')
            .map(([name, value]) => `${name}: ${value}`),
          '',
          ''
        ].join('\r\n');
        tlsSocket.write(requestHeaders);
      });
      tlsSocket.on('data', (chunk: string) => {
        raw += chunk;
      });
      tlsSocket.on('end', () => {
        const [head, ...bodyParts] = raw.split('\r\n\r\n');
        const status = Number(head.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1] ?? 0);
        const body = bodyParts.join('\r\n\r\n');
        const isChunked = /transfer-encoding:\s*chunked/i.test(head);
        resolve({
          ok: status >= 200 && status < 300,
          status,
          body: isChunked ? decodeChunkedBody(body) : body
        });
      });
      tlsSocket.on('timeout', () => {
        tlsSocket.destroy(new Error(`Request timed out: ${url}`));
      });
      tlsSocket.on('error', reject);
    });
    connectRequest.on('timeout', () => {
      connectRequest.destroy(new Error(`Proxy timed out: ${proxyUrl}`));
    });
    connectRequest.on('error', reject);
    connectRequest.end();
  });
}

let nodeNetworkModules: Promise<{ http: any; tls: any }> | null = null;
let nodeStorageModules: Promise<{ fs: any; path: any }> | null = null;

function loadNodeNetworkModules(): Promise<{ http: any; tls: any }> {
  if (!nodeNetworkModules) {
    const importNodeModule = Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    nodeNetworkModules = Promise.all([importNodeModule('node:http'), importNodeModule('node:tls')]).then(
      ([http, tls]) => ({ http, tls })
    );
  }

  return nodeNetworkModules;
}

function loadNodeStorageModules(): Promise<{ fs: any; path: any }> {
  if (!nodeStorageModules) {
    const importNodeModule = Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    nodeStorageModules = Promise.all([importNodeModule('node:fs/promises'), importNodeModule('node:path')]).then(
      ([fs, path]) => ({ fs, path })
    );
  }

  return nodeStorageModules;
}

function decodeChunkedBody(body: string): string {
  let cursor = 0;
  let decoded = '';

  while (cursor < body.length) {
    const nextBreak = body.indexOf('\r\n', cursor);
    if (nextBreak < 0) {
      break;
    }

    const size = Number.parseInt(body.slice(cursor, nextBreak).split(';')[0], 16);
    if (!Number.isFinite(size) || size <= 0) {
      break;
    }

    const start = nextBreak + 2;
    decoded += body.slice(start, start + size);
    cursor = start + size + 2;
  }

  return decoded || body;
}
