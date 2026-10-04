// #1341 — the Finances panel renders ui.finances.category.<category> for every
// ledger category, so the new 'explosives' expense category needs both locales.
import { describe, it, expect } from 'vitest';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

describe('ui.finances.category.explosives (#1341)', () => {
  it('has an English label', () => {
    expect(en['ui.finances.category.explosives']).toBe('Explosives');
  });

  it('has a French label', () => {
    expect(fr['ui.finances.category.explosives']).toBe('Explosifs');
  });
});
