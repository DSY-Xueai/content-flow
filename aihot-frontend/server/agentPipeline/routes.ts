import { createAihotMaterial, createXMaterial, mergeMaterials } from './materials';
import { access, readFile } from 'node:fs/promises';
import { createAgentRunner, type AgentRunner } from './runner';
import { createAgentStore, type AgentStore } from './store';
import type { AgentJob, AgentMaterial } from './types';

const MAX_MARKDOWN_BYTES = 1024 * 1024;
const MAX_AGENT_REQUEST_BYTES = 8 * 1024 * 1024;

export interface AgentRequest {
  method: string;
  url: string;
  body?: unknown;
}

export interface AgentResponse {
  status: number;
  body: unknown;
}

interface AgentRouteDeps {
  store: AgentStore;
  runner?: AgentRunner;
  modelEnv?: Record<string, string | undefined>;
}

interface MiddlewareRequest {
  method?: string;
  url?: string;
  on?: (event: string, listener: (chunk?: unknown) => void) => void;
}

interface MiddlewareResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

export async function handleAgentRequest(request: AgentRequest, deps: AgentRouteDeps): Promise<AgentResponse> {
  const store = deps.store;
  const runner = deps.runner ?? createAgentRunner({ store, modelEnv: deps.modelEnv });
  const method = request.method.toUpperCase();
  const route = normalizeRoute(request.url);
  const parts = route.split('/').filter(Boolean);

  try {
    if (parts[0] === 'materials') {
      return await handleMaterials(method, parts, request.body, store);
    }

    if (parts[0] === 'current-job' && method === 'GET') {
      const job = await store.readCurrentJob();
      return { status: 200, body: { job } };
    }

    if (parts[0] === 'history' && method === 'GET') {
      return { status: 200, body: { history: await store.readHistory() } };
    }

    if (parts[0] === 'jobs') {
      return await handleJobs(method, parts, request.body, store, runner);
    }

    return { status: 404, body: { error: 'Not found' } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: message.includes('已有发文任务正在进行') ? 409 : 500,
      body: { error: message }
    };
  }
}

export function createAgentMiddleware(deps: Partial<AgentRouteDeps> = {}) {
  const store = deps.store ?? createAgentStore();
  const runner = deps.runner ?? createAgentRunner({ store, modelEnv: deps.modelEnv });
  const startupCleanup = clearNonResumableCurrentJob(store);

  return async function agentMiddleware(req: MiddlewareRequest, res: MiddlewareResponse, next?: () => void) {
    const url = req.url ?? '';
    if (!url.startsWith('/api/agent')) {
      next?.();
      return;
    }

    await startupCleanup;
    try {
      const method = req.method ?? 'GET';
      const body = method === 'GET' || method === 'DELETE' ? undefined : await readRequestJson(req);
      const response = await handleAgentRequest({ method, url, body }, { store, runner });
      sendJson(res, response.status, response.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : '请求体解析失败';
      sendJson(res, message === '请求体不能超过 8 MiB' ? 413 : 400, { error: message });
    }
  };
}

export async function clearNonResumableCurrentJob(store: AgentStore): Promise<void> {
  const job = await store.readCurrentJob();
  if (!job) {
    return;
  }

  if (await canResumeCurrentJob(job)) {
    return;
  }

  await store.clearCurrentJob();
}

async function canResumeCurrentJob(job: AgentJob | null): Promise<boolean> {
  if (!job) {
    return false;
  }

  if (job.status === 'waiting_review') {
    return pathsExist([job.paths.draftMarkdown]);
  }

  if (job.status !== 'stopped' || !job.paths.workDir.trim()) {
    return false;
  }

  const requiredPaths: Array<string | undefined> = [];
  if (job.currentStep === 'prepare_materials') {
    return true;
  }
  if (job.currentStep === 'generate_draft') {
    requiredPaths.push(job.sourceMode === 'markdown' ? job.paths.draftMarkdown : job.paths.materialsMarkdown);
  } else if (job.currentStep === 'format_markdown') {
    requiredPaths.push(job.paths.draftMarkdown);
  } else if (job.currentStep === 'generate_cover') {
    requiredPaths.push(job.paths.formattedMarkdown);
  } else if (job.currentStep === 'generate_illustrations') {
    requiredPaths.push(job.paths.formattedMarkdown, job.paths.cover);
  } else if (job.currentStep === 'render_html' || job.currentStep === 'publish_wechat_draft') {
    requiredPaths.push(job.paths.formattedMarkdown, job.paths.cover);
    if (!job.paths.illustrations?.length || !(await pathsExist(job.paths.illustrations))) {
      return false;
    }
    if (job.currentStep === 'publish_wechat_draft') {
      requiredPaths.push(job.paths.html);
    }
  } else {
    return false;
  }

  return pathsExist(requiredPaths);
}

async function pathsExist(paths: Array<string | undefined>): Promise<boolean> {
  if (paths.some((filePath) => !filePath)) {
    return false;
  }

  try {
    await Promise.all(paths.map((filePath) => access(filePath!)));
    return true;
  } catch {
    return false;
  }
}

async function handleMaterials(method: string, parts: string[], body: unknown, store: AgentStore): Promise<AgentResponse> {
  if (method === 'GET') {
    return { status: 200, body: { materials: await store.readMaterials() } };
  }

  if (method === 'PUT') {
    const materials = readMaterialArray(body);
    await store.writeMaterials(materials);
    return { status: 200, body: { materials } };
  }

  if (method === 'POST') {
    const material = createMaterialFromBody(body);
    const materials = mergeMaterials(await store.readMaterials(), [material]);
    await store.writeMaterials(materials);
    return { status: 200, body: { materials } };
  }

  if (method === 'DELETE' && parts.length === 1) {
    await store.writeMaterials([]);
    return { status: 200, body: { materials: [] } };
  }

  if (method === 'DELETE' && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    const materials = (await store.readMaterials()).filter((item) => item.id !== id);
    await store.writeMaterials(materials);
    return { status: 200, body: { materials } };
  }

  return { status: 405, body: { error: 'Method not allowed' } };
}

async function handleJobs(
  method: string,
  parts: string[],
  body: unknown,
  store: AgentStore,
  runner: AgentRunner
): Promise<AgentResponse> {
  if (method === 'POST' && parts.length === 1) {
    if (readOptionalStringField(body, 'sourceMode') === 'markdown') {
      const fileName = readStringField(body, 'fileName').trim();
      const markdown = readStringField(body, 'markdown');
      if (!/\.(?:md|markdown)$/i.test(fileName)) {
        return { status: 400, body: { error: '请选择 .md 或 .markdown 文件' } };
      }
      if (!markdown.trim()) {
        return { status: 400, body: { error: 'Markdown 文件内容不能为空' } };
      }
      if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) {
        return { status: 400, body: { error: 'Markdown 文件不能超过 1 MiB' } };
      }
      const heading = extractMarkdownH1(markdown);
      const fallback = fileName.replace(/\.(?:md|markdown)$/i, '').trim();
      if (!heading && !fallback) {
        return { status: 400, body: { error: '无法识别文章标题' } };
      }
      const job = await runner.startImportedDraft({ topic: heading || fallback, markdown });
      return { status: 200, body: { job } };
    }

    const materials = await store.readMaterials();
    const topic = readStringField(body, 'topic').trim() || (materials.length ? '根据所选素材自动拟定公众号文章主题' : '');
    if (!topic) {
      return { status: 400, body: { error: '请输入发文主题或加入素材' } };
    }
    const job = await runner.startJob({ topic, materials });
    return { status: 200, body: { job } };
  }

  const jobId = parts[1];
  const action = parts[2];
  if (!jobId || !action) {
    return { status: 404, body: { error: 'Not found' } };
  }

  if (method === 'GET' && action === 'logs') {
    return { status: 200, body: { logs: await store.readLogs(jobId) } };
  }

  if (method === 'GET' && action === 'draft') {
    const job = await store.readCurrentJob();
    if (!job || job.id !== jobId || !job.paths.draftMarkdown) {
      return { status: 404, body: { error: 'Draft not found' } };
    }
    return { status: 200, body: { markdown: await readFile(job.paths.draftMarkdown, 'utf8') } };
  }

  if (method !== 'POST') {
    return { status: 405, body: { error: 'Method not allowed' } };
  }

  if (action === 'confirm-draft') {
    return { status: 200, body: { job: await runner.confirmDraft(jobId) } };
  }
  if (action === 'regenerate-draft') {
    return { status: 200, body: { job: await runner.regenerateDraft(jobId, readStringField(body, 'revisionNote')) } };
  }
  if (action === 'save-draft') {
    return { status: 200, body: { job: await runner.saveDraft(jobId, readStringField(body, 'markdown')) } };
  }
  if (action === 'retry') {
    return { status: 200, body: { job: await runner.retry(jobId) } };
  }
  if (action === 'restart') {
    return { status: 200, body: { job: await runner.restart(jobId) } };
  }
  if (action === 'stop') {
    return { status: 200, body: { job: await runner.stop(jobId) } };
  }
  if (action === 'resume') {
    return { status: 200, body: { job: await runner.resume(jobId) } };
  }

  return { status: 404, body: { error: 'Not found' } };
}

function createMaterialFromBody(body: unknown): AgentMaterial {
  const payload = asRecord(body);
  const item = asRecord(payload.item ?? payload);

  if (payload.sourceType === 'aihot') {
    return createAihotMaterial({
      id: readStringField(item, 'id'),
      title: readOptionalStringField(item, 'title'),
      summary: readOptionalStringField(item, 'summary')
    });
  }

  if (payload.sourceType === 'x') {
    const latestPost = asRecord(item.latestPost);
    return createXMaterial({
      handle: readStringField(item, 'handle'),
      displayName: readOptionalStringField(item, 'displayName'),
      text: readOptionalStringField(item, 'text') ?? readOptionalStringField(latestPost, 'text'),
      translatedText: readOptionalStringField(item, 'translatedText') ?? readOptionalStringField(latestPost, 'translatedText')
    });
  }

  throw new Error('不支持的素材类型');
}

function readMaterialArray(body: unknown): AgentMaterial[] {
  const materials = asRecord(body).materials;
  return Array.isArray(materials) ? materials.filter(isAgentMaterial) : [];
}

function isAgentMaterial(value: unknown): value is AgentMaterial {
  const item = asRecord(value);
  return (
    typeof item.id === 'string' &&
    (item.sourceType === 'aihot' || item.sourceType === 'x') &&
    typeof item.title === 'string' &&
    typeof item.summary === 'string' &&
    typeof item.addedAt === 'string'
  );
}

function normalizeRoute(url: string): string {
  const pathname = new URL(url, 'http://localhost').pathname;
  return pathname.startsWith('/api/agent') ? pathname.slice('/api/agent'.length) || '/' : pathname;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readStringField(value: unknown, field: string): string {
  const raw = asRecord(value)[field];
  return typeof raw === 'string' ? raw : '';
}

function readOptionalStringField(value: unknown, field: string): string | null {
  const raw = asRecord(value)[field];
  return typeof raw === 'string' ? raw : null;
}

function readRequestJson(req: MiddlewareRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;
    req.on?.('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8');
      byteLength += buffer.byteLength;
      if (byteLength > MAX_AGENT_REQUEST_BYTES) {
        settled = true;
        reject(new Error('请求体不能超过 8 MiB'));
        return;
      }
      chunks.push(buffer);
    });
    req.on?.('end', () => {
      if (settled) return;
      let raw: string;
      try {
        raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      } catch {
        reject(new Error('请求体必须是 UTF-8 编码'));
        return;
      }
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on?.('error', reject);
  });
}

function extractMarkdownH1(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  let inFrontMatter = lines[0]?.trim() === '---';
  let fenceMarker: '`' | '~' | null = null;
  let fenceLength = 0;

  for (let index = inFrontMatter ? 1 : 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (inFrontMatter) {
      if (/^(?:---|\.\.\.)\s*$/.test(line)) inFrontMatter = false;
      continue;
    }

    if (fenceMarker) {
      const closingFence = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (closingFence) {
        const marker = closingFence[1][0] as '`' | '~';
        if (marker === fenceMarker && closingFence[1].length >= fenceLength) {
          fenceMarker = null;
          fenceLength = 0;
        }
      }
      continue;
    }

    const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (openingFence) {
      fenceMarker = openingFence[1][0] as '`' | '~';
      fenceLength = openingFence[1].length;
      continue;
    }

    const heading = line.match(/^ {0,3}#[ \t]+(.+?)\s*$/)?.[1].replace(/[ \t]+#+[ \t]*$/, '').trim();
    if (heading) return heading;
  }

  return null;
}

function sendJson(res: MiddlewareResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
