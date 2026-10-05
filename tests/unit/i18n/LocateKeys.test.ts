// Locate button i18n keys (#1422)
import { describe, it, expect } from 'vitest';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

describe('locate i18n keys (#1422)', () => {
  it('ui.crew.locate exists in en and fr and differs between them', () => {
    const e = (en as Record<string, string>)['ui.crew.locate'];
    const f = (fr as Record<string, string>)['ui.crew.locate'];
    expect(typeof e).toBe('string');
    expect(typeof f).toBe('string');
    expect(e.length).toBeGreaterThan(0);
    expect(f.length).toBeGreaterThan(0);
    expect(e).not.toBe(f);
  });
});
