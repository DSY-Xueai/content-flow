import { describe, expect, it, vi } from 'vitest';
import {
  buildJinaProfileUrl,
  buildJinaStatusUrl,
  buildNitterProfileUrl,
  buildRssHubUserUrl,
  choosePreferredPost,
  choosePreferredPostFromReaders,
  normalizeRssHubItem,
  parseNitterProfileHtml,
  parseJinaPageTime,
  parseJinaProfileMarkdown,
  parseJinaStatusMarkdown
} from './sourceReaders';

describe('sourceReaders', () => {
  it('builds a Jina Reader URL for an X profile', () => {
    expect(buildJinaProfileUrl(undefined, 'OpenAI')).toBe(
      'https://r.jina.ai/http://x.com/OpenAI'
    );
  });

  it('builds a Jina Reader URL for an X status', () => {
    expect(buildJinaStatusUrl(undefined, 'https://x.com/Zai_org/status/2057216685040443743')).toBe(
      'https://r.jina.ai/http://x.com/Zai_org/status/2057216685040443743'
    );
  });

  it('builds a Nitter profile URL for an X profile fallback', () => {
    expect(buildNitterProfileUrl('https://nitter.tiekoetter.com/', '_akhaliq')).toBe(
      'https://nitter.tiekoetter.com/_akhaliq'
    );
  });

  it('extracts the first public post from Jina profile markdown', () => {
    const markdown = `Title: OpenAI (@OpenAI) / X

Published Time: Thu, 21 May 2026 07:18:13 GMT

Markdown Content:
OpenAI

@OpenAI

## OpenAI's posts

Pinned

[![Image](https://pbs.twimg.com/profile_images/openai.jpg)](https://x.com/OpenAI)

Today, we share a breakthrough on the planar unit distance problem.

2:35

[![Image](https://pbs.twimg.com/profile_images/openai.jpg)](https://x.com/OpenAI)

People are generating over 1.5 billion images a week in ChatGPT.
`;

    expect(parseJinaProfileMarkdown('OpenAI', markdown)).toEqual({
      id: 'OpenAI-jina-latest',
      text: 'People are generating over 1.5 billion images a week in ChatGPT.',
      createdAt: '2026-05-21T07:18:13.000Z',
      url: 'https://x.com/OpenAI',
      media: []
    });
  });

  it('keeps media attached to the first public post', () => {
    const markdown = `## Google AI Studio's posts

Pinned

[![Image](https://pbs.twimg.com/profile_images/avatar.jpg)](https://x.com/GoogleAIStudio)

Pinned mobile app post.

[![Image](https://pbs.twimg.com/profile_images/avatar.jpg)](https://x.com/GoogleAIStudio)

Build with Gemini faster today.

![Image 4: Article cover image](https://pbs.twimg.com/media/HItPuria0AAR7M9?format=jpg&name=small)

![Image 5](https://pbs.twimg.com/amplify_video_thumb/2057119909147267072/img/YHy4HNrzqrOB1SQO.jpg)

[![Image](https://pbs.twimg.com/profile_images/avatar.jpg)](https://x.com/GoogleAIStudio)

Next post text.
`;

    expect(parseJinaProfileMarkdown('GoogleAIStudio', markdown)).toEqual({
      id: 'GoogleAIStudio-jina-latest',
      text: 'Build with Gemini faster today.',
      createdAt: null,
      url: 'https://x.com/GoogleAIStudio',
      media: [
        {
          url: 'https://pbs.twimg.com/media/HItPuria0AAR7M9?format=jpg&name=small',
          type: 'photo',
          embedUrl: null
        },
        {
          url: 'https://pbs.twimg.com/amplify_video_thumb/2057119909147267072/img/YHy4HNrzqrOB1SQO.jpg',
          type: 'video',
          embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=2057119909147267072'
        }
      ]
    });
  });

  it('marks ext_tw_video thumbnails from Jina as videos', () => {
    const markdown = `## Andrew Ng's posts

[![Image](https://pbs.twimg.com/profile_images/avatar.jpg)](https://x.com/AndrewYNg)

How we prompt AI is very different in 2026 than 2022 when ChatGPT came out.

1:51

![Image 2](https://pbs.twimg.com/ext_tw_video_thumb/1651603342022553600/pu/img/3ZcBCgwS54XV8RvI.jpg)

The suspension of the H1B visa program is bad for the US.
`;

    expect(parseJinaProfileMarkdown('AndrewYNg', markdown)?.media).toEqual([
      {
        url: 'https://pbs.twimg.com/ext_tw_video_thumb/1651603342022553600/pu/img/3ZcBCgwS54XV8RvI.jpg',
        type: 'video',
        embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=1651603342022553600'
      }
    ]);
  });

  it('parses Jina page published time as a fallback timestamp', () => {
    expect(parseJinaPageTime('Published Time: Thu, 21 May 2026 07:18:13 GMT')).toBe(
      '2026-05-21T07:18:13.000Z'
    );
  });

  it('skips author metadata in Jina profile markdown and keeps status dates', () => {
    const markdown = `Published Time: Thu, 21 May 2026 07:04:24 GMT

## AK’s posts

Pinned

[AK](https://x.com/_akhaliq)

[@_akhaliq](https://x.com/_akhaliq)

[Oct 11, 2024](https://x.com/_akhaliq/status/1844746338396770616)

for daily papers, authors can directly submit them here:

[AK](https://x.com/_akhaliq)

[@_akhaliq](https://x.com/_akhaliq)

[Jun 2, 2023](https://x.com/_akhaliq/status/1664650266505822213)

ChatGPT playing rock paper scissors

[![Image 4: Image](https://pbs.twimg.com/media/FxoGfpnWAAIL-o4?format=png&name=small)](https://x.com/_akhaliq/status/1664650266505822213/photo/1)
`;

    expect(parseJinaProfileMarkdown('_akhaliq', markdown)).toEqual({
      id: '1664650266505822213',
      text: 'ChatGPT playing rock paper scissors',
      createdAt: '2023-06-02T00:00:00.000Z',
      url: 'https://x.com/_akhaliq/status/1664650266505822213',
      media: [
        {
          url: 'https://pbs.twimg.com/media/FxoGfpnWAAIL-o4?format=png&name=small',
          type: 'photo',
          embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=1664650266505822213'
        }
      ]
    });
  });

  it('prefers the owner post over quoted or reposted blocks after a pinned post', () => {
    const markdown = `Published Time: Thu, 21 May 2026 07:04:24 GMT

## Z.ai’s posts

Pinned

[![Image 2: Square profile picture](https://pbs.twimg.com/profile_images/zai_normal.jpg)](https://x.com/Zai_org)

![Image 3: Article cover image](https://pbs.twimg.com/media/pinned.jpg)

Pinned article title

[![Image 4: Square profile picture](https://pbs.twimg.com/profile_images/orca_normal.jpg)](https://x.com/OrcaRouter)

GLM-5.1 from is now live on OrcaRouter

[![Image 14: Square profile picture](https://pbs.twimg.com/profile_images/zai_normal.jpg)](https://x.com/Zai_org)

GLM-5V-Turbo Tech Report: Toward a Native Foundation Model for Multimodal Agents This report summarizes the main improvements.
`;

    expect(parseJinaProfileMarkdown('Zai_org', markdown)).toEqual({
      id: 'Zai_org-jina-latest',
      text: 'GLM-5V-Turbo Tech Report: Toward a Native Foundation Model for Multimodal Agents This report summarizes the main improvements.',
      createdAt: '2026-05-21T07:04:24.000Z',
      url: 'https://x.com/Zai_org',
      media: []
    });
  });

  it('combines multiline owner post text and keeps media after continuation lines', () => {
    const markdown = `Published Time: Thu, 21 May 2026 06:57:32 GMT

## Google DeepMind’s posts

Pinned

[![Image 2: Square profile picture](https://pbs.twimg.com/profile_images/deepmind_normal.jpg)](https://x.com/GoogleDeepMind)

Pinned post.

[![Image 4: Square profile picture](https://pbs.twimg.com/profile_images/deepmind_normal.jpg)](https://x.com/GoogleDeepMind)

How can you accelerate your day to day research workflow? By giving AI the right scientific toolkit. We launched Science Skills for Google

, integrating insights from over 30 major life science sources, including UniProt and the AlphaFold Database.

![Image 5](https://pbs.twimg.com/media/HIzXxdHasAAYfwa.jpg)
`;

    expect(parseJinaProfileMarkdown('GoogleDeepMind', markdown)).toEqual({
      id: 'GoogleDeepMind-jina-latest',
      text: 'How can you accelerate your day to day research workflow? By giving AI the right scientific toolkit. We launched Science Skills for Google\n\n, integrating insights from over 30 major life science sources, including UniProt and the AlphaFold Database.',
      createdAt: '2026-05-21T06:57:32.000Z',
      url: 'https://x.com/GoogleDeepMind',
      media: [
        {
          url: 'https://pbs.twimg.com/media/HIzXxdHasAAYfwa.jpg',
          type: 'photo',
          embedUrl: null
        }
      ]
    });
  });

  it('keeps short owner posts when no metadata boundary is present', () => {
    const markdown = `Published Time: Thu, 21 May 2026 07:04:24 GMT

## Claude’s posts

Keep thinking.

1:29

You're absolutely right.

Quote

Anthropic

@AnthropicAI
`;

    expect(parseJinaProfileMarkdown('claudeai', markdown)).toEqual({
      id: 'claudeai-jina-latest',
      text: 'Keep thinking.',
      createdAt: '2026-05-21T07:04:24.000Z',
      url: 'https://x.com/claudeai',
      media: []
    });
  });

  it('returns null when Jina only returns the logged-out profile shell', () => {
    const markdown = `Title: AK (@_akhaliq) / X

Published Time: Thu, 21 May 2026 08:04:37 GMT

Markdown Content:
# AK (@_akhaliq) / X

Don’t miss what’s happening

People on X are the first to know.

## AK

46.6K posts

See new posts

[![Image 1](https://pbs.twimg.com/profile_banners/2465283662/1610997549/600x200)](http://x.com/_akhaliq/header_photo)
`;

    expect(parseJinaProfileMarkdown('_akhaliq', markdown)).toBeNull();
  });

  it('parses the newest owner post from Nitter HTML while skipping pinned older posts', () => {
    const html = `<div class="timeline-item " data-username="_akhaliq">
      <a class="tweet-link" href="/_akhaliq/status/1844746338396770616#m"></a>
      <span class="tweet-date"><a href="/_akhaliq/status/1844746338396770616#m" title="Oct 11, 2024 · 2:26 PM UTC">11 Oct 2024</a></span>
      <div class="tweet-content media-body" dir="auto">for daily papers, authors can directly submit them here: <a href="https://huggingface.co/papers/submit">huggingface.co/papers/submit</a></div>
    </div>
    <div class="timeline-item " data-username="cohere">
      <a class="tweet-link" href="/cohere/status/2057122131410813016#m"></a>
      <span class="tweet-date"><a href="/cohere/status/2057122131410813016#m" title="May 20, 2026 · 3:31 PM UTC">8h</a></span>
      <div class="tweet-content media-body" dir="auto">Other account content</div>
    </div>
    <div class="timeline-item " data-username="_akhaliq">
      <a class="tweet-link" href="/_akhaliq/status/2057129159000760347#m"></a>
      <span class="tweet-date"><a href="/_akhaliq/status/2057129159000760347#m" title="May 20, 2026 · 3:59 PM UTC">8h</a></span>
      <div class="tweet-content media-body" dir="auto">paper: <a href="https://huggingface.co/papers/2605.18746">huggingface.co/papers/2605.1…</a></div>
      <img src="/pic/card_img%2F2057129157931188224%2F9R01l7OO%3Fformat%3Djpg%26name%3D800x419" />
    </div>`;

    expect(parseNitterProfileHtml('_akhaliq', html)).toEqual({
      id: '2057129159000760347',
      text: 'paper: huggingface.co/papers/2605.1…',
      createdAt: '2026-05-20T15:59:00.000Z',
      url: 'https://x.com/_akhaliq/status/2057129159000760347',
      media: [
        {
          url: 'https://pbs.twimg.com/card_img/2057129157931188224/9R01l7OO?format=jpg&name=800x419',
          type: 'photo',
          embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=2057129159000760347'
        }
      ]
    });
  });

  it('extracts playable video URLs from Nitter timeline HTML', () => {
    const html = `<div class="timeline-item " data-username="GeminiApp">
      <a class="tweet-link" href="/GeminiApp/status/2057237073397268970#m"></a>
      <span class="tweet-date"><a href="/GeminiApp/status/2057237073397268970#m" title="May 20, 2026 路 11:59 PM UTC">8h</a></span>
      <div class="tweet-content media-body" dir="auto">Watch Gemini take an advanced math paper and explore it visually.</div>
      <video poster="/pic/pbs.twimg.com%2Fmedia%2FHIyLmCYaQAANv5c.jpg%3Fname%3Dsmall%26format%3Dwebp" data-url="/video/E6AB31F6DAF3D/https%3A%2F%2Fvideo.twimg.com%2Famplify_video%2F2057172107164024833%2Fpl%2FUPl1AOIhr4G-JCQi.m3u8%3Ftag%3D27%26v%3Dcfc"></video>
    </div>`;

    expect(parseNitterProfileHtml('GeminiApp', html)).toEqual({
      id: '2057237073397268970',
      text: 'Watch Gemini take an advanced math paper and explore it visually.',
      createdAt: '2026-05-20T23:59:00.000Z',
      url: 'https://x.com/GeminiApp/status/2057237073397268970',
      media: [
        {
          url: 'https://pbs.twimg.com/media/HIyLmCYaQAANv5c.jpg?name=small&format=webp',
          type: 'video',
          embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=2057237073397268970',
          videoUrl: 'https://video.twimg.com/amplify_video/2057172107164024833/pl/UPl1AOIhr4G-JCQi.m3u8?tag=27&v=cfc'
        }
      ]
    });
  });

  it('stops a Jina post before linked media belonging to the next visible post', () => {
    const markdown = `Published Time: Thu, 21 May 2026 08:04:36 GMT

## Sebastian Raschka’s posts

Pinned

[![Image 2: Image](https://pbs.twimg.com/media/HFEI2mzXUAE2CHZ?format=jpg&name=small)](https://x.com/rasbt/status/2040423398824698310/photo/1)

Looks like the first open source equivalent of ChatGPT has arrived.

When I started LLMs-from-scratch I just hoped it might help a few people learn.

[![Image 4: Image](https://pbs.twimg.com/media/G0u_O8AWIAAXatc?format=jpg&name=small)](https://x.com/rasbt/status/1966875930674286935/photo/1)

Kimi K2 is basically DeepSeek V3 but with fewer heads and more experts:
`;

    expect(parseJinaProfileMarkdown('rasbt', markdown)).toEqual({
      id: '2040423398824698310',
      text: 'Looks like the first open source equivalent of ChatGPT has arrived.\n\nWhen I started LLMs-from-scratch I just hoped it might help a few people learn.',
      createdAt: '2026-05-21T08:04:36.000Z',
      url: 'https://x.com/rasbt/status/2040423398824698310',
      media: [
        {
          url: 'https://pbs.twimg.com/media/HFEI2mzXUAE2CHZ?format=jpg&name=small',
          type: 'photo',
          embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=2040423398824698310'
        }
      ]
    });
  });

  it('prefers Jina content when RSSHub has a stale item', () => {
    expect(
      choosePreferredPost(
        {
          id: 'rss-old',
          text: 'old rss item',
          createdAt: '2026-04-27T15:20:10.000Z',
          url: 'https://x.com/Zai_org/status/rss-old',
          media: []
        },
        {
          id: 'jina-current',
          text: 'current jina item',
          createdAt: '2026-05-21T07:04:24.000Z',
          url: 'https://x.com/Zai_org',
          media: []
        }
      )?.text
    ).toBe('current jina item');
  });

  it('keeps RSSHub content when it is recent and structured', () => {
    expect(
      choosePreferredPost(
        {
          id: 'rss-recent',
          text: 'recent rss item',
          createdAt: '2026-05-21T01:20:10.000Z',
          url: 'https://x.com/Zai_org/status/rss-recent',
          media: []
        },
        {
          id: 'jina-current',
          text: 'current jina item',
          createdAt: '2026-05-21T07:04:24.000Z',
          url: 'https://x.com/Zai_org',
          media: []
        }
      )?.text
    ).toBe('current jina item');
  });

  it('uses the linked media status URL for Jina posts without date metadata', () => {
    const markdown = `Published Time: Thu, 21 May 2026 07:18:13 GMT

## Gemini App's posts

[![Image](https://pbs.twimg.com/profile_images/gemini.jpg)](https://x.com/GeminiApp)

Watch Gemini take an advanced math paper and explore it visually.

[![Image 2](https://pbs.twimg.com/media/demo.jpg)](https://x.com/GeminiApp/status/2057237073397268970/photo/1)
`;

    expect(parseJinaProfileMarkdown('GeminiApp', markdown)).toMatchObject({
      id: '2057237073397268970',
      url: 'https://x.com/GeminiApp/status/2057237073397268970',
      text: 'Watch Gemini take an advanced math paper and explore it visually.'
    });
  });

  it('prefers the newer post over an older playable video fallback', () => {
    expect(
      choosePreferredPost(
        {
          id: 'rss-newer',
          text: 'newer rss item',
          createdAt: '2026-05-21T09:00:00.000Z',
          url: 'https://x.com/GeminiApp/status/rss-newer',
          media: []
        },
        {
          id: 'jina-video',
          text: 'older jina video',
          createdAt: '2026-05-21T08:30:00.000Z',
          url: 'https://x.com/GeminiApp/status/jina-video',
          media: [
            {
              url: 'https://pbs.twimg.com/media/HIyLmCYaQAANv5c.jpg',
              type: 'video',
              embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=jina-video',
              videoUrl: 'https://video.twimg.com/amplify_video/2057172107164024833/pl/UPl1AOIhr4G-JCQi.m3u8'
            }
          ]
        }
      )?.id
    ).toBe('rss-newer');
  });

  it('uses direct playable video as a tie-breaker for posts with the same timestamp', () => {
    expect(
      choosePreferredPost(
        {
          id: 'jina-video-thumb',
          text: 'video demo',
          createdAt: '2026-05-21T09:00:00.000Z',
          url: 'https://x.com/GeminiApp',
          media: [
            {
              url: 'https://pbs.twimg.com/amplify_video_thumb/2057172107164024833/img/demo.jpg',
              type: 'video',
              embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=2057172107164024833'
            }
          ]
        },
        {
          id: '2057237073397268970',
          text: 'video demo',
          createdAt: '2026-05-21T09:00:00.000Z',
          url: 'https://x.com/GeminiApp/status/2057237073397268970',
          media: [
            {
              url: 'https://pbs.twimg.com/media/HIyLmCYaQAANv5c.jpg',
              type: 'video',
              embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=2057237073397268970',
              videoUrl: 'https://video.twimg.com/amplify_video/2057172107164024833/pl/UPl1AOIhr4G-JCQi.m3u8'
            }
          ]
        }
      )?.id
    ).toBe('2057237073397268970');
  });

  it('builds a RSSHub user route for X timelines', () => {
    expect(buildRssHubUserUrl('https://rsshub.app', 'OpenAI')).toBe(
      'https://rsshub.app/twitter/user/OpenAI/includeReplies=0&includeRts=0&forceWebApi=1?format=json&limit=1'
    );
  });

  it('normalizes a JSON Feed item into a latest post', () => {
    expect(
      normalizeRssHubItem('OpenAI', {
        id: 'https://x.com/OpenAI/status/123',
        title: 'OpenAI 最新发布',
        url: 'https://x.com/OpenAI/status/123',
        date_published: '2026-05-21T01:00:00.000Z',
        content_text: 'OpenAI 最新发布\n\n更多内容',
        content_html: '<p>OpenAI 最新发布</p><img src="https://pbs.twimg.com/media/demo.jpg">'
      })
    ).toEqual({
      id: '123',
      text: 'OpenAI 最新发布\n\n更多内容',
      createdAt: '2026-05-21T01:00:00.000Z',
      url: 'https://x.com/OpenAI/status/123',
      media: [
        {
          url: 'https://pbs.twimg.com/media/demo.jpg',
          type: 'photo',
          embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=123'
        }
      ]
    });
  });

  it('extracts media from RSSHub markdown image content', () => {
    expect(
      normalizeRssHubItem('OpenAI', {
        id: 'https://x.com/OpenAI/status/123',
        url: 'https://x.com/OpenAI/status/123',
        title: 'OpenAI 最新发布',
        content_html:
          'OpenAI 最新发布\n\n[![Image](https://pbs.twimg.com/media/demo.jpg?format=jpg&amp;name=small)](https://x.com/OpenAI/status/123/photo/1)'
      })
    ).toMatchObject({
      media: [
        {
          url: 'https://pbs.twimg.com/media/demo.jpg?format=jpg&name=small',
          type: 'photo',
          embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=123'
        }
      ]
    });
  });

  it('keeps media found by another reader for the same status', () => {
    expect(
      choosePreferredPost(
        {
          id: '123',
          text: 'same post',
          createdAt: '2026-05-21T09:00:00.000Z',
          url: 'https://x.com/OpenAI/status/123',
          media: []
        },
        {
          id: '123',
          text: 'same post',
          createdAt: '2026-05-21T09:00:00.000Z',
          url: 'https://x.com/OpenAI/status/123',
          media: [
            {
              url: 'https://pbs.twimg.com/media/demo.jpg',
              type: 'photo',
              embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=123'
            }
          ]
        }
      )?.media
    ).toEqual([
      {
        url: 'https://pbs.twimg.com/media/demo.jpg',
        type: 'photo',
        embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=123'
      }
    ]);
  });

  it('prefers substantive reader content over a URL-only latest placeholder', () => {
    expect(
      choosePreferredPost(
        {
          id: '2057213177868496897',
          text: 'http://x.com/i/article/2056825144065306624',
          createdAt: '2026-05-22T01:00:00.000Z',
          url: 'https://x.com/GoogleAIStudio/status/2057213177868496897',
          media: []
        },
        {
          id: 'GoogleAIStudio-jina-latest',
          text: 'Bring any idea to life: Google AI Studio at I/O 2026\n\nFor millions of builders, Google AI Studio has become the fastest path from prompt to a production app.',
          createdAt: '2026-05-22T01:00:00.000Z',
          url: 'https://x.com/GoogleAIStudio',
          media: [
            {
              url: 'https://pbs.twimg.com/media/HItPuria0AAR7M9?format=jpg&name=small',
              type: 'photo',
              embedUrl: null
            }
          ]
        }
      )?.text
    ).toContain('Bring any idea to life');
  });

  it('prefers substantive reader content over emoji-only latest placeholders', () => {
    expect(
      choosePreferredPost(
        {
          id: '2057767604048240987',
          text: '⚡️⚡️',
          createdAt: '2026-05-22T01:00:00.000Z',
          url: 'https://x.com/Alibaba_Qwen/status/2057767604048240987',
          media: []
        },
        {
          id: 'Alibaba_Qwen-jina-latest',
          text: 'Qwen 3.7-max beats Opus 4.7 and GPT-5.5 on a real agentic task.',
          createdAt: '2026-05-22T01:00:00.000Z',
          url: 'https://x.com/Alibaba_Qwen',
          media: [
            {
              url: 'https://pbs.twimg.com/amplify_video_thumb/2057581434013945856/img/demo.jpg',
              type: 'video',
              embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=2057581434013945856'
            }
          ]
        }
      )?.text
    ).toContain('Qwen 3.7-max');
  });

  it('prefers substantive reader content over Nitter-only link placeholders', () => {
    expect(
      choosePreferredPost(
        {
          id: '2057616380690841739',
          text: 'nitter.tiekoetter.com/DontFearAI/status/2056…',
          createdAt: '2026-05-22T01:00:00.000Z',
          url: 'https://x.com/GeminiApp/status/2057616380690841739',
          media: []
        },
        {
          id: 'GeminiApp-jina-latest',
          text: 'We’re also launching Veo 3, our state-of-the-art video generation model.',
          createdAt: '2026-05-22T01:00:00.000Z',
          url: 'https://x.com/GeminiApp',
          media: [
            {
              url: 'https://pbs.twimg.com/amplify_video_thumb/1924893621322711040/img/demo.jpg',
              type: 'video',
              embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=1924893621322711040'
            }
          ]
        }
      )?.text
    ).toContain('Veo 3');
  });

  it('parses substantive article content from a Jina status page', () => {
    const markdown = `Title: Z.ai on X: "Next-generation LLM Inference Network: How ZCube Alleviates Network Bottlenecks?" / X

URL Source: http://x.com/Zai_org/status/2057216685040443743

Markdown Content:
## Article

## Conversation

[![Image 1: Square profile picture](https://pbs.twimg.com/profile_images/zai_normal.jpg)](https://x.com/Zai_org)

[![Image 2: Image](https://pbs.twimg.com/media/HIyyK-CWYAA8Juc?format=jpg&name=small)](https://x.com/Zai_org/article/2057216685040443743/media/2057215031322763264)

Next-generation LLM Inference Network: How ZCube Alleviates Network Bottlenecks?

LLM inference is reshaping AI infrastructure.

[10:01 AM · May 22, 2026](https://x.com/Zai_org/status/2057216685040443743)

## New to X?
`;

    expect(parseJinaStatusMarkdown('Zai_org', 'https://x.com/Zai_org/status/2057216685040443743', markdown)).toEqual({
      id: '2057216685040443743',
      text: 'Next-generation LLM Inference Network: How ZCube Alleviates Network Bottlenecks?\n\nLLM inference is reshaping AI infrastructure.',
      createdAt: '2026-05-22T10:01:00.000Z',
      url: 'https://x.com/Zai_org/status/2057216685040443743',
      media: [
        {
          url: 'https://pbs.twimg.com/media/HIyyK-CWYAA8Juc?format=jpg&name=small',
          type: 'photo',
          embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=2057216685040443743'
        }
      ]
    });
  });

  it('parses quoted substantive content from a low-information Jina status page', () => {
    const markdown = `Title: Qwen on X: "⚡️⚡️" / X

URL Source: http://x.com/Alibaba_Qwen/status/2057767604048240987

Markdown Content:
## Post

## Conversation

[Qwen](https://x.com/Alibaba_Qwen)

[@Alibaba_Qwen](https://x.com/Alibaba_Qwen)

![Image 2: ⚡️](https://abs.twimg.com/emoji/v2/svg/26a1.svg)![Image 3: ⚡️](https://abs.twimg.com/emoji/v2/svg/26a1.svg)

Quote

OpenRouter

@OpenRouter

21h

The new Qwen3.7-Max from @Alibaba_Qwen is live on OpenRouter. Built for agent-centric work.

[![Image 5: Image](https://pbs.twimg.com/media/HI21bqVbcAArMLz?format=jpg&name=small)](https://x.com/OpenRouter/status/2057500097206976983/photo/1)

[10:16 AM · May 22, 2026](https://x.com/Alibaba_Qwen/status/2057767604048240987)
`;

    expect(parseJinaStatusMarkdown('Alibaba_Qwen', 'https://x.com/Alibaba_Qwen/status/2057767604048240987', markdown)).toMatchObject({
      id: '2057767604048240987',
      text: expect.stringContaining('The new Qwen3.7-Max'),
      media: [
        {
          url: 'https://pbs.twimg.com/media/HI21bqVbcAArMLz?format=jpg&name=small',
          type: 'photo',
          embedUrl: 'https://platform.twitter.com/embed/Tweet.html?id=2057500097206976983'
        }
      ]
    });
  });

  it('falls back to title and generated id when RSSHub item is sparse', () => {
    expect(
      normalizeRssHubItem('github', {
        title: 'GitHub 发布更新'
      })
    ).toEqual({
      id: 'github-latest',
      text: 'GitHub 发布更新',
      createdAt: null,
      url: 'https://x.com/github',
      media: []
    });
  });

  it('keeps available reader content when another reader exceeds the reader budget', async () => {
    vi.useFakeTimers();
    const rssHubPost = {
      id: '123',
      text: 'OpenAI latest from RSSHub',
      createdAt: '2026-05-21T01:00:00.000Z',
      url: 'https://x.com/OpenAI/status/123',
      media: []
    };

    try {
      const result = choosePreferredPostFromReaders(
        [
          () => Promise.resolve(rssHubPost),
          () => new Promise<null>(() => undefined)
        ],
        1000
      );

      await vi.advanceTimersByTimeAsync(1000);
      await expect(result).resolves.toEqual(rssHubPost);
    } finally {
      vi.useRealTimers();
    }
  });
});
