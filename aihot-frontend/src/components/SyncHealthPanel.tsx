import type { SyncHealth } from '../api/sync';
import { useRemoteResource } from '../lib/useRemoteResource';

export function SyncHealthPanel({ refreshKey }: { refreshKey: number }) {
  const state = useRemoteResource<SyncHealth>('/api/aihot-sync/status', refreshKey, 0);
  const data = state.resource?.data;
  const health = data && Array.isArray(data.resources) && data.cache ? data : null;
  const issues = health?.resources.filter((entry) => entry.error || entry.warning) ?? [];
  const waiting = health?.resources.some((entry) => !entry.lastSuccessAt);
  const error = state.error ?? (data && !health ? '同步状态格式不正确，请重启本地服务后检查' : null);
  const abnormal = Boolean(error || health?.cache.error || issues.length);
  const status = abnormal ? 'error' : !health || waiting ? 'loading' : 'ok';
  const detail = error || health?.cache.error || issues.map((entry) => `${entry.name}：${entry.error ?? entry.warning}`).join('\n');
  return <div className={`sync-health ${status}`} role="status" aria-label="后台同步状态" title={detail || undefined}>
    <span className="sync-health-dot" aria-hidden="true" />
    <span>同步状态：{status === 'error' ? '异常' : status === 'loading' ? '同步中' : '正常'}</span>
  </div>;
}
