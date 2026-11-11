import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncHealthPanel } from './SyncHealthPanel';
import type { SyncHealth } from '../api/sync';

const health: SyncHealth = {
  resources: [{ name: '热点榜', path: '/api/v1/hot-topics', lastAttemptAt: 1000000, lastSuccessAt: 900000, nextAttemptAt: 1060000, consecutiveFailures: 2, error: 'items[0].title 缺失', lastFailureAt: 1000000, lastFailure: 'items[0].title 缺失', warning: null, cached: true }],
  cache: { bytes: 10240, limitBytes: 5242880, diskBudgetBytes: 10485760, error: null }
};
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('SyncHealthPanel', () => {
  it('shows a compact error indicator and returns to normal after recovery', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(health))).mockResolvedValueOnce(new Response(JSON.stringify({ ...health, resources: [{ ...health.resources[0], error: null, consecutiveFailures: 0, lastSuccessAt: 1060000 }] })));
    const { container, unmount } = render(<SyncHealthPanel refreshKey={0} />);
    await act(async () => {});
    expect(screen.getByText('同步状态：异常')).toBeVisible();
    expect(screen.getByLabelText('后台同步状态')).toHaveClass('error');
    expect(screen.getByLabelText('后台同步状态')).toHaveAttribute('title', '热点榜：items[0].title 缺失');
    expect(container.querySelector('details')).not.toBeInTheDocument();
    expect(screen.queryByText('查看各接口最近检查结果')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(screen.getByText('同步状态：正常')).toBeVisible();
    expect(screen.getByLabelText('后台同步状态')).toHaveClass('ok');
    expect(screen.getByLabelText('后台同步状态')).not.toHaveAttribute('title');
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows a local-service failure instead of presenting old health as current', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'));
    render(<SyncHealthPanel refreshKey={0} />);
    expect(await screen.findByText('同步状态：异常')).toBeVisible();
    expect(screen.getByLabelText('后台同步状态')).toHaveClass('error');
    expect(screen.getByLabelText('后台同步状态')).toHaveAttribute('title', 'Failed to fetch');
  });
});
