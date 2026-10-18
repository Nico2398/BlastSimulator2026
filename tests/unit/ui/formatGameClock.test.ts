// BlastSimulator2026 — formatGameClock: tick -> "Day N, HH:00" (#1966)

import { describe, it, expect, afterEach } from 'vitest';
import { formatGameClock } from '../../../src/ui/formatGameClock.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';

afterEach(() => setLocale('en'));

describe('formatGameClock (en)', () => {
  it.each([
    [0, 'Day 1, 00:00'],
    [1, 'Day 1, 01:00'],
    [23, 'Day 1, 23:00'],
    [24, 'Day 2, 00:00'],
    [47, 'Day 2, 23:00'],
    [437, 'Day 19, 05:00'],
    [680, 'Day 29, 08:00'],
  ])('tick %i -> %s', (tick, expected) => {
    setLocale('en');
    expect(formatGameClock(tick)).toBe(expected);
  });

  it('floors fractional ticks', () => {
    setLocale('en');
    expect(formatGameClock(23.9)).toBe('Day 1, 23:00');
  });

  it('never shows the word tick', () => {
    setLocale('en');
    expect(formatGameClock(680)).not.toContain('tick');
  });
});

describe('formatGameClock (fr)', () => {
  it.each([
    [0, 'Jour 1, 00h00'],
    [680, 'Jour 29, 08h00'],
  ])('tick %i -> %s', (tick, expected) => {
    setLocale('fr');
    expect(formatGameClock(tick)).toBe(expected);
  });
});
