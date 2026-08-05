import { describe, it, expect } from 'vitest';
import { formatMoney, formatPricePerKg } from '../../../src/core/economy/formatMoney.js';

describe('formatMoney', () => {
  it('rounds a float to whole dollars', () => {
    // Cash accumulates rounding error; messages used to read
    // "have $-5839.852589446586".
    expect(formatMoney(-5839.852589446586)).toBe('-5,840');
  });

  it('groups thousands', () => {
    expect(formatMoney(1234567)).toBe('1,234,567');
  });

  it('leaves a positive amount unsigned', () => {
    expect(formatMoney(900)).toBe('900');
  });

  it('puts the sign in front of the digits', () => {
    expect(formatMoney(-42.6)).toBe('-43');
  });

  it('formats zero without a sign', () => {
    expect(formatMoney(0)).toBe('0');
    expect(formatMoney(-0.2)).toBe('0');
  });
});

describe('formatPricePerKg', () => {
  it('uses two decimals at or above $1/kg', () => {
    expect(formatPricePerKg(12.5)).toBe('12.50');
  });

  it('uses three decimals under $1/kg so a cheap rubble price does not round to $0.00', () => {
    expect(formatPricePerKg(0.6273750268155709)).toBe('0.627');
  });

  it('groups thousands', () => {
    expect(formatPricePerKg(2500)).toBe('2,500.00');
  });
});
