import type { AihotItem } from '../api/aihot';
import { formatBeijingTime } from '../lib/time';
import { NewsCard } from './NewsCard';

const dayFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric'
});
const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', weekday: 'long'
});

export function FeedTimeline({ items, materialIds, onAddMaterial, bookmarkIds, onToggleBookmark }: {
  items: AihotItem[];
  materialIds: Set<string>;
  onAddMaterial: (item: AihotItem) => void;
  bookmarkIds?: Set<string>;
  onToggleBookmark?: (item: AihotItem) => void;
}) {
  const days = new Map<string, { weekday: string; items: AihotItem[] }>();
  for (const item of items) {
    const time = item.discoveredAt ?? item.publishedAt;
    const date = time ? new Date(time) : null;
    const known = date && !Number.isNaN(date.getTime());
    const label = known ? dayFormatter.format(date) : '时间未知';
    if (!days.has(label)) days.set(label, { weekday: known ? weekdayFormatter.format(date) : '', items: [] });
    days.get(label)!.items.push(item);
  }

  return (
    <div className="feed-list">
      {[...days].map(([label, day]) => (
        <section className="timeline-day" aria-label={label} key={label}>
          <div className="day-heading">
            <h2>{label}</h2>
            <span>{day.weekday}{day.weekday ? ' · ' : ''}{day.items.length} 条</span>
          </div>
          <ol className="timeline-items">
            {day.items.map((item) => (
              <li className="timeline-entry" key={item.id}>
                <time className="timeline-time" dateTime={item.discoveredAt ?? item.publishedAt ?? undefined} title={`原文发布时间：${formatBeijingTime(item.publishedAt)}`}>
                  {formatBeijingTime(item.discoveredAt ?? item.publishedAt).split(' ').at(-1)}
                </time>
                <NewsCard item={item} materialAdded={materialIds.has(`aihot:${item.id}`)} onAddMaterial={onAddMaterial} bookmarked={bookmarkIds?.has(item.id)} onToggleBookmark={onToggleBookmark} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
