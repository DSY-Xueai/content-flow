import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewsCard } from './NewsCard';

describe('NewsCard media playback', () => {
  it('opens an image preview when clicking photo media', async () => {
    render(
      <NewsCard
        item={{
          id: 'photo-1',
          title: 'AI photo workflow',
          url: 'https://example.com/photo',
          source: 'AI HOT',
          publishedAt: '2026-05-20T15:00:34.000Z',
          media: [
            {
              url: 'https://pbs.twimg.com/media/example.jpg',
              type: 'photo',
              width: 1200,
              height: 800
            }
          ]
        }}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '查看图片：AI photo workflow' }));

    expect(screen.getByRole('dialog', { name: 'AI photo workflow 图片预览' })).toBeInTheDocument();
    expect(screen.getByAltText('AI photo workflow 图片预览')).toHaveAttribute(
      'src',
      'https://pbs.twimg.com/media/example.jpg'
    );
    expect(screen.getByAltText('AI photo workflow 的媒体预览').closest('a')).toBeNull();
  });

  it('closes an image preview', async () => {
    render(
      <NewsCard
        item={{
          id: 'photo-1',
          title: 'AI photo workflow',
          url: 'https://example.com/photo',
          source: 'AI HOT',
          publishedAt: '2026-05-20T15:00:34.000Z',
          media: [
            {
              url: 'https://pbs.twimg.com/media/example.jpg',
              type: 'photo'
            }
          ]
        }}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '查看图片：AI photo workflow' }));
    await userEvent.click(screen.getByRole('button', { name: '关闭图片预览' }));

    expect(screen.queryByRole('dialog', { name: 'AI photo workflow 图片预览' })).not.toBeInTheDocument();
  });

  it('keeps the source link on the title', () => {
    render(
      <NewsCard
        item={{
          id: 'photo-1',
          title: 'AI photo workflow',
          url: 'https://example.com/photo',
          source: 'AI HOT',
          publishedAt: '2026-05-20T15:00:34.000Z'
        }}
      />
    );

    expect(screen.getByRole('link', { name: 'AI photo workflow' })).toHaveAttribute(
      'href',
      'https://example.com/photo'
    );
  });

  it('opens an inline player for X video media', async () => {
    render(
      <NewsCard
        item={{
          id: 'video-1',
          title: 'AI video workflow',
          url: 'https://x.com/PixVerse_/status/2057114262145818752',
          source: 'X: PixVerse (@PixVerse_)',
          publishedAt: '2026-05-20T15:00:34.000Z',
          media: [
            {
              url: 'https://pbs.twimg.com/ext_tw_video_thumb/example.jpg',
              type: 'video',
              width: 1080,
              height: 1440
            }
          ]
        }}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '播放视频：AI video workflow' }));

    expect(screen.getByRole('dialog', { name: 'AI video workflow' })).toBeInTheDocument();
    expect(screen.getByTitle('AI video workflow')).toHaveAttribute(
      'src',
      'https://platform.twitter.com/embed/Tweet.html?id=2057114262145818752'
    );
  });

  it('shows an optional add material button', async () => {
    const addMaterial = vi.fn();
    const item = {
      id: 'material-1',
      title: 'AI material workflow',
      url: 'https://example.com/material',
      source: 'AI HOT',
      summary: '适合写成公众号文章的素材。',
      publishedAt: '2026-05-20T15:00:34.000Z'
    };

    render(<NewsCard item={item} onAddMaterial={addMaterial} />);

    await userEvent.click(screen.getByRole('button', { name: '加入素材：AI material workflow' }));

    expect(addMaterial).toHaveBeenCalledWith(item);
  });

  it('marks the material button as added', () => {
    render(
      <NewsCard
        item={{
          id: 'material-1',
          title: 'AI material workflow',
          url: 'https://example.com/material',
          source: 'AI HOT',
          publishedAt: '2026-05-20T15:00:34.000Z'
        }}
        materialAdded
        onAddMaterial={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: '已加入素材：AI material workflow' })).toBeDisabled();
  });
});
