import { useEffect, useState } from 'react';
import type { AihotItem } from '../api/aihot';

export interface Bookmark { item: AihotItem; savedAt: string }
const STORAGE_KEY = 'paixiaoxin.bookmarks';

export function parseBookmarks(value: unknown): Bookmark[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('收藏格式不正确，最多支持 500 条收藏');
  const items = new Map<string, Bookmark>();
  for (const record of value) {
    if (!record || typeof record !== 'object' || typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt)) ||
      !record.item || typeof record.item.id !== 'string' || typeof record.item.title !== 'string' || typeof record.item.source !== 'string' ||
      typeof record.item.url !== 'string' || !/^https?:\/\//i.test(record.item.url) ||
      (record.item.summary != null && typeof record.item.summary !== 'string')) throw new Error('收藏记录不完整或包含不安全的链接');
    items.set(record.item.id, {
      item: {
        id: record.item.id, title: record.item.title, source: record.item.source, url: record.item.url,
        summary: record.item.summary, publishedAt: typeof record.item.publishedAt === 'string' ? record.item.publishedAt : null,
        discoveredAt: typeof record.item.discoveredAt === 'string' ? record.item.discoveredAt : null,
        category: typeof record.item.category === 'string' ? record.item.category : null,
        score: typeof record.item.score === 'number' && Number.isFinite(record.item.score) ? record.item.score : null,
        reason: typeof record.item.reason === 'string' ? record.item.reason : null
      },
      savedAt: record.savedAt
    });
  }
  return [...items.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

export function useBookmarks() {
  const [state, setState] = useState<{ items: Bookmark[]; notice: string | null }>(() => {
    try { return { items: parseBookmarks(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')), notice: null }; }
    catch { return { items: [], notice: '本地收藏无法读取。原存储尚未覆盖，可先检查浏览器存储或导入备份。' }; }
  });
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      try { setState({ items: parseBookmarks(JSON.parse(event.newValue ?? '[]')), notice: null }); }
      catch { setState((old) => ({ ...old, notice: '其他页面的收藏数据无法读取，请检查备份文件。' })); }
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);

  const save = (items: Bookmark[], notice: string | null = null) => {
    try {
      if (items.length > 500) throw new Error('收藏已达到 500 条，请先导出备份或取消部分收藏');
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      setState({ items, notice });
    } catch (error) {
      setState((old) => ({ ...old, notice: error instanceof Error && error.message.includes('500') ? error.message : '浏览器存储不可用或已满，收藏未保存。请先导出备份。' }));
    }
  };
  return {
    ...state,
    dismissNotice: () => setState((old) => ({ ...old, notice: null })),
    toggle: (item: AihotItem) => {
      try {
        save(state.items.some((entry) => entry.item.id === item.id)
          ? state.items.filter((entry) => entry.item.id !== item.id)
          : [...parseBookmarks([{ item, savedAt: new Date().toISOString() }]), ...state.items]);
      } catch { setState((old) => ({ ...old, notice: '内容字段不完整或链接不可用，未保存收藏。' })); }
    },
    importBackup: (text: string) => {
      try {
        const backup = JSON.parse(text);
        if (!backup || typeof backup !== 'object' || backup.version !== 1) throw new Error('不支持此收藏备份格式或版本');
        const imported = parseBookmarks(backup.bookmarks);
        const merged = new Map([...imported, ...state.items].map((record) => [record.item.id, record]));
        save([...merged.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt)), `已导入 ${merged.size - state.items.length} 条新收藏`);
      } catch (error) { setState((old) => ({ ...old, notice: error instanceof SyntaxError ? '备份文件不是有效 JSON，原收藏未修改' : error instanceof Error ? error.message : '导入失败，原收藏未修改' })); }
    }
  };
}
