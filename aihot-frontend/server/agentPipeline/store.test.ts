import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentStore } from './store';
import type { AgentJob, AgentMaterial } from './types';

let tempDir = '';

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
  tempDir = '';
});

async function makeStore() {
  tempDir = await mkdtemp(path.join(tmpdir(), 'agent-store-'));
  return createAgentStore(tempDir);
}

const material: AgentMaterial = {
  id: 'aihot:1',
  sourceType: 'aihot',
  title: '标题',
  summary: '摘要',
  addedAt: '2026-05-27T00:00:00.000Z'
};

function job(workDir: string): AgentJob {
  return {
    id: 'job-1',
    topic: '主题',
    status: 'running',
    currentStep: 'prepare_materials',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    materials: [material],
    paths: { workDir }
  };
}

describe('agent store', () => {
  it('exposes base and jobs directories', async () => {
    const store = await makeStore();

    expect(store.baseDir).toBe(tempDir);
    expect(store.jobsDir).toBe(path.join(tempDir, 'jobs'));
  });

  it('persists materials', async () => {
    const store = await makeStore();
    await store.writeMaterials([material]);
    expect(await store.readMaterials()).toEqual([material]);
  });

  it('persists the current job and per-job copy', async () => {
    const store = await makeStore();
    const current = job(path.join(tempDir, 'jobs', 'job-1'));
    await store.writeCurrentJob(current);

    expect(await store.readCurrentJob()).toEqual(current);
    expect(JSON.parse(await readFile(path.join(tempDir, 'current-job.json'), 'utf8'))).toEqual(current);
    expect(JSON.parse(await readFile(path.join(tempDir, 'jobs', 'job-1', 'job.json'), 'utf8'))).toEqual(current);
  });

  it('clears the current job without deleting job history files', async () => {
    const store = await makeStore();
    const current = job(path.join(tempDir, 'jobs', 'job-1'));
    await store.writeCurrentJob(current);
    await store.clearCurrentJob();

    expect(await store.readCurrentJob()).toBeNull();
    expect(JSON.parse(await readFile(path.join(tempDir, 'jobs', 'job-1', 'job.json'), 'utf8'))).toEqual(current);
  });

  it('appends and reads JSONL logs', async () => {
    const store = await makeStore();
    await store.appendLog('job-1', {
      at: '2026-05-27T00:00:00.000Z',
      level: 'info',
      step: 'prepare_materials',
      message: '准备素材'
    });
    await store.appendLog('job-1', {
      at: '2026-05-27T00:01:00.000Z',
      level: 'error',
      step: 'generate_draft',
      message: '失败'
    });

    expect(await store.readLogs('job-1')).toEqual([
      expect.objectContaining({ message: '准备素材' }),
      expect.objectContaining({ level: 'error', message: '失败' })
    ]);
    expect(await readFile(path.join(tempDir, 'jobs', 'job-1', 'logs.jsonl'), 'utf8')).toContain('"准备素材"');
  });

  it('writes and reads job text files', async () => {
    const store = await makeStore();
    const filePath = await store.writeJobText('job-1', 'materials.md', '# 素材');

    expect(filePath).toBe(path.join(tempDir, 'jobs', 'job-1', 'materials.md'));
    expect(await store.readJobText('job-1', 'materials.md')).toBe('# 素材');
  });

  it('adds completed jobs to history with newest first', async () => {
    const store = await makeStore();
    await store.addHistory({
      id: 'job-1',
      topic: '主题一',
      createdAt: '2026-05-27T00:00:00.000Z',
      completedAt: '2026-05-27T00:10:00.000Z',
      materialCount: 1,
      workDir: 'pipeline-output/2026-05-27/topic-1',
      publishResult: 'media_id:123'
    });
    await store.addHistory({
      id: 'job-2',
      topic: '主题二',
      createdAt: '2026-05-27T01:00:00.000Z',
      completedAt: '2026-05-27T01:10:00.000Z',
      materialCount: 0,
      workDir: 'pipeline-output/2026-05-27/topic-2'
    });

    expect(await store.readHistory()).toEqual([
      expect.objectContaining({ id: 'job-2' }),
      expect.objectContaining({ id: 'job-1', publishResult: 'media_id:123' })
    ]);
  });
});
