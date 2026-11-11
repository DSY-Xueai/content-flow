import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderMaterialsMarkdown } from './materials';
import { generateDraftMarkdown, isEnglishMarkdown, readModelConfig } from './model';
import { createScriptAdapter, type ScriptAdapter } from './scripts';
import type { AgentJob, AgentLogEntry, AgentMaterial, AgentStepId } from './types';
import type { AgentStore } from './store';

export interface DraftInput {
  topic: string;
  materialsMarkdown: string;
  revisionNote?: string;
  previousDraft?: string;
  translateToChinese?: boolean;
}

export type DraftGenerator = (input: DraftInput, signal?: AbortSignal) => Promise<string>;
export type ImageGeneratorScripts = Pick<ScriptAdapter, 'formatMarkdown' | 'generateImage' | 'renderHtml' | 'publishWechatDraft'>;

interface AgentRunnerOptions {
  store: AgentStore;
  outputRoot?: string;
  createId?: () => string;
  now?: () => Date;
  modelEnv?: Record<string, string | undefined>;
  generateDraft?: DraftGenerator;
  scripts?: ImageGeneratorScripts;
}

interface StartJobInput {
  topic: string;
  materials: AgentMaterial[];
}

interface StartImportedDraftInput {
  topic: string;
  markdown: string;
}

export interface AgentRunner {
  startJob(input: StartJobInput): Promise<AgentJob>;
  startImportedDraft(input: StartImportedDraftInput): Promise<AgentJob>;
  saveDraft(jobId: string, markdown: string): Promise<AgentJob>;
  regenerateDraft(jobId: string, revisionNote: string): Promise<AgentJob>;
  confirmDraft(jobId: string): Promise<AgentJob>;
  retry(jobId: string): Promise<AgentJob>;
  restart(jobId: string): Promise<AgentJob>;
  stop(jobId: string): Promise<AgentJob>;
  resume(jobId: string): Promise<AgentJob>;
}

interface ActiveRun {
  controller: AbortController;
  promise: Promise<AgentJob>;
}

const REVIEW_STEPS = new Set<AgentStepId>(['prepare_materials', 'generate_draft']);
const AFTER_REVIEW_STEPS: AgentStepId[] = [
  'format_markdown',
  'generate_cover',
  'generate_illustrations',
  'render_html',
  'publish_wechat_draft'
];

export function createAgentRunner(options: AgentRunnerOptions): AgentRunner {
  const store = options.store;
  const outputRoot = options.outputRoot ?? defaultOutputRoot();
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const generateDraft =
    options.generateDraft ??
    ((input, signal) => generateDraftMarkdown(input, { ...readModelConfig(options.modelEnv), signal }));
  const scripts = options.scripts ?? createScriptAdapter({ env: options.modelEnv });
  const activeRuns = new Map<string, ActiveRun>();
  let currentJobReserved = false;

  function reserveCurrentJob(action: () => Promise<AgentJob>): Promise<AgentJob> {
    if (currentJobReserved) {
      return Promise.reject(new Error('已有发文任务正在进行'));
    }

    currentJobReserved = true;
    let promise: Promise<AgentJob>;
    try {
      promise = action();
    } catch (error) {
      currentJobReserved = false;
      return Promise.reject(error);
    }
    const release = () => {
      currentJobReserved = false;
    };
    void promise.then(release, release);
    return promise;
  }

  function startRun(jobId: string, action: (signal: AbortSignal) => Promise<AgentJob>): Promise<AgentJob> {
    if (activeRuns.has(jobId)) {
      return Promise.reject(new Error('当前任务已有运行中的操作'));
    }

    const controller = new AbortController();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const promise = (async () => {
      await ready;
      return action(controller.signal);
    })();
    const activeRun = { controller, promise };
    activeRuns.set(jobId, activeRun);
    release();

    const cleanup = () => {
      if (activeRuns.get(jobId) === activeRun) {
        activeRuns.delete(jobId);
      }
    };
    void promise.then(cleanup, cleanup);
    return promise;
  }

  async function saveJob(job: AgentJob): Promise<AgentJob> {
    job.updatedAt = now().toISOString();
    await store.writeCurrentJob(job);
    return job;
  }

  async function log(job: AgentJob, level: AgentLogEntry['level'], step: AgentStepId, message: string) {
    await store.appendLog(job.id, {
      at: now().toISOString(),
      level,
      step,
      message
    });
  }

  async function markStopped(job: AgentJob, step: AgentStepId) {
    job.status = 'stopped';
    job.currentStep = step;
    job.failedStep = undefined;
    job.error = undefined;
    await saveJob(job);
    await log(job, 'info', step, '任务已停止');
  }

  async function runStep(
    job: AgentJob,
    step: AgentStepId,
    message: string,
    signal: AbortSignal,
    action: (signal: AbortSignal) => Promise<void>
  ) {
    job.status = 'running';
    job.currentStep = step;
    job.failedStep = undefined;
    job.error = undefined;
    await saveJob(job);
    await log(job, 'info', step, message);

    try {
      throwIfAborted(signal);
      await action(signal);
      await saveJob(job);
      return true;
    } catch (error) {
      if (isAbortError(error)) {
        await markStopped(job, step);
        return false;
      }
      job.status = 'failed';
      job.currentStep = step;
      job.failedStep = step;
      job.error = error instanceof Error ? error.message : String(error);
      await saveJob(job);
      await log(job, 'error', step, job.error);
      return false;
    }
  }

  async function runUntilReview(job: AgentJob, signal: AbortSignal, fromStep: AgentStepId = 'prepare_materials') {
    if (fromStep === 'prepare_materials') {
      const ok = await runStep(job, 'prepare_materials', '保存主题和素材包', signal, async () => {
        await mkdir(job.paths.workDir, { recursive: true });
        const materialsPath = path.join(job.paths.workDir, 'materials.md');
        await writeFile(materialsPath, renderMaterialsMarkdown(job.topic, job.materials), 'utf8');
        job.paths.materialsMarkdown = materialsPath;
      });
      if (!ok) return job;
    }

    if (fromStep === 'prepare_materials' || fromStep === 'generate_draft') {
      const message = job.sourceMode === 'markdown' ? '识别并翻译英文 Markdown 为中文' : '生成公众号文章草稿';
      const ok = await runStep(job, 'generate_draft', message, signal, async (stepSignal) => {
        const materialsMarkdown = job.paths.materialsMarkdown
          ? await readFile(job.paths.materialsMarkdown, 'utf8')
          : renderMaterialsMarkdown(job.topic, job.materials);
        const draft = await generateDraft({
          topic: job.topic,
          materialsMarkdown,
          ...(job.sourceMode === 'markdown' ? {
            previousDraft: await readFile(job.paths.draftMarkdown!, 'utf8'),
            translateToChinese: true
          } : {})
        }, stepSignal);
        const draftPath = path.join(job.paths.workDir, 'draft.md');
        await writeFile(draftPath, draft, 'utf8');
        job.paths.draftMarkdown = draftPath;
      });
      if (!ok) return job;
    }

    job.status = 'waiting_review';
    job.currentStep = 'review_draft';
    await saveJob(job);
    await log(job, 'info', 'review_draft', '等待用户确认草稿');
    return job;
  }

  async function runAfterReview(job: AgentJob, signal: AbortSignal, fromStep: AgentStepId = 'format_markdown') {
    const startIndex = Math.max(0, AFTER_REVIEW_STEPS.indexOf(fromStep));
    const steps = AFTER_REVIEW_STEPS.slice(startIndex);

    for (const step of steps) {
      if (step === 'format_markdown') {
        const ok = await runStep(job, step, '格式化 markdown', signal, async (stepSignal) => {
          if (!job.paths.draftMarkdown) throw new Error('缺少草稿文件');
          const formattedPath = path.join(job.paths.workDir, 'article-formatted.md');
          await copyFile(job.paths.draftMarkdown, formattedPath);
          await scripts.formatMarkdown(formattedPath, stepSignal);
          job.paths.formattedMarkdown = formattedPath;
        });
        if (!ok) return job;
      }

      if (step === 'generate_cover') {
        const ok = await runStep(job, step, '生成封面图', signal, async (stepSignal) => {
          const imgsDir = path.join(job.paths.workDir, 'imgs');
          await mkdir(imgsDir, { recursive: true });
          const promptPath = path.join(imgsDir, 'cover-prompt.md');
          const coverPath = path.join(imgsDir, 'cover.png');
          await writeFile(promptPath, buildCoverPrompt(job), 'utf8');
          await scripts.generateImage({ promptPath, imagePath: coverPath, aspectRatio: '3:4' }, stepSignal);
          job.paths.cover = coverPath;
        });
        if (!ok) return job;
      }

      if (step === 'generate_illustrations') {
        const ok = await runStep(job, step, '生成文章内配图', signal, async (stepSignal) => {
          if (!job.paths.formattedMarkdown) throw new Error('缺少已格式化 markdown');
          const imgsDir = path.join(job.paths.workDir, 'imgs');
          await mkdir(imgsDir, { recursive: true });
          const promptPath = path.join(imgsDir, 'illustration-prompt.md');
          const imagePath = path.join(imgsDir, '01-article-illustration.png');
          await writeFile(promptPath, buildIllustrationPrompt(job), 'utf8');
          await scripts.generateImage({ promptPath, imagePath, aspectRatio: '16:9' }, stepSignal);
          await insertIllustration(job.paths.formattedMarkdown, 'imgs/01-article-illustration.png');
          job.paths.illustrations = [imagePath];
        });
        if (!ok) return job;
      }

      if (step === 'render_html') {
        const ok = await runStep(job, step, '转换微信 HTML', signal, async (stepSignal) => {
          if (!job.paths.formattedMarkdown) throw new Error('缺少已格式化 markdown');
          job.paths.html = await scripts.renderHtml(job.paths.formattedMarkdown, stepSignal);
        });
        if (!ok) return job;
      }

      if (step === 'publish_wechat_draft') {
        const ok = await runStep(job, step, '发布到公众号草稿箱', signal, async (stepSignal) => {
          if (!job.paths.formattedMarkdown) throw new Error('缺少已格式化 markdown');
          if (!job.paths.cover) throw new Error('缺少封面图');
          const result = await scripts.publishWechatDraft(
            {
              markdownPath: job.paths.formattedMarkdown,
              coverPath: job.paths.cover
            },
            stepSignal
          );
          job.publishResult = typeof result === 'string' ? result : JSON.stringify(result);
        });
        if (!ok) return job;
      }
    }

    job.status = 'completed';
    job.currentStep = 'completed';
    await saveJob(job);
    await store.addHistory({
      id: job.id,
      topic: job.topic,
      createdAt: job.createdAt,
      completedAt: now().toISOString(),
      materialCount: job.materials.length,
      workDir: job.paths.workDir,
      draftMarkdown: job.paths.draftMarkdown,
      formattedMarkdown: job.paths.formattedMarkdown,
      html: job.paths.html,
      cover: job.paths.cover,
      illustrations: job.paths.illustrations,
      publishResult: job.publishResult
    });
    await log(job, 'info', 'completed', '发文任务完成');
    return job;
  }

  async function readCurrent(jobId: string): Promise<AgentJob> {
    const job = await store.readCurrentJob();
    if (!job || job.id !== jobId) {
      throw new Error('找不到当前发文任务');
    }
    return job;
  }

  function launchJob(id: string, input: StartJobInput): Promise<AgentJob> {
    return startRun(id, async (signal) => {
      const current = await store.readCurrentJob();
      if (current && current.status === 'running') {
        throw new Error('已有发文任务正在进行');
      }

      const createdAt = now().toISOString();
      const job: AgentJob = {
        id,
        topic: input.topic.trim(),
        sourceMode: input.materials.length ? 'materials' : 'topic',
        status: 'running',
        currentStep: 'prepare_materials',
        createdAt,
        updatedAt: createdAt,
        materials: input.materials,
        paths: {
          workDir: path.join(outputRoot, createdAt.slice(0, 10), `${slugify(input.topic) || 'article'}-${id}`)
        }
      };
      await saveJob(job);
      return runUntilReview(job, signal);
    });
  }

  async function importDraft(id: string, input: StartImportedDraftInput): Promise<AgentJob> {
    const current = await store.readCurrentJob();
    if (current && current.status === 'running') {
      throw new Error('已有发文任务正在进行');
    }

    const createdAt = now().toISOString();
    const workDir = path.join(outputRoot, createdAt.slice(0, 10), `${slugify(input.topic) || 'article'}-${id}`);
    const draftMarkdown = path.join(workDir, 'draft.md');
    const job: AgentJob = {
      id,
      topic: input.topic.trim(),
      sourceMode: 'markdown',
      status: 'waiting_review',
      currentStep: 'review_draft',
      createdAt,
      updatedAt: createdAt,
      materials: [],
      paths: { workDir, draftMarkdown }
    };
    await mkdir(workDir, { recursive: true });
    await writeFile(draftMarkdown, input.markdown, 'utf8');
    await log(job, 'info', 'review_draft', '导入本地 Markdown 草稿');
    if (isEnglishMarkdown(input.markdown)) {
      return startRun(id, (signal) => runUntilReview(job, signal, 'generate_draft'));
    }
    return saveJob(job);
  }

  return {
    startJob(input) {
      const id = createId();
      return reserveCurrentJob(() => launchJob(id, input));
    },

    startImportedDraft(input) {
      const id = createId();
      return reserveCurrentJob(() => importDraft(id, input));
    },

    async saveDraft(jobId, markdown) {
      const job = await readCurrent(jobId);
      if (job.status !== 'waiting_review') {
        throw new Error('当前任务不在草稿确认阶段');
      }
      const draftPath = job.paths.draftMarkdown ?? path.join(job.paths.workDir, 'draft.md');
      await mkdir(path.dirname(draftPath), { recursive: true });
      await writeFile(draftPath, markdown, 'utf8');
      job.paths.draftMarkdown = draftPath;
      await log(job, 'info', 'review_draft', '保存手动编辑草稿');
      return saveJob(job);
    },

    async regenerateDraft(jobId, revisionNote) {
      const job = await readCurrent(jobId);
      if (job.status !== 'waiting_review') {
        throw new Error('当前任务不在草稿确认阶段');
      }
      const previousDraft = job.paths.draftMarkdown ? await readFile(job.paths.draftMarkdown, 'utf8') : '';
      const materialsMarkdown = job.paths.materialsMarkdown
        ? await readFile(job.paths.materialsMarkdown, 'utf8')
        : renderMaterialsMarkdown(job.topic, job.materials);
      const draft = await generateDraft({
        topic: job.topic,
        materialsMarkdown,
        revisionNote,
        previousDraft
      });
      const draftPath = job.paths.draftMarkdown ?? path.join(job.paths.workDir, 'draft.md');
      await writeFile(draftPath, draft, 'utf8');
      job.paths.draftMarkdown = draftPath;
      job.status = 'waiting_review';
      job.currentStep = 'review_draft';
      await log(job, 'info', 'review_draft', '根据修改意见重新生成草稿');
      return saveJob(job);
    },

    confirmDraft(jobId) {
      return reserveCurrentJob(() => startRun(jobId, async (signal) => {
        const job = await readCurrent(jobId);
        if (job.status !== 'waiting_review') {
          throw new Error('当前任务不在草稿确认阶段');
        }
        return runAfterReview(job, signal);
      }));
    },

    retry(jobId) {
      return reserveCurrentJob(() => startRun(jobId, async (signal) => {
        const job = await readCurrent(jobId);
        if (job.status !== 'failed' || !job.failedStep) {
          throw new Error('当前任务没有可继续的失败步骤');
        }
        return REVIEW_STEPS.has(job.failedStep)
          ? runUntilReview(job, signal, job.failedStep)
          : runAfterReview(job, signal, job.failedStep);
      }));
    },

    restart(jobId) {
      return reserveCurrentJob(async () => {
        const job = await readCurrent(jobId);
        const id = createId();
        if (job.sourceMode === 'markdown' && job.paths.draftMarkdown) {
          const markdown = await readFile(job.paths.draftMarkdown, 'utf8');
          return importDraft(id, { topic: job.topic, markdown });
        }
        return launchJob(id, { topic: job.topic, materials: job.materials });
      });
    },

    async stop(jobId) {
      const activeRun = activeRuns.get(jobId);
      if (activeRun) {
        activeRun.controller.abort();
        return activeRun.promise;
      }
      const job = await readCurrent(jobId);
      throw new Error(`当前任务状态 ${job.status} 不支持停止`);
    },

    resume(jobId) {
      return reserveCurrentJob(() => startRun(jobId, async (signal) => {
        const job = await readCurrent(jobId);
        if (job.status !== 'stopped') {
          throw new Error(`当前任务状态 ${job.status} 不支持继续`);
        }
        return REVIEW_STEPS.has(job.currentStep)
          ? runUntilReview(job, signal, job.currentStep)
          : runAfterReview(job, signal, job.currentStep);
      }));
    }
  };
}

function defaultOutputRoot(): string {
  const cwd = process.cwd();
  const repoRoot = path.basename(cwd) === 'aihot-frontend' ? path.resolve(cwd, '..') : cwd;
  return path.join(repoRoot, 'pipeline-output', 'agent');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function buildCoverPrompt(job: AgentJob): string {
  return [
    `Create a professional WeChat article cover image for: ${job.topic}`,
    'Use a polished tech editorial style, clear focal composition, no source list, no fake logos.',
    'If text appears, keep it short Chinese title text only.',
    '',
    'Article materials:',
    job.materials.map((item) => `- ${item.title}: ${item.summary}`).join('\n')
  ].join('\n');
}

function buildIllustrationPrompt(job: AgentJob): string {
  return [
    `Create one clean article illustration for this WeChat article: ${job.topic}`,
    'Use an informative tech editorial visual. Avoid screenshots, fake UI brands, source citations, and dense text.',
    'The image should support the core argument rather than repeat the title.',
    '',
    'Article materials:',
    job.materials.map((item) => `- ${item.title}: ${item.summary}`).join('\n')
  ].join('\n');
}

async function insertIllustration(markdownPath: string, imageRelativePath: string) {
  const markdown = await readFile(markdownPath, 'utf8');
  if (markdown.includes(imageRelativePath)) {
    return;
  }

  const imageMarkdown = `\n\n![文章配图](${imageRelativePath})\n`;
  const secondHeading = markdown.match(/\n##\s+.+/);
  if (!secondHeading?.index) {
    await writeFile(markdownPath, `${markdown.trimEnd()}${imageMarkdown}\n`, 'utf8');
    return;
  }

  const insertAt = secondHeading.index;
  await writeFile(markdownPath, `${markdown.slice(0, insertAt).trimEnd()}${imageMarkdown}${markdown.slice(insertAt)}`, 'utf8');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('任务已停止');
    error.name = 'AbortError';
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
