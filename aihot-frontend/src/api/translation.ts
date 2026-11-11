export function buildGoogleTranslateUrls(text: string): string[] {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: 'zh-CN',
    dt: 't',
    q: text
  });

  return [
    `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
    `https://translate.google.com/translate_a/single?${params.toString()}`
  ];
}

export function buildMyMemoryTranslateUrl(text: string): string {
  const params = new URLSearchParams({
    q: text,
    langpair: 'en|zh-CN'
  });

  return `https://api.mymemory.translated.net/get?${params.toString()}`;
}

export function parseGoogleTranslateResponse(body: string): string | null {
  try {
    const data = JSON.parse(body) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      return null;
    }

    const translated = data[0]
      .map((part) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : ''))
      .join('')
      .trim();

    return translated || null;
  } catch {
    return null;
  }
}

export function parseMyMemoryTranslateResponse(body: string): string | null {
  try {
    const data = JSON.parse(body) as {
      responseData?: {
        translatedText?: unknown;
      };
      responseStatus?: unknown;
    };

    if (data.responseStatus !== 200 || typeof data.responseData?.translatedText !== 'string') {
      return null;
    }

    const translated = data.responseData.translatedText.trim();
    return translated || null;
  } catch {
    return null;
  }
}

export function isUsefulSimplifiedChineseTranslation(source: string, translated: string | null): translated is string {
  return Boolean(translated && translated !== source && /[\u4e00-\u9fff]/.test(translated));
}
