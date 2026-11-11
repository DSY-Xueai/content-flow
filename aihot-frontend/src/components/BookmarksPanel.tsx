import { useState } from 'react';
import type { AihotItem } from '../api/aihot';
import type { Bookmark } from '../lib/bookmarks';
import { FeedTimeline } from './FeedTimeline';
import { StatusView } from './StatusView';

export function BookmarksPanel({ bookmarks, materialIds, onAddMaterial, onToggleBookmark, onImport }: {
  bookmarks: Bookmark[];
  materialIds: Set<string>;
  onAddMaterial: (item: AihotItem) => void;
  onToggleBookmark: (item: AihotItem) => void;
  onImport: (text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const filtered = bookmarks.filter(({ item }) => `${item.title} ${item.summary ?? ''} ${item.source}`.toLowerCase().includes(query.trim().toLowerCase()));
  const exportBackup = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), bookmarks }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `paixiaoxin-bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="bookmarks-panel">
      <div className="feature-toolbar">
        <label className="feature-search">搜索收藏<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、摘要或来源" /></label>
        <button className="ghost-button" type="button" onClick={exportBackup} disabled={!bookmarks.length}>导出收藏</button>
        <label className="file-control">导入收藏<input aria-label="导入收藏文件" type="file" accept=".json,application/json" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) { setError('收藏备份不能超过 5MB'); return; }
          const reader = new FileReader();
          reader.onload = () => { setError(null); onImport(String(reader.result)); };
          reader.onerror = () => setError('文件读取失败，原收藏未修改');
          reader.readAsText(file);
        }} /></label>
      </div>
      <p className="feature-note">标题、摘要和来源链接保存在当前浏览器，保留保存时的文字快照；清除浏览器数据前请导出备份。与 AIHOT 网站上的收藏相互独立。</p>
      {error ? <StatusView title="导入失败" detail={error} /> : null}
      <p className="collection-count">{filtered.length} 条收藏{bookmarks.length !== filtered.length ? ` · 共 ${bookmarks.length} 条` : ''}</p>
      {filtered.length ? <FeedTimeline items={filtered.map((entry) => entry.item)} materialIds={materialIds} onAddMaterial={onAddMaterial} bookmarkIds={new Set(bookmarks.map((entry) => entry.item.id))} onToggleBookmark={onToggleBookmark} /> : <StatusView title={bookmarks.length ? '没有匹配的收藏' : '还没有收藏'} detail="在资讯卡片上点击收藏，即可在这里保存和查找。" />}
    </div>
  );
}
