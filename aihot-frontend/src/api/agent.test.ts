import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addAgentMaterial,
  confirmAgentDraft,
  fetchAgentDraft,
  fetchAgentMaterials,
  resumeAgentJob,
  saveAgentDraft,
  startAgentJob,
  startAgentMarkdownJob,
  stopAgentJob,
  type AgentJobStatus
} from './agent';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent api client', () => {
  it('loads persisted materials', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ materials: [{ id: 'aihot:1', sourceType: 'aihot', title: '标题', summary: '摘要', addedAt: 'now' }] })
    );

    await expect(fetchAgentMaterials()).resolves.toEqual([
      { id: 'aihot:1', sourceType: 'aihot', title: '标题', summary: '摘要', addedAt: 'now' }
    ]);
    expect(fetch).toHaveBeenCalledWith('/api/agent/materials');
  });

  it('adds AI HOT material through the server normalizer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ materials: [] }));

    await addAgentMaterial({
      sourceType: 'aihot',
      item: { id: '1', title: '标题', summary: '摘要' }
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/agent/materials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'aihot',
        item: { id: '1', title: '标题', summary: '摘要' }
      })
    });
  });

  it('starts and controls draft review jobs', async () => {
    const job = { id: 'job-1', status: 'waiting_review', currentStep: 'review_draft', topic: '主题', materials: [], paths: { workDir: 'out' } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(jsonResponse({ job })));

    await startAgentJob('主题');
    await saveAgentDraft('job-1', '# 手动稿');
    await confirmAgentDraft('job-1');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/agent/jobs',
      '/api/agent/jobs/job-1/save-draft',
      '/api/agent/jobs/job-1/confirm-draft'
    ]);
  });

  it('loads draft markdown for review editing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ markdown: '# 当前草稿' }));

    await expect(fetchAgentDraft('job-1')).resolves.toBe('# 当前草稿');
    expect(fetch).toHaveBeenCalledWith('/api/agent/jobs/job-1/draft');
  });

  it('stops and resumes a job through POST actions', async () => {
    const job = { id: 'job-1', status: 'stopped', currentStep: 'format_markdown' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(jsonResponse({ job })));

    await stopAgentJob('job-1');
    await resumeAgentJob('job-1');

    expect(fetchMock.mock.calls).toEqual([
      ['/api/agent/jobs/job-1/stop', { method: 'POST' }],
      ['/api/agent/jobs/job-1/resume', { method: 'POST' }]
    ]);
  });

  it('includes stopped in the frontend job status union', () => {
    const status: AgentJobStatus = 'stopped';

    expect(status).toBe('stopped');
  });

  it('submits a local markdown draft through the jobs endpoint', async () => {
    const job = { id: 'job-1', status: 'waiting_review', currentStep: 'review_draft' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ job }));

    await startAgentMarkdownJob('article.md', '# 标题');

    expect(fetchMock).toHaveBeenCalledWith('/api/agent/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceMode: 'markdown', fileName: 'article.md', markdown: '# 标题' })
    });
  });

  it('throws server error messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: '已有发文任务正在进行' }, 409));

    await expect(startAgentJob('主题')).rejects.toThrow('已有发文任务正在进行');
  });
});
