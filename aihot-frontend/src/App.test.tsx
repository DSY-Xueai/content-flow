import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { resetXSourceRequestStateForTests } from './api/xSources';

const syncHealthResponse = { resources: [], cache: { bytes: 0, limitBytes: 5242880, diskBudgetBytes: 10485760, error: null } };

const itemsResponse = {
  items: [
    {
      id: '1',
      title: 'OpenAI 发布新的 Agent 工具',
      links: { original: 'https://example.com/openai', aihot: 'https://aihot.news/items/1' },
      source: { name: 'OpenAI Blog' },
      summary: '面向开发者的 Agent 工作流能力更新。',
      publishedAt: '2026-05-20T01:48:00.000Z',
      category: 'ai-models',
      score: 88,
      tags: ['Agent', 'OpenAI'],
      reason: '开发者关注度高',
      media: [
        {
          url: 'https://pbs.twimg.com/media/openai.jpg',
          type: 'photo',
          width: 1200,
          height: 800
        }
      ]
    }
  ]
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockDefaultAppFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
    if (url.startsWith('/api/x/handles')) {
      return Promise.resolve(jsonResponse({ handles: [] }));
    }

    if (url.startsWith('/api/x/latest')) {
      return Promise.resolve(jsonResponse({ items: [] }));
    }

    return Promise.resolve(jsonResponse(itemsResponse));
  });
}

function mockAppFetchWithXItems(items: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
    if (url.startsWith('/api/x/handles')) {
      return Promise.resolve(jsonResponse({ handles: [] }));
    }

    if (url.startsWith('/api/x/latest')) {
      return Promise.resolve(jsonResponse({ items }));
    }

    return Promise.resolve(jsonResponse(itemsResponse));
  });
}

afterEach(() => {
  resetXSourceRequestStateForTests();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('App', () => {
  it('opens the hot ranking from navigation and refreshes the official endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url === '/api/v1/hot-topics') return jsonResponse({ schemaVersion: 1, count: 0, items: [] });
      if (url.startsWith('/api/x/handles')) return jsonResponse({ handles: [] });
      if (url.startsWith('/api/x/latest')) return jsonResponse({ items: [] });
      return jsonResponse(itemsResponse);
    });
    render(<App />);
    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '热点榜' }));
    expect(await screen.findByText('暂无热点')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '热点榜' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '热点榜' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('信息源状态：正常')).toBeInTheDocument();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 60000);
    await userEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/hot-topics')).toHaveLength(2));
  });

  it('synchronizes on the minute and on return, preserves content on failure, and stops polling after unmount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T00:00:00Z'));
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let reads = 0;
    let unavailable = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return jsonResponse({ handles: [] });
      if (url.startsWith('/api/x/latest')) return jsonResponse({ items: [] });
      reads += 1;
      return unavailable ? jsonResponse({}, 503) : jsonResponse({ items: [{ ...itemsResponse.items[0], title: `同步版本 ${reads}` }], page: { hasMore: false, nextCursor: null } });
    });
    const { unmount } = render(<App />);
    try {
      await act(async () => {});
      expect(screen.getByText('同步版本 1')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(screen.getByText('同步版本 2')).toBeInTheDocument();
      unavailable = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(screen.getByText('同步版本 2')).toBeInTheDocument();
      expect(screen.getByText(/自动同步失败，正在保留上次数据/)).toBeInTheDocument();
      visible.mockReturnValue('hidden');
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(reads).toBe(3);
      unavailable = false;
      visible.mockReturnValue('visible');
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(screen.getByText('同步版本 4')).toBeInTheDocument();
      unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(reads).toBe(4);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it('collapses to a navigable rail and restores without resetting on a view change', async () => {
    mockDefaultAppFetch();
    const { container } = render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    const closeButton = screen.getByRole('button', { name: '收起侧栏' });
    expect(closeButton).toHaveAttribute('aria-expanded', 'true');
    expect(closeButton).toHaveAttribute('aria-controls', 'workspace-sidebar');
    expect(container.querySelector('#workspace-sidebar')).toBeInTheDocument();

    await userEvent.click(closeButton);

    expect(container.querySelector('#workspace-sidebar')).toBeVisible();
    expect(container.querySelector('#workspace-sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(container.querySelector('.workspace')).toHaveClass('sidebar-collapsed');
    const openButton = screen.getByRole('button', { name: '展开侧栏' });
    expect(openButton).toHaveAttribute('aria-expanded', 'false');
    expect(openButton).toHaveFocus();
    expect(document.getElementById(openButton.getAttribute('aria-controls') ?? '')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '全部 AI 动态' }));
    expect(screen.getByRole('button', { name: '全部 AI 动态' })).toHaveAttribute('aria-current', 'page');
    expect(container.querySelector('#workspace-sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
    expect(container.querySelector('#workspace-sidebar')).toBeVisible();
    expect(screen.getByRole('button', { name: '收起侧栏' })).toHaveFocus();
    expect(localStorage.getItem('paixiaoxin.sidebar')).toBe('open');
  });

  it('restores the saved sidebar and theme preferences', async () => {
    localStorage.setItem('paixiaoxin.sidebar', 'collapsed');
    localStorage.setItem('paixiaoxin.theme', 'dark');
    mockDefaultAppFetch();
    render(<App />);

    expect(screen.getByRole('button', { name: '展开侧栏' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await userEvent.click(screen.getByRole('button', { name: '浅色模式' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('paixiaoxin.theme')).toBe('light');
    expect(screen.getByRole('button', { name: '浅色模式' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('loads selected AI news and renders a news card', async () => {
    mockDefaultAppFetch();

    render(<App />);

    expect(screen.getByText('派小芯')).toBeInTheDocument();
    expect(screen.getAllByText('信息源工作台')[0]).toBeInTheDocument();
    expect(await screen.findByText('OpenAI 发布新的 Agent 工具')).toBeInTheDocument();
    expect(screen.getByLabelText('信息源状态：正常')).toHaveTextContent('信息源正常');
    expect(screen.getByText('OpenAI Blog')).toBeInTheDocument();
    expect(screen.getByText('模型发布/更新')).toBeInTheDocument();
    expect(screen.getByAltText('OpenAI 发布新的 Agent 工具 的媒体预览')).toBeInTheDocument();
  });

  it('adds an AI HOT item to Agent materials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) {
        return Promise.resolve(jsonResponse({ handles: [] }));
      }
      if (url.startsWith('/api/x/latest')) {
        return Promise.resolve(jsonResponse({ items: [] }));
      }
      if (url.startsWith('/api/agent/materials')) {
        expect(init?.method).toBe('POST');
        return Promise.resolve(
          jsonResponse({
            materials: [
              {
                id: 'aihot:1',
                sourceType: 'aihot',
                title: 'OpenAI 发布新的 Agent 工具',
                summary: '面向开发者的 Agent 工作流能力更新。',
                addedAt: '2026-05-27T00:00:00.000Z'
              }
            ]
          })
        );
      }

      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '加入素材：OpenAI 发布新的 Agent 工具' }));

    const materialCall = fetchMock.mock.calls.find(([url]) => String(url).startsWith('/api/agent/materials'));
    expect(materialCall?.[1]?.body).toBe(
      JSON.stringify({
        sourceType: 'aihot',
        item: {
          id: '1',
          title: 'OpenAI 发布新的 Agent 工具',
          summary: '面向开发者的 Agent 工作流能力更新。'
        }
      })
    );
    expect(screen.getByRole('button', { name: '已加入素材：OpenAI 发布新的 Agent 工具' })).toBeDisabled();
  });

  it('renders the Agent workbench with current draft state', async () => {
    mockDefaultAppFetch();

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') {
        return Promise.resolve(
          jsonResponse({
            materials: [
              {
                id: 'aihot:1',
                sourceType: 'aihot',
                title: 'OpenAI 发布新的 Agent 工具',
                summary: '面向开发者的 Agent 工作流能力更新。',
                addedAt: '2026-05-27T00:00:00.000Z'
              }
            ]
          })
        );
      }
      if (url === '/api/agent/current-job') {
        return Promise.resolve(
          jsonResponse({
            job: {
              id: 'job-1',
              topic: 'AI 内容工作流',
              status: 'waiting_review',
              currentStep: 'review_draft',
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              materials: [],
              paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
            }
          })
        );
      }
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-1/draft') return Promise.resolve(jsonResponse({ markdown: '# 当前草稿' }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));

    expect(await screen.findByRole('heading', { name: '公众号自动发文AGENT' })).toBeInTheDocument();
    expect(screen.getByText('OpenAI 发布新的 Agent 工具')).toBeInTheDocument();
    expect(screen.getByLabelText('草稿 Markdown')).toHaveValue('# 当前草稿');
    expect(screen.getAllByText('等待草稿确认').length).toBeGreaterThan(0);
  });

  it('stops a running confirmation while busy and ignores its stale response', async () => {
    const reviewJob = {
      id: 'job-1',
      topic: 'AI 内容工作流',
      status: 'waiting_review',
      currentStep: 'review_draft',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      materials: [],
      paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
    };
    const runningJob = { ...reviewJob, status: 'running', currentStep: 'format_markdown' };
    const stoppedJob = { ...runningJob, status: 'stopped' };
    const staleCompletedJob = { ...runningJob, status: 'completed', currentStep: 'completed' };
    let currentJob = reviewJob;
    let resolveConfirm: (response: Response) => void = () => undefined;
    let resolveStop: (response: Response) => void = () => undefined;
    const confirmResponse = new Promise<Response>((resolve) => {
      resolveConfirm = resolve;
    });
    const stopResponse = new Promise<Response>((resolve) => {
      resolveStop = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: currentJob }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-1/draft') return Promise.resolve(jsonResponse({ markdown: '# 当前草稿' }));
      if (url === '/api/agent/jobs/job-1/confirm-draft' && init?.method === 'POST') {
        currentJob = runningJob;
        return confirmResponse;
      }
      if (url === '/api/agent/jobs/job-1/stop' && init?.method === 'POST') {
        currentJob = stoppedJob;
        return stopResponse;
      }
      return Promise.resolve(jsonResponse(itemsResponse));
    });
    vi.spyOn(window, 'setInterval').mockImplementation((handler: (...args: any[]) => void) => {
      Promise.resolve().then(handler);
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    });

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    await screen.findByLabelText('草稿 Markdown');
    await userEvent.click(screen.getAllByRole('button', { name: '确认继续' })[0]);

    const stopButton = await screen.findByRole('button', { name: '停止任务' });
    expect(stopButton).not.toBeDisabled();
    await userEvent.click(stopButton);
    expect(screen.getByRole('button', { name: '正在停止' })).toBeDisabled();

    await act(async () => {
      resolveStop(jsonResponse({ job: stoppedJob }));
    });
    expect(await screen.findByRole('button', { name: '继续任务' })).not.toBeDisabled();
    expect(screen.getAllByText('已停止').length).toBeGreaterThan(0);

    await act(async () => {
      resolveConfirm(jsonResponse({ job: staleCompletedJob }));
    });
    expect(screen.getByRole('button', { name: '继续任务' })).toBeInTheDocument();
    expect(screen.getAllByText('已停止').length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent/jobs/job-1/stop')).toBe(true);
  });

  it('releases busy state and refreshes the real job when stopping fails', async () => {
    const reviewJob = {
      id: 'job-1',
      topic: 'AI 内容工作流',
      status: 'waiting_review',
      currentStep: 'review_draft',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      materials: [],
      paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
    };
    const runningJob = { ...reviewJob, status: 'running', currentStep: 'format_markdown' };
    const completedJob = { ...runningJob, status: 'completed', currentStep: 'completed' };
    const staleFailedJob = { ...runningJob, status: 'failed', error: '旧请求失败' };
    let currentJob = reviewJob;
    let historyRequests = 0;
    let resolveConfirm: (response: Response) => void = () => undefined;
    const confirmResponse = new Promise<Response>((resolve) => {
      resolveConfirm = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: currentJob }));
      if (url === '/api/agent/history') {
        historyRequests += 1;
        return Promise.resolve(
          historyRequests > 1 ? jsonResponse({ error: '历史刷新失败' }, 500) : jsonResponse({ history: [] })
        );
      }
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-1/draft') return Promise.resolve(jsonResponse({ markdown: '# 当前草稿' }));
      if (url === '/api/agent/jobs/job-1/confirm-draft' && init?.method === 'POST') {
        currentJob = runningJob;
        return confirmResponse;
      }
      if (url === '/api/agent/jobs/job-1/stop' && init?.method === 'POST') {
        currentJob = completedJob;
        return Promise.resolve(jsonResponse({ error: '停止请求失败' }, 500));
      }
      return Promise.resolve(jsonResponse(itemsResponse));
    });
    vi.spyOn(window, 'setInterval').mockImplementation((handler: (...args: any[]) => void) => {
      Promise.resolve().then(handler);
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    });

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    await screen.findByLabelText('草稿 Markdown');
    await userEvent.click(screen.getAllByRole('button', { name: '确认继续' })[0]);
    await userEvent.click(await screen.findByRole('button', { name: '停止任务' }));

    expect(await screen.findByRole('heading', { name: 'Agent 操作失败' })).toBeInTheDocument();
    expect(screen.getByText('停止请求失败')).toBeInTheDocument();
    expect(screen.queryByText('历史刷新失败')).not.toBeInTheDocument();
    expect((await screen.findAllByText('已完成')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '开始发文' })).not.toBeDisabled();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/agent/current-job')).toHaveLength(3);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/agent/jobs/job-1/logs')).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/agent/history')).toHaveLength(2);

    await act(async () => {
      resolveConfirm(jsonResponse({ job: staleFailedJob }));
    });
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(screen.queryByText('旧请求失败')).not.toBeInTheDocument();
  });

  it('keeps resume disabled until stopping finishes and resets the stopping state before resume', async () => {
    const runningJob = {
      id: 'job-1',
      topic: 'AI 内容工作流',
      status: 'running',
      currentStep: 'format_markdown',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      materials: [],
      paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
    };
    const stoppedJob = { ...runningJob, status: 'stopped' };
    let historyRequests = 0;
    let resolveStopHistory: (response: Response) => void = () => undefined;
    const stopHistoryResponse = new Promise<Response>((resolve) => {
      resolveStopHistory = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: runningJob }));
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/history') {
        historyRequests += 1;
        return historyRequests === 2 ? stopHistoryResponse : Promise.resolve(jsonResponse({ history: [] }));
      }
      if (url === '/api/agent/jobs/job-1/stop' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ job: stoppedJob }));
      }
      if (url === '/api/agent/jobs/job-1/resume' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ job: runningJob }));
      }
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    await userEvent.click(await screen.findByRole('button', { name: '停止任务' }));

    expect(await screen.findByRole('button', { name: '继续任务' })).toBeDisabled();
    await act(async () => {
      resolveStopHistory(jsonResponse({ history: [] }));
    });
    expect(await screen.findByRole('button', { name: '继续任务' })).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '继续任务' }));
    expect(await screen.findByRole('button', { name: '停止任务' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '正在停止' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent/jobs/job-1/resume')).toBe(true);
  });

  it('clears pending Agent polling when stopping or unmounting', async () => {
    const reviewJob = {
      id: 'job-1',
      topic: 'AI 内容工作流',
      status: 'waiting_review',
      currentStep: 'review_draft',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      materials: [],
      paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
    };
    const runningJob = { ...reviewJob, status: 'running', currentStep: 'format_markdown' };
    const stoppedJob = { ...runningJob, status: 'stopped' };
    let currentJob = reviewJob;
    let nextIntervalId = 0;
    const intervalCallbacks = new Map<number, () => void>();
    const agentIntervalIds: number[] = [];
    vi.spyOn(window, 'setInterval').mockImplementation((handler: (...args: any[]) => void, delay?: number) => {
      const intervalId = ++nextIntervalId;
      intervalCallbacks.set(intervalId, handler);
      if (delay === 1500) agentIntervalIds.push(intervalId);
      return intervalId as unknown as ReturnType<typeof window.setInterval>;
    });
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation((intervalId) => {
      intervalCallbacks.delete(Number(intervalId));
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: currentJob }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-1/draft') return Promise.resolve(jsonResponse({ markdown: '# 当前草稿' }));
      if (url === '/api/agent/jobs/job-1/confirm-draft' && init?.method === 'POST') {
        currentJob = runningJob;
        return new Promise<Response>(() => undefined);
      }
      if (url === '/api/agent/jobs/job-1/stop' && init?.method === 'POST') {
        currentJob = stoppedJob;
        return Promise.resolve(jsonResponse({ job: stoppedJob }));
      }
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    const firstRender = render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    await screen.findByLabelText('草稿 Markdown');
    await userEvent.click(screen.getAllByRole('button', { name: '确认继续' })[0]);
    const firstAgentIntervalId = agentIntervalIds[0];
    expect(intervalCallbacks.has(firstAgentIntervalId)).toBe(true);
    firstRender.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(firstAgentIntervalId);
    expect(intervalCallbacks.has(firstAgentIntervalId)).toBe(false);

    currentJob = reviewJob;
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    await screen.findByLabelText('草稿 Markdown');
    await userEvent.click(screen.getAllByRole('button', { name: '确认继续' })[0]);
    const secondAgentIntervalId = agentIntervalIds[1];
    await act(async () => {
      intervalCallbacks.get(secondAgentIntervalId)?.();
    });
    await userEvent.click(await screen.findByRole('button', { name: '停止任务' }));
    await screen.findByRole('button', { name: '继续任务' });

    expect(clearIntervalSpy).toHaveBeenCalledWith(secondAgentIntervalId);
    expect(intervalCallbacks.has(secondAgentIntervalId)).toBe(false);
  });

  it.each(['waiting_review', 'stopped', 'failed', 'completed'] as const)(
    'polls a restored running Agent job until it becomes %s',
    async (status) => {
      const runningJob = {
        id: 'job-restore',
        topic: '恢复中的任务',
        status: 'running' as const,
        currentStep: 'format_markdown' as const,
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
        materials: [],
        paths: { workDir: 'pipeline-output/agent/job-restore', draftMarkdown: 'draft.md' }
      };
      const nextJob = {
        ...runningJob,
        status,
        currentStep: (status === 'waiting_review' ? 'review_draft' : status === 'completed' ? 'completed' : 'format_markdown') as
          | 'review_draft'
          | 'completed'
          | 'format_markdown'
      };
      let currentJob: typeof runningJob | typeof nextJob = runningJob;
      let history = [] as Array<{ id: string; topic: string; createdAt: string; completedAt: string; materialCount: number; workDir: string }>;
      let nextIntervalId = 0;
      const intervalCallbacks = new Map<number, () => void>();
      const agentIntervalIds: number[] = [];
      vi.spyOn(window, 'setInterval').mockImplementation((handler: (...args: any[]) => void, delay?: number) => {
        const intervalId = ++nextIntervalId;
        intervalCallbacks.set(intervalId, handler);
        if (delay === 1500) agentIntervalIds.push(intervalId);
        return intervalId as unknown as ReturnType<typeof window.setInterval>;
      });
      vi.spyOn(window, 'clearInterval').mockImplementation((intervalId) => {
        intervalCallbacks.delete(Number(intervalId));
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
        const url = String(input);
        if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
        if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
        if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
        if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
        if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: currentJob }));
        if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history }));
        if (url === '/api/agent/jobs/job-restore/logs') {
          return Promise.resolve(jsonResponse({ logs: [{ at: '2026-07-20T00:00:00.000Z', level: 'info', step: currentJob.currentStep, message: `状态：${currentJob.status}` }] }));
        }
        if (url === '/api/agent/jobs/job-restore/draft') return Promise.resolve(jsonResponse({ markdown: '# 恢复的草稿' }));
        return Promise.resolve(jsonResponse(itemsResponse));
      });

      render(<App />);
      await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
      const stopButton = await screen.findByRole('button', { name: '停止任务' });
      expect(stopButton).toBeEnabled();

      await waitFor(() => expect(agentIntervalIds).toHaveLength(1));
      currentJob = nextJob;
      if (status !== 'waiting_review') {
        history = [{
          id: 'history-restore',
          topic: `${status} 历史记录`,
          createdAt: '2026-07-20T00:00:00.000Z',
          completedAt: '2026-07-20T00:01:00.000Z',
          materialCount: 0,
          workDir: 'pipeline-output/agent/job-restore'
        }];
      }
      await act(async () => {
        intervalCallbacks.get(agentIntervalIds[0])?.();
      });

      expect(await screen.findByText(`状态：${status}`)).toBeInTheDocument();
      if (status === 'waiting_review') {
        expect((await screen.findByLabelText('草稿 Markdown')) as HTMLTextAreaElement).toHaveValue('# 恢复的草稿');
      } else {
        expect(await screen.findByText(`${status} 历史记录`)).toBeInTheDocument();
      }
    }
  );

  it('resumes a stopped Agent job', async () => {
    const stoppedJob = {
      id: 'job-1',
      topic: 'AI 内容工作流',
      status: 'stopped',
      currentStep: 'format_markdown',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      materials: [],
      paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
    };
    const completedJob = { ...stoppedJob, status: 'completed', currentStep: 'completed' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: stoppedJob }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-1/resume' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ job: completedJob }));
      }
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));

    expect((await screen.findAllByText('已停止')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: '继续任务' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent/jobs/job-1/resume')).toBe(true);
    });
    expect((await screen.findAllByText('已完成')).length).toBeGreaterThan(0);
  });

  it('uses the primary button class for starting and every draft confirmation', async () => {
    const reviewJob = {
      id: 'job-1',
      topic: 'AI 内容工作流',
      status: 'waiting_review',
      currentStep: 'review_draft',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      materials: [],
      paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: reviewJob }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-1/draft') return Promise.resolve(jsonResponse({ markdown: '# 当前草稿' }));
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    await screen.findByLabelText('草稿 Markdown');

    const startButton = screen.getByRole('button', { name: '开始发文' });
    expect(startButton).toHaveClass('agent-primary-button', 'agent-start-button');
    const confirmButtons = screen.getAllByRole('button', { name: '确认继续' });
    expect(confirmButtons).toHaveLength(3);
    confirmButtons.forEach((button) => expect(button).toHaveClass('agent-primary-button'));
  });

  it('submits multiline revision notes when regenerating the current draft', async () => {
    const reviewJob = {
      id: 'job-1',
      topic: 'AI 内容工作流',
      status: 'waiting_review',
      currentStep: 'review_draft',
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
      materials: [],
      paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: reviewJob }));
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-1/draft') return Promise.resolve(jsonResponse({ markdown: '# 当前草稿' }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      if (url === '/api/agent/jobs/job-1/regenerate-draft' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ job: reviewJob }));
      }
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));

    const revisionBox = await screen.findByLabelText('修改要求');
    expect(revisionBox.tagName).toBe('TEXTAREA');
    fireEvent.change(revisionBox, { target: { value: '请加强结论\n减少空话' } });
    await userEvent.click(screen.getByRole('button', { name: '重新生成' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent/jobs/job-1/regenerate-draft')).toBe(true);
    });
    const regenerateCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/agent/jobs/job-1/regenerate-draft');
    expect(regenerateCall?.[1]?.body).toBe(JSON.stringify({ revisionNote: '请加强结论\n减少空话' }));
  });

  it('allows starting a fresh job while a generated draft is waiting for review', async () => {
    const reviewJob = {
      id: 'job-1',
      topic: '旧草稿',
      status: 'waiting_review',
      currentStep: 'review_draft',
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
      materials: [],
      paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
    };
    const newJob = { ...reviewJob, id: 'job-2', topic: '新主题', paths: { workDir: 'pipeline-output/agent/job-2' } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: reviewJob }));
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-1/draft') return Promise.resolve(jsonResponse({ markdown: '# 当前草稿' }));
      if (url === '/api/agent/jobs/job-2/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      if (url === '/api/agent/jobs' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ job: newJob }));
      }
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    fireEvent.change(screen.getByLabelText('发文主题'), { target: { value: '新主题' } });
    const startButton = screen.getByRole('button', { name: '开始发文' });
    expect(startButton).not.toBeDisabled();
    await userEvent.click(startButton);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/agent/jobs')).toBe(true);
    });
    const startCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/agent/jobs');
    expect(startCall?.[1]?.body).toBe(JSON.stringify({ topic: '新主题' }));
  });

  it('renders the Agent page as a task cockpit layout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') {
        return Promise.resolve(
          jsonResponse({
            materials: [
              {
                id: 'aihot:1',
                sourceType: 'aihot',
                title: 'OpenAI 发布新的 Agent 工具',
                summary: '面向开发者的 Agent 工作流能力更新。',
                addedAt: '2026-05-27T00:00:00.000Z'
              }
            ]
          })
        );
      }
      if (url === '/api/agent/current-job') {
        return Promise.resolve(
          jsonResponse({
            job: {
              id: 'job-1',
              topic: 'AI 内容工作流',
              status: 'waiting_review',
              currentStep: 'review_draft',
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              materials: [],
              paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
            }
          })
        );
      }
      if (url === '/api/agent/jobs/job-1/logs') {
        return Promise.resolve(
          jsonResponse({
            logs: [
              {
                at: '2026-05-27T00:00:00.000Z',
                level: 'info',
                step: 'review_draft',
                message: '等待用户确认草稿'
              }
            ]
          })
        );
      }
      if (url === '/api/agent/jobs/job-1/draft') return Promise.resolve(jsonResponse({ markdown: '# 当前草稿' }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    const { container } = render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));

    expect(await screen.findByRole('heading', { name: '公众号自动发文AGENT' })).toBeInTheDocument();
    expect(screen.queryByText('公众号流水线')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '自动发文' })).not.toBeInTheDocument();
    expect(container.querySelector('.agent-cockpit-hero')).toBeInTheDocument();
    expect(container.querySelector('.agent-timeline-card')).toBeInTheDocument();
    expect(container.querySelector('.agent-assist-rail')).toBeInTheDocument();
    expect(container.querySelector('.agent-console')).toBeInTheDocument();
  });

  it('starts an Agent job directly from collected materials without a topic', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') {
        return Promise.resolve(
          jsonResponse({
            materials: [
              {
                id: 'aihot:1',
                sourceType: 'aihot',
                title: 'OpenAI 发布新的 Agent 工具',
                summary: '面向开发者的 Agent 工作流能力更新。',
                addedAt: '2026-05-27T00:00:00.000Z'
              }
            ]
          })
        );
      }
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: null }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      if (url === '/api/agent/jobs' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            job: {
              id: 'job-1',
              topic: '根据所选素材自动拟定公众号文章主题',
              status: 'waiting_review',
              currentStep: 'review_draft',
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              materials: [],
              paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
            }
          })
        );
      }
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-1/draft') return Promise.resolve(jsonResponse({ markdown: '# 自动拟题草稿' }));
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    await screen.findByText('1 条素材');
    await userEvent.click(screen.getByRole('button', { name: '基于素材发文' }));
    await userEvent.click(screen.getByRole('button', { name: '开始发文' }));

    const jobCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/agent/jobs');
    expect(jobCall?.[1]?.body).toBe(JSON.stringify({ topic: '' }));
    expect(await screen.findAllByText('等待草稿确认')).not.toHaveLength(0);
  });

  it('uploads a local markdown file and opens it for draft review', async () => {
    const markdown = '# 本地标题\n\n正文';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: null }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      if (url === '/api/agent/jobs' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            job: {
              id: 'job-1',
              topic: '本地标题',
              sourceMode: 'markdown',
              status: 'waiting_review',
              currentStep: 'review_draft',
              createdAt: '2026-07-19T00:00:00.000Z',
              updatedAt: '2026-07-19T00:00:00.000Z',
              materials: [],
              paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
            }
          })
        );
      }
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-1/draft') return Promise.resolve(jsonResponse({ markdown }));
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    await userEvent.click(screen.getByRole('button', { name: '本地 Markdown' }));
    const file = new File([markdown], 'article.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(markdown) });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(new TextEncoder().encode(markdown).buffer)
    });
    await userEvent.upload(screen.getByLabelText('本地 Markdown 文件'), file);
    await userEvent.click(screen.getByRole('button', { name: '开始发文' }));

    const jobCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/agent/jobs');
    expect(jobCall?.[1]?.body).toBe(
      JSON.stringify({ sourceMode: 'markdown', fileName: 'article.md', markdown })
    );
    expect(await screen.findByLabelText('草稿 Markdown')).toHaveValue(markdown);
    expect(screen.getByText('导入草稿')).toBeInTheDocument();
  });

  it('locks Agent controls while reading a local markdown file', async () => {
    const markdown = '# 本地标题\n\n正文';
    let resolveRead!: (buffer: ArrayBuffer) => void;
    const readPromise = new Promise<ArrayBuffer>((resolve) => {
      resolveRead = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: null }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      if (url === '/api/agent/jobs' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            job: {
              id: 'job-1',
              topic: '本地标题',
              sourceMode: 'markdown',
              status: 'waiting_review',
              currentStep: 'review_draft',
              createdAt: '2026-07-19T00:00:00.000Z',
              updatedAt: '2026-07-19T00:00:00.000Z',
              materials: [],
              paths: { workDir: 'pipeline-output/agent/job-1', draftMarkdown: 'draft.md' }
            }
          })
        );
      }
      if (url === '/api/agent/jobs/job-1/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-1/draft') return Promise.resolve(jsonResponse({ markdown }));
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    await userEvent.click(screen.getByRole('button', { name: '本地 Markdown' }));
    const file = new File([markdown], 'article.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'arrayBuffer', { value: () => readPromise });
    await userEvent.upload(screen.getByLabelText('本地 Markdown 文件'), file);
    await userEvent.click(screen.getByRole('button', { name: '开始发文' }));

    expect(screen.getByRole('button', { name: '开始发文' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '基于主题发文' })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/agent/jobs')).toHaveLength(0);

    resolveRead(new TextEncoder().encode(markdown).buffer);
    expect(await screen.findByLabelText('草稿 Markdown')).toHaveValue(markdown);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/agent/jobs')).toHaveLength(1);
  });

  it('keeps the previous Agent job when a new draft cannot be loaded', async () => {
    const oldJob = {
      id: 'job-old',
      topic: '旧草稿',
      status: 'waiting_review',
      currentStep: 'review_draft',
      createdAt: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-19T00:00:00.000Z',
      materials: [],
      paths: { workDir: 'pipeline-output/agent/job-old', draftMarkdown: 'draft.md' }
    };
    const newJob = {
      ...oldJob,
      id: 'job-new',
      topic: '新草稿',
      sourceMode: 'markdown',
      paths: { workDir: 'pipeline-output/agent/job-new', draftMarkdown: 'draft.md' }
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: oldJob }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      if (url === '/api/agent/jobs/job-old/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-old/draft') {
        return Promise.resolve(jsonResponse({ markdown: '# 旧草稿' }));
      }
      if (url === '/api/agent/jobs' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ job: newJob }));
      }
      if (url === '/api/agent/jobs/job-new/logs') return Promise.resolve(jsonResponse({ logs: [] }));
      if (url === '/api/agent/jobs/job-new/draft') {
        return Promise.resolve(jsonResponse({ error: '草稿读取失败' }, 500));
      }
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    expect(await screen.findByLabelText('草稿 Markdown')).toHaveValue('# 旧草稿');
    await userEvent.click(screen.getByRole('button', { name: '本地 Markdown' }));
    const markdown = '# 新草稿';
    const file = new File([markdown], 'new.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(new TextEncoder().encode(markdown).buffer)
    });
    await userEvent.upload(screen.getByLabelText('本地 Markdown 文件'), file);
    await userEvent.click(screen.getByRole('button', { name: '开始发文' }));

    await screen.findByRole('heading', { name: 'Agent 操作失败' });
    expect(screen.getByText('pipeline-output/agent/job-old')).toBeInTheDocument();
    expect(screen.queryByText('pipeline-output/agent/job-new')).not.toBeInTheDocument();
    expect(screen.getByLabelText('草稿 Markdown')).toHaveValue('# 旧草稿');
  });

  it('rejects invalid local markdown files before calling the jobs endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) return Promise.resolve(jsonResponse({ items: [] }));
      if (url === '/api/agent/materials') return Promise.resolve(jsonResponse({ materials: [] }));
      if (url === '/api/agent/current-job') return Promise.resolve(jsonResponse({ job: null }));
      if (url === '/api/agent/history') return Promise.resolve(jsonResponse({ history: [] }));
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Agent 接入' }));
    await userEvent.click(screen.getByRole('button', { name: '本地 Markdown' }));
    const input = screen.getByLabelText('本地 Markdown 文件');
    const submit = screen.getByRole('button', { name: '开始发文' });
    const errorView = () => within(screen.getByRole('heading', { name: 'Agent 操作失败' }).parentElement!);

    await userEvent.click(submit);
    expect(errorView().getByText('请选择 Markdown 文件')).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File(['# 标题'], 'article.txt')] } });
    await userEvent.click(submit);
    expect(errorView().getByText('请选择 .md 或 .markdown 文件')).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File(['a'.repeat(1024 * 1024 + 1)], 'large.md')] } });
    await userEvent.click(submit);
    expect(errorView().getByText('Markdown 文件不能超过 1 MiB')).toBeInTheDocument();

    const emptyFile = new File(['   '], 'empty.md');
    Object.defineProperty(emptyFile, 'text', { value: () => Promise.resolve('   ') });
    Object.defineProperty(emptyFile, 'arrayBuffer', {
      value: () => Promise.resolve(new TextEncoder().encode('   ').buffer)
    });
    fireEvent.change(input, { target: { files: [emptyFile] } });
    await userEvent.click(submit);
    expect(errorView().getByText('Markdown 文件内容不能为空')).toBeInTheDocument();

    const invalidUtf8 = new File([new Uint8Array([0xff])], 'invalid.md');
    Object.defineProperty(invalidUtf8, 'text', { value: () => Promise.resolve('\uFFFD') });
    Object.defineProperty(invalidUtf8, 'arrayBuffer', {
      value: () => Promise.resolve(new Uint8Array([0xff]).buffer)
    });
    fireEvent.change(input, { target: { files: [invalidUtf8] } });
    await userEvent.click(submit);
    expect(errorView().getByText('Markdown 文件必须是 UTF-8 编码')).toBeInTheDocument();

    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/agent/jobs')).toHaveLength(0);
  });

  it('adds a Specific Sources post to Agent materials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) return Promise.resolve(jsonResponse({ handles: [] }));
      if (url.startsWith('/api/x/latest')) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                handle: 'OpenAI',
                displayName: 'OpenAI',
                profileUrl: 'https://x.com/OpenAI',
                latestPost: {
                  id: '123',
                  text: 'Original post',
                  translatedText: '中文动态',
                  createdAt: '2026-05-21T01:00:00.000Z',
                  url: 'https://x.com/OpenAI/status/123',
                  media: []
                }
              }
            ]
          })
        );
      }
      if (url.startsWith('/api/agent/materials')) {
        expect(init?.method).toBe('POST');
        return Promise.resolve(
          jsonResponse({
            materials: [
              {
                id: 'x:openai',
                sourceType: 'x',
                title: 'OpenAI',
                summary: '中文动态',
                addedAt: '2026-05-27T00:00:00.000Z'
              }
            ]
          })
        );
      }
      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));
    expect(await screen.findByText('中文动态')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '加入素材：OpenAI' }));

    const materialCall = fetchMock.mock.calls.find(([url]) => String(url).startsWith('/api/agent/materials'));
    expect(materialCall?.[1]?.body).toBe(
      JSON.stringify({
        sourceType: 'x',
        item: {
          handle: 'OpenAI',
          displayName: 'OpenAI',
          latestPost: {
            text: 'Original post',
            translatedText: '中文动态'
          }
        }
      })
    );
    expect(screen.getByRole('button', { name: '已加入素材：OpenAI' })).toBeDisabled();
  });

  it('prefetches Specific Sources when the app starts', async () => {
    const fetchMock = mockDefaultAppFetch();

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/x/latest'))).toBe(true);
    });
  });

  it('refreshes the selected feed when the refresh button is used', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/latest')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }

      const feedCalls = fetchMock.mock.calls.filter(([callUrl]) => String(callUrl).startsWith('/api/v1/items'));
      const title = feedCalls.length > 1 ? '刷新后的 AI 动态' : 'OpenAI 发布新的 Agent 工具';
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [{ ...itemsResponse.items[0], title }],
            page: { hasMore: false, nextCursor: null }
          }),
          { status: 200 }
        )
      );
    });

    render(<App />);

    expect(await screen.findByText('OpenAI 发布新的 Agent 工具')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '刷新' }));

    expect(await screen.findByText('刷新后的 AI 动态')).toBeInTheDocument();
    const feedCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/items'));
    expect(feedCalls).toHaveLength(2);
  });

  it('uses fresh prefetched Specific Sources when opening the page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) {
        if (init?.method === 'PUT' && typeof init.body === 'string') {
          return Promise.resolve(jsonResponse(JSON.parse(init.body)));
        }

        return Promise.resolve(jsonResponse({ handles: [] }));
      }

      if (url.startsWith('/api/x/latest')) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                handle: 'OpenAI',
                displayName: 'OpenAI',
                profileUrl: 'https://x.com/OpenAI',
                latestPost: {
                  id: '123',
                  text: '预抓发布',
                  translatedText: '预抓发布',
                  createdAt: '2026-05-21T01:00:00.000Z',
                  url: 'https://x.com/OpenAI/status/123',
                  media: []
                }
              }
            ]
          })
        );
      }

      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await waitFor(() => {
      const xCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/x/latest'));
      expect(xCalls).toHaveLength(1);
    });

    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));

    expect(await screen.findByText('预抓发布')).toBeInTheDocument();
    const xCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/x/latest'));
    expect(xCalls).toHaveLength(1);
  });

  it('uses a fresh empty Specific Sources cache when opening the page', async () => {
    const fetchMock = mockDefaultAppFetch();

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await waitFor(() => {
      const xCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/x/latest'));
      expect(xCalls).toHaveLength(1);
    });

    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));

    await waitFor(() => {
      const xCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/x/latest'));
      expect(xCalls).toHaveLength(1);
    });
  });

  it('shows all Specific Sources rows while the first source request is still loading', async () => {
    localStorage.setItem(
      'x-specific-source-handles',
      JSON.stringify(['huggingface', 'MistralAI', 'cursor_ai', 'Perplexity_AI'])
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/v1/items')) {
        return Promise.resolve(new Response(JSON.stringify(itemsResponse), { status: 200 }));
      }

      return new Promise<Response>(() => undefined);
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));

    expect(screen.getByLabelText('X 账号链接或 handle')).toBeInTheDocument();
    expect(screen.getAllByText('22 个账号').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('specific-sources-list')).getAllByTestId('specific-source-row')).toHaveLength(22);
  });

  it('keeps stored Specific Sources accounts in the request and rendered count', async () => {
    localStorage.setItem(
      'x-specific-source-handles',
      JSON.stringify(['huggingface', 'MistralAI', 'cursor_ai', 'Perplexity_AI'])
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) {
        if (init?.method === 'PUT' && typeof init.body === 'string') {
          return Promise.resolve(jsonResponse(JSON.parse(init.body)));
        }

        return Promise.resolve(jsonResponse({ handles: [] }));
      }

      if (url.startsWith('/api/v1/items')) {
        return Promise.resolve(new Response(JSON.stringify(itemsResponse), { status: 200 }));
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                handle: 'OpenAI',
                displayName: 'OpenAI',
                profileUrl: 'https://x.com/OpenAI',
                latestPost: {
                  id: '123',
                  text: 'OpenAI 最新发布',
                  translatedText: 'OpenAI 最新发布',
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
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));

    expect(await screen.findByText('OpenAI 最新发布')).toBeInTheDocument();
    expect(screen.getAllByText('22 个账号').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('specific-sources-list')).getAllByTestId('specific-source-row')).toHaveLength(22);
    const xCall = fetchMock.mock.calls.find(([url]) => String(url).startsWith('/api/x/latest'));
    expect(String(xCall?.[0])).toContain('huggingface');
    expect(String(xCall?.[0])).toContain('MistralAI');
    expect(String(xCall?.[0])).toContain('cursor_ai');
    expect(String(xCall?.[0])).toContain('Perplexity_AI');
  });

  it('refreshes stale prefetched Specific Sources when opening the page', async () => {
    let now = 0;
    let resolveRefresh: (response: Response) => void = () => undefined;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let xRequestCount = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) {
        return Promise.resolve(jsonResponse({ handles: [] }));
      }

      if (url.startsWith('/api/x/latest')) {
        xRequestCount += 1;
        if (xRequestCount === 1) {
          return Promise.resolve(
            jsonResponse({
            items: [
              {
                handle: 'OpenAI',
                displayName: 'OpenAI',
                profileUrl: 'https://x.com/OpenAI',
                latestPost: {
                  id: '123',
                  text: '旧预抓发布',
                  translatedText: '旧预抓发布',
                  createdAt: '2026-05-21T01:00:00.000Z',
                  url: 'https://x.com/OpenAI/status/123',
                  media: []
                }
              }
            ]
            })
          );
        }

        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      }

      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await waitFor(() => {
      const xCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/x/latest'));
      expect(xCalls).toHaveLength(1);
    });

    now = 5 * 60 * 1000 + 1;
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));

    expect(await screen.findByText('旧预抓发布')).toBeInTheDocument();
    resolveRefresh(
      new Response(
        JSON.stringify({
          items: [
            {
              handle: 'OpenAI',
              displayName: 'OpenAI',
              profileUrl: 'https://x.com/OpenAI',
              latestPost: {
                id: '456',
                text: '刷新后发布',
                translatedText: '刷新后发布',
                createdAt: '2026-05-21T02:00:00.000Z',
                url: 'https://x.com/OpenAI/status/456',
                media: []
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    expect(await screen.findByText('刷新后发布')).toBeInTheDocument();
    const xCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/x/latest'));
    expect(xCalls).toHaveLength(2);
  });

  it('updates query when searching', async () => {
    const fetchMock = mockDefaultAppFetch();

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.type(screen.getByLabelText('搜索 AI 动态'), 'Claude{enter}');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/items?mode=selected&by=timeline&q=Claude&limit=40'
      );
    });
  });

  it('switches category filters', async () => {
    const fetchMock = mockDefaultAppFetch();

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '论文' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/items?mode=selected&by=timeline&category=paper&limit=40'
      );
    });
  });

  it('loads the next feed page with cursor pagination', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/latest')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }

      if (url.includes('cursor=it3.next-page')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                {
                  id: '2',
                  title: 'Second item',
                  url: 'https://example.com/second',
                  source: 'Source',
                  publishedAt: '2026-05-19T01:48:00.000Z'
                }
              ],
              page: { hasMore: false, nextCursor: null }
            }),
            { status: 200 }
          )
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                id: '1',
                title: 'First item',
                url: 'https://example.com/first',
                source: 'Source',
                publishedAt: '2026-05-20T01:48:00.000Z'
              }
            ],
            page: { hasMore: true, nextCursor: 'it3.next-page' }
          }),
          { status: 200 }
        )
      );
    });

    render(<App />);

    expect(await screen.findByText('First item')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /加载更多/ }));

    expect(await screen.findByText('Second item')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/items?mode=selected&by=timeline&limit=40&cursor=it3.next-page'
    );
  });

  it('shows an error state when API fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));

    render(<App />);

    expect(await screen.findByText('信息源暂时不可用')).toBeInTheDocument();
  });

  it('replaces About with Specific Sources and loads latest X posts', async () => {
    const fetchMock = mockAppFetchWithXItems([
      {
        handle: 'OpenAI',
        displayName: 'OpenAI',
        profileUrl: 'https://x.com/OpenAI',
        latestPost: {
          id: '123',
          text: 'OpenAI 最新发布',
          createdAt: '2026-05-21T01:00:00.000Z',
          url: 'https://x.com/OpenAI/status/123'
        }
      }
    ]);

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    expect(screen.queryByRole('button', { name: '关于' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('/api/x/latest?handles='));
    });
    expect(await screen.findByText('OpenAI 最新发布')).toBeInTheDocument();
    expect(screen.getByText('@OpenAI')).toBeInTheDocument();
  });

  it('renders Specific Sources as one source per list row', async () => {
    mockAppFetchWithXItems([
      {
        handle: 'OpenAI',
        displayName: 'OpenAI',
        profileUrl: 'https://x.com/OpenAI',
        latestPost: {
          id: '123',
          text: 'OpenAI 最新发布',
          translatedText: 'OpenAI 最新发布',
          createdAt: '2026-05-21T01:00:00.000Z',
          url: 'https://x.com/OpenAI/status/123',
          media: []
        }
      },
      {
        handle: 'AnthropicAI',
        displayName: 'AnthropicAI',
        profileUrl: 'https://x.com/AnthropicAI',
        latestPost: {
          id: '456',
          text: 'Claude 更新',
          translatedText: 'Claude 更新',
          createdAt: '2026-05-21T02:00:00.000Z',
          url: 'https://x.com/AnthropicAI/status/456',
          media: []
        }
      }
    ]);

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));

    const list = await screen.findByTestId('specific-sources-list');
    const rows = within(list).getAllByTestId('specific-source-row');

    expect(list).toHaveClass('source-list');
    expect(rows).toHaveLength(18);
    expect(screen.getByText('OpenAI 最新发布')).toBeInTheDocument();
    expect(screen.getByText('Claude 更新')).toBeInTheDocument();
    for (const row of rows) {
      expect(row).toHaveClass('source-row');
    }
  });

  it('keeps Specific Sources cached when switching away and back', async () => {
    const fetchMock = mockAppFetchWithXItems([
      {
        handle: 'OpenAI',
        displayName: 'OpenAI',
        profileUrl: 'https://x.com/OpenAI',
        latestPost: {
          id: '123',
          text: 'OpenAI 最新发布',
          translatedText: 'OpenAI 最新发布',
          createdAt: '2026-05-21T01:00:00.000Z',
          url: 'https://x.com/OpenAI/status/123',
          media: []
        }
      }
    ]);

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));
    expect(await screen.findByText('OpenAI 最新发布')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '精选' }));
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));

    await waitFor(() => {
      const xCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/x/latest'));
      expect(xCalls).toHaveLength(1);
    });
  });

  it('loads the expanded Specific Sources list after importing a new account', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/v1/items')) {
        return Promise.resolve(new Response(JSON.stringify(itemsResponse), { status: 200 }));
      }

      if (url.startsWith('/api/x/latest') && !url.includes('huggingface')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                {
                  handle: 'OpenAI',
                  displayName: 'OpenAI',
                  profileUrl: 'https://x.com/OpenAI',
                  latestPost: {
                    id: '123',
                    text: 'OpenAI 旧发布',
                    translatedText: 'OpenAI 旧发布',
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
      }

      if (url.startsWith('/api/x/latest') && url.includes('huggingface')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                {
                  handle: 'huggingface',
                  displayName: 'huggingface',
                  profileUrl: 'https://x.com/huggingface',
                  latestPost: {
                    id: '999',
                    text: 'Hugging Face 新发布',
                    translatedText: 'Hugging Face 新发布',
                    createdAt: '2026-05-23T01:00:00.000Z',
                    url: 'https://x.com/huggingface/status/999',
                    media: []
                  }
                }
              ]
            }),
            { status: 200 }
          )
        );
      }

      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));
    expect(await screen.findByText('OpenAI 旧发布')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('X 账号链接或 handle'), '@huggingface{enter}');

    expect(await screen.findByText('Hugging Face 新发布')).toBeInTheDocument();
    expect(screen.getAllByText('19 个账号').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('specific-sources-list')).getAllByTestId('specific-source-row')).toHaveLength(19);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/x/latest'))).toHaveLength(2);
  });

  it('refreshes Specific Sources only when the refresh button is used', async () => {
    let xRequestCount = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url === '/api/aihot-sync/status') return Promise.resolve(jsonResponse(syncHealthResponse));
      if (url.startsWith('/api/x/handles')) {
        return Promise.resolve(jsonResponse({ handles: [] }));
      }

      if (url.startsWith('/api/x/latest')) {
        xRequestCount += 1;
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                handle: 'OpenAI',
                displayName: 'OpenAI',
                profileUrl: 'https://x.com/OpenAI',
                latestPost: {
                  id: xRequestCount > 1 ? '456' : '123',
                  text: xRequestCount > 1 ? '新发布' : '旧发布',
                  translatedText: xRequestCount > 1 ? '新发布' : '旧发布',
                  createdAt: xRequestCount > 1 ? '2026-05-21T02:00:00.000Z' : '2026-05-21T01:00:00.000Z',
                  url: `https://x.com/OpenAI/status/${xRequestCount > 1 ? '456' : '123'}`,
                  media: []
                }
              }
            ]
          })
        );
      }

      return Promise.resolve(jsonResponse(itemsResponse));
    });

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));
    expect(await screen.findByText('旧发布')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '刷新' }));

    expect(await screen.findByText('新发布')).toBeInTheDocument();
    const xCalls = fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/x/latest'));
    expect(xCalls).toHaveLength(2);
  });

  it('opens a playable video element when a Specific Source has a direct video URL', async () => {
    mockAppFetchWithXItems([
      {
        handle: 'GeminiApp',
        displayName: 'GeminiApp',
        profileUrl: 'https://x.com/GeminiApp',
        latestPost: {
          id: '2057237073397268970',
          text: 'Gemini video demo',
          translatedText: 'Gemini video demo',
          createdAt: '2026-05-21T02:00:00.000Z',
          url: 'https://x.com/GeminiApp/status/2057237073397268970',
          media: [
            {
              url: 'https://pbs.twimg.com/media/HIyLmCYaQAANv5c.jpg',
              type: 'video',
              embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=2057237073397268970',
              videoUrl: 'https://video.twimg.com/amplify_video/2057172107164024833/pl/UPl1AOIhr4G-JCQi.m3u8'
            }
          ]
        }
      }
    ]);

    const { container } = render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));
    await screen.findByText('Gemini video demo');
    await userEvent.click(container.querySelector('.source-media-button') as HTMLElement);

    expect(container.querySelector('video.player-video')).toBeInTheDocument();
    expect(container.querySelector('iframe.player-frame')).not.toBeInTheDocument();
  });

  it('renders Specific Sources media through the image proxy', async () => {
    mockAppFetchWithXItems([
      {
        handle: 'OpenAI',
        displayName: 'OpenAI',
        profileUrl: 'https://x.com/OpenAI',
        latestPost: {
          id: '123',
          text: 'OpenAI media post',
          translatedText: 'OpenAI media post',
          createdAt: '2026-05-21T02:00:00.000Z',
          url: 'https://x.com/OpenAI/status/123',
          media: [
            {
              url: 'https://pbs.twimg.com/card_img/123/demo?format=jpg&name=800x419',
              type: 'photo'
            }
          ]
        }
      }
    ]);

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));

    expect(await screen.findByAltText('OpenAI 发布媒体')).toHaveAttribute(
      'src',
      'https://pbs.twimg.com/card_img/123/demo?format=jpg&name=800x419'
    );
  });

  it('opens an image preview when clicking Specific Sources photo media', async () => {
    mockAppFetchWithXItems([
      {
        handle: 'OpenAI',
        displayName: 'OpenAI',
        profileUrl: 'https://x.com/OpenAI',
        latestPost: {
          id: '123',
          text: 'OpenAI media post',
          translatedText: 'OpenAI media post',
          createdAt: '2026-05-21T02:00:00.000Z',
          url: 'https://x.com/OpenAI/status/123',
          media: [
            {
              url: 'https://pbs.twimg.com/card_img/123/demo?format=jpg&name=800x419',
              type: 'photo'
            }
          ]
        }
      }
    ]);

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));

    await screen.findByAltText('OpenAI 发布媒体');
    await userEvent.click(screen.getByRole('button', { name: '查看图片：OpenAI' }));

    expect(screen.getByRole('dialog', { name: 'OpenAI 图片预览' })).toBeInTheDocument();
    expect(screen.getByAltText('OpenAI 图片预览')).toHaveAttribute(
      'src',
      'https://pbs.twimg.com/card_img/123/demo?format=jpg&name=800x419'
    );
    expect(screen.getByAltText('OpenAI 发布媒体').closest('a')).toBeNull();
  });

  it('keeps the poster visible while a Specific Sources video is loading', async () => {
    mockAppFetchWithXItems([
      {
        handle: 'GeminiApp',
        displayName: 'GeminiApp',
        profileUrl: 'https://x.com/GeminiApp',
        latestPost: {
          id: '2057237073397268970',
          text: 'Gemini video demo',
          translatedText: 'Gemini video demo',
          createdAt: '2026-05-21T02:00:00.000Z',
          url: 'https://x.com/GeminiApp/status/2057237073397268970',
          media: [
            {
              url: 'https://pbs.twimg.com/media/HIyLmCYaQAANv5c.jpg',
              type: 'video',
              videoUrl: 'https://video.twimg.com/amplify_video/2057172107164024833/pl/UPl1AOIhr4G-JCQi.m3u8'
            }
          ]
        }
      }
    ]);

    render(<App />);

    await screen.findByText('OpenAI 发布新的 Agent 工具');
    await userEvent.click(screen.getByRole('button', { name: '特定来源' }));
    await screen.findByText('Gemini video demo');
    await userEvent.click(screen.getByRole('button', { name: '播放视频：GeminiApp' }));

    expect(screen.getByAltText('Gemini video demo 视频封面')).toHaveAttribute(
      'src',
      'https://pbs.twimg.com/media/HIyLmCYaQAANv5c.jpg'
    );

    fireEvent.loadedData(screen.getAllByLabelText('Gemini video demo')[1]);

    expect(screen.queryByAltText('Gemini video demo 视频封面')).not.toBeInTheDocument();
  });
});
