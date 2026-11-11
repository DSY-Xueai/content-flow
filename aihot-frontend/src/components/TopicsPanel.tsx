import { useState } from 'react';
import type { AihotItem } from '../api/aihot';
import { normalizeSiteItem, siteAsset, type TopicData, type TopicsData } from '../api/features';
import { useRemoteResource } from '../lib/useRemoteResource';
import { formatBeijingTime } from '../lib/time';
import { FeedTimeline } from './FeedTimeline';
import { StatusView } from './StatusView';
import { SyncStatus, type FeatureState } from './SyncStatus';

export function TopicsPanel({ refreshKey, materialIds, bookmarkIds, onAddMaterial, onToggleBookmark, onStateChange }: {
  refreshKey: number;
  materialIds: Set<string>;
  bookmarkIds: Set<string>;
  onAddMaterial: (item: AihotItem) => void;
  onToggleBookmark: (item: AihotItem) => void;
  onStateChange: (state: FeatureState) => void;
}) {
  const [slug, setSlug] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');
  const state = useRemoteResource<TopicsData | TopicData>(slug ? `/api/site/topics/${encodeURIComponent(slug)}?page=${page}` : '/api/site/topics', refreshKey);
  const data = state.resource?.data;
  const list = data && typeof data === 'object' && 'topics' in data && Array.isArray(data.topics) && Array.isArray(data.groups) ? data : null;
  const detail = data && typeof data === 'object' && 'topic' in data && Array.isArray(data.items) ? data : null;
  const error = state.error ?? (data && !list && !detail ? 'AIHOT 主题数据格式发生变化，请稍后重试' : null);
  const filtered = list?.topics.filter((topic) => (group === 'all' || topic.group === group) && `${topic.name} ${topic.definition}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  return (
    <div className="topics-panel">
      <SyncStatus loading={state.loading} error={error} syncedAt={state.resource?.syncedAt} onStateChange={onStateChange} />
      {list && !slug ? <>
        <div className="feature-toolbar">
          <div className="feature-tabs" role="group" aria-label="主题分类">
            {[{ key: 'all', name: '全部主题' }, ...list.groups].map((entry) => <button key={entry.key} type="button" aria-pressed={group === entry.key} onClick={() => setGroup(entry.key)}>{entry.name}</button>)}
          </div>
          <label className="feature-search">搜索主题<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="公司、技术方向、内容类型" /></label>
        </div>
        {list.groups.filter((entry) => group === 'all' || group === entry.key).map((entry) => {
          const topics = filtered.filter((topic) => topic.group === entry.key);
          return topics.length ? <section className="topic-group" key={entry.key}>
            <div className="section-title"><h2>{entry.name}</h2><span>{entry.blurb}</span></div>
            <div className="topic-grid">{topics.map((topic) => <button className="topic-card" type="button" key={topic.slug} onClick={() => { setPage(1); setSlug(topic.slug); }}>
              <span className="topic-card-title"><span className="topic-brand" aria-hidden="true">{topic.brand?.monogram ?? topic.name.slice(0, 1)}{topic.brand?.src ? <img src={siteAsset(topic.brand.src)} alt="" referrerPolicy="no-referrer" loading="lazy" onLoad={(event) => { event.currentTarget.style.opacity = '1'; }} onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}</span><strong>{topic.name}</strong></span>
              <span className="topic-definition">{topic.definition}</span>
              {topic.latest ? <span className="topic-latest">{topic.latest.title}</span> : null}
              <span className="topic-count">近 30 天 {topic.recent} 条精选 <span>查看主题 ↗</span></span>
            </button>)}</div>
          </section> : null;
        })}
        {!filtered.length ? <StatusView title="没有匹配的主题" detail="试试其他关键词或分类。" /> : null}
      </> : null}
      {slug ? <button className="ghost-button" type="button" onClick={() => { setSlug(null); setPage(1); }}>← 全部主题</button> : null}
      {slug && detail ? <>
        <section className="topic-intro">
          <h2>{detail.topic.name}</h2><p>{detail.topic.definition}</p>
          <span>{detail.topic.total} 条精选 · 近 30 天 {detail.topic.recent} 条{detail.topic.latest ? ` · 最近更新 ${formatBeijingTime(detail.topic.latest.at)}` : ''}</span>
        </section>
        {detail.modules?.chronicle?.milestones?.length ? <details className="topic-milestones"><summary>大事记 · {detail.modules.chronicle.milestones.length} 个节点</summary>
          <ol>{detail.modules.chronicle.milestones.map((entry, index) => <li key={`${entry.date}-${index}`}><time>{entry.date}</time><div>{entry.href ? <a href={siteAsset(entry.href)} target="_blank" rel="noreferrer">{entry.title} ↗</a> : <strong>{entry.title}</strong>}{entry.summary ? <p>{entry.summary}</p> : null}</div></li>)}</ol>
        </details> : null}
        {detail.items.length ? <FeedTimeline items={detail.items.map(normalizeSiteItem)} materialIds={materialIds} onAddMaterial={onAddMaterial} bookmarkIds={bookmarkIds} onToggleBookmark={onToggleBookmark} /> : <StatusView title="这个主题暂无精选" />}
        <div className="pagination" aria-label="主题分页"><button className="ghost-button" type="button" disabled={page <= 1 || state.loading} onClick={() => setPage((current) => current - 1)}>上一页</button><span>第 {detail.page} / {detail.pageCount || 1} 页</span><button className="ghost-button" type="button" disabled={page >= detail.pageCount || state.loading} onClick={() => setPage((current) => current + 1)}>下一页</button></div>
      </> : null}
    </div>
  );
}
