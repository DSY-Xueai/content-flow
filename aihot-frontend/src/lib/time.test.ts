import { describe, expect, it } from 'vitest';
import { formatBeijingTime } from './time';

describe('formatBeijingTime', () => {
  it('formats UTC timestamps as Beijing month/day and time', () => {
    expect(formatBeijingTime('2026-05-20T01:48:00.000Z')).toBe('5/20 09:48');
  });

  it('shows fallback text when timestamp is missing', () => {
    expect(formatBeijingTime(null)).toBe('时间未知');
  });
});

