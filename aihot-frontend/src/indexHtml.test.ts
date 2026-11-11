import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('index html', () => {
  it('declares an existing favicon so browsers do not request a missing default icon', () => {
    const html = readFileSync('index.html', 'utf8');
    const favicon = html.match(/<link\s+rel="icon"\s+href="([^"]+)"/i)?.[1];

    expect(favicon).toBe('/favicon.svg');
    expect(existsSync(path.join('public', favicon!.slice(1)))).toBe(true);
  });
});
