// BlastSimulator2026 — known text-correctness defects (issue #492, section 1).
//
// src/core/i18n/glossary.ts's `KNOWN_TEXT_DEFECTS` records text that is
// simply wrong relative to the actual UI, or a straight typo — distinct from
// the "many names, one concept" terminology drift covered by
// glossaryConformance.test.ts. One assertion target per defect:
//   - tutorial.step2 / step4 / step11 / step13 (fr): "Emboutez" (to
//     dent/stamp) where "Embauchez" (to hire) is meant.
//
// #923: the tutorial.step1 defect (speed controls said to be in the
// top-right corner) is gone along with the standalone 'time-speed' step it
// belonged to — the key no longer exists in either locale, and
// KNOWN_TEXT_DEFECTS no longer records it.
//
// Every case below is fixed and green; this suite guards against a
// regression reintroducing any of these defects.

import { describe, it, expect } from 'vitest';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import { KNOWN_TEXT_DEFECTS } from '../../../src/core/i18n/glossary.js';

const en: Record<string, string> = enLocale as Record<string, string>;
const fr: Record<string, string> = frLocale as Record<string, string>;

describe('KNOWN_TEXT_DEFECTS — sanity', () => {
  it('lists the 4 Emboutez typos as fr defects', () => {
    // #923: tutorial.step1 (the old speed-controls-location text) no longer
    // exists — the standalone 'time-speed' step it belonged to is gone, and
    // KNOWN_TEXT_DEFECTS no longer records it (glossary.ts).
    expect(KNOWN_TEXT_DEFECTS.find((d) => d.key === 'tutorial.step1')).toBeUndefined();

    const typoKeys = ['tutorial.step2', 'tutorial.step4', 'tutorial.step11', 'tutorial.step13'];
    for (const key of typoKeys) {
      const defect = KNOWN_TEXT_DEFECTS.find((d) => d.key === key && d.locale === 'fr');
      expect(defect, `glossary.ts must record a fr Emboutez defect for ${key}`).toBeTruthy();
    }
  });
});

describe('fr.json — "Emboutez" typo replaced with "Embauchez" (to hire)', () => {
  const typoKeys = ['tutorial.step2', 'tutorial.step4', 'tutorial.step11', 'tutorial.step13'] as const;

  for (const key of typoKeys) {
    it(`fr.json "${key}" does not contain the "Emboutez" typo`, () => {
      expect(fr[key]).not.toMatch(/Emboutez/);
    });

    it(`fr.json "${key}" contains "Embauchez" instead`, () => {
      expect(fr[key]).toMatch(/Embauchez/);
    });
  }
});

describe('en.json — the equivalent tutorial hire steps use "Hire", unaffected by the fr typo', () => {
  const hireKeys = ['tutorial.step2', 'tutorial.step4', 'tutorial.step11', 'tutorial.step13'] as const;

  for (const key of hireKeys) {
    it(`en.json "${key}" contains "Hire"`, () => {
      expect(en[key]).toMatch(/Hire/i);
    });
  }
});

describe('ui.shady.exposure_note — #1410 describes the real consequence of exposure', () => {
  it('en no longer claims arrangements are "more likely to go wrong"', () => {
    expect(en['ui.shady.exposure_note']).not.toMatch(/more likely to go wrong/i);
    expect(en['ui.shady.exposure_note']).toMatch(/exposure/i);
    expect(en['ui.shady.exposure_note']).toMatch(/arrest/i);
  });

  it('fr no longer claims arrangements are "susceptible de mal tourner"', () => {
    expect(fr['ui.shady.exposure_note']).not.toMatch(/susceptible de mal tourner/i);
    expect(fr['ui.shady.exposure_note']).toMatch(/exposition/i);
    expect(fr['ui.shady.exposure_note']).toMatch(/arrêt/i);
  });
});

// #2237 — fr calques (word-for-word English renderings) and a tu-form tagline.
// Each key is recorded in KNOWN_TEXT_DEFECTS and its fr value guarded here.
const CALQUE_FIXES: ReadonlyArray<{
  key: string;
  gone: string;
  expected: string;
}> = [
  { key: 'game.subtitle', gone: 'Creuse. Explose. Profite.', expected: 'Creusez. Explosez. Profitez.' },
  { key: 'economy.negotiation.failure', gone: 'Négociation échouée', expected: 'Échec de la négociation' },
  { key: 'saveload.slot_name', gone: 'Créneau', expected: 'Emplacement' },
  { key: 'course.driving.truck', gone: 'Permis Conduite', expected: 'Permis de camion' },
  { key: 'tutorial.stage.hire_surveyor', gone: 'à côté de prospecteur', expected: 'à côté du prospecteur' },
  { key: 'inspector.command_failed', gone: 'Action échouée', expected: "Échec de l'action" },
  { key: 'mining.survey.failed', gone: 'relevé', expected: 'sondage' },
  { key: 'notification.corruption.scandal', gone: 'versé à {target}', expected: 'visant {target}' },
  { key: 'tick.contract_completed_bonus', gone: "Prime d'avance", expected: 'Prime de livraison anticipée' },
];

const placeholders = (s: string): string[] => (s.match(/\{[^}]+\}/g) ?? []).slice().sort();

describe('#2237 — fr calque fixes are recorded in KNOWN_TEXT_DEFECTS', () => {
  for (const { key } of CALQUE_FIXES) {
    it(`glossary.ts records a fr defect for ${key}`, () => {
      const defect = KNOWN_TEXT_DEFECTS.find((d) => d.key === key && d.locale === 'fr');
      expect(defect, `KNOWN_TEXT_DEFECTS must hold a fr entry for ${key}`).toBeTruthy();
      expect(defect?.problem.length ?? 0).toBeGreaterThan(0);
      expect(defect?.expectedFix.length ?? 0).toBeGreaterThan(0);
    });
  }

  it('records no en defect for these keys (en.json is untouched)', () => {
    for (const { key } of CALQUE_FIXES) {
      expect(KNOWN_TEXT_DEFECTS.find((d) => d.key === key && d.locale !== 'fr')).toBeUndefined();
    }
  });
});

describe('#2237 — fr.json calque fixes', () => {
  for (const { key, gone, expected } of CALQUE_FIXES) {
    it(`fr "${key}" no longer contains "${gone}"`, () => {
      expect(fr[key]).toBeTypeOf('string');
      expect(fr[key]).not.toContain(gone);
    });

    it(`fr "${key}" contains "${expected}"`, () => {
      expect(fr[key]).toContain(expected);
    });

    it(`fr "${key}" keeps the placeholder set of en`, () => {
      expect(en[key], `en.json must still carry ${key}`).toBeTypeOf('string');
      expect(placeholders(fr[key] ?? '')).toEqual(placeholders(en[key] ?? ''));
    });
  }

  it('game.subtitle drops the tu-form imperatives entirely', () => {
    for (const verb of ['Creuse.', 'Explose.', 'Profite.']) {
      expect(fr['game.subtitle']).not.toContain(verb);
    }
  });
});

describe('fr.json ui.* — #2236 calques rewritten', () => {
  const cases: [string, RegExp, RegExp][] = [
    ['ui.modifier.work_stoppage', /Arrêt de travail/, /Arrêt des travaux/],
    ['ui.crew.location_bench', /Palier/, /Gradin/],
    ['ui.event.category.lawsuit', /Poursuite/, /Procès/],
    ['ui.shady.frame_label', /MONTER UN COUP/, /MONTER UN DOSSIER/],
    ['ui.permit.all_met', /chercher plus fort/, /plus en profondeur/],
  ];
  for (const [key, bad, good] of cases) {
    it(`${key} is recorded as a known defect and no longer reads as the calque`, () => {
      expect(KNOWN_TEXT_DEFECTS.find((d) => d.key === key && d.locale === 'fr')).toBeTruthy();
      expect(fr[key]).not.toMatch(bad);
      expect(fr[key]).toMatch(good);
    });
  }
});

describe('event.politics_ / event.lawsuit_ calques — #2238 French rewrites', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
  [
    "event.lawsuit_wrongful_death.res0",
    "homicide involontaire",
    "décès injustifié"
  ],
  [
    "event.lawsuit_mountaineer.desc",
    "le saccage de la montagne",
    "vu la montagne saccagée"
  ],
  [
    "event.lawsuit_patent_troll.title",
    "Troll des Brevets",
    "Chasseur de Brevets"
  ],
  [
    "event.lawsuit_noise_restraining.res0",
    "éloignement",
    "ordonnance restrictive"
  ],
  [
    "event.politics_celebrity_protest.res1",
    "ce silence",
    "cet silence"
  ],
  [
    "event.politics_client_scandal.res0",
    "éclaboussé par le scandale",
    "client scandalisé"
  ],
  [
    "event.politics_un_inspector.res1",
    "procès-verbal",
    "citation officielle"
  ],
  [
    "event.politics_tax_reform.res1",
    "société-écran",
    "coquille offshore"
  ]
];

  for (const [key, expected, old] of cases) {
    it(`KNOWN_TEXT_DEFECTS records a fr defect for ${key}`, () => {
      expect(KNOWN_TEXT_DEFECTS.find((d) => d.key === key && d.locale === 'fr')).toBeTruthy();
    });

    it(`fr.json "${key}" no longer says "${old}"`, () => {
      expect(fr[key]).not.toContain(old);
    });

    it(`fr.json "${key}" says "${expected}"`, () => {
      expect(fr[key]).toContain(expected);
    });
  }
});

describe('event.mafia_ / event.weather_ calques — #2239 French rewrites', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["event.mafia_hide_witness.res1", "quiconque", "qui que ce soit"],
    ["event.mafia_police_raid_tip.res0", "descente", "raid"],
    ["event.mafia_stolen_vehicles.res2_alt", "numéro de châssis", "numéro de série"],
    ["event.mafia_tattoo_shop.res0", "posent", "pose exactement"],
    ["event.weather_ore_hail.res1", "des bleus", "contusionner"],
    ["event.weather_logo_cloud.res2", "produits dérivés", "goodies"],
    ["event.weather_suspiciously_perfect.title", "Trop Beau pour Être Vrai", "Suspicieusement"],
    ["event.mafia_zoning_favors.opt2", "Reclassement", "Rezonage"],
  ];

  for (const [key, expected, old] of cases) {
    it(`KNOWN_TEXT_DEFECTS records a fr defect for ${key}`, () => {
      expect(KNOWN_TEXT_DEFECTS.find((d) => d.key === key && d.locale === 'fr')).toBeTruthy();
    });

    it(`fr.json "${key}" no longer says "${old}"`, () => {
      expect(fr[key]).not.toContain(old);
    });

    it(`fr.json "${key}" says "${expected}"`, () => {
      expect(fr[key]).toContain(expected);
    });
  }
});

describe('event.union_ / misc event calques — #2240 French rewrites', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['event.legendary_vein.res0', 'tréranium', 'trérnium'],
    ['event.union_ghost_backpay.res3', 'Chargé de Sécurité', 'Officier de Sécurité'],
    ['event.union_lunch_thief.res0', 'voleur de casse-croûte', 'voleur de lunch'],
    ['event.union_overtime_revolt.res1', 'devinettes', 'en pari'],
    ['event.union_hazard_emotional.res2', 'Ce sont, techniquement', "C'est, techniquement"],
    ['event.barren_blast.desc', 'sondage', 'relevé'],
  ];

  for (const [key, expected, old] of cases) {
    it(`KNOWN_TEXT_DEFECTS records a fr defect for ${key}`, () => {
      expect(KNOWN_TEXT_DEFECTS.find((d) => d.key === key && d.locale === 'fr')).toBeTruthy();
    });

    it(`fr.json "${key}" no longer says "${old}"`, () => {
      expect(fr[key]).not.toContain(old);
    });

    it(`fr.json "${key}" says "${expected}"`, () => {
      expect(fr[key]).toContain(expected);
    });
  }
});
