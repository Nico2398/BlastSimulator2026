// BlastSimulator2026 — the player-facing blast buttons are named "Blast" (#1749).
// Per-key assertions: the 13 keys that used to say Fire/Detonate/Tir/Tirer/Déclencher.

import { describe, it, expect } from 'vitest';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const EN = enLocale as Record<string, string>;
const FR = frLocale as Record<string, string>;

const EXACT: Array<[string, string, string]> = [
  ['ui.blast_workshop.step.fire', 'Blast', 'Blast'],
  ['ui.blast_workshop.footer.fire', 'Blast', 'Blast'],
  ['ui.blast_workshop.preflight.detonate', 'Blast', 'Blast'],
  ['ui.blast_workshop.preflight.fire_anyway', 'Blast anyway', 'Blast quand même'],
  ['ui.blast_workshop.preflight.cancel_detonation', 'Cancel blast', 'Annuler le blast'],
];

const RENAMED_KEYS = [
  ...EXACT.map(([k]) => k),
  'ui.blast_workshop.preflight.stranded_names',
  'ui.blast_workshop.fire.check_zone_occupied',
  'ui.blast_workshop.fire.check_zone_occupied_stranded',
  'tutorial.step_evacuate',
  'tutorial.stage.open_fire_tab',
  'tutorial.stage.execute',
  'tutorial.stage.detonate',
  'tutorial.stage.detonation_stranded',
];

const TUTORIAL_KEYS = RENAMED_KEYS.filter((k) => k.startsWith('tutorial.'));

// Capitalised verbs/nouns are button names; lowercase imperatives are checked too.
const EN_OLD = /\b(fire|firing|detonate|detonation)\b/i;
const FR_OLD = /\b(Tir|Tirer|Tirez|tirer|tirez)\b|d[ée]clench/i;

describe('blast button terminology (#1749)', () => {
  it('there are 13 renamed keys', () => {
    expect(new Set(RENAMED_KEYS).size).toBe(13);
  });

  it.each(EXACT)('%s has the exact new value', (key, en, fr) => {
    expect(EN[key]).toBe(en);
    expect(FR[key]).toBe(fr);
  });

  it.each(RENAMED_KEYS)('%s no longer names Fire/Detonate (en)', (key) => {
    expect(typeof EN[key]).toBe('string');
    expect(EN[key], `en ${key}: ${EN[key]}`).not.toMatch(EN_OLD);
  });

  it.each(RENAMED_KEYS)('%s no longer names Tir/Tirer/Déclencher (fr)', (key) => {
    expect(typeof FR[key]).toBe('string');
    expect(FR[key], `fr ${key}: ${FR[key]}`).not.toMatch(FR_OLD);
  });

  it.each(TUTORIAL_KEYS)('%s teaches the Blast button in both locales', (key) => {
    expect(EN[key], `en ${key}`).toContain('Blast');
    expect(FR[key], `fr ${key}`).toContain('Blast');
  });
});
