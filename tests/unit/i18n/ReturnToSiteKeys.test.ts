import { describe, it, expect } from 'vitest';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;
const KEYS = [
  'ui.portfolio.back_to_site',
  'ui.portfolio.restart_confirm_title',
  'ui.portfolio.restart_confirm_body',
  'ui.portfolio.restart_confirm_button',
  'menu.resume',
];

describe('return-to-site i18n keys (#1314)', () => {
  for (const k of KEYS) {
    it(`${k} exists, non-empty, in en and fr`, () => {
      expect(en[k], `en ${k}`).toBeTruthy();
      expect(fr[k], `fr ${k}`).toBeTruthy();
    });
  }
});
