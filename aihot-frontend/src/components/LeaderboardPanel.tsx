import { useEffect, useState } from 'react';
import type { BoardEntry, LeaderboardData, ModelInfo } from '../api/features';
import { useRemoteResource } from '../lib/useRemoteResource';
import { formatBeijingTime } from '../lib/time';
import { StatusView } from './StatusView';
import { SyncStatus, type FeatureState } from './SyncStatus';

export function modelPrice(info: ModelInfo, kind: 'input' | 'output' | 'cached', currency: 'USD' | 'CNY', rate: number): number | null {
  if (!info.price) return null;
  const cny = info.price[`${kind}Cny`];
  const value = currency === 'CNY' ? cny : info.price.currency === 'USD' ? info.price[kind] : cny == null || !rate ? null : cny / rate;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function priceText(value: number | null, currency: string) {
  return value === null ? '未公布' : `${currency === 'USD' ? '$' : '¥'}${value.toLocaleString('zh-CN', { maximumSignificantDigits: 6 })}`;
}

function FrontierChart({ entries, data, currency }: { entries: BoardEntry[]; data: LeaderboardData; currency: 'USD' | 'CNY' }) {
  const points = entries.map((entry) => ({ ...entry, price: modelPrice(data.models[entry.slug], 'input', currency, data.run.fx.rate) })).filter((entry): entry is BoardEntry & { price: number } => entry.price !== null && entry.price > 0).sort((a, b) => a.price - b.price || b.score - a.score);
  if (!points.length) return <StatusView title="暂无可用于性价比图的价格数据" />;
  const min = Math.log10(points[0].price) - 0.15;
  const max = Math.max(min + 1, Math.log10(points.at(-1)!.price) + 0.15);
  const low = Math.floor(Math.min(...points.map((entry) => entry.score)) / 5) * 5 - 5;
  const high = Math.max(low + 10, Math.ceil(Math.max(...points.map((entry) => entry.score)) / 5) * 5 + 5);
  const x = (value: number) => 55 + (Math.log10(value) - min) / (max - min) * 650;
  const y = (value: number) => 240 - (value - low) / (high - low) * 210;
  const front = points.filter((entry, index) => !points.slice(0, index).some((prior) => prior.score >= entry.score));
  return <figure className="frontier-chart"><svg viewBox="0 0 760 280" role="img" aria-label="模型性价比：横轴为输入价格，纵轴为模型评分，越靠左上越有优势">
    {[0, 1, 2, 3, 4].map((tick) => { const score = low + (high - low) * tick / 4; return <g key={tick}><line x1="55" x2="705" y1={y(score)} y2={y(score)} className="chart-grid" /><text x="42" y={y(score) + 4} textAnchor="end">{score.toFixed(0)}</text></g>; })}
    {[0, 1, 2, 3, 4].map((tick) => { const price = 10 ** (min + (max - min) * tick / 4); return <text key={tick} x={x(price)} y="263" textAnchor="middle">{priceText(price, currency)}</text>; })}
    <polyline points={front.map((entry) => `${x(entry.price)},${y(entry.score)}`).join(' ')} fill="none" className="chart-front" />
    {points.map((entry) => <circle key={entry.slug} cx={x(entry.price)} cy={y(entry.score)} r={front.includes(entry) ? 5 : 3.5} className={front.includes(entry) ? 'chart-dot front' : 'chart-dot'}><title>{data.models[entry.slug].model.name} · {entry.score} 分 · {priceText(entry.price, currency)}</title></circle>)}
  </svg><figcaption>榜单斩杀线：输入价格为对数坐标，连线标出当前价格下评分更高的模型；窄屏可左右滑动，完整数值见下表。</figcaption></figure>;
}

export function LeaderboardPanel({ refreshKey, onStateChange }: { refreshKey: number; onStateChange: (state: FeatureState) => void }) {
  const state = useRemoteResource<LeaderboardData>('/api/site/leaderboard/boards', refreshKey);
  const raw = state.resource?.data;
  const data = raw && Array.isArray(raw.boards) && raw.models && raw.run ? raw : null;
  const [boardKey, setBoardKey] = useState('overall');
  const [query, setQuery] = useState('');
  const [domestic, setDomestic] = useState(false);
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState<'USD' | 'CNY'>('CNY');
  const [chart, setChart] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: 'rank' | 'score' | 'input' | 'output'; direction: number }>({ key: 'rank', direction: 1 });
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = document.getElementById('model-detail');
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
      if (event.key === 'Tab') {
        const controls = dialog?.querySelectorAll<HTMLElement>('button, a[href]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [selected]);
  const board = data?.boards.find((entry) => entry.board.key === boardKey) ?? data?.boards[0];
  const searching = Boolean(query.trim() || domestic || open);
  const candidates = board ? [...new Map((searching ? [...board.entries, ...board.filterEntries] : board.entries).map((entry) => [entry.slug, entry])).values()] : [];
  const entries = candidates.filter((entry) => {
    const info = data!.models[entry.slug];
    return info && `${info.model.name} ${info.model.provider} ${info.model.aliases?.join(' ') ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()) && (!domestic || info.access?.domestic) && (!open || info.access?.weightsUrl);
  }).sort((a, b) => {
    const first = sort.key === 'input' || sort.key === 'output' ? modelPrice(data!.models[a.slug], sort.key, currency, data!.run.fx.rate) : a[sort.key];
    const second = sort.key === 'input' || sort.key === 'output' ? modelPrice(data!.models[b.slug], sort.key, currency, data!.run.fx.rate) : b[sort.key];
    if (first == null) return 1;
    if (second == null) return -1;
    return (first - second) * sort.direction;
  }).slice(0, 30);
  const selectedInfo = selected ? data?.models[selected] : null;
  return <div className="leaderboard-panel">
    <SyncStatus loading={state.loading} error={state.error ?? (raw && !data ? 'AIHOT 模型榜数据格式发生变化，请稍后重试' : null)} syncedAt={state.resource?.syncedAt} onStateChange={onStateChange} />
    {data && board ? <>
      <div className="feature-tabs" role="group" aria-label="模型榜分类">{data.boards.map((entry) => <button type="button" key={entry.board.key} aria-pressed={board.board.key === entry.board.key} onClick={() => setBoardKey(entry.board.key)}>{entry.board.name}</button>)}</div>
      <p className="feature-note">{board.board.description}</p>
      <p className="data-timestamp">{board.board.sourceCount} 项评测 · {board.board.operatorCount} 家机构 · 数据更新 {formatBeijingTime(data.run.generatedAt)}</p>
      <div className="feature-toolbar">
        <label className="feature-search">搜索模型<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="模型名称、厂商或别名" /></label>
        <label className="check-filter"><input type="checkbox" checked={domestic} onChange={(event) => setDomestic(event.target.checked)} />国产模型</label>
        <label className="check-filter"><input type="checkbox" checked={open} onChange={(event) => setOpen(event.target.checked)} />开放权重</label>
        <label className="select-filter">价格单位<select aria-label="价格单位" value={currency} onChange={(event) => setCurrency(event.target.value as 'USD' | 'CNY')}><option value="CNY">人民币</option><option value="USD">美元</option></select></label>
        <button type="button" className="ghost-button" aria-pressed={chart} onClick={() => setChart(!chart)}>榜单斩杀线</button>
      </div>
      <p className="feature-note">展示 {entries.length} 个模型，保留原榜名次。价格为每百万 Token，未公布的价格不补零。</p>
      {chart ? <FrontierChart entries={entries} data={data} currency={currency} /> : null}
      {entries.length ? <div className="ranking-table-wrap"><table className="ranking-table"><caption className="visually-hidden">{board.board.name}模型榜</caption><thead><tr>
        {([['rank', '名次'], ['model', '模型'], ['score', 'AIHOT 评分'], ['input', '输入价格'], ['output', '输出价格']] as const).map(([key, label]) => <th key={key} className={key === 'input' || key === 'output' ? 'price-column' : undefined} aria-sort={key === sort.key ? sort.direction === 1 ? 'ascending' : 'descending' : undefined}>{key === 'model' ? label : <button type="button" onClick={() => setSort({ key, direction: sort.key === key ? -sort.direction : key === 'score' ? -1 : 1 })}>{label}{sort.key === key ? sort.direction === 1 ? ' ↑' : ' ↓' : ''}</button>}</th>)}
      </tr></thead><tbody>{entries.map((entry) => { const info = data.models[entry.slug]; return <tr key={entry.slug}>
        <td className="model-rank">{String(entry.rank).padStart(2, '0')}</td>
        <td><button className="model-name" type="button" onClick={() => setSelected(entry.slug)}>{info.model.name}</button><span className="model-provider">{info.model.provider} · {info.model.releasedAt ?? '上线日期未公布'}</span><span className="mobile-price">输入 {priceText(modelPrice(info, 'input', currency, data.run.fx.rate), currency)} · 输出 {priceText(modelPrice(info, 'output', currency, data.run.fx.rate), currency)}</span></td>
        <td className="model-score"><strong>{entry.score.toFixed(1)}</strong><span>覆盖 {Math.round(entry.coverage * 100)}%</span></td>
        <td className="price-column">{priceText(modelPrice(info, 'input', currency, data.run.fx.rate), currency)}</td><td className="price-column">{priceText(modelPrice(info, 'output', currency, data.run.fx.rate), currency)}</td>
      </tr>; })}</tbody></table></div> : <StatusView title="没有匹配的模型" detail="调整关键词或关闭部分筛选条件。" />}
      {board.pending.length ? <details className="pending-models"><summary>暂不排名 · {board.pending.length} 个模型</summary>{board.pending.map((entry) => <p key={entry.slug}><button className="text-button" type="button" onClick={() => setSelected(entry.slug)}>{data.models[entry.slug]?.model.name ?? entry.slug}</button><span>{entry.reason} · {entry.sources} 项评测 · {entry.score.toFixed(1)} 分</span></p>)}</details> : null}
      <details className="ranking-rules"><summary>评分与价格说明</summary><p>{board.board.howToRead}</p><p>价格不参与模型评分。汇率日期 {data.run.fx.asOf}，来源 {data.run.fx.sourceName}；限时折扣及上下文长度限制请以模型详情和厂商价格页为准。</p><a href="https://aihot.news/leaderboard/rules" target="_blank" rel="noreferrer">查看 AIHOT 计算方法 ↗</a></details>
    </> : null}
    {selectedInfo && data ? <div className="feature-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="feature-dialog" role="dialog" aria-modal="true" aria-labelledby="model-detail-title" id="model-detail"><div className="section-title"><h2 id="model-detail-title">{selectedInfo.model.name}</h2><button className="ghost-button" type="button" aria-label="关闭模型详情" onClick={() => setSelected(null)}>关闭</button></div><p>{selectedInfo.model.provider} · 上线 {selectedInfo.model.releasedAt ?? '日期未公布'}</p>
      <div className="model-board-scores">{data.boards.map((entry) => { const pending = entry.pending.find((model) => model.slug === selected); const score = [...entry.entries, ...entry.filterEntries].find((model) => model.slug === selected) ?? pending; return <div key={entry.board.key}><span>{entry.board.name}</span><strong>{score ? score.score.toFixed(1) : '暂无足够评测'}</strong>{pending ? <small>{pending.reason}</small> : null}</div>; })}</div>
      <dl className="model-price-details">{(['input', 'output', 'cached'] as const).map((key, index) => <div key={key}><dt>{['输入价格', '输出价格', '缓存命中价格'][index]}</dt><dd>{priceText(modelPrice(selectedInfo, key, currency, data.run.fx.rate), currency)} / 百万 Token</dd></div>)}</dl>
      {selectedInfo.price?.note ? <p className="feature-note">{selectedInfo.price.note}</p> : null}
      <div className="detail-links"><a href={`https://aihot.news/leaderboard/${encodeURIComponent(selectedInfo.model.slug)}`} target="_blank" rel="noreferrer">完整评测与分项成绩 ↗</a>{selectedInfo.price?.officialUrl ? <a href={selectedInfo.price.officialUrl} target="_blank" rel="noreferrer">厂商价格原文 ↗</a> : null}{selectedInfo.access?.weightsUrl ? <a href={selectedInfo.access.weightsUrl} target="_blank" rel="noreferrer">开放权重 ↗</a> : null}</div>
    </section></div> : null}
  </div>;
}
