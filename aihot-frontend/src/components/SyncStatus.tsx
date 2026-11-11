import { useEffect } from 'react';
import { StatusView } from './StatusView';

export interface FeatureState { loading: boolean; error: string | null }

export function SyncStatus({ loading, error, syncedAt, onStateChange }: FeatureState & {
  syncedAt?: number;
  onStateChange?: (state: FeatureState) => void;
}) {
  useEffect(() => { onStateChange?.({ loading, error }); }, [loading, error, onStateChange]);
  return (
    <>
      <div className="sync-status" role="status">
        <span>{syncedAt ? `最近同步 ${new Date(syncedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '正在连接 AIHOT'}{loading && syncedAt ? ' · 正在检查更新' : ''}</span>
      </div>
      {error ? <StatusView title={syncedAt ? '同步失败，正在显示上次数据' : '暂时无法同步'} detail={error} /> : null}
      {loading && !syncedAt ? <StatusView title="正在同步" detail="正在读取 AIHOT 最新数据。" /> : null}
    </>
  );
}
