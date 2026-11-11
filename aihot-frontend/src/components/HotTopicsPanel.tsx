import { Bookmark, Check, Plus } from 'lucide-react';
import type { AihotItem } from '../api/aihot';
import type { HotTopicsData } from '../api/features';
import { useRemoteResource } from '../lib/useRemoteResource';
import { formatBeijingTime } from '../lib/time';
import { StatusView } from './StatusView';
import { SyncStatus, type FeatureState } from './SyncStatus';

export function HotTopicsPanel({ refreshKey, materialIds, bookmarkIds, onAddMaterial, onToggleBookmark, onStateChange }: {
  refreshKey: number;
  materialIds: Set<string>;
  bookmarkIds: Set<string>;
  onAddMaterial: (item: AihotItem) => void;
  onToggleBookmark: (item: AihotItem) => void;
  onStateChange: (state: FeatureState) => void;
}) {
  const state = useRemoteResource<HotTopicsData>('/api/v1/hot-topics', refreshKey);
  const data = state.resource?.data;
  return (
    <div className="hot-topics-panel">
      <SyncStatus loading={state.loading} error={state.error} syncedAt={state.resource?.syncedAt} onStateChange={onStateChange} />
      <div className="hot-topics-heading">
        <span>{data ? `当前 ${data.count} 个热点` : 'AIHOT Top 10'}</span>
      </div>
      {data?.items.length ? <ol className="hot-topics-list" aria-label="AIHOT 热点排名">
        {data.items.map((topic) => {
          const item: AihotItem = { id: topic.id, title: topic.title, source: topic.source.name, url: topic.links.aihot };
          const added = materialIds.has(`aihot:${topic.id}`);
          const bookmarked = bookmarkIds.has(topic.id);
          return <li key={topic.id}>
            <span className={`hot-topic-rank${topic.rank <= 3 ? ' top-three' : ''}`} aria-label={`第 ${topic.rank} 名`}>{String(topic.rank).padStart(2, '0')}</span>
            <article className="hot-topic-content">
              <h2><a href={topic.links.story ?? topic.links.aihot} target="_blank" rel="noreferrer">{topic.title}</a></h2>
              <div className="hot-topic-meta">
                <span>{topic.sourceCount} 个报道来源</span>
                {topic.participantCount !== undefined ? <span>{topic.participantCount} 位讨论参与者</span> : null}
                <span>最近报道 <time dateTime={topic.latestAt}>{formatBeijingTime(topic.latestAt)}</time></span>
              </div>
              <p className="hot-topic-sources">{topic.sourceNames.join(' · ') || topic.source.name}</p>
              <div className="hot-topic-actions">
                <a href={topic.links.original} target="_blank" rel="noreferrer">原文 ↗</a>
                <button className="bookmark-action" type="button" aria-pressed={bookmarked} aria-label={`${bookmarked ? '取消收藏' : '收藏'}：${topic.title}`} onClick={() => onToggleBookmark(item)}>
                  <Bookmark size={14} fill={bookmarked ? 'currentColor' : 'none'} />{bookmarked ? '已收藏' : '收藏'}
                </button>
                <button className="material-action" type="button" disabled={added} aria-label={`${added ? '已加入素材' : '加入素材'}：${topic.title}`} onClick={() => onAddMaterial(item)}>
                  {added ? <Check size={15} /> : <Plus size={15} />}{added ? '已加入' : '加入素材'}
                </button>
              </div>
            </article>
          </li>;
        })}
      </ol> : data ? <StatusView title="暂无热点" detail="AIHOT 当前没有可展示的热点，榜单更新后会自动同步。" /> : null}
    </div>
  );
}
