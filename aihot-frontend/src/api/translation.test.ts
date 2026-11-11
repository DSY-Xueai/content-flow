import { describe, expect, it } from 'vitest';
import {
  buildGoogleTranslateUrls,
  buildMyMemoryTranslateUrl,
  isUsefulSimplifiedChineseTranslation,
  parseGoogleTranslateResponse,
  parseMyMemoryTranslateResponse
} from './translation';

describe('translation helpers', () => {
  it('parses Google Translate response into simplified Chinese text', () => {
    const body = JSON.stringify([
      [
        ['今天，我们分享一个突破', 'Today, we share a breakthrough'],
        ['。', '.']
      ],
      null,
      'en'
    ]);

    expect(parseGoogleTranslateResponse(body)).toBe('今天，我们分享一个突破。');
  });

  it('requires translated text to differ from source and contain Chinese', () => {
    expect(isUsefulSimplifiedChineseTranslation('Today', 'Today')).toBe(false);
    expect(isUsefulSimplifiedChineseTranslation('Today', '今天')).toBe(true);
  });

  it('parses MyMemory fallback response into simplified Chinese text', () => {
    const body = JSON.stringify({
      responseStatus: 200,
      responseData: {
        translatedText: '今天，我们分享一个突破'
      }
    });

    expect(parseMyMemoryTranslateResponse(body)).toBe('今天，我们分享一个突破');
  });

  it('builds both Google translation endpoints', () => {
    expect(buildGoogleTranslateUrls('Hello')).toEqual([
      expect.stringContaining('https://translate.googleapis.com/translate_a/single?'),
      expect.stringContaining('https://translate.google.com/translate_a/single?')
    ]);
  });

  it('builds MyMemory fallback endpoint for simplified Chinese', () => {
    expect(buildMyMemoryTranslateUrl('Hello')).toContain('langpair=en%7Czh-CN');
  });
});
