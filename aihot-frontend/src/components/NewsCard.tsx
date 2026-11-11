import { Bookmark, Check, PlayCircle, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { AihotItem } from '../api/aihot';
import { getCategoryLabel } from '../lib/categories';

interface NewsCardProps {
  item: AihotItem;
  materialAdded?: boolean;
  onAddMaterial?: (item: AihotItem) => void;
  bookmarked?: boolean;
  onToggleBookmark?: (item: AihotItem) => void;
}

export function NewsCard({ item, materialAdded = false, onAddMaterial, bookmarked = false, onToggleBookmark }: NewsCardProps) {
  const media = item.media?.filter((entry) => entry.url).slice(0, 4) ?? [];
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  return (
    <article className="news-card">
      <div className="card-meta">
        {item.authorAvatar ? (
          <img className="author-avatar" referrerPolicy="no-referrer" src={item.authorAvatar} alt="" loading="lazy" />
        ) : null}
        <span className="source-name" title={item.source}>{item.source}</span>
        <span className="category-pill">{getCategoryLabel(item.category)}</span>
        {typeof item.score === 'number' ? <strong className="score-badge">AI 评分 <span>{item.score}</span></strong> : null}
      </div>
      <h3>
        <a href={item.url} target="_blank" rel="noreferrer">
          {item.title}
        </a>
      </h3>
      <div className="card-body">
        {item.summary ? <p className="summary">{item.summary}</p> : null}
        {item.reason ? <p className="reason">推荐理由：{item.reason}</p> : null}
      </div>
      {media.length ? (
        <div className={`media-grid media-count-${Math.min(media.length, 4)}`}>
          {media.map((entry) => {
            const isPlayable = entry.type === 'video' || entry.type === 'animated_gif';
            const embedUrl = isPlayable ? buildTweetEmbedUrl(item.url) : null;
            const preview = (
              <>
                <img
                  alt={`${item.title} 的媒体预览`}
                  loading="lazy"
                  referrerPolicy="no-referrer" src={entry.url}
                  style={entry.width && entry.height ? { aspectRatio: `${entry.width} / ${entry.height}` } : undefined}
                />
                {isPlayable ? (
                  <span className="media-badge">{entry.type === 'animated_gif' ? 'GIF' : '视频'}</span>
                ) : null}
                {isPlayable ? (
                  <span className="media-play-icon" aria-hidden="true">
                    <PlayCircle size={44} strokeWidth={1.8} />
                  </span>
                ) : null}
              </>
            );

            if (embedUrl) {
              return (
                <button
                  aria-label={`播放视频：${item.title}`}
                  className="media-cell media-button"
                  key={`${entry.url}-${entry.type ?? 'media'}`}
                  onClick={() => setPlayerUrl(embedUrl)}
                  type="button"
                >
                  {preview}
                </button>
              );
            }

            return (
              <button
                aria-label={`查看图片：${item.title}`}
                className="media-cell media-button"
                key={`${entry.url}-${entry.type ?? 'media'}`}
                onClick={() => setPreviewImage(entry.url)}
                type="button"
              >
                {preview}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="card-footer">
        {onToggleBookmark ? <button className="bookmark-action" type="button" aria-pressed={bookmarked} aria-label={`${bookmarked ? '取消收藏' : '收藏'}：${item.title}`} onClick={() => onToggleBookmark(item)}>
          <Bookmark size={14} fill={bookmarked ? 'currentColor' : 'none'} />{bookmarked ? '已收藏' : '收藏'}
        </button> : null}
        {item.tags?.length ? (
          <div className="tag-row">
            {item.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
        <a className="source-link" href={item.url} target="_blank" rel="noreferrer">
          原文
        </a>
        {onAddMaterial ? (
          <button
            aria-label={`${materialAdded ? '已加入素材' : '加入素材'}：${item.title}`}
            className="material-action"
            disabled={materialAdded}
            onClick={() => onAddMaterial(item)}
            type="button"
          >
            {materialAdded ? <Check size={15} /> : <Plus size={15} />}
            {materialAdded ? '已加入' : '加入素材'}
          </button>
        ) : null}
      </div>
      {playerUrl ? (
        <div className="player-backdrop" role="presentation">
          <div aria-label={item.title} aria-modal="true" className="player-dialog" role="dialog">
            <div className="player-head">
              <strong>{item.title}</strong>
              <button type="button" onClick={() => setPlayerUrl(null)}>
                <X size={16} />
                关闭
              </button>
            </div>
            <iframe
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              className="player-frame"
              src={playerUrl}
              title={item.title}
            />
            <a className="player-source" href={item.url} rel="noreferrer" target="_blank">
              打开原文播放
            </a>
          </div>
        </div>
      ) : null}
      {previewImage ? (
        <div className="player-backdrop" role="presentation">
          <div aria-label={`${item.title} 图片预览`} aria-modal="true" className="player-dialog image-preview-dialog" role="dialog">
            <div className="player-head">
              <strong>{item.title}</strong>
              <button aria-label="关闭图片预览" type="button" onClick={() => setPreviewImage(null)}>
                <X size={16} />
                关闭
              </button>
            </div>
            <img alt={`${item.title} 图片预览`} className="image-preview-frame" referrerPolicy="no-referrer" src={previewImage} />
          </div>
        </div>
      ) : null}
    </article>
  );
}


function buildTweetEmbedUrl(url: string): string | null {
  const match = url.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i);
  if (!match) {
    return null;
  }

  return `https://platform.twitter.com/embed/Tweet.html?id=${match[1]}`;
}
