// Manager-run negotiation i18n keys (#1340)
import { describe, it, expect } from 'vitest';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

const KEYS = [
  'economy.negotiation.no_manager',
  'ui.contracts.negotiate_no_manager',
  'ui.crew.manager_effect',
  'ui.crew.manager_effect_hint',
];

describe('manager negotiation keys (#1340)', () => {
  for (const key of KEYS) {
    it(`${key} exists in en and fr and differs`, () => {
      const e = (en as Record<string, string>)[key];
      const f = (fr as Record<string, string>)[key];
      expect(e, `en ${key}`).toBeTruthy();
      expect(f, `fr ${key}`).toBeTruthy();
      expect(e).not.toBe(f);
    });
  }

  it('ui.crew.manager_effect interpolates {pct} in both locales', () => {
    expect((en as Record<string, string>)['ui.crew.manager_effect']).toContain('{pct}');
    expect((fr as Record<string, string>)['ui.crew.manager_effect']).toContain('{pct}');
  });

  it('economy.negotiation.no_manager names the Manager in en', () => {
    expect((en as Record<string, string>)['economy.negotiation.no_manager']).toMatch(/manager/i);
  });

  it('tutorial.step11 tells the player a Manager negotiates contracts', () => {
    expect((en as Record<string, string>)['tutorial.step11']).toBe('Hire a Manager to negotiate better contracts.');
    expect((fr as Record<string, string>)['tutorial.step11']).not.toBe((en as Record<string, string>)['tutorial.step11']);
    expect((fr as Record<string, string>)['tutorial.step11']).toMatch(/n[ée]goci/i);
  });
});
