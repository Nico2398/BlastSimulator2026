// @vitest-environment jsdom
// BlastSimulator2026 — Tutorial stage table
//
// A stage selector that matches nothing strands the player: the guide blocks
// every control and highlights none, with no way forward and no Skip button to
// escape with. These tests are the guard against that.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { TUTORIAL_STAGES, stagesFor, REGION, PICKER_CANCEL, TUTORIAL_POLICY_FATIGUE_MIN, TUTORIAL_POLICY_FATIGUE_MAX } from '../../../src/ui/tutorialStages.js';
import { TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
import { TOOLBAR_TARGET } from '../../../src/ui/tutorialStepHelpers.js';
import { resolveStageIndex, isReachable } from '../../../src/ui/tutorialGuide.js';
import { rampDefFromEndpoints, validateRampOrder } from '../../../src/core/mining/Ramp.js';
import en from '../../../src/core/i18n/locales/en.json' with { type: 'json' };
import fr from '../../../src/core/i18n/locales/fr.json' with { type: 'json' };

const UI_DIR = resolve(import.meta.dirname, '../../../src/ui');

/** Every .ts source in src/ui, concatenated — where selectors are produced. */
const UI_SOURCE = readdirSync(UI_DIR)
  .filter(f => f.endsWith('.ts'))
  .map(f => readFileSync(resolve(UI_DIR, f), 'utf-8'))
  .join('\n');

const messages = en as Record<string, string>;
const messagesFr = fr as Record<string, string>;

/**
 * The identifying tokens of a selector: ids, classes and data-attribute values.
 * Each must appear somewhere in the UI source, or nothing will ever match it.
 */
function selectorTokens(selector: string): string[] {
  const tokens: string[] = [];
  for (const m of selector.matchAll(/#([\w-]+)/g)) tokens.push(m[1]!);
  for (const m of selector.matchAll(/\.([\w-]+)/g)) tokens.push(m[1]!);
  for (const m of selector.matchAll(/\[data-[\w-]+="([^"]+)"\]/g)) tokens.push(m[1]!);
  return tokens;
}

const ALL_STAGES = Object.entries(TUTORIAL_STAGES)
  .flatMap(([stepId, stages]) => stages.map((stage, i) => ({ stepId, i, stage })));

describe('tutorial stage table', () => {
  it('every keyed step id is a real tutorial step', () => {
    const known = new Set(TUTORIAL_STEPS.map(s => s.id));
    for (const stepId of Object.keys(TUTORIAL_STAGES)) {
      expect(known.has(stepId), `"${stepId}" is not a tutorial step`).toBe(true);
    }
  });

  it('every step the player must act on has stages', () => {
    // Terminal cards are the only ones allowed to have none.
    for (const step of TUTORIAL_STEPS) {
      const isPassive = step.id === 'free-play' || step.id === 'congratulations';
      if (isPassive) continue;
      expect(
        stagesFor(step.id, step.highlightTarget).length,
        `step "${step.id}" gives the player nothing to click`,
      ).toBeGreaterThan(0);
    }
  });

  it.each(ALL_STAGES)('$stepId stage $i targets a selector the UI produces', ({ stage }) => {
    for (const token of selectorTokens(stage.target)) {
      expect(UI_SOURCE.includes(token), `nothing in src/ui produces "${token}"`).toBe(true);
    }
  });

  it.each(ALL_STAGES)('$stepId stage $i helper selectors exist too', ({ stage }) => {
    for (const selector of stage.also ?? []) {
      for (const token of selectorTokens(selector)) {
        expect(UI_SOURCE.includes(token), `nothing in src/ui produces "${token}"`).toBe(true);
      }
    }
  });

  it.each(ALL_STAGES)('$stepId stage $i has an English instruction', ({ stage }) => {
    expect(messages[stage.hintKey], `missing en key ${stage.hintKey}`).toBeTruthy();
  });

  it.each(ALL_STAGES)('$stepId stage $i has a French instruction', ({ stage }) => {
    expect(messagesFr[stage.hintKey], `missing fr key ${stage.hintKey}`).toBeTruthy();
  });

  it('no stage repeats the selector of the stage before it', () => {
    for (const [stepId, stages] of Object.entries(TUTORIAL_STAGES)) {
      for (let i = 1; i < stages.length; i++) {
        expect(
          stages[i]!.target,
          `${stepId} stage ${i} repeats stage ${i - 1}, so it can never advance`,
        ).not.toBe(stages[i - 1]!.target);
      }
    }
  });

  it('no picker stage instruction prints tile coordinates (#489)', () => {
    // Naming the corners was the old answer to "which rectangle?", and it made
    // the step impossible: there is no control that takes a typed tile, so a
    // player reading "(20, 20) to (30, 30)" had numbers and nothing to do with
    // them. The region is drawn in the scene and the picker snaps to it, so the
    // instruction points at the outline instead.
    for (const { stepId, stage } of ALL_STAGES) {
      if (!stage.region) continue;
      for (const [loc, table] of [['en', messages], ['fr', messagesFr]] as const) {
        const text = table[stage.hintKey] ?? '';
        for (const token of ['{x1}', '{z1}', '{x2}', '{z2}']) {
          expect(text.includes(token), `${stepId} (${loc}): instruction still prints ${token}`).toBe(false);
        }
        expect(
          /\(?\d+\s*,\s*\d+\)?/.test(text),
          `${stepId} (${loc}): instruction still prints a coordinate pair`,
        ).toBe(false);
      }
    }
  });

  it('every guided placement pins an exact answer (#489)', () => {
    // "The player has too much freedom in the tutorial": a region that merely
    // bounds the placement lets the step end in a layout it never taught.
    for (const { stepId, stage } of ALL_STAGES) {
      if (!stage.region) continue;
      expect(stage.region.exact, `${stepId}: guided placement accepts more than the one it teaches`).toBe(true);
    }
  });

  // ── #1015: no step teaches the speed bar any more — it is unconditionally
  // player-controlled from the tutorial's first step onward (BASE_PERMANENTLY_ALLOWED,
  // tutorialRails.ts), so neither 'speed-up-for-dig' nor 'speed-normal-after-dig'
  // has a TUTORIAL_STAGES entry (or exists as a step at all) any more.
  describe('speed-control stages are gone (#1015)', () => {
    it('no "time-speed" entry exists in TUTORIAL_STAGES any more', () => {
      expect(TUTORIAL_STAGES['time-speed']).toBeUndefined();
    });

    it('no "speed-up-for-dig" or "speed-normal-after-dig" entry exists in TUTORIAL_STAGES', () => {
      expect(TUTORIAL_STAGES['speed-up-for-dig']).toBeUndefined();
      expect(TUTORIAL_STAGES['speed-normal-after-dig']).toBeUndefined();
    });

    it('no stage entries remain for the removed set-policy / tick-advance / victory steps (#1328)', () => {
      for (const id of ['set-policy', 'tick-advance', 'victory', 'free-play']) {
        expect(TUTORIAL_STAGES[id], id).toBeUndefined();
      }
    });
  });

  it('a region is a well-formed rectangle', () => {
    for (const { stepId, stage } of ALL_STAGES) {
      const r = stage.region;
      if (!r) continue;
      expect(r.x2, `${stepId} region x`).toBeGreaterThanOrEqual(r.x1);
      expect(r.z2, `${stepId} region z`).toBeGreaterThanOrEqual(r.z1);
      expect(r.x1).toBeGreaterThanOrEqual(0);
      expect(r.z1).toBeGreaterThanOrEqual(0);
    }
  });

  it('the grid tool demands an exact rectangle', () => {
    const canvasStage = TUTORIAL_STAGES['drill-plan']!
      .find(s => s.target.includes('canvas'))!;
    expect(canvasStage.region?.exact).toBe(true);
  });

  it('multi-click steps really do have more than one stage', () => {
    // Every one of these opens a panel before acting in it. A single stage here
    // is the bug this whole table exists to fix.
    for (const stepId of [
      // haul-debris (#552) is deliberately excluded: hauling self-dispatches
      // now, so the step is a single watch-only stage, not a click sequence.
      'hire-surveyor', 'survey', 'drill-plan', 'blast',
      'vehicle-buy-assign', 'build-storage', 'box-cut',
    ]) {
      expect(TUTORIAL_STAGES[stepId]!.length, `${stepId} should be multi-stage`)
        .toBeGreaterThan(1);
    }
  });
});

describe('sell-ore stage list (#1335 — accept scoped to the fillable ore offer)', () => {
  it('has no contract-accept stage list any more', () => {
    expect(TUTORIAL_STAGES['contract-accept']).toBeUndefined();
  });

  it('scopes the Accept target to fillable ore_sale offers only', () => {
    const accept = TUTORIAL_STAGES['sell-ore']!
      .find(s => s.target.includes('.bs-contract-accept'))!;
    expect(accept).toBeDefined();
    expect(accept.target).toContain('[data-contract-type="ore_sale"]');
    expect(accept.target).toContain('[data-contract-fillable="true"]');
    expect(accept.target).toContain('.bs-contract-accept');
  });

  it('keeps Deliver and the amount box as also-allowed controls', () => {
    const accept = TUTORIAL_STAGES['sell-ore']!
      .find(s => s.target.includes('.bs-contract-accept'))!;
    expect((accept.also ?? []).some(a => a.includes('.bs-contract-deliver'))).toBe(true);
    expect((accept.also ?? []).some(a => a.includes('.bs-contract-amount'))).toBe(true);
  });
});

describe('sell-ore doneTarget (#1335 — active card Deliver keeps the stage resolved)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function mountCard(kind: 'active' | 'offered'): void {
    const panel = document.createElement('div');
    panel.id = 'bs-contract-panel';
    document.body.appendChild(panel);
    const card = document.createElement('div');
    card.dataset['contractType'] = 'ore_sale';
    panel.appendChild(card);
    // Mirrors ContractsPanel: only active cards carry Deliver; offered cards carry Accept.
    if (kind === 'active') {
      const deliver = makeButton({}, card);
      deliver.classList.add('bs-contract-deliver');
    } else {
      const accept = makeButton({}, card);
      accept.classList.add('bs-contract-accept');
    }
  }

  it('resolves to the sell-ore stage, not stage 0, with only an active ore card Deliver present', () => {
    mountCard('active');
    const stages = TUTORIAL_STAGES['sell-ore']!;
    const index = resolveStageIndex(stages);
    expect(index).not.toBe(0);
    expect(stages[index]!.hintKey).toBe('tutorial.stage.sell_ore');
  });

  it('does not satisfy doneTarget for an offered ore card lacking Deliver', () => {
    mountCard('offered');
    const stages = TUTORIAL_STAGES['sell-ore']!;
    const doneTarget = stages.find((s) => s.doneTarget)!.doneTarget!;
    expect(isReachable(doneTarget)).toBe(false);
    expect(resolveStageIndex(stages)).toBe(0);
  });
});

describe('haul-debris stage list (#552— self-dispatching, no manual Haul button)', () => {
  // Hauling is fully automatic now: on-ground fragments spawn their own
  // PendingActions and a qualified employee claims/drives/delivers them with
  // no player click. The step has nothing left to walk the player through
  // stage by stage — it teaches watching, not clicking — so TUTORIAL_STAGES
  // carries one explicit watch-only stage (matching every other step's
  // convention of a keyed entry) pointing at the same Fleet toolbar target
  // as the step's own highlightTarget, rather than relying on stagesFor's
  // generic fallback.

  it('has a single keyed TUTORIAL_STAGES entry pointing at the Fleet toolbar', () => {
    const step = TUTORIAL_STEPS.find(s => s.id === 'haul-debris')!;
    expect(step.highlightTarget).toBeDefined();

    expect(TUTORIAL_STAGES['haul-debris']).toHaveLength(1);
    expect(TUTORIAL_STAGES['haul-debris']![0]!.target).toBe(step.highlightTarget);
  });

  it('agrees with stagesFor when the step\'s own highlightTarget is passed', () => {
    const step = TUTORIAL_STEPS.find(s => s.id === 'haul-debris')!;

    const stages = stagesFor('haul-debris', step.highlightTarget);

    expect(stages).toHaveLength(1);
    expect(stages[0]!.target).toBe(step.highlightTarget);
  });

  it('never targets the retired Fleet-panel Haul button', () => {
    const step = TUTORIAL_STEPS.find(s => s.id === 'haul-debris')!;
    const stages = stagesFor('haul-debris', step.highlightTarget);

    for (const stage of stages) {
      expect(stage.target).not.toBe('#bs-vehicle-panel .bs-vehicle-haul-btn');
      expect(stage.also ?? []).not.toContain('#bs-vehicle-panel .bs-vehicle-haul-btn');
    }
  });
});

describe('buy-drill-rig-assign / buy-rock-digger-assign / vehicle-buy-assign stage lists (#921 — no player driver assignment)', () => {
  // A vehicle's driver is claimed automatically now (VehicleReservation/
  // ArrivalGate), so the third stage each of these used to carry — clicking
  // `.bs-vehicle-assign-btn` — is gone. Each list ends on the vehicle-buy
  // click itself.
  const RETARGETED_IDS = ['buy-drill-rig-assign', 'buy-rock-digger-assign', 'vehicle-buy-assign'];

  for (const id of RETARGETED_IDS) {
    it(`"${id}" has exactly 2 stages, ending on the vehicle-buy click`, () => {
      const stages = TUTORIAL_STAGES[id];
      expect(stages, `no TUTORIAL_STAGES entry for "${id}"`).toBeDefined();
      expect(stages!.length, `"${id}" should have 2 stages now that assign is automatic`).toBe(2);
      const last = stages![stages!.length - 1]!;
      expect(last.target, `"${id}"'s last stage should target the vehicle-buy control, not an assign button`)
        .not.toMatch(/assign/i);
    });

    it(`"${id}" has no stage targeting the retired ".bs-vehicle-assign-btn" control`, () => {
      const stages = TUTORIAL_STAGES[id] ?? [];
      for (const stage of stages) {
        expect(stage.target).not.toMatch(/bs-vehicle-assign-btn/);
        expect(stage.also ?? []).not.toEqual(
          expect.arrayContaining([expect.stringMatching(/bs-vehicle-assign-btn/)]),
        );
        expect(stage.doneTarget ?? '').not.toMatch(/bs-vehicle-assign-btn/);
      }
    });
  }
});

describe('toggle-survey-overlay stage fallback (#905)', () => {
  // Genuinely one click — no explicit TUTORIAL_STAGES entry needed.
  // stagesFor()'s own fallback (a single stage built from the step's
  // highlightTarget) already covers it.
  const TARGET = '#bs-survey-panel [data-role="overlay-toggle"]';

  it('has no explicit TUTORIAL_STAGES entry', () => {
    expect(TUTORIAL_STAGES['toggle-survey-overlay']).toBeUndefined();
  });

  it('stagesFor falls back to a single stage targeting the Survey panel\'s overlay-toggle button', () => {
    const stages = stagesFor('toggle-survey-overlay', TARGET);
    expect(stages).toHaveLength(1);
    expect(stages[0]!.target).toBe(TARGET);
  });
});

// Mirrors BlastWorkshop.ts's real DOM shape (see the #926 describe below).
function withBox(el: HTMLElement): HTMLElement {
  el.getBoundingClientRect = () => ({
    width: 40, height: 20, top: 0, left: 0, right: 40, bottom: 20, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  return el;
}

function makeButton(attrs: Record<string, string>, parent: HTMLElement): HTMLButtonElement {
  const btn = document.createElement('button');
  for (const [k, v] of Object.entries(attrs)) btn.setAttribute(k, v);
  parent.appendChild(btn);
  withBox(btn);
  return btn;
}

describe('sequence stage list is gone (#1344)', () => {
  it('TUTORIAL_STAGES has no sequence entry', () => {
    expect(Object.keys(TUTORIAL_STAGES)).not.toContain('sequence');
    expect(TUTORIAL_STAGES['sequence']).toBeUndefined();
  });

  it('no stage of any step targets an auto-sequence control or a data-step 5 tab', () => {
    for (const [id, stages] of Object.entries(TUTORIAL_STAGES)) {
      for (const stage of stages) {
        expect(stage.target, `${id} targets a removed control`).not.toContain('auto-sequence');
        expect(stage.target, `${id} targets a removed tab`).not.toContain('data-step="5"');
      }
    }
  });
});

describe('evacuate-zone stages after the horn button is gone (#1362, was #1337)', () => {
  it('no stage targets the removed sound-horn control or uses its hint key', () => {
    const stages = TUTORIAL_STAGES['evacuate-zone']!;
    expect(stages.length).toBeGreaterThan(0);
    for (const st of stages) {
      expect(st.target).not.toContain('sound-horn');
      expect(st.hintKey).not.toBe('tutorial.stage.sound_horn');
    }
  });

  it('starts at the toolbar Blast button and still carries no spentWhen on any stage', () => {
    const stages = TUTORIAL_STAGES['evacuate-zone']!;
    expect(stages[0]!.hintKey).toBe('tutorial.stage.open_blast');
    for (const st of stages) {
      expect((st as { spentWhen?: unknown }).spentWhen).toBeUndefined();
    }
  });

  it('every stage hint resolves to distinct en and fr text', () => {
    for (const st of TUTORIAL_STAGES['evacuate-zone']!) {
      const enText = (en as Record<string, string>)[st.hintKey];
      const frText = (fr as Record<string, string>)[st.hintKey];
      expect(enText, `missing en key ${st.hintKey}`).toBeTruthy();
      expect(frText, `missing fr key ${st.hintKey}`).toBeTruthy();
      expect(enText).not.toBe(frText);
    }
  });

  it('the horn stage hint key is removed from both locales', () => {
    expect((en as Record<string, string>)['tutorial.stage.sound_horn']).toBeUndefined();
    expect((fr as Record<string, string>)['tutorial.stage.sound_horn']).toBeUndefined();
  });
});

describe('event-fire-resolve stage targets exactly the highlighted choice (#951)', () => {
  // The 3 consultant-event choices have materially different effects
  // (TutorialEvents.ts: option 1 is -$3,000/+15 well-being, option 2 is
  // -10 well-being/-5 safety, option 3 is +5 well-being/-5 safety). The
  // stage used to target every `.bs-event-choice` sibling (matching all 3),
  // letting applyRails' modal blanket-allowance leave all 3 clickable even
  // though only the first is highlighted. Narrowed to `:first-child` so the
  // stage's own selector resolves to exactly the one choice the hint points
  // at.
  it('targets only the first choice button, not every sibling', () => {
    const stage = TUTORIAL_STAGES['event-fire-resolve']![0]!;
    expect(stage.target).toBe('#bs-event-dialog .bs-event-choice:first-child');
  });

  it('still has a second stage targeting the dismiss button, unchanged', () => {
    const stage = TUTORIAL_STAGES['event-fire-resolve']![1]!;
    expect(stage.target).toBe('#bs-event-dialog .bs-event-dismiss');
  });
});

describe('spentWhen / waitingKey wiring (#1014)', () => {
  // Every step named in the approved plan gets exactly one stage whose
  // `spentWhen` fires once its own order is genuinely in the simulation's
  // hands, paired with the matching waitingKey.
  const WAITS_ON_WORK_WITH_SPENT_WHEN: Record<string, string> = {
    survey: 'tutorial.waiting.surveying',
    'drill-plan': 'tutorial.waiting.drilling',
    charge: 'tutorial.waiting.charging',
    'box-cut': 'tutorial.waiting.excavating',
    'haul-debris': 'tutorial.waiting.hauling',
    'build-living-quarters': 'tutorial.waiting.building',
    'build-driving-center': 'tutorial.waiting.building',
    'build-storage': 'tutorial.waiting.building',
    'sell-ore': 'tutorial.waiting.delivering',
  };

  for (const [stepId, waitingKey] of Object.entries(WAITS_ON_WORK_WITH_SPENT_WHEN)) {
    it(`${stepId} carries exactly one stage with a spentWhen wired to ${waitingKey}`, () => {
      const stages = TUTORIAL_STAGES[stepId]!;
      expect(stages, `no TUTORIAL_STAGES entry for "${stepId}"`).toBeDefined();
      const spentStages = stages.filter(s => typeof s.spentWhen === 'function');
      expect(spentStages.length, `${stepId} should carry exactly one spentWhen stage`).toBe(1);
      expect(spentStages[0]!.waitingKey).toBe(waitingKey);
      expect(messages[waitingKey], `missing en key ${waitingKey}`).toBeTruthy();
      expect(messagesFr[waitingKey], `missing fr key ${waitingKey}`).toBeTruthy();
    });
  }

  it.each(['evacuate-zone', 'train-fragmenter'])(
    '%s carries no spentWhen on any of its stages',
    (stepId) => {
      const stages = TUTORIAL_STAGES[stepId]!;
      for (const stage of stages) {
        expect(stage.spentWhen, `${stepId} stage targeting ${stage.target} should not carry spentWhen`)
          .toBeUndefined();
      }
    },
  );

  it('every stage that carries spentWhen also carries a waitingKey (required pairing)', () => {
    for (const [stepId, stages] of Object.entries(TUTORIAL_STAGES)) {
      for (const stage of stages) {
        if (stage.spentWhen) {
          expect(stage.waitingKey, `${stepId} stage targeting ${stage.target} has spentWhen but no waitingKey`)
            .toBeTruthy();
        }
      }
    }
  });

  it('no step outside the named list above carries a spentWhen stage', () => {
    // Guards against `spentWhen` creeping onto a step the plan never asked
    // for (hire-*, blast, set-policy, event-fire-resolve,
    // vehicle-buy-assign, etc.) — those steps are genuinely one-shot clicks
    // and must keep re-highlighting nothing once used, not silently gain a
    // waiting state nobody asked for.
    for (const [stepId, stages] of Object.entries(TUTORIAL_STAGES)) {
      if (stepId in WAITS_ON_WORK_WITH_SPENT_WHEN) continue;
      for (const stage of stages) {
        expect(stage.spentWhen, `${stepId} stage targeting ${stage.target} unexpectedly carries spentWhen`)
          .toBeUndefined();
      }
    }
  });
});

describe('stagesFor', () => {
  it('falls back to the step highlight target when no stages are keyed', () => {
    const stages = stagesFor('not-a-step', '#bs-toolbar [data-panel="blast"]');
    expect(stages).toHaveLength(1);
    expect(stages[0]!.target).toBe('#bs-toolbar [data-panel="blast"]');
  });

  it('returns nothing when there is neither a table entry nor a target', () => {
    expect(stagesFor('not-a-step')).toEqual([]);
  });

  it('prefers the table over the step highlight target', () => {
    const stages = stagesFor('survey', '#ignored');
    expect(stages.length).toBeGreaterThan(1);
    expect(stages[0]!.target).not.toBe('#ignored');
  });
});

// ── #1210: REGION.boxcut's fixed line must stay long enough for SOME depth ──
//
// The box-cut stage pins the ramp tool to REGION.boxcut (a 12-tile
// north/south line) with a DEPTH_STEPPER the player can move — but the line
// itself is fixed. If REGION.boxcut were ever edited shorter than
// computeMinimumRampLength(depth) for every depth the stepper allows, the
// step would become uncompletable: no depth the player picks could ever
// validate. This is the regression guard against that — run through the same
// rampDefFromEndpoints + validateRampOrder path the ramp tool itself uses,
// not a hand-derived length check, so a change to either function's math is
// covered too.

describe('REGION.boxcut stays orderable at some depth (#1210)', () => {
  it('rampDefFromEndpoints + validateRampOrder(..., Infinity) succeeds for at least one depth in 1..8', () => {
    const region = REGION.boxcut;
    let succeededAtLeastOnce = false;
    for (let depth = 1; depth <= 8; depth++) {
      const def = rampDefFromEndpoints(region.x1, region.z1, region.x2, region.z2, depth);
      const result = validateRampOrder(def, Infinity);
      if (result.success) succeededAtLeastOnce = true;
    }
    expect(succeededAtLeastOnce).toBe(true);
  });
});

describe('scores/finances/needs stages (#1334)', () => {
  const OWN_STAGES = [
    { stepId: 'finances', targetPart: '.bs-balance', hintKey: 'tutorial.stage.open_finances' },
    { stepId: 'needs', targetPart: '#bs-toolbar [data-panel="employees"]', hintKey: 'tutorial.stage.check_needs' },
    { stepId: 'scores', targetPart: '#bs-hud-scores', hintKey: 'tutorial.stage.inspect_scores' },
  ];

  it.each(OWN_STAGES)('$stepId has its own stage, not the generic hint', ({ stepId, targetPart, hintKey }) => {
    const step = TUTORIAL_STEPS.find(s => s.id === stepId)!;
    const stages = TUTORIAL_STAGES[stepId];
    expect(stages, `no TUTORIAL_STAGES entry for ${stepId}`).toBeDefined();
    expect(stages!.length).toBeGreaterThan(0);
    expect(stages![0]!.target).toContain(targetPart);
    expect(stages![0]!.hintKey).toBe(hintKey);
    expect(stagesFor(step.id, step.highlightTarget)[0]!.hintKey).not.toBe('tutorial.stage.generic');
  });

  it.each(OWN_STAGES)('$hintKey exists in en.json and fr.json', ({ hintKey }) => {
    expect(messages[hintKey], `missing en key ${hintKey}`).toBeTruthy();
    expect(messagesFr[hintKey], `missing fr key ${hintKey}`).toBeTruthy();
  });
});

describe('every picker step keeps the strip cancel reachable (#1593)', () => {
  const PICKER_STEPS = ['survey', 'build-living-quarters', 'box-cut', 'drill-plan', 'build-driving-center', 'build-storage'];

  it('PICKER_CANCEL is the strip cancel selector', () => {
    expect(PICKER_CANCEL).toBe('#bs-param-strip-bar [data-action="cancel"]');
  });

  it.each(PICKER_STEPS)('%s: both picker stages list the cancel control in `also`', (stepId) => {
    const step = TUTORIAL_STEPS.find(st => st.id === stepId);
    expect(step, `step ${stepId} exists`).toBeDefined();
    const pickerStages = stagesFor(stepId, step!.highlightTarget).filter(
      st => st.target.includes('bs-placement-armed') || st.target === '#bs-tile-select-confirm',
    );
    expect(pickerStages.length).toBe(2);
    for (const stage of pickerStages) {
      expect(stage.also ?? [], `${stepId} ${stage.target}`).toContain(PICKER_CANCEL);
    }
  });

  it('every stage that allows the placement canvas also allows the cancel control', () => {
    for (const { stepId, i, stage } of ALL_STAGES) {
      const picker = stage.target.includes('bs-placement-armed') || stage.also?.some(a => a.includes('bs-placement-armed'));
      if (!picker) continue;
      expect(stage.also ?? [], `${stepId}[${i}]`).toContain(PICKER_CANCEL);
    }
  });

  it('the cancel tip hint exists in both locales and differs between them', () => {
    expect(messages['tutorial.stage.picker_cancel_tip']).toBeTruthy();
    expect(messagesFr['tutorial.stage.picker_cancel_tip']).toBeTruthy();
    expect(messages['tutorial.stage.picker_cancel_tip']).not.toBe(messagesFr['tutorial.stage.picker_cancel_tip']);
  });
});

describe('tutorial stage allow-set pins the scripted choice (#1595)', () => {
  it.each([
    ['buy-drill-rig-assign', 'drill_rig'],
    ['buy-rock-digger-assign', 'rock_digger'],
    ['vehicle-buy-assign', 'debris_hauler'],
  ])('%s matches only the tier-1 button of %s', (stepId, role) => {
    const stages = stagesFor(stepId);
    const buy = stages[stages.length - 1]!;
    expect(buy.target).toContain(`[data-vtype="${role}"]`);
    expect(buy.target).toContain('[data-tier="1"]');
    for (const sel of buy.also ?? []) expect(sel).not.toMatch(/data-vtype/);
  });

  it('survey run stage keeps the seismic method row live', () => {
    const run = stagesFor('survey').find(s => s.target === '#bs-survey-run')!;
    expect(run.also).toContain('#bs-survey-panel [data-method="seismic"]');
  });

  it('set-early-policy no longer allows Apply unconditionally', () => {
    for (const s of stagesFor('set-early-policy')) {
      expect(s.also ?? []).not.toContain('#bs-policy-apply');
    }
    const cond = stagesFor('set-early-policy').flatMap(s => s.alsoWhen ?? []);
    expect(cond.map(c => c.selector)).toContain('#bs-policy-apply');
  });

  it('tutorial fatigue range is a non-empty band inside 0..100', () => {
    expect(TUTORIAL_POLICY_FATIGUE_MIN).toBeLessThanOrEqual(TUTORIAL_POLICY_FATIGUE_MAX);
    expect(TUTORIAL_POLICY_FATIGUE_MIN).toBeGreaterThan(0);
    expect(TUTORIAL_POLICY_FATIGUE_MAX).toBeLessThan(100);
  });

  it('set-early-policy highlights the Operations toolbar button, not settings', () => {
    const step = TUTORIAL_STEPS.find(s => s.id === 'set-early-policy')!;
    expect(step.highlightTarget).toBe(TOOLBAR_TARGET.ops);
  });
});
