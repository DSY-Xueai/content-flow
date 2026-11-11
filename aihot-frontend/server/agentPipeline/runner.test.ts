import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentStore, type AgentStore } from './store';
import { createAgentRunner, type DraftGenerator, type DraftInput, type ImageGeneratorScripts } from './runner';
import type { AgentMaterial } from './types';

const material: AgentMaterial = {
  id: 'aihot:item-1',
  sourceType: 'aihot',
  title: 'AI 工具更新',
  summary: '一个面向内容生产的 Agent 更新。',
  addedAt: '2026-05-27T00:00:00.000Z'
};

describe('agent runner', () => {
  let baseDir: string;
  let outputRoot: string;
  let store: AgentStore;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
    outputRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-output-'));
    store = createAgentStore(baseDir);
  });

  it('starts a job, snapshots materials, generates a draft, and waits for review', async () => {
    const { runner } = createRunner({
      draft: async () => '---\ntitle: 测试文章\ndescription: 摘要\nauthor: Agent\n---\n\n# 测试文章\n\n正文。'
    });

    const job = await runner.startJob({ topic: 'AI 内容工作流', materials: [material] });

    expect(job.status).toBe('waiting_review');
    expect(job.currentStep).toBe('review_draft');
    expect(job.sourceMode).toBe('materials');
    expect(job.materials).toEqual([material]);
    expect(job.paths.materialsMarkdown).toBe(path.join(job.paths.workDir, 'materials.md'));
    expect(job.paths.draftMarkdown).toBe(path.join(job.paths.workDir, 'draft.md'));
    await expect(readFile(job.paths.materialsMarkdown!, 'utf8')).resolves.toContain('AI 工具更新');
    await expect(readFile(job.paths.draftMarkdown!, 'utf8')).resolves.toContain('# 测试文章');
  });

  it('imports markdown as a review draft without generating a new draft', async () => {
    let generateCalls = 0;
    const { runner } = createRunner({
      draft: async () => {
        generateCalls += 1;
        return '# 不应生成';
      }
    });

    const job = await runner.startImportedDraft({
      topic: '本地文章',
      markdown: '# 本地文章\n\n正文。'
    });

    expect(job).toMatchObject({
      topic: '本地文章',
      sourceMode: 'markdown',
      status: 'waiting_review',
      currentStep: 'review_draft',
      materials: []
    });
    expect(generateCalls).toBe(0);
    await expect(readFile(job.paths.draftMarkdown!, 'utf8')).resolves.toBe('# 本地文章\n\n正文。');
  });

  it('translates an English import before review and keeps the existing confirmation flow', async () => {
    const original = '# Agent tools\n\nThese tools help writers publish articles.';
    const translated = '# Agent 工具\n\n这些工具帮助作者发布文章。';
    const inputs: DraftInput[] = [];
    const { runner } = createRunner({
      draft: async (input, signal) => {
        inputs.push(input);
        expect(signal).toBeInstanceOf(AbortSignal);
        return translated;
      }
    });

    const job = await runner.startImportedDraft({ topic: 'Agent tools', markdown: original });

    expect(inputs).toEqual([expect.objectContaining({ previousDraft: original, translateToChinese: true })]);
    expect(job).toMatchObject({ sourceMode: 'markdown', status: 'waiting_review', currentStep: 'review_draft' });
    await expect(readFile(job.paths.draftMarkdown!, 'utf8')).resolves.toBe(translated);
    const completed = await runner.confirmDraft(job.id);
    expect(completed.status).toBe('completed');
    expect(inputs).toHaveLength(1);
    await expect(readFile(completed.paths.formattedMarkdown!, 'utf8')).resolves.toContain(translated);
  });

  it('keeps a Chinese import with English metadata and code unchanged', async () => {
    const original = '---\ntitle: English metadata title\n---\n\n# 中文正文\n\n介绍技术。\n\n```js\nconsole.log("many English words in a code example");\n```';
    let calls = 0;
    const { runner } = createRunner({ draft: async () => { calls += 1; return '# 不应调用'; } });

    const job = await runner.startImportedDraft({ topic: '中文正文', markdown: original });

    expect(calls).toBe(0);
    await expect(readFile(job.paths.draftMarkdown!, 'utf8')).resolves.toBe(original);
  });

  it('preserves an English import on translation failure and retries translation from that original', async () => {
    const original = '# English article\n\nThe original article must not be lost.';
    const translated = '# 中文文章\n\n不能丢失原稿。';
    let attempts = 0;
    const { runner } = createRunner({
      draft: async (input) => {
        expect(input).toMatchObject({ translateToChinese: true, previousDraft: original });
        attempts += 1;
        if (attempts === 1) throw new Error('翻译接口不可用');
        return translated;
      }
    });

    const failed = await runner.startImportedDraft({ topic: 'English article', markdown: original });
    expect(failed).toMatchObject({ status: 'failed', failedStep: 'generate_draft', error: '翻译接口不可用' });
    await expect(readFile(failed.paths.draftMarkdown!, 'utf8')).resolves.toBe(original);

    const retried = await runner.retry(failed.id);
    expect(retried.status).toBe('waiting_review');
    expect(attempts).toBe(2);
    await expect(readFile(retried.paths.draftMarkdown!, 'utf8')).resolves.toBe(translated);
    await runner.restart(retried.id);
    expect(attempts).toBe(2);
  });

  it('stops and resumes import translation using the saved English document', async () => {
    const started = deferred<void>();
    const original = '# English article\n\nTranslate this article into Chinese.';
    let attempts = 0;
    const { runner } = createRunner({
      draft: async (input, signal) => {
        expect(input).toMatchObject({ previousDraft: original, translateToChinese: true });
        if (++attempts > 1) return '# 中文文章\n\n翻译后的正文。';
        started.resolve();
        return new Promise<string>((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(abortError()), { once: true });
        });
      }
    });

    const importing = runner.startImportedDraft({ topic: 'English article', markdown: original });
    await started.promise;
    const stopped = await runner.stop('job-1');
    await importing;
    expect(stopped).toMatchObject({ status: 'stopped', currentStep: 'generate_draft' });
    await expect(readFile(stopped.paths.draftMarkdown!, 'utf8')).resolves.toBe(original);
    await expect(runner.resume(stopped.id)).resolves.toMatchObject({ status: 'waiting_review' });
    expect(attempts).toBe(2);
  });

  it('restarts an imported job from its saved markdown instead of generating content', async () => {
    let generateCalls = 0;
    const { runner } = createRunner({
      draft: async () => {
        generateCalls += 1;
        return '# 不应生成';
      }
    });
    const imported = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });
    await store.writeCurrentJob({
      ...imported,
      status: 'failed',
      failedStep: 'publish_wechat_draft'
    });

    const restarted = await runner.restart(imported.id);

    expect(restarted.sourceMode).toBe('markdown');
    expect(generateCalls).toBe(0);
    await expect(readFile(restarted.paths.draftMarkdown!, 'utf8')).resolves.toBe('# 本地文章\n\n正文。');
  });

  it('supports editing, regenerating, and confirming an imported draft', async () => {
    const draftInputs: Array<{ revisionNote?: string; previousDraft?: string }> = [];
    const { runner } = createRunner({
      draft: async (input) => {
        draftInputs.push(input);
        return '---\ntitle: 修改稿\ndescription: 摘要\nauthor: Agent\n---\n\n# 修改稿\n\n新正文。';
      }
    });
    const imported = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });

    await runner.saveDraft(imported.id, '# 手动修改\n\n正文。');
    const regenerated = await runner.regenerateDraft(imported.id, '加强结论');
    const completed = await runner.confirmDraft(imported.id);

    expect(draftInputs).toEqual([
      expect.objectContaining({ revisionNote: '加强结论', previousDraft: '# 手动修改\n\n正文。' })
    ]);
    expect(regenerated).toMatchObject({ sourceMode: 'markdown', status: 'waiting_review' });
    expect(completed).toMatchObject({ sourceMode: 'markdown', status: 'completed', currentStep: 'completed' });
    await expect(readFile(completed.paths.formattedMarkdown!, 'utf8')).resolves.toContain('# 修改稿');
  });

  it('retries an imported draft from a failed publish step', async () => {
    let generateCalls = 0;
    let publishAttempts = 0;
    const { runner } = createRunner({
      draft: async () => {
        generateCalls += 1;
        return '# 不应生成';
      },
      scripts: {
        publishWechatDraft: async () => {
          publishAttempts += 1;
          if (publishAttempts === 1) throw new Error('微信发布失败');
          return { success: true, media_id: 'draft-id' };
        }
      }
    });
    const imported = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });

    const failed = await runner.confirmDraft(imported.id);
    const completed = await runner.retry(imported.id);

    expect(failed).toMatchObject({ sourceMode: 'markdown', status: 'failed', failedStep: 'publish_wechat_draft' });
    expect(completed).toMatchObject({ sourceMode: 'markdown', status: 'completed' });
    expect(generateCalls).toBe(0);
    expect(publishAttempts).toBe(2);
  });

  it('allows a new job to replace a draft waiting for review', async () => {
    const { runner } = createRunner();

    await runner.startJob({ topic: '第一篇', materials: [] });

    await expect(runner.startJob({ topic: '第二篇', materials: [] })).resolves.toMatchObject({
      topic: '第二篇',
      sourceMode: 'topic',
      status: 'waiting_review'
    });
  });

  it('still blocks a new job while a job is running', async () => {
    const { runner } = createRunner();
    await store.writeCurrentJob({
      id: 'running-job',
      topic: '运行中',
      status: 'running',
      currentStep: 'generate_draft',
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
      materials: [],
      paths: { workDir: 'out' }
    });

    await expect(runner.startJob({ topic: '第二篇', materials: [] })).rejects.toThrow('已有发文任务正在进行');
  });

  it('rejects a concurrent start before it can replace the current job or create another work directory', async () => {
    const firstReadStarted = deferred<void>();
    const releaseFirstRead = deferred<void>();
    let draftCalls = 0;
    const ids = ['job-1', 'job-2'];
    const { runner } = createRunner({
      createId: () => ids.shift()!,
      draft: async () => {
        draftCalls += 1;
        return '# 第一篇';
      }
    });
    const readCurrentJob = store.readCurrentJob.bind(store);
    let firstRead = true;
    store.readCurrentJob = async () => {
      if (firstRead) {
        firstRead = false;
        firstReadStarted.resolve();
        await releaseFirstRead.promise;
      }
      return readCurrentJob();
    };

    const first = runner.startJob({ topic: '第一篇', materials: [] });
    await firstReadStarted.promise;
    const second = runner.startJob({ topic: '第二篇', materials: [] });
    releaseFirstRead.resolve();

    await expect(second).rejects.toThrow('已有发文任务正在进行');
    await expect(first).resolves.toMatchObject({ id: 'job-1', status: 'waiting_review' });
    expect(draftCalls).toBe(1);
    await expect(store.readCurrentJob()).resolves.toMatchObject({ id: 'job-1', topic: '第一篇', status: 'waiting_review' });
    await expect(stat(path.join(outputRoot, '2026-05-27', '第二篇-job-2'))).rejects.toThrow();
  });

  it('rejects replacements while confirmation holds the global reservation', async () => {
    const formatStarted = deferred<void>();
    const releaseFormat = deferred<void>();
    const { runner } = createRunner({
      scripts: {
        formatMarkdown: async () => {
          formatStarted.resolve();
          await releaseFormat.promise;
        }
      }
    });
    const job = await runner.startImportedDraft({ topic: '第一篇', markdown: '# 第一篇' });

    const confirming = runner.confirmDraft(job.id);
    await formatStarted.promise;
    let replacementReads = 0;
    store.readCurrentJob = async () => {
      replacementReads += 1;
      throw new Error('不应读取 current job');
    };

    await expect(runner.startJob({ topic: '第二篇', materials: [] })).rejects.toThrow('已有发文任务正在进行');
    await expect(runner.startImportedDraft({ topic: '第二篇', markdown: '# 第二篇' })).rejects.toThrow('已有发文任务正在进行');
    await expect(runner.restart(job.id)).rejects.toThrow('已有发文任务正在进行');
    expect(replacementReads).toBe(0);

    releaseFormat.resolve();
    await confirming;
  });

  it('rejects replacements while resume holds the global reservation', async () => {
    const formatStarted = deferred<void>();
    const resumeStarted = deferred<void>();
    const releaseFormat = deferred<void>();
    let formatCalls = 0;
    const { runner } = createRunner({
      scripts: {
        formatMarkdown: async (_markdownPath, signal) => {
          formatCalls += 1;
          if (formatCalls === 1) {
            formatStarted.resolve();
            await new Promise<void>((_resolve, reject) => {
              signal?.addEventListener('abort', () => reject(abortError()), { once: true });
            });
          } else {
            resumeStarted.resolve();
            await releaseFormat.promise;
          }
        }
      }
    });
    const job = await runner.startImportedDraft({ topic: '第一篇', markdown: '# 第一篇' });

    const confirming = runner.confirmDraft(job.id);
    await formatStarted.promise;
    await runner.stop(job.id);
    await confirming;

    const resuming = runner.resume(job.id);
    await resumeStarted.promise;
    let replacementReads = 0;
    store.readCurrentJob = async () => {
      replacementReads += 1;
      throw new Error('不应读取 current job');
    };

    await expect(runner.startJob({ topic: '第二篇', materials: [] })).rejects.toThrow('已有发文任务正在进行');
    await expect(runner.startImportedDraft({ topic: '第二篇', markdown: '# 第二篇' })).rejects.toThrow('已有发文任务正在进行');
    await expect(runner.restart(job.id)).rejects.toThrow('已有发文任务正在进行');
    expect(replacementReads).toBe(0);

    releaseFormat.resolve();
    await resuming;
  });

  it('saves a manually edited draft before continuing the pipeline', async () => {
    const calls: string[] = [];
    const { runner } = createRunner({
      scripts: {
        formatMarkdown: async () => calls.push('format'),
        generateImage: async (input) => calls.push(input.imagePath.endsWith('cover.png') ? 'cover' : 'illustration'),
        renderHtml: async (markdownPath) => {
          calls.push('html');
          return markdownPath.replace(/\.md$/i, '.html');
        },
        publishWechatDraft: async () => {
          calls.push('publish');
          return { success: true, media_id: 'draft-id' };
        }
      }
    });
    const job = await runner.startJob({ topic: 'AI 内容工作流', materials: [material] });
    await runner.saveDraft(job.id, '---\ntitle: 手动稿\ndescription: 摘要\nauthor: Agent\n---\n\n# 手动稿\n\n正文。');

    const completed = await runner.confirmDraft(job.id);

    expect(completed.status).toBe('completed');
    expect(completed.currentStep).toBe('completed');
    expect(calls).toEqual(['format', 'cover', 'illustration', 'html', 'publish']);
    await expect(readFile(completed.paths.formattedMarkdown!, 'utf8')).resolves.toContain('# 手动稿');
    await expect(store.readHistory()).resolves.toHaveLength(1);
  });

  it('records failed step and can continue from that step', async () => {
    let publishAttempts = 0;
    const { runner } = createRunner({
      scripts: {
        formatMarkdown: async () => undefined,
        generateImage: async () => undefined,
        renderHtml: async (markdownPath) => markdownPath.replace(/\.md$/i, '.html'),
        publishWechatDraft: async () => {
          publishAttempts += 1;
          if (publishAttempts === 1) {
            throw new Error('微信发布失败');
          }
          return { success: true, media_id: 'draft-id' };
        }
      }
    });
    const job = await runner.startJob({ topic: 'AI 内容工作流', materials: [] });

    const failed = await runner.confirmDraft(job.id);
    expect(failed.status).toBe('failed');
    expect(failed.failedStep).toBe('publish_wechat_draft');
    expect(failed.error).toContain('微信发布失败');

    const completed = await runner.retry(job.id);
    expect(completed.status).toBe('completed');
    expect(publishAttempts).toBe(2);
  });

  it('regenerates the draft with revision notes while staying in review', async () => {
    const drafts: string[] = [];
    const { runner } = createRunner({
      draft: async (input) => {
        drafts.push(input.revisionNote ?? '');
        return `---\ntitle: 版本 ${drafts.length}\ndescription: 摘要\nauthor: Agent\n---\n\n# 版本 ${drafts.length}`;
      }
    });
    const job = await runner.startJob({ topic: 'AI 内容工作流', materials: [] });

    const regenerated = await runner.regenerateDraft(job.id, '加强结论');

    expect(regenerated.status).toBe('waiting_review');
    expect(regenerated.currentStep).toBe('review_draft');
    expect(drafts).toEqual(['', '加强结论']);
    await expect(readFile(regenerated.paths.draftMarkdown!, 'utf8')).resolves.toContain('# 版本 2');
  });

  it('waits for the running step to settle before returning a stopped job', async () => {
    const stepStarted = deferred<void>();
    const abortObserved = deferred<void>();
    const finishAbort = deferred<void>();
    const { runner } = createRunner({
      scripts: {
        formatMarkdown: async (_markdownPath, signal) => {
          stepStarted.resolve();
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                abortObserved.resolve();
                void finishAbort.promise.then(() => reject(abortError()));
              },
              { once: true }
            );
          });
        }
      }
    });
    const job = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });
    await store.writeCurrentJob({ ...job, failedStep: 'format_markdown', error: '旧错误' });

    const confirming = runner.confirmDraft(job.id);
    await stepStarted.promise;
    let stopSettled = false;
    const stopping = runner.stop(job.id).then((result) => {
      stopSettled = true;
      return result;
    });
    await abortObserved.promise;

    expect(stopSettled).toBe(false);
    finishAbort.resolve();
    const [stopped, confirmResult] = await Promise.all([stopping, confirming]);

    expect(stopped).toMatchObject({ status: 'stopped', currentStep: 'format_markdown' });
    expect(confirmResult).toMatchObject({ status: 'stopped', currentStep: 'format_markdown' });
    expect(stopped.failedStep).toBeUndefined();
    expect(stopped.error).toBeUndefined();
    const logs = await store.readLogs(job.id);
    expect(logs.at(-1)).toMatchObject({ level: 'info', step: 'format_markdown' });
    expect(logs.filter((entry) => entry.level === 'error')).toHaveLength(0);
  });

  it('keeps a business error as failed even when it happens after abort', async () => {
    const stepStarted = deferred<void>();
    const { runner } = createRunner({
      scripts: {
        formatMarkdown: async (_markdownPath, signal) => {
          stepStarted.resolve();
          await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
          throw new Error('业务失败');
        }
      }
    });
    const job = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });

    const confirming = runner.confirmDraft(job.id);
    await stepStarted.promise;
    const stopResult = await runner.stop(job.id);
    const confirmResult = await confirming;

    expect(stopResult).toMatchObject({
      status: 'failed',
      currentStep: 'format_markdown',
      failedStep: 'format_markdown',
      error: '业务失败'
    });
    expect(confirmResult).toMatchObject({ status: 'failed', error: '业务失败' });
    expect((await store.readLogs(job.id)).at(-1)).toMatchObject({
      level: 'error',
      step: 'format_markdown',
      message: '业务失败'
    });
  });

  it('resumes from the stopped step without rerunning completed steps', async () => {
    const coverStarted = deferred<void>();
    let formatCalls = 0;
    let coverCalls = 0;
    const { runner } = createRunner({
      scripts: {
        formatMarkdown: async () => {
          formatCalls += 1;
        },
        generateImage: async (input, signal) => {
          if (!input.imagePath.endsWith('cover.png')) return;
          coverCalls += 1;
          if (coverCalls > 1) return;
          coverStarted.resolve();
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(abortError()), { once: true });
          });
        }
      }
    });
    const job = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });

    const confirming = runner.confirmDraft(job.id);
    await coverStarted.promise;
    const stopped = await runner.stop(job.id);
    await confirming;
    const completed = await runner.resume(job.id);

    expect(stopped).toMatchObject({ status: 'stopped', currentStep: 'generate_cover' });
    expect(completed).toMatchObject({ status: 'completed', currentStep: 'completed' });
    expect(formatCalls).toBe(1);
    expect(coverCalls).toBe(2);
  });

  it('registers confirmation before asynchronous reads so an immediate stop is not lost', async () => {
    const { runner } = createRunner({
      scripts: {
        formatMarkdown: async (_markdownPath, signal) => {
          if (signal?.aborted) throw abortError();
        }
      }
    });
    const job = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });

    const confirming = runner.confirmDraft(job.id);
    const stopping = runner.stop(job.id);
    const [confirmResult, stopResult] = await Promise.all([confirming, stopping]);

    expect(confirmResult.status).toBe('stopped');
    expect(stopResult.status).toBe('stopped');
  });

  it('does not delay aborting an active run on another store read', async () => {
    const { runner } = createRunner({
      scripts: {
        formatMarkdown: async (_markdownPath, signal) => {
          if (signal?.aborted) throw abortError();
        }
      }
    });
    const job = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });
    const readCurrentJob = store.readCurrentJob.bind(store);
    let reads = 0;
    store.readCurrentJob = async () => {
      reads += 1;
      return readCurrentJob();
    };

    const confirming = runner.confirmDraft(job.id);
    const stopping = runner.stop(job.id);
    const [confirmResult, stopResult] = await Promise.all([confirming, stopping]);

    expect(confirmResult.status).toBe('stopped');
    expect(stopResult.status).toBe('stopped');
    expect(reads).toBe(1);
  });

  it('checkpoints a step that finishes after abort and resumes from the next step', async () => {
    const coverStarted = deferred<void>();
    let coverCalls = 0;
    let illustrationCalls = 0;
    const { runner } = createRunner({
      scripts: {
        generateImage: async (input, signal) => {
          if (input.imagePath.endsWith('cover.png')) {
            coverCalls += 1;
            if (coverCalls === 1) {
              coverStarted.resolve();
              await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
            }
            return;
          }
          illustrationCalls += 1;
        }
      }
    });
    const job = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });

    const confirming = runner.confirmDraft(job.id);
    await coverStarted.promise;
    const stopped = await runner.stop(job.id);
    await confirming;
    const completed = await runner.resume(job.id);

    expect(stopped).toMatchObject({ status: 'stopped', currentStep: 'generate_illustrations' });
    expect(completed.status).toBe('completed');
    expect(coverCalls).toBe(1);
    expect(illustrationCalls).toBe(1);
  });

  it('does not duplicate a publish operation that succeeds after abort', async () => {
    const publishStarted = deferred<void>();
    let publishCalls = 0;
    const { runner } = createRunner({
      scripts: {
        publishWechatDraft: async (_input, signal) => {
          publishCalls += 1;
          publishStarted.resolve();
          await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
          return { success: true, media_id: 'draft-id' };
        }
      }
    });
    const job = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });

    const confirming = runner.confirmDraft(job.id);
    await publishStarted.promise;
    const stopResult = await runner.stop(job.id);
    const confirmResult = await confirming;

    expect(stopResult).toMatchObject({ status: 'completed', currentStep: 'completed' });
    expect(confirmResult).toMatchObject({ status: 'completed', currentStep: 'completed' });
    expect(publishCalls).toBe(1);
    await expect(store.readHistory()).resolves.toHaveLength(1);
    await expect(runner.resume(job.id)).rejects.toThrow('completed');
  });

  it('rejects another operation while the same job is active', async () => {
    const stepStarted = deferred<void>();
    const { runner } = createRunner({
      scripts: {
        formatMarkdown: async (_markdownPath, signal) => {
          stepStarted.resolve();
          await new Promise<void>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(abortError()), { once: true });
          });
        }
      }
    });
    const job = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });

    const confirming = runner.confirmDraft(job.id);
    await stepStarted.promise;

    await expect(runner.confirmDraft(job.id)).rejects.toThrow('已有发文任务正在进行');
    await expect(runner.resume(job.id)).rejects.toThrow('已有发文任务正在进行');
    await runner.stop(job.id);
    await confirming;
  });

  it('uses one abort signal for every script operation in a run', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const { runner } = createRunner({
      scripts: {
        formatMarkdown: async (_markdownPath, signal) => {
          signals.push(signal);
        },
        generateImage: async (_input, signal) => {
          signals.push(signal);
        },
        renderHtml: async (markdownPath, signal) => {
          signals.push(signal);
          return markdownPath.replace(/\.md$/i, '.html');
        },
        publishWechatDraft: async (_input, signal) => {
          signals.push(signal);
          return { success: true, media_id: 'draft-id' };
        }
      }
    });
    const job = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });

    await runner.confirmDraft(job.id);

    expect(signals).toHaveLength(5);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    expect(new Set(signals).size).toBe(1);
  });

  it('stops initial draft generation through the model signal', async () => {
    const draftStarted = deferred<void>();
    let draftSignal: AbortSignal | undefined;
    let draftCalls = 0;
    const { runner } = createRunner({
      draft: async (_input, signal) => {
        draftCalls += 1;
        draftSignal = signal;
        if (draftCalls > 1) return '# resumed';
        draftStarted.resolve();
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        });
        return '# unreachable';
      }
    });

    const starting = runner.startJob({ topic: 'AI 内容工作流', materials: [] });
    await draftStarted.promise;
    const stopped = await runner.stop('job-1');
    const startResult = await starting;

    expect(draftSignal?.aborted).toBe(true);
    expect(stopped).toMatchObject({ status: 'stopped', currentStep: 'generate_draft' });
    expect(startResult.status).toBe('stopped');
    await expect(runner.resume('job-1')).resolves.toMatchObject({ status: 'waiting_review', currentStep: 'review_draft' });
    expect(draftCalls).toBe(2);
  });

  it('rejects stop and resume for unsupported job states', async () => {
    const { runner } = createRunner();
    const job = await runner.startImportedDraft({ topic: '本地文章', markdown: '# 本地文章\n\n正文。' });

    await expect(runner.stop(job.id)).rejects.toThrow('waiting_review');
    await expect(runner.resume(job.id)).rejects.toThrow('waiting_review');
    await store.writeCurrentJob({ ...job, status: 'failed', failedStep: 'format_markdown' });
    await expect(runner.stop(job.id)).rejects.toThrow('failed');
    await store.writeCurrentJob({ ...job, status: 'completed', currentStep: 'completed' });
    await expect(runner.stop(job.id)).rejects.toThrow('completed');
  });

  function createRunner(options: { createId?: () => string; draft?: DraftGenerator; scripts?: Partial<ImageGeneratorScripts> } = {}) {
    const runner = createAgentRunner({
      store,
      outputRoot,
      createId: options.createId ?? (() => 'job-1'),
      now: () => new Date('2026-05-27T12:00:00.000Z'),
      generateDraft: options.draft ?? (async () => '---\ntitle: 初稿\ndescription: 摘要\nauthor: Agent\n---\n\n# 初稿'),
      scripts: {
        formatMarkdown: async () => undefined,
        generateImage: async () => undefined,
        renderHtml: async (markdownPath) => markdownPath.replace(/\.md$/i, '.html'),
        publishWechatDraft: async () => ({ success: true, media_id: 'draft-id' }),
        ...options.scripts
      }
    });

    return { runner };
  }
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}
