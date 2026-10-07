// BlastSimulator2026 — tutorial cards must quote control names exactly (#1331).
//
// A tutorial card that tells the player to click "Fire" when the button reads
// "Blast!" sends them hunting. Each card below names one or more on-screen
// controls; the card text must contain the control's label verbatim, in both
// locales. Case-sensitive, no normalization: the label key's value is the
// exact string the player sees.

import { describe, it, expect } from 'vitest';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const LOCALES: Record<string, Record<string, string>> = {
  en: enLocale as Record<string, string>,
  fr: frLocale as Record<string, string>,
};

/** Tutorial key (under `tutorial.`) -> locale keys of the labels it must quote. */
const CARD_CONTROLS: Record<string, string[]> = {
  'stage.hire_surveyor': ['ui.crew.hire'],
  'stage.hire_driller': ['ui.crew.hire'],
  'stage.hire_manager': ['ui.crew.hire'],
  'stage.hire_driver': ['ui.crew.hire'],
  step2: ['ui.crew.hire'],
  'stage.open_crew': ['shell.rail.employees'],
  'stage.open_survey': ['shell.rail.survey'],
  'stage.open_blast': ['shell.rail.blast'],
  'stage.sound_horn': ['ui.blast_workshop.fire.sound_horn'],
  'stage.open_contracts': ['shell.rail.contracts'],
  'stage.open_vehicles': ['shell.rail.vehicles'],
  'stage.open_build': ['shell.rail.build'],
  'stage.open_settings': ['shell.rail.settings'],
  'stage.open_ops': ['shell.rail.ops'],
  'stage.survey_method': ['survey.seismic'],
  'stage.survey_run': ['ui.survey.pick_target_scene'],
  'stage.grid_tool': ['ui.blast_workshop.drill.grid_tool'],
  'stage.drill_area': [
    'ui.blast_workshop.drill.spacing',
    'ui.blast_workshop.drill.depth',
  ],
  'stage.charge_all': [
    'ui.blast_workshop.charge.charge_all',
    'ui.blast_workshop.charge.amount',
    'ui.blast_workshop.charge.stemming',
  ],
  'stage.auto_sequence': ['ui.blast_workshop.sequence.auto'],
  'stage.execute': ['ui.blast_workshop.footer.fire'],
  'stage.contract_deliver': ['ui.contracts.deliver'],
  'stage.build_warehouse': ['ui.build.place'],
  'stage.build_living_quarters': ['ui.build.place'],
  'stage.build_driving_center': ['ui.build.place'],
  'stage.policy_continuous': ['ui.policy.shift_mode', 'ui.policy.continuous'],
  step_earlypolicy: ['ui.policy.shift_mode', 'ui.policy.continuous'],
  'stage.train_fragmenter': ['ui.crew.train'],
  'stage.ramp_tool': ['ui.build.ramp'],
};

const ROWS = Object.entries(CARD_CONTROLS).flatMap(([card, labels]) =>
  labels.map((label) => ({ cardKey: `tutorial.${card}`, labelKey: label })),
);

describe.each(Object.keys(LOCALES))('tutorial cards name real controls (%s)', (code) => {
  const locale = LOCALES[code] as Record<string, string>;

  it('every card key and label key exists (no vacuous pass)', () => {
    const missing: string[] = [];
    for (const { cardKey, labelKey } of ROWS) {
      for (const key of [cardKey, labelKey]) {
        if (typeof locale[key] !== 'string' || locale[key].length === 0) missing.push(key);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it.each(ROWS.map((r) => [r.cardKey, r.labelKey] as const))('%s quotes %s', (cardKey, labelKey) => {
    const card = locale[cardKey] as string;
    const label = locale[labelKey] as string;
    expect(
      card.includes(label),
      `[${code}] ${cardKey} must contain the exact control label "${label}" (${labelKey}); card reads: "${card}"`,
    ).toBe(true);
  });
});

// The cards must also quote the stepper values the scenario sets (#1338), so a
// player following the card lands on the exact drill grid and charge the
// tutorial expects.
describe.each(Object.keys(LOCALES))('tutorial stepper values are named on the cards (%s)', (code) => {
  const locale = LOCALES[code] as Record<string, string>;
  const cases: Array<[string, string[]]> = [
    ['tutorial.stage.drill_area', ['4', '8']],
    ['tutorial.stage.charge_all', ['4', '2.5']],
  ];
  it.each(cases)('%s names its values', (cardKey, values) => {
    const card = locale[cardKey] as string;
    for (const v of values) {
      // fr writes the decimal separator as a comma ("2,5 m").
      const sep = code === 'fr' ? '[.,]' : '\\.';
      expect(new RegExp(`(^|[^0-9.,])${v.replace('.', sep)}(?![0-9])`).test(card), `[${code}] ${cardKey} lacks "${v}": ${card}`).toBe(true);
    }
  });
});
