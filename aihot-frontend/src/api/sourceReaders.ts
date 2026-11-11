import type { XLatestPost } from './xSources';

export interface RssHubItem {
  id?: string;
  title?: string;
  url?: string;
  date_published?: string;
  content_text?: string;
  content_html?: string;
  image?: string;
  attachments?: Array<{ url?: string; mime_type?: string }>;
}

const DEFAULT_JINA_BASE_URL = 'https://r.jina.ai/http://';
const STALE_RSSHUB_MS = 24 * 60 * 60 * 1000;

export function buildJinaProfileUrl(baseUrl: string | undefined, handle: string): string {
  const rawBase = baseUrl || DEFAULT_JINA_BASE_URL;
  const normalizedBase = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  return `${normalizedBase}x.com/${handle}`;
}

export function buildJinaStatusUrl(baseUrl: string | undefined, statusUrl: string): string {
  const rawBase = baseUrl || DEFAULT_JINA_BASE_URL;
  const normalizedBase = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  return `${normalizedBase}${statusUrl.replace(/^https?:\/\//i, '')}`;
}

export function parseJinaProfileMarkdown(handle: string, markdown: string): XLatestPost | null {
  const pageTime = parseJinaPageTime(markdown);
  const postStart = markdown.search(/^##\s+.+posts\s*$/im);
  if (postStart < 0) {
    return null;
  }

  const body = postStart >= 0 ? markdown.slice(postStart) : markdown;
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parseStart = findFirstNonPinnedIndex(lines, handle);

  for (let index = parseStart; index < lines.length; index += 1) {
    const line = lines[index];
    if (isJinaNoiseLine(line)) {
      continue;
    }

    const metadata = parseJinaPostMetadata(lines, index, handle, pageTime);
    const linkedStatusId = metadata.url.includes('/status/') ? null : findLinkedStatusIdForJinaPost(lines, index, metadata.id);
    const id = linkedStatusId ?? metadata.id;
    const content = collectJinaPostContent(lines, index, id);
    return {
      id,
      text: content.text,
      createdAt: metadata.createdAt,
      url: linkedStatusId ? `https://x.com/${handle}/status/${linkedStatusId}` : metadata.url,
      media: content.media
    };
  }

  return null;
}

export function parseJinaStatusMarkdown(handle: string, statusUrl: string, markdown: string): XLatestPost | null {
  const id = statusUrl.match(/status\/(\d+)/)?.[1];
  if (!id) {
    return null;
  }

  const contentStart = markdown.indexOf('Markdown Content:');
  const body = contentStart >= 0 ? markdown.slice(contentStart + 'Markdown Content:'.length) : markdown;
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const textLines: string[] = [];
  const media: NonNullable<XLatestPost['media']> = [];
  let createdAt: string | null = parseJinaPageTime(markdown);

  for (const line of lines) {
    if (isJinaStatusPageStopLine(line)) {
      break;
    }

    const date = parseJinaStatusTimestamp(line);
    if (date) {
      createdAt = date;
      continue;
    }

    const mediaEntry = parseJinaMediaLine(line);
    if (mediaEntry && !media.some((entry) => entry.url === mediaEntry.url)) {
      media.push({
        ...mediaEntry,
        embedUrl: mediaEntry.embedUrl ?? `https://platform.twitter.com/embed/Tweet.html?id=${id}`
      });
      continue;
    }

    if (isJinaStatusNoiseLine(line, handle)) {
      continue;
    }

    const text = cleanupText(line);
    if (text) {
      textLines.push(text);
    }
  }

  const text = textLines.join('\n\n');
  if (!text && !media.length) {
    return null;
  }

  return {
    id,
    text,
    createdAt,
    url: statusUrl,
    media
  };
}

function collectJinaPostContent(lines: string[], textIndex: number, postId: string): { text: string; media: NonNullable<XLatestPost['media']> } {
  const textLines = [cleanupText(lines[textIndex])];
  const media = collectJinaMedia(lines, textIndex, postId);

  for (const line of lines.slice(textIndex + 1)) {
    if (isJinaPostBoundary(line) || isJinaPostStopLine(line)) {
      break;
    }

    if (parseJinaMediaLine(line)) {
      if (hasLinkedStatusMedia(line) && !isFallbackJinaPostId(postId) && !hasLinkedStatusMedia(line, postId)) {
        break;
      }
      continue;
    }

    if (isJinaNoiseLine(line)) {
      continue;
    }

    textLines.push(cleanupText(line));
  }

  return {
    text: textLines.filter(Boolean).join('\n\n'),
    media
  };
}

export function parseJinaPageTime(markdown: string): string | null {
  const match = markdown.match(/^Published Time:\s*(.+)$/im);
  if (!match) {
    return null;
  }

  const date = new Date(match[1]);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function findFirstNonPinnedIndex(lines: string[], handle: string): number {
  const pinnedIndex = lines.findIndex((line) => line === 'Pinned');
  if (pinnedIndex < 0) {
    return 0;
  }

  let sawPinnedContent = false;
  for (let index = pinnedIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const isProfileBoundary = isJinaOwnerPostBoundary(line, handle);

    if (!sawPinnedContent && !isJinaNoiseLine(line)) {
      sawPinnedContent = true;
      continue;
    }

    if (sawPinnedContent && isProfileBoundary) {
      return index;
    }
  }

  return pinnedIndex + 1;
}

function parseJinaPostMetadata(lines: string[], textIndex: number, handle: string, fallbackTime: string | null) {
  for (let index = textIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (index !== textIndex - 1 && isJinaPostBoundary(line)) {
      break;
    }

    const dateMatch = line.match(/^\[([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})]\(https:\/\/x\.com\/[^/\s)]+\/status\/(\d+)[^)]*\)$/);
    if (dateMatch) {
      const date = new Date(`${dateMatch[1]} 00:00:00 GMT`);
      const id = dateMatch[2];
      return {
        id,
        createdAt: Number.isNaN(date.getTime()) ? fallbackTime : date.toISOString(),
        url: `https://x.com/${handle}/status/${id}`
      };
    }
  }

  return {
    id: `${handle}-jina-latest`,
    createdAt: fallbackTime,
    url: `https://x.com/${handle}`
  };
}

export function buildRssHubUserUrl(baseUrl: string, handle: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return `${normalizedBase}/twitter/user/${handle}/includeReplies=0&includeRts=0&forceWebApi=1?format=json&limit=1`;
}

export function buildNitterProfileUrl(baseUrl: string, handle: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return `${normalizedBase}/${handle}`;
}

export function parseNitterProfileHtml(handle: string, html: string): XLatestPost | null {
  const blocks = html.split(/<div class="timeline-item[^"]*"\s+data-username="/i).slice(1);
  const posts = blocks
    .map((block) => parseNitterTimelineItem(handle, block))
    .filter((post): post is XLatestPost => Boolean(post?.text.trim() && post.createdAt));

  posts.sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightTime - leftTime;
  });

  return posts[0] ?? null;
}

export function normalizeRssHubItem(handle: string, item: RssHubItem): XLatestPost {
  const url = item.url || item.id || `https://x.com/${handle}`;
  const idMatch = url.match(/status\/(\d+)/);
  const text = cleanupText(item.content_text || stripHtml(item.content_html) || item.title || '暂无正文');

  return {
    id: idMatch?.[1] ?? `${handle}-latest`,
    text,
    createdAt: item.date_published ?? null,
    url,
    media: normalizeRssHubMedia(item)
  };
}

function parseNitterTimelineItem(handle: string, block: string): XLatestPost | null {
  const usernameEnd = block.indexOf('"');
  const username = usernameEnd >= 0 ? block.slice(0, usernameEnd) : '';
  if (username.toLowerCase() !== handle.toLowerCase()) {
    return null;
  }

  const statusMatch = block.match(/href="\/[^/"]+\/status\/(\d+)#m"/);
  const dateMatch = block.match(/class="tweet-date"><a[^>]+title="([^"]+)"/);
  const contentMatch = block.match(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!statusMatch || !dateMatch || !contentMatch) {
    return null;
  }

  const id = statusMatch[1];
  const createdAt = parseNitterDate(dateMatch[1]);
  const media = parseNitterMedia(block, id);

  return {
    id,
    text: cleanupText(stripHtml(contentMatch[1])),
    createdAt,
    url: `https://x.com/${handle}/status/${id}`,
    media
  };
}

function parseNitterDate(value: string): string | null {
  const normalized = value.replace(/\s+(?:·|路)\s+/, ' ');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseNitterMedia(block: string, postId: string): NonNullable<XLatestPost['media']> {
  const imageMedia = [...block.matchAll(/<img[^>]+src="\/pic\/([^"]+)"/gi)]
    .map((match) => normalizeNitterAssetUrl(match[1]))
    .filter((url): url is string => Boolean(url))
    .map((url) => ({
      url,
      type: inferMediaType(url),
      embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${postId}`
    }));

  const videoMedia = [...block.matchAll(/<video[^>]+poster="\/pic\/([^"]+)"[^>]+data-url="([^"]+)"/gi)]
    .map((match) => {
      const posterUrl = normalizeNitterAssetUrl(match[1]);
      const videoUrl = normalizeNitterVideoUrl(match[2]);
      return posterUrl && videoUrl
        ? {
            url: posterUrl,
            type: 'video' as const,
            embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${postId}`,
            videoUrl
          }
        : null;
    })
    .filter((entry): entry is { url: string; type: 'video'; embedUrl: string; videoUrl: string } => Boolean(entry));

  return [...videoMedia, ...imageMedia.filter((entry) => !videoMedia.some((video) => video.url === entry.url))];
}

export function choosePreferredPost(rssHubPost: XLatestPost | null, jinaPost: XLatestPost | null): XLatestPost | null {
  if (!rssHubPost) {
    return jinaPost;
  }

  if (!jinaPost) {
    return rssHubPost;
  }

  if (isLowInformationPost(rssHubPost) && !isLowInformationPost(jinaPost)) {
    return jinaPost;
  }

  if (!isLowInformationPost(rssHubPost) && isLowInformationPost(jinaPost)) {
    return rssHubPost;
  }

  const rssTime = rssHubPost.createdAt ? new Date(rssHubPost.createdAt).getTime() : Number.NaN;
  const jinaTime = jinaPost.createdAt ? new Date(jinaPost.createdAt).getTime() : Number.NaN;
  if (!Number.isNaN(rssTime) && !Number.isNaN(jinaTime) && jinaTime !== rssTime) {
    return jinaTime > rssTime ? withSupplementalMedia(jinaPost, rssHubPost) : withSupplementalMedia(rssHubPost, jinaPost);
  }

  const rssHasPlayableVideo = hasPlayableVideo(rssHubPost);
  const jinaHasPlayableVideo = hasPlayableVideo(jinaPost);
  if (!rssHasPlayableVideo && jinaHasPlayableVideo && areComparableTimes(rssTime, jinaTime)) {
    return withSupplementalMedia(jinaPost, rssHubPost);
  }

  if (rssHasPlayableVideo && !jinaHasPlayableVideo && areComparableTimes(rssTime, jinaTime)) {
    return withSupplementalMedia(rssHubPost, jinaPost);
  }

  if (Number.isNaN(rssTime) && !Number.isNaN(jinaTime)) {
    return withSupplementalMedia(jinaPost, rssHubPost);
  }

  if (!Number.isNaN(rssTime) && !Number.isNaN(jinaTime) && jinaTime - rssTime > STALE_RSSHUB_MS) {
    return withSupplementalMedia(jinaPost, rssHubPost);
  }

  if (!hasStatusUrl(rssHubPost) && hasStatusUrl(jinaPost)) {
    return withSupplementalMedia(jinaPost, rssHubPost);
  }

  return withSupplementalMedia(rssHubPost, jinaPost);
}

export async function choosePreferredPostFromReaders(
  readers: Array<() => Promise<XLatestPost | null>>,
  timeoutMs: number
): Promise<XLatestPost | null> {
  const posts = await Promise.all(readers.map((reader) => readWithBudget(reader, timeoutMs)));
  return posts.reduce<XLatestPost | null>((preferred, post) => choosePreferredPost(preferred, post), null);
}

function readWithBudget(reader: () => Promise<XLatestPost | null>, timeoutMs: number): Promise<XLatestPost | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    reader()
      .then(resolve)
      .catch(() => resolve(null))
      .finally(() => clearTimeout(timeout));
  });
}

function hasPlayableVideo(post: XLatestPost | null): boolean {
  return Boolean(post?.media?.some((entry) => entry.type === 'video' && entry.videoUrl));
}

function areComparableTimes(leftTime: number, rightTime: number): boolean {
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return true;
  }

  return Math.abs(leftTime - rightTime) <= STALE_RSSHUB_MS;
}

function hasStatusUrl(post: XLatestPost | null): boolean {
  return Boolean(post?.url.includes('/status/'));
}

function isLowInformationPost(post: XLatestPost): boolean {
  if (post.media?.length) {
    return false;
  }

  const withoutUrls = post.text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b(?:[\w-]+\.)+(?:com|net|org|ai|dev|app|io|co|cn|me|ly|ms|tv|gg)(?:\/\S*)?/gi, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/[#@]\w+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();

  return withoutUrls.length < 8;
}

export function hasLowInformationContent(post: XLatestPost): boolean {
  return isLowInformationPost(post);
}

function withSupplementalMedia(primary: XLatestPost, secondary: XLatestPost): XLatestPost {
  if (!isSameStatusPost(primary, secondary)) {
    return primary;
  }

  const media = mergeMedia(primary.media, secondary.media);
  return media === primary.media ? primary : { ...primary, media };
}

function isSameStatusPost(left: XLatestPost, right: XLatestPost): boolean {
  const leftStatus = statusIdFromUrl(left.url) ?? left.id;
  const rightStatus = statusIdFromUrl(right.url) ?? right.id;
  return Boolean(leftStatus && rightStatus && leftStatus === rightStatus);
}

function statusIdFromUrl(url: string): string | null {
  return url.match(/status\/(\d+)/)?.[1] ?? null;
}

function mergeMedia(left: XLatestPost['media'], right: XLatestPost['media']): XLatestPost['media'] {
  const merged: NonNullable<XLatestPost['media']> = [];
  for (const entry of [...(left ?? []), ...(right ?? [])]) {
    if (!entry.url || merged.some((current) => current.url === entry.url)) {
      continue;
    }
    merged.push(entry);
  }

  if (!right?.length || merged.length === (left?.length ?? 0)) {
    return left ?? [];
  }

  return merged;
}

function findLinkedStatusIdForJinaPost(lines: string[], textIndex: number, postId: string): string | null {
  for (let index = textIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (isJinaPostBoundary(line)) {
      break;
    }

    const match = line.match(/https:\/\/x\.com\/[^/\s)]+\/status\/(\d+)/i);
    if (match) {
      return match[1];
    }
  }

  for (const line of lines.slice(textIndex + 1)) {
    if (isJinaPostBoundary(line) || isJinaPostStopLine(line)) {
      break;
    }

    const match = line.match(/https:\/\/x\.com\/[^/\s)]+\/status\/(\d+)/i);
    if (match && (isFallbackJinaPostId(postId) || match[1] === postId)) {
      return match[1];
    }
  }

  return null;
}

function isFallbackJinaPostId(postId: string): boolean {
  return postId.endsWith('-jina-latest');
}

function collectJinaMedia(lines: string[], textIndex: number, postId: string): NonNullable<XLatestPost['media']> {
  const media: NonNullable<XLatestPost['media']> = [];

  for (let index = textIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (isJinaPostBoundary(line)) {
      break;
    }

    const mediaEntry = parseJinaMediaLine(line);
    if (mediaEntry) {
      media.unshift(mediaEntry);
    }
  }

  let sawForwardMedia = false;
  for (const line of lines.slice(textIndex + 1)) {
    if (isJinaPostBoundary(line) || line === 'Quote' || line === 'Replying to' || isJinaStatusDateLine(line)) {
      break;
    }

    if (/^\d{1,2}:\d{2}$/.test(line)) {
      continue;
    }

    const mediaEntry = parseJinaMediaLine(line);
    if (mediaEntry) {
      if (hasLinkedStatusMedia(line) && !isFallbackJinaPostId(postId) && !hasLinkedStatusMedia(line, postId)) {
        break;
      }
      media.push(mediaEntry);
      sawForwardMedia = true;
      continue;
    }

    if (!isJinaNoiseLine(line)) {
      if (sawForwardMedia) {
        break;
      }
      continue;
    }
  }

  return media;
}

function parseJinaMediaLine(line: string) {
  const urlMatch = line.match(/!\[[^\]]*]\((https:\/\/pbs\.twimg\.com\/[^)]+)\)/i);
  if (!urlMatch || urlMatch[1].includes('/profile_images/')) {
    return null;
  }

  const url = urlMatch[1];
  const statusMatch = line.match(/https:\/\/x\.com\/[^/\s)]+\/status\/(\d+)/i);
  const videoThumbMatch = url.match(/\/(?:amplify_video_thumb|ext_tw_video_thumb)\/(\d+)\//);
  const type = isVideoThumbnail(url) ? 'video' : 'photo';
  const embedId = statusMatch?.[1] ?? videoThumbMatch?.[1];

  return {
    url,
    type,
    embedUrl: embedId ? `https://platform.twitter.com/embed/Tweet.html?id=${embedId}` : null
  } as const;
}

function hasLinkedStatusMedia(line: string, postId?: string): boolean {
  const match = line.match(/https:\/\/x\.com\/[^/\s)]+\/status\/(\d+)/i);
  if (!match) {
    return false;
  }

  return postId ? match[1] === postId : true;
}

function isJinaPostStopLine(line: string): boolean {
  return (
    line === 'Quote' ||
    line === 'Replying to' ||
    /^\d{1,2}:\d{2}$/.test(line) ||
    isJinaStatusDateLine(line)
  );
}

function isJinaStatusDateLine(line: string): boolean {
  return /^\[[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}]\(https:\/\/x\.com\/[^/\s)]+\/status\/\d+[^)]*\)$/.test(line);
}

function parseJinaStatusTimestamp(line: string): string | null {
  const match = line.match(/^\[(\d{1,2}:\d{2}\s+[AP]M)\s+·\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})]\(https:\/\/x\.com\/[^/\s)]+\/status\/\d+[^)]*\)$/);
  if (!match) {
    return null;
  }

  const date = new Date(`${match[2]} ${match[1]} GMT`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isJinaStatusPageStopLine(line: string): boolean {
  return (
    line === '## New to X?' ||
    line === '## Trending now' ||
    line === '## What’s happening' ||
    line === '## What’s Happening'
  );
}

function isJinaStatusNoiseLine(line: string, handle: string): boolean {
  return (
    isJinaNoiseLine(line) ||
    line === '## Post' ||
    line === '## Article' ||
    line === '## Conversation' ||
    line === 'Quote' ||
    /^\d+[hms]$/.test(line) ||
    line.toLowerCase() === handle.toLowerCase()
  );
}

function normalizeRssHubMedia(item: RssHubItem): XLatestPost['media'] {
  const media: NonNullable<XLatestPost['media']> = [];

  if (item.image) {
    media.push({ url: item.image, type: inferMediaType(item.image), embedUrl: buildEmbedUrl(item.url || item.id) });
  }

  for (const attachment of item.attachments ?? []) {
    if (!attachment.url) {
      continue;
    }
    media.push({
      url: attachment.url,
      type: attachment.mime_type?.startsWith('video/') ? 'video' : inferMediaType(attachment.url),
      embedUrl: buildEmbedUrl(item.url || item.id)
    });
  }

  for (const url of extractHtmlImageUrls(item.content_html)) {
    if (!media.some((entry) => entry.url === url)) {
      media.push({ url, type: inferMediaType(url), embedUrl: buildEmbedUrl(item.url || item.id) });
    }
  }

  return media;
}

function extractHtmlImageUrls(html?: string): string[] {
  if (!html) {
    return [];
  }

  return [
    ...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi),
    ...html.matchAll(/!\[[^\]]*]\((https:\/\/(?:pbs|video)\.twimg\.com\/[^)\s]+)\)/gi)
  ].map((match) => match[1].replace(/&amp;/g, '&'));
}

function normalizeNitterAssetUrl(value: string): string | null {
  const decoded = decodeURIComponent(value);
  if (decoded.startsWith('card_img/')) {
    return `https://pbs.twimg.com/${decoded}`;
  }

  if (!/(?:pbs|video)\.twimg\.com/.test(decoded)) {
    return null;
  }

  return decoded.startsWith('http') ? decoded : `https://${decoded}`;
}

function normalizeNitterVideoUrl(value: string): string | null {
  const decoded = decodeURIComponent(value);
  const urlStart = decoded.indexOf('https://video.twimg.com/');
  return urlStart >= 0 ? decoded.slice(urlStart) : null;
}

function inferMediaType(url: string): 'photo' | 'video' {
  return isVideoThumbnail(url) || /\.(mp4|mov|webm|m3u8)(?:$|[?#])/i.test(url) ? 'video' : 'photo';
}

function isVideoThumbnail(url: string): boolean {
  return url.includes('/amplify_video_thumb/') || url.includes('/ext_tw_video_thumb/');
}

function buildEmbedUrl(url?: string): string | null {
  const match = url?.match(/status\/(\d+)/);
  return match ? `https://platform.twitter.com/embed/Tweet.html?id=${match[1]}` : null;
}

function isJinaNoiseLine(line: string): boolean {
  return (
    line.startsWith('Title:') ||
    line.startsWith('URL Source:') ||
    line.startsWith('Published Time:') ||
    line.startsWith('Markdown Content:') ||
    line.startsWith('## ') ||
    line === 'Pinned' ||
    /^\[[^\]]+]\(https:\/\/x\.com\/[^/\s)]+\)$/.test(line) ||
    /^\[@[A-Za-z0-9_]{1,15}]\(https:\/\/x\.com\/[^/\s)]+\)$/.test(line) ||
    /^\[[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}]\(https:\/\/x\.com\/[^/\s)]+\/status\/\d+[^)]*\)$/.test(line) ||
    /^\[[\d.]+[KMB]?]\(https:\/\/x\.com\/[^/\s)]+\/status\/\d+\/analytics\)$/.test(line) ||
    /^@?[A-Za-z0-9_]{1,15}$/.test(line) ||
    /^\d{1,2}:\d{2}$/.test(line) ||
    /^\[!\[Image/i.test(line) ||
    /^!\[Image/i.test(line)
  );
}

function isJinaPostBoundary(line: string): boolean {
  return (
    /^\[!\[Image.*profile_images/i.test(line) ||
    /^\[[^\]]+]\(https:\/\/x\.com\/[^/\s)]+\)$/.test(line)
  );
}

function isJinaOwnerPostBoundary(line: string, handle: string): boolean {
  const escapedHandle = escapeRegExp(handle);
  return (
    new RegExp(`^\\[!\\[Image.*profile_images.*\\]\\(https://x\\.com/${escapedHandle}\\)$`, 'i').test(line) ||
    new RegExp(`^\\[[^\\]]+\\]\\(https://x\\.com/${escapedHandle}\\)$`, 'i').test(line)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanupText(value: string): string {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .trim();
}

function stripHtml(value?: string): string {
  return value
    ? value
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim()
    : '';
}
