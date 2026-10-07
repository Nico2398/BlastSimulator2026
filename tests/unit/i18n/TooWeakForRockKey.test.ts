import { describe, it, expect } from 'vitest';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

const KEY = 'ui.blast_workshop.charge.too_weak_for_rock';

describe('too_weak_for_rock warning text (#1358)', () => {
  for (const [name, locale] of [['en', en], ['fr', fr]] as const) {
    it(`${name} defines the key with {explosive}, {rock}, {count} and {total}`, () => {
      const text = (locale as Record<string, string>)[KEY];
      expect(text, `${name}.json missing ${KEY}`).toBeTypeOf('string');
      for (const p of ['{explosive}', '{rock}', '{count}', '{total}']) expect(text).toContain(p);
    });
  }

  it('en reads "<explosive> is too weak for <rock> under <count> of <total> holes"', () => {
    expect((en as Record<string, string>)[KEY]).toBe('{explosive} is too weak for {rock} under {count} of {total} holes');
  });
});
