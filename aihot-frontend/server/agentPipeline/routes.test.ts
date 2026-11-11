import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentStore, type AgentStore } from './store';
import { clearNonResumableCurrentJob, createAgentMiddleware, handleAgentRequest } from './routes';
import type { AgentRunner } from './runner';
import type { AgentJob, AgentMaterial } from './types';

describe('agent routes', () => {
  let store: AgentStore;
  let runner: AgentRunner;
  let startedWith: { topic: string; materials: AgentMaterial[] } | null;
  let importedWith: { topic: string; markdown: string } | null;

  beforeEach(async () => {
    store = createAgentStore(await mkdtemp(path.join(os.tmpdir(), 'agent-routes-')));
    startedWith = null;
    importedWith = null;
    runner = createFakeRunner();
  });

  it('adds sanitized AI HOT material to the persisted basket', async () => {
    const response = await handleAgentRequest(
      {
        method: 'POST',
        url: '/api/agent/materials',
        body: {
          sourceType: 'aihot',
          item: {
            id: 'item-1',
            title: 'AI 新产品',
            summary: '一个新的 Agent 产品。',
            source: 'ignored',
            url: 'https://example.com'
          }
        }
      },
      { store, runner }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      materials: [
        {
          id: 'aihot:item-1',
          sourceType: 'aihot',
          title: 'AI 新产品',
          summary: '一个新的 Agent 产品。',
          addedAt: expect.any(String)
        }
      ]
    });
    expect(JSON.stringify(response.body)).not.toContain('https://example.com');
  });

  it('deletes one material by id', async () => {
    await store.writeMaterials([
      createMaterial('aihot:item-1'),
      createMaterial('x:openai')
    ]);

    const response = await handleAgentRequest(
      { method: 'DELETE', url: '/api/agent/materials/x%3Aopenai' },
      { store, runner }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ materials: [createMaterial('aihot:item-1')] });
  });

  it('starts a job with the current material snapshot', async () => {
    await store.writeMaterials([createMaterial('aihot:item-1')]);

    const response = await handleAgentRequest(
      { method: 'POST', url: '/api/agent/jobs', body: { topic: 'AI 内容工作流' } },
      { store, runner }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ job: createJob('job-1') });
    expect(startedWith).toEqual({
      topic: 'AI 内容工作流',
      materials: [createMaterial('aihot:item-1')]
    });
  });

  it('starts a material-driven job with an auto-topic when topic is empty', async () => {
    await store.writeMaterials([createMaterial('aihot:item-1')]);

    const response = await handleAgentRequest(
      { method: 'POST', url: '/api/agent/jobs', body: { topic: '' } },
      { store, runner }
    );

    expect(response.status).toBe(200);
    expect(startedWith).toEqual({
      topic: '根据所选素材自动拟定公众号文章主题',
      materials: [createMaterial('aihot:item-1')]
    });
  });

  it('starts a markdown upload job using its first h1 as the topic', async () => {
    const response = await handleAgentRequest(
      {
        method: 'POST',
        url: '/api/agent/jobs',
        body: {
          sourceMode: 'markdown',
          fileName: 'fallback.md',
          markdown: '引言\n\n# 上传标题\n\n正文'
        }
      },
      { store, runner }
    );

    expect(response.status).toBe(200);
    expect(importedWith).toEqual({ topic: '上传标题', markdown: '引言\n\n# 上传标题\n\n正文' });
  });

  it('uses the markdown file name when the draft has no h1', async () => {
    const response = await handleAgentRequest(
      {
        method: 'POST',
        url: '/api/agent/jobs',
        body: { sourceMode: 'markdown', fileName: '本地文章.markdown', markdown: '正文' }
      },
      { store, runner }
    );

    expect(response.status).toBe(200);
    expect(importedWith?.topic).toBe('本地文章');
  });

  it('uses the first top-level h1 outside front matter and fenced code', async () => {
    const markdown =
      '---\n# YAML 注释\ntitle: 示例\n---\n\n```md\n# 代码示例\n```not-a-close\n# 仍是代码\n```\n\n   # 真实标题\n\n正文';

    const response = await handleAgentRequest(
      {
        method: 'POST',
        url: '/api/agent/jobs',
        body: { sourceMode: 'markdown', fileName: 'fallback.md', markdown }
      },
      { store, runner }
    );

    expect(response.status).toBe(200);
    expect(importedWith?.topic).toBe('真实标题');
  });

  it('preserves utf8 when a multibyte character spans request chunks', async () => {
    const middleware = createAgentMiddleware({ store, runner });
    const body = Buffer.from(
      JSON.stringify({ sourceMode: 'markdown', fileName: 'article.md', markdown: '# 中文标题\n\n正文' }),
      'utf8'
    );
    const chineseStart = body.indexOf(Buffer.from('中', 'utf8'));

    const response = await invokeMiddleware(middleware, [
      body.subarray(0, chineseStart + 1),
      body.subarray(chineseStart + 1)
    ]);

    expect(response.status).toBe(200);
    expect(importedWith).toEqual({ topic: '中文标题', markdown: '# 中文标题\n\n正文' });
  });

  it('rejects a request body that is not valid utf8', async () => {
    const middleware = createAgentMiddleware({ store, runner });
    const response = await invokeMiddleware(middleware, [
      Buffer.concat([
        Buffer.from('{"sourceMode":"markdown","fileName":"article.md","markdown":"# '),
        Buffer.from([0xff]),
        Buffer.from('"}')
      ])
    ]);

    expect(response).toEqual({ status: 400, body: { error: '请求体必须是 UTF-8 编码' } });
    expect(importedWith).toBeNull();
  });

  it('rejects an oversized request body before json parsing', async () => {
    const middleware = createAgentMiddleware({ store, runner });

    const response = await invokeMiddleware(middleware, [Buffer.alloc(8 * 1024 * 1024 + 1, 'a')]);

    expect(response).toEqual({ status: 413, body: { error: '请求体不能超过 8 MiB' } });
    expect(importedWith).toBeNull();
  });

  it('rejects invalid markdown uploads before creating a job', async () => {
    const cases = [
      {
        body: { sourceMode: 'markdown', fileName: 'article.txt', markdown: '# 标题' },
        error: '请选择 .md 或 .markdown 文件'
      },
      {
        body: { sourceMode: 'markdown', fileName: 'article.md', markdown: '   \n' },
        error: 'Markdown 文件内容不能为空'
      },
      {
        body: { sourceMode: 'markdown', fileName: 'article.md', markdown: 'a'.repeat(1024 * 1024 + 1) },
        error: 'Markdown 文件不能超过 1 MiB'
      },
      {
        body: { sourceMode: 'markdown', fileName: '.md', markdown: '正文' },
        error: '无法识别文章标题'
      }
    ];

    for (const testCase of cases) {
      const response = await handleAgentRequest(
        { method: 'POST', url: '/api/agent/jobs', body: testCase.body },
        { store, runner }
      );

      expect(response).toEqual({ status: 400, body: { error: testCase.error } });
      expect(importedWith).toBeNull();
    }
  });

  it('returns 409 when another job is active', async () => {
    runner = {
      ...runner,
      startJob: async () => {
        throw new Error('已有发文任务正在进行');
      }
    };

    const response = await handleAgentRequest(
      { method: 'POST', url: '/api/agent/jobs', body: { topic: '第二篇' } },
      { store, runner }
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: '已有发文任务正在进行' });
  });

  it('routes draft review actions to the runner', async () => {
    let savedMarkdown = '';
    runner = {
      ...runner,
      saveDraft: async (_jobId, markdown) => {
        savedMarkdown = markdown;
        return createJob('job-1');
      }
    };

    const response = await handleAgentRequest(
      { method: 'POST', url: '/api/agent/jobs/job-1/save-draft', body: { markdown: '# 手动稿' } },
      { store, runner }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ job: createJob('job-1') });
    expect(savedMarkdown).toBe('# 手动稿');
  });

  it('reads current draft markdown for review', async () => {
    const draftPath = path.join(store.jobsDir, 'job-1', 'draft.md');
    await mkdir(path.dirname(draftPath), { recursive: true });
    await writeFile(draftPath, '# 当前草稿', 'utf8');
    await store.writeCurrentJob({ ...createJob('job-1'), paths: { workDir: 'out', draftMarkdown: draftPath } });

    const response = await handleAgentRequest(
      { method: 'GET', url: '/api/agent/jobs/job-1/draft' },
      { store, runner }
    );

    expect(response).toEqual({ status: 200, body: { markdown: '# 当前草稿' } });
  });

  it('routes stop and resume actions to the runner', async () => {
    const calls: string[] = [];
    runner = {
      ...runner,
      async stop(jobId) {
        calls.push(`stop:${jobId}`);
        return { ...createJob(jobId), status: 'stopped', currentStep: 'format_markdown' };
      },
      async resume(jobId) {
        calls.push(`resume:${jobId}`);
        return { ...createJob(jobId), status: 'completed', currentStep: 'completed' };
      }
    };

    const stopped = await handleAgentRequest(
      { method: 'POST', url: '/api/agent/jobs/job-1/stop' },
      { store, runner }
    );
    const resumed = await handleAgentRequest(
      { method: 'POST', url: '/api/agent/jobs/job-1/resume' },
      { store, runner }
    );

    expect(stopped).toEqual({
      status: 200,
      body: { job: expect.objectContaining({ status: 'stopped', currentStep: 'format_markdown' }) }
    });
    expect(resumed).toEqual({
      status: 200,
      body: { job: expect.objectContaining({ status: 'completed', currentStep: 'completed' }) }
    });
    expect(calls).toEqual(['stop:job-1', 'resume:job-1']);
  });

  it('clears a failed startup job instead of restoring it as current work', async () => {
    await store.writeCurrentJob({
      ...createJob('job-1'),
      status: 'failed',
      currentStep: 'generate_draft',
      failedStep: 'generate_draft',
      error: '缺少模型配置',
      paths: { workDir: 'out' }
    });

    await clearNonResumableCurrentJob(store);

    await expect(store.readCurrentJob()).resolves.toBeNull();
  });

  it.each(['running', 'completed'] as const)('clears a %s startup job', async (status) => {
    await store.writeCurrentJob({
      ...createJob('job-1'),
      status,
      currentStep: status === 'completed' ? 'completed' : 'generate_draft'
    });

    await clearNonResumableCurrentJob(store);

    await expect(store.readCurrentJob()).resolves.toBeNull();
  });

  it('keeps a generated draft review job resumable after startup', async () => {
    const draftPath = path.join(store.jobsDir, 'job-1', 'draft.md');
    await mkdir(path.dirname(draftPath), { recursive: true });
    await writeFile(draftPath, '# 当前草稿', 'utf8');
    const job = { ...createJob('job-1'), paths: { workDir: 'out', draftMarkdown: draftPath } };
    await store.writeCurrentJob(job);

    await clearNonResumableCurrentJob(store);

    await expect(store.readCurrentJob()).resolves.toEqual(job);
  });

  it('clears a review job whose draft file is missing', async () => {
    await store.writeCurrentJob({
      ...createJob('job-1'),
      paths: { workDir: 'out', draftMarkdown: path.join(store.jobsDir, 'job-1', 'missing.md') }
    });

    await clearNonResumableCurrentJob(store);

    await expect(store.readCurrentJob()).resolves.toBeNull();
  });

  it('keeps stopped jobs whose completed-step artifacts allow resume', async () => {
    const workDir = path.join(store.jobsDir, 'job-1', 'work');
    const paths = {
      workDir,
      materialsMarkdown: path.join(workDir, 'materials.md'),
      draftMarkdown: path.join(workDir, 'draft.md'),
      formattedMarkdown: path.join(workDir, 'article-formatted.md'),
      cover: path.join(workDir, 'imgs', 'cover.png'),
      illustrations: [path.join(workDir, 'imgs', '01-article-illustration.png')],
      html: path.join(workDir, 'article-formatted.html')
    };
    await mkdir(path.join(workDir, 'imgs'), { recursive: true });
    await Promise.all([
      writeFile(paths.materialsMarkdown, '# materials', 'utf8'),
      writeFile(paths.draftMarkdown, '# draft', 'utf8'),
      writeFile(paths.formattedMarkdown, '# formatted', 'utf8'),
      writeFile(paths.cover, 'cover', 'utf8'),
      writeFile(paths.illustrations[0], 'illustration', 'utf8'),
      writeFile(paths.html, '<p>article</p>', 'utf8')
    ]);
    const cases: Array<{ currentStep: AgentJob['currentStep']; paths: AgentJob['paths'] }> = [
      { currentStep: 'prepare_materials', paths: { workDir: path.join(store.jobsDir, 'new-work') } },
      { currentStep: 'generate_draft', paths: { workDir, materialsMarkdown: paths.materialsMarkdown } },
      { currentStep: 'format_markdown', paths: { workDir, draftMarkdown: paths.draftMarkdown } },
      {
        currentStep: 'generate_cover',
        paths: { workDir, formattedMarkdown: paths.formattedMarkdown }
      },
      {
        currentStep: 'generate_illustrations',
        paths: {
          workDir,
          formattedMarkdown: paths.formattedMarkdown,
          cover: paths.cover
        }
      },
      {
        currentStep: 'render_html',
        paths: {
          workDir,
          formattedMarkdown: paths.formattedMarkdown,
          cover: paths.cover,
          illustrations: paths.illustrations
        }
      },
      {
        currentStep: 'publish_wechat_draft',
        paths: {
          workDir,
          formattedMarkdown: paths.formattedMarkdown,
          cover: paths.cover,
          illustrations: paths.illustrations,
          html: paths.html
        }
      }
    ];

    for (const testCase of cases) {
      const job = { ...createJob('job-1'), status: 'stopped' as const, ...testCase };
      await store.writeCurrentJob(job);

      await clearNonResumableCurrentJob(store);

      await expect(store.readCurrentJob()).resolves.toEqual(job);
    }
  });

  it('keeps a stopped import translation only when its original markdown still exists', async () => {
    const workDir = path.join(store.jobsDir, 'job-1', 'work');
    const draftMarkdown = path.join(workDir, 'draft.md');
    await mkdir(workDir, { recursive: true });
    await writeFile(draftMarkdown, '# English article', 'utf8');
    const job: AgentJob = {
      ...createJob('job-1'),
      sourceMode: 'markdown',
      status: 'stopped',
      currentStep: 'generate_draft',
      paths: { workDir, draftMarkdown }
    };
    await store.writeCurrentJob(job);

    await clearNonResumableCurrentJob(store);
    await expect(store.readCurrentJob()).resolves.toEqual(job);

    await store.writeCurrentJob({ ...job, paths: { workDir, draftMarkdown: path.join(workDir, 'missing.md') } });
    await clearNonResumableCurrentJob(store);
    await expect(store.readCurrentJob()).resolves.toBeNull();
  });

  it('clears stopped jobs with a missing prerequisite artifact', async () => {
    const workDir = path.join(store.jobsDir, 'job-1', 'work');
    const draftMarkdown = path.join(workDir, 'draft.md');
    const formattedMarkdown = path.join(workDir, 'article-formatted.md');
    const cover = path.join(workDir, 'imgs', 'cover.png');
    const illustration = path.join(workDir, 'imgs', '01-article-illustration.png');
    await mkdir(path.join(workDir, 'imgs'), { recursive: true });
    await Promise.all([
      writeFile(draftMarkdown, '# draft', 'utf8'),
      writeFile(formattedMarkdown, '# formatted', 'utf8'),
      writeFile(cover, 'cover', 'utf8'),
      writeFile(illustration, 'illustration', 'utf8')
    ]);
    const cases: Array<{ currentStep: AgentJob['currentStep']; paths: AgentJob['paths'] }> = [
      {
        currentStep: 'generate_draft',
        paths: { workDir, materialsMarkdown: path.join(workDir, 'missing-materials.md') }
      },
      { currentStep: 'format_markdown', paths: { workDir, draftMarkdown: path.join(workDir, 'missing-draft.md') } },
      {
        currentStep: 'generate_cover',
        paths: { workDir, draftMarkdown, formattedMarkdown: path.join(workDir, 'missing-formatted.md') }
      },
      {
        currentStep: 'generate_illustrations',
        paths: { workDir, draftMarkdown, formattedMarkdown, cover: path.join(workDir, 'missing-cover.png') }
      },
      {
        currentStep: 'render_html',
        paths: {
          workDir,
          draftMarkdown,
          formattedMarkdown,
          cover,
          illustrations: [path.join(workDir, 'missing-illustration.png')]
        }
      },
      {
        currentStep: 'publish_wechat_draft',
        paths: {
          workDir,
          draftMarkdown,
          formattedMarkdown,
          cover,
          illustrations: [illustration],
          html: path.join(workDir, 'missing.html')
        }
      }
    ];

    for (const testCase of cases) {
      await store.writeCurrentJob({ ...createJob('job-1'), status: 'stopped', ...testCase });

      await clearNonResumableCurrentJob(store);

      await expect(store.readCurrentJob()).resolves.toBeNull();
    }
  });

  function createFakeRunner(): AgentRunner {
    return {
      async startJob(input) {
        startedWith = input;
        return createJob('job-1');
      },
      async startImportedDraft(input) {
        importedWith = input;
        return { ...createJob('job-1'), topic: input.topic, sourceMode: 'markdown' };
      },
      async saveDraft() {
        return createJob('job-1');
      },
      async regenerateDraft() {
        return createJob('job-1');
      },
      async confirmDraft() {
        return createJob('job-1');
      },
      async retry() {
        return createJob('job-1');
      },
      async restart() {
        return createJob('job-2');
      },
      async stop() {
        return { ...createJob('job-1'), status: 'stopped', currentStep: 'format_markdown' };
      },
      async resume() {
        return createJob('job-1');
      }
    };
  }
});

function createMaterial(id: string): AgentMaterial {
  return {
    id,
    sourceType: id.startsWith('x:') ? 'x' : 'aihot',
    title: id,
    summary: 'summary',
    addedAt: '2026-05-27T00:00:00.000Z'
  };
}

function createJob(id: string): AgentJob {
  return {
    id,
    topic: 'AI 内容工作流',
    status: 'waiting_review',
    currentStep: 'review_draft',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    materials: [],
    paths: { workDir: 'pipeline-output/agent/job-1' }
  };
}

async function invokeMiddleware(
  middleware: (req: any, res: any, next?: () => void) => Promise<void>,
  chunks: Buffer[]
): Promise<{ status: number; body: unknown }> {
  const req = Object.assign(new EventEmitter(), {
    method: 'POST',
    url: '/api/agent/jobs'
  });
  let response: { status: number; body: unknown } | null = null;
  const res = {
    statusCode: 200,
    setHeader() {},
    end(body: string) {
      response = { status: this.statusCode, body: JSON.parse(body) };
    }
  };
  const request = middleware(req, res);
  while (!req.listenerCount('data')) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  for (const chunk of chunks) {
    req.emit('data', chunk);
  }
  req.emit('end');
  await request;
  if (!response) {
    throw new Error('middleware did not send a response');
  }
  return response;
}
