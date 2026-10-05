import { describe, it, expect, afterEach } from 'vitest';
import { formatGameDuration } from '../../../src/ui/formatGameDuration.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { TICKS_PER_DAY } from '../../../src/core/config/balance.js';

describe('formatGameDuration (en)', () => {
  afterEach(() => { setLocale('en'); });

  it('uses 24 ticks per day', () => {
    expect(TICKS_PER_DAY).toBe(24);
  });

  it.each([
    [0, '0h'],
    [5, '5h'],
    [23, '23h'],
    [24, '1d'],
    [30, '1d 6h'],
    [48, '2d'],
    [70, '2d 22h'],
    [100, '4d 4h'],
    [80, '3d 8h'],
  ])('%i ticks -> %s', (ticks, expected) => {
    setLocale('en');
    expect(formatGameDuration(ticks)).toBe(expected);
  });

  it('clamps negatives to 0h', () => {
    expect(formatGameDuration(-5)).toBe('0h');
  });

  it('floors fractional ticks', () => {
    expect(formatGameDuration(5.9)).toBe('5h');
    expect(formatGameDuration(24.99)).toBe('1d');
    expect(formatGameDuration(0.5)).toBe('0h');
  });
});

describe('formatGameDuration (fr)', () => {
  afterEach(() => { setLocale('en'); });

  it.each([
    [0, '0 h'],
    [5, '5 h'],
    [24, '1 j'],
    [30, '1 j 6 h'],
    [70, '2 j 22 h'],
    [100, '4 j 4 h'],
  ])('%i ticks -> %s', (ticks, expected) => {
    setLocale('fr');
    expect(formatGameDuration(ticks)).toBe(expected);
  });

  it('clamps negatives and floors fractions', () => {
    setLocale('fr');
    expect(formatGameDuration(-1)).toBe('0 h');
    expect(formatGameDuration(5.7)).toBe('5 h');
  });
});
