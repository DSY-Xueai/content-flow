import { useState } from 'react';
import type { ResetEvent, ResetsData } from '../api/features';
import { useRemoteResource } from '../lib/useRemoteResource';
import { formatBeijingTime } from '../lib/time';
import { StatusView } from './StatusView';
import { SyncStatus, type FeatureState } from './SyncStatus';

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
export function beijingDay(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return dayFormatter.format(new Date(value));
}
export function resetDay(event: ResetEvent) {
  return event.occurredOn ?? beijingDay(event.confirmedAt ?? event.estimate?.from ?? event.schedule?.from ?? event.createdAt);
}
export function resetStatus(event: ResetEvent) {
  if (event.status === 'confirmed') return event.confirmationBasis === 'receipt_review' ? '已核验' : '原帖已确认';
  return ({ announced: '已宣布，等待生效', in_progress: '预计正在生效', confirmed: '等待原帖确认', expired_unconfirmed: '预计窗口已过，尚未确认', likely_completed: '推测已完成，尚未确认' })[event.presentation?.status ?? 'announced'] ?? '状态待核验';
}

function ResetRecord({ event }: { event: ResetEvent }) {
  return <article className="reset-record">
    <div className="reset-record-heading"><span className={`reset-kind ${event.type}`}>{event.type === 'reset_credit' ? '发重置卡' : '额度重置'}</span><span className={`reset-state ${event.status}`}>{resetStatus(event)}</span></div>
    <h3>{event.status === 'confirmed' ? event.title : event.type === 'reset_credit' ? '重置卡发放预告（尚未确认）' : '额度重置预告（尚未确认）'}</h3>
    <p className="reset-scope">{event.presentation?.scopeLabel || event.scope || '适用范围未说明'}</p>
    {event.confirmedAt ? <p className="data-timestamp">确认记录时间 {formatBeijingTime(event.confirmedAt)}，不代表精确到账时间。</p> : null}
    {event.estimate ? <p className="reset-estimate">{event.estimate.label}<small>{event.estimate.reason}；这是预计时间，并非到账确认。</small></p> : null}
    {event.schedule ? <details><summary>原始预告时间</summary><p>{event.schedule.label}</p></details> : null}
    {event.posts.map((post) => <section className="reset-post" key={post.id}><div><strong>Tibo · @thsottiaux</strong><span>{post.stage} · {formatBeijingTime(post.publishedAt)}</span></div><blockquote>{post.fullText || post.text || post.originalText}</blockquote><details><summary>英文原文</summary><blockquote lang="en">{post.fullOriginalText || post.originalText}</blockquote></details><a href={post.url} target="_blank" rel="noreferrer">在 X 查看原帖 ↗</a></section>)}
  </article>;
}

export function ResetsPanel({ refreshKey, onStateChange }: { refreshKey: number; onStateChange: (state: FeatureState) => void }) {
  const state = useRemoteResource<ResetsData>('/api/v1/codex-resets', refreshKey);
  const raw = state.resource?.data;
  const data = raw && Array.isArray(raw.events) ? raw : null;
  const today = data?.today ?? beijingDay(new Date().toISOString())!;
  const [selected, setSelected] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [kind, setKind] = useState('all');
  const activeDay = selected ?? today;
  const activeMonth = month ?? today.slice(0, 7);
  const [year, monthNumber] = activeMonth.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - (first.getUTCDay() + 6) % 7);
  const calendar = Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setUTCDate(start.getUTCDate() + index); return date.toISOString().slice(0, 10); });
  const events = data?.events ?? [];
  const filtered = events.filter((event) => kind === 'all' || event.type === kind);
  const eventsByDay = new Map<string, ResetEvent[]>();
  for (const event of filtered) {
    const day = resetDay(event);
    if (!day) continue;
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day)!.push(event);
  }
  const dayEvents = eventsByDay.get(activeDay) ?? [];
  const cutoff = Date.parse(`${today}T00:00:00+08:00`) - 89 * 86400000;
  const recent = events.filter((event) => (event.status === 'confirmed' || event.presentation?.status === 'likely_completed') && resetDay(event) && Date.parse(`${resetDay(event)}T00:00:00+08:00`) >= cutoff);
  const resetDays = [...new Set(recent.filter((event) => event.type === 'direct_reset').map(resetDay))].filter((day): day is string => day !== null).sort();
  const intervals = resetDays.slice(1).map((day, index) => (Date.parse(day) - Date.parse(resetDays[index])) / 86400000).sort((a, b) => a - b);
  const median = intervals.length ? intervals.length % 2 ? intervals[Math.floor(intervals.length / 2)] : (intervals[intervals.length / 2 - 1] + intervals[intervals.length / 2]) / 2 : null;
  const pending = events.filter((event) => event.status !== 'confirmed' && event.presentation?.status !== 'likely_completed').sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt ?? '') - Date.parse(a.updatedAt ?? a.createdAt ?? ''));
  const confirmed = events.filter((event) => event.status === 'confirmed').sort((a, b) => Date.parse(b.confirmedAt ?? b.createdAt ?? '') - Date.parse(a.confirmedAt ?? a.createdAt ?? ''));
  const moveMonth = (offset: number) => setMonth(new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7));
  return <div className="resets-panel">
    <SyncStatus loading={state.loading} error={state.error ?? (raw && !data ? 'AIHOT 重置数据格式发生变化，请稍后重试' : null)} syncedAt={state.resource?.syncedAt} onStateChange={onStateChange} />
    <p className="feature-note">全部为北京时间（UTC+8）。跟踪 Tibo 的公开消息，每 10 分钟检查更新；不读取个人用量，也不预测尚未宣布的重置。</p>
    {data ? <>
      {data.outage && !data.outage.recoveredAt ? <div className="feature-warning" role="status"><strong>服务异常提示</strong><p>{data.outage.text || data.outage.originalText}</p><a href={data.outage.url} target="_blank" rel="noreferrer">查看消息来源 ↗</a></div> : null}
      <section className="reset-current"><h2>{pending.length ? '已宣布的重置与发卡' : '当前没有等待生效的重置'}</h2>
        {pending.length ? pending.map((event) => <ResetRecord event={event} key={event.id} />) : confirmed[0] ? <><p>最近确认：{confirmed[0].type === 'reset_credit' ? '重置卡发放' : '额度重置'} · {formatBeijingTime(confirmed[0].confirmedAt)}</p><ResetRecord event={confirmed[0]} /></> : <p>暂未收录可确认的事件。</p>}
      </section>
      <div className="reset-statistics"><div><span>近 90 天额度重置记录</span><strong>{recent.filter((event) => event.type === 'direct_reset').length} 次</strong></div><div><span>近 90 天发重置卡记录</span><strong>{recent.filter((event) => event.type === 'reset_credit').length} 次</strong></div><div><span>重置间隔中位数</span><strong>{median === null ? '记录不足' : `${Number(median.toFixed(1))} 天`}</strong></div><div><span>上次额度重置记录</span><strong>{resetDays.at(-1) ?? '暂无记录'}</strong></div></div>
      {recent.some((event) => event.presentation?.status === 'likely_completed') ? <p className="feature-note">统计与 AIHOT 的历史分类一致，包含 {recent.filter((event) => event.presentation?.status === 'likely_completed').length} 条推测完成、尚无确认原帖的记录；每条记录的依据可在日历中查看。</p> : null}
      <section className="reset-calendar-section"><div className="section-title"><h2>重置日历</h2><button type="button" className="ghost-button" onClick={() => { const date = filtered.map(resetDay).filter((day): day is string => day !== null).sort().at(-1) ?? today; setSelected(date); setMonth(date.slice(0, 7)); }}>最近记录</button></div>
        <div className="feature-tabs" role="group" aria-label="重置类型">{[['all', '全部记录'], ['direct_reset', '额度重置'], ['reset_credit', '发重置卡']].map(([key, label]) => <button key={key} type="button" aria-pressed={kind === key} onClick={() => setKind(key)}>{label}</button>)}</div>
        <div className="calendar-heading"><button className="ghost-button" aria-label="上个月" type="button" onClick={() => moveMonth(-1)}>←</button><h3>{year} 年 {monthNumber} 月</h3><button className="ghost-button" aria-label="下个月" type="button" onClick={() => moveMonth(1)}>→</button></div>
        <div className="reset-calendar" role="group" aria-label="重置事件日历">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span className="weekday" key={day}>{day}</span>)}{calendar.map((day) => {
          const records = eventsByDay.get(day) ?? [];
          return <button type="button" key={day} className={`${day.slice(0, 7) !== activeMonth ? 'other-month' : ''}${day === today ? ' today' : ''}`} aria-pressed={activeDay === day} aria-label={`${day}，${records.length} 条记录`} onClick={() => setSelected(day)}><span>{Number(day.slice(8))}</span><span className="calendar-marks">{records.some((event) => event.type === 'direct_reset') ? <i className="direct_reset" title="额度重置" /> : null}{records.some((event) => event.type === 'reset_credit') ? <i className="reset_credit" title="发重置卡" /> : null}{records.some((event) => event.status !== 'confirmed') ? <i className="announced" title="已宣布，尚未确认" /> : null}</span></button>;
        })}</div>
        <p className="calendar-legend"><span>● 额度重置</span><span>● 发重置卡</span><span>○ 已宣布，尚未确认</span></p>
      </section>
      <section className="reset-day-details" aria-label="选中日期记录"><h2>{activeDay}{activeDay === today ? ' · 今天' : ''}</h2><p className="data-timestamp">{dayEvents.length} 条记录，日期优先使用已核验发生日，否则使用确认帖／预告日期。</p>{dayEvents.length ? dayEvents.map((event) => <ResetRecord event={event} key={event.id} />) : <StatusView title="这一天没有记录" detail="选择日历上有标记的日期查看事件与原帖。" />}</section>
      <details className="ranking-rules"><summary>来源与时间规则</summary><p>确认帖时间不是个人账户精确到账时间。重置卡发放与额度重置分开记录，发卡不代表额度已恢复；预计时间不是来源确认。</p><a href="https://aihot.news/codex-reset" target="_blank" rel="noreferrer">查看 AIHOT 监控页面 ↗</a></details>
      <section className="monitor-status"><h2>监控状态：{({ healthy: '正常', delayed: '检查延迟', attention: '需要复核', unknown: '未知' })[data.monitor?.status ?? 'unknown']}</h2><dl><div><dt>上次尝试读取</dt><dd>{formatBeijingTime(data.monitor?.lastAttemptAt)}</dd></div><div><dt>上次读到帖子</dt><dd>{formatBeijingTime(data.monitor?.lastCollectedAt)}</dd></div><div><dt>上次完整检查</dt><dd>{formatBeijingTime(data.monitor?.lastVerifiedAt ?? data.checkedAt)}</dd></div></dl><p className="feature-note">AIHOT 整理，非 OpenAI 官方页面。个人额度和重置卡余额请在 Codex 内查看。</p></section>
    </> : null}
  </div>;
}
