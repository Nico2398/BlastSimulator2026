// @vitest-environment jsdom
// BlastSimulator2026 — Tutorial stage table
//
// A stage selector that matches nothing strands the player: the guide blocks
// every control and highlights none, with no way forward and no Skip button to
// escape with. These tests are the guard against that.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { TUTORIAL_STAGES, stagesFor, REGION } from '../../../src/ui/tutorialStages.js';
import { TUTORIAL_STEPS } from '../../../src/ui/tutorialSteps.js';
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

describe('sequence stage list — Charge-tab reachability regression (#926)', () => {
  // Mirrors BlastWorkshop.ts's real DOM shape: a toolbar button that opens
  // the panel, a `#bs-blast-panel` root holding a tab strip (`[data-step]`,
  // always on screen regardless of which tab is active) and one body per
  // step (display:none unless its own tab is the active one).
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves to a reachable control while the workshop is showing the Charge tab, not the already-open toolbar hint', () => {
    const toolbar = document.createElement('div');
    toolbar.id = 'bs-toolbar';
    document.body.appendChild(toolbar);
    makeButton({ 'data-panel': 'blast' }, toolbar);

    const panel = document.createElement('div');
    panel.id = 'bs-blast-panel';
    document.body.appendChild(panel);
    const strip = document.createElement('div');
    panel.appendChild(strip);
    makeButton({ 'data-step': '2' }, strip);
    makeButton({ 'data-step': '3' }, strip);

    // Charge tab body: visible (the crew is still mid-charge, so the panel's
    // own auto-advance correctly keeps it on screen).
    const chargeBody = document.createElement('div');
    chargeBody.style.display = '';
    panel.appendChild(chargeBody);
    makeButton({ 'data-action': 'charge-all' }, chargeBody);

    // Sequence tab body: hidden — its own auto-sequence button is not on
    // screen yet.
    const sequenceBody = document.createElement('div');
    sequenceBody.style.display = 'none';
    panel.appendChild(sequenceBody);
    makeButton({ 'data-action': 'auto-sequence' }, sequenceBody);

    const stages = TUTORIAL_STAGES['sequence']!;
    const index = resolveStageIndex(stages);
    const resolved = stages[index]!;

    expect(
      resolved.target,
      'sequence rail fell back to the already-satisfied "open the Blast panel" hint, ' +
      'with no reachable control to click',
    ).not.toBe(stages[0]!.target);
    expect(isReachable(resolved.target)).toBe(true);
  });

  it('resolves to Auto Sequence once the panel actually shows the Sequence tab', () => {
    const toolbar = document.createElement('div');
    toolbar.id = 'bs-toolbar';
    document.body.appendChild(toolbar);
    makeButton({ 'data-panel': 'blast' }, toolbar);

    const panel = document.createElement('div');
    panel.id = 'bs-blast-panel';
    document.body.appendChild(panel);
    const strip = document.createElement('div');
    panel.appendChild(strip);
    makeButton({ 'data-step': '2' }, strip);
    makeButton({ 'data-step': '3' }, strip);

    const chargeBody = document.createElement('div');
    chargeBody.style.display = 'none';
    panel.appendChild(chargeBody);
    makeButton({ 'data-action': 'charge-all' }, chargeBody);

    const sequenceBody = document.createElement('div');
    sequenceBody.style.display = '';
    panel.appendChild(sequenceBody);
    makeButton({ 'data-action': 'auto-sequence' }, sequenceBody);

    const stages = TUTORIAL_STAGES['sequence']!;
    const index = resolveStageIndex(stages);
    expect(stages[index]!.target).toBe('#bs-blast-panel [data-action="auto-sequence"]');
    expect(isReachable(stages[index]!.target)).toBe(true);
  });
});

describe('#1337 evacuate-zone manual-tab reachability', () => {
  const FIRE_TAB = '#bs-blast-panel [data-step="5"]';
  const HORN = '#bs-blast-panel [data-action="sound-horn"]';

  function mount(opts: { panel: boolean; fireVisible: boolean }): void {
    const toolbar = document.createElement('div');
    toolbar.id = 'bs-toolbar';
    document.body.appendChild(toolbar);
    makeButton({ 'data-panel': 'blast' }, toolbar);
    if (!opts.panel) return;

    const panel = document.createElement('div');
    panel.id = 'bs-blast-panel';
    document.body.appendChild(panel);
    const strip = document.createElement('div');
    panel.appendChild(strip);
    for (const n of ['3', '4', '5']) makeButton({ 'data-step': n }, strip);

    const sequenceBody = document.createElement('div');
    sequenceBody.style.display = opts.fireVisible ? 'none' : '';
    panel.appendChild(sequenceBody);
    makeButton({ 'data-action': 'auto-sequence' }, sequenceBody);

    const fireBody = document.createElement('div');
    fireBody.style.display = opts.fireVisible ? '' : 'none';
    panel.appendChild(fireBody);
    makeButton({ 'data-action': 'sound-horn' }, fireBody);
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves to the Fire tab button when the player manually showed Sequence and Fire body is hidden', () => {
    mount({ panel: true, fireVisible: false });
    const stages = TUTORIAL_STAGES['evacuate-zone']!;
    const resolved = stages[resolveStageIndex(stages)]!;
    expect(resolved.target).toBe(FIRE_TAB);
    expect(resolved).not.toBe(stages[0]);
    expect(isReachable(resolved.target)).toBe(true);
  });

  it('resolves to Sound the Horn once the Fire body is visible', () => {
    mount({ panel: true, fireVisible: true });
    const stages = TUTORIAL_STAGES['evacuate-zone']!;
    const resolved = stages[resolveStageIndex(stages)]!;
    expect(resolved.target).toBe(HORN);
    expect(isReachable(resolved.target)).toBe(true);
  });

  it('resolves to the toolbar Blast stage when the Blast panel is not open', () => {
    mount({ panel: false, fireVisible: false });
    const stages = TUTORIAL_STAGES['evacuate-zone']!;
    expect(resolveStageIndex(stages)).toBe(0);
  });

  it('lists exactly toolbar, Fire tab, Sound the Horn in order', () => {
    const stages = TUTORIAL_STAGES['evacuate-zone']!;
    expect(stages).toHaveLength(3);
    expect(stages.map((st) => st.hintKey)).toEqual([
      'tutorial.stage.open_blast',
      'tutorial.stage.open_fire_tab',
      'tutorial.stage.sound_horn',
    ]);
    expect(stages[1]!.target).toBe(FIRE_TAB);
    expect(stages[2]!.target).toBe(HORN);
  });

  it('has distinct open_fire_tab hint text in en and fr and no spentWhen on any stage', () => {
    const key = 'tutorial.stage.open_fire_tab';
    const enText = (en as Record<string, string>)[key];
    const frText = (fr as Record<string, string>)[key];
    expect(enText, 'missing en key').toBeTruthy();
    expect(frText, 'missing fr key').toBeTruthy();
    expect(enText).not.toBe(frText);
    expect(enText).not.toBe((en as Record<string, string>)['tutorial.stage.sound_horn']);
    for (const st of TUTORIAL_STAGES['evacuate-zone']!) {
      expect((st as { spentWhen?: unknown }).spentWhen).toBeUndefined();
    }
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

  it.each(['sequence', 'evacuate-zone', 'train-driller', 'train-digger'])(
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
