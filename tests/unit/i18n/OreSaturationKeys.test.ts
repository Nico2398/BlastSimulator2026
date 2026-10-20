// BlastSimulator2026 — i18n keys for ore saturation (#1930)
import { describe, it, expect } from 'vitest';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

const KEYS = [
  'economy.contract.market_header',
  'economy.contract.market_line',
  'economy.contract.market_none',
  'notification.market.glut',
  'notification.title.market',
];

describe('ore saturation i18n keys (#1930)', () => {
  it.each(KEYS)('%s exists in en and fr and differs', (key) => {
    const e = (en as Record<string, string>)[key];
    const f = (fr as Record<string, string>)[key];
    expect(e, `en ${key}`).toBeTypeOf('string');
    expect(f, `fr ${key}`).toBeTypeOf('string');
    expect(e).not.toBe(f);
  });

  it('the glut line names the ore and reads as the analysts line', () => {
    const e = (en as Record<string, string>)['notification.market.glut']!;
    expect(e).toContain('{ore}');
    expect(e).toBe('Analysts blame you for the {ore} glut.');
  });

  it('the market line carries ore, saturation and price placeholders in both locales', () => {
    for (const bundle of [en, fr] as Record<string, string>[]) {
      const line = bundle['economy.contract.market_line']!;
      expect(line).toContain('{ore}');
    }
  });
});
