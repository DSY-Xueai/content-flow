import { describe, expect, it } from 'vitest';
import { modelPrice } from './LeaderboardPanel';
import { beijingDay, resetDay, resetStatus } from './ResetsPanel';
import type { ModelInfo, ResetEvent } from '../api/features';

describe('ranking price units and reset evidence', () => {
  it('converts native CNY prices only with the supplied exchange rate and keeps unknown prices unknown', () => {
    const info = { price: { currency: 'CNY', input: 10, output: 20, cached: null, inputCny: 10, outputCny: 20, cachedCny: null } } as ModelInfo;
    expect(modelPrice(info, 'input', 'CNY', 5)).toBe(10);
    expect(modelPrice(info, 'input', 'USD', 5)).toBe(2);
    expect(modelPrice(info, 'cached', 'USD', 5)).toBeNull();
    expect(modelPrice({ ...info, price: null }, 'input', 'USD', 5)).toBeNull();
  });

  it('uses Beijing dates across UTC midnight without guessing an execution time', () => {
    expect(beijingDay('2026-11-02T23:30:00Z')).toBe('2026-11-03');
    expect(resetDay({ occurredOn: null, confirmedAt: '2026-11-02T23:30:00Z' } as ResetEvent)).toBe('2026-11-03');
    expect(resetDay({ occurredOn: '2026-11-01', confirmedAt: '2026-11-02T23:30:00Z' } as ResetEvent)).toBe('2026-11-01');
  });

  it('never presents an estimate or likely-completed status as a confirmed reset', () => {
    const event = { status: 'announced', presentation: { status: 'likely_completed' } } as ResetEvent;
    expect(resetStatus(event)).toContain('尚未确认');
    expect(resetStatus({ ...event, status: 'confirmed', confirmationBasis: 'source_post' })).toBe('原帖已确认');
    expect(resetStatus({ ...event, status: 'confirmed', confirmationBasis: 'receipt_review' })).toBe('已核验');
  });
});
