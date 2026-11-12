// @vitest-environment jsdom
// #2101: the Charge step opens at the stemming that keeps the site's permit once every hole is filled up to it,
// and the player's own stepping always beats that default. A hole is charged by filling it from the bottom up to
// the stemming: the kilograms it will hold are a read-only readout (data-role="charge-per-hole"), never a stepper.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChargeStep } from '../../../../../src/ui/panels/blastSteps/Charge.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole } from '../../../../../src/core/mining/DrillPlan.js';
import { createGradeState } from '../../../../../src/core/economy/MineGrade.js';
import { defaultStemmingM } from '../../../../../src/core/economy/PermitDefaults.js';
import { CHARGE_DEFAULT_STEMMING_M } from '../../../../../src/core/config/balance.js';
import { setLocale, t } from '../../../../../src/core/i18n/I18n.js';

const holeCounter = { nextHoleId: 1 };
const DIAMETER_M = 0.089;
/** What the step preselects without a pattern charge; boomite fills 2 kg a metre of an 89 mm hole. */
const DEFAULT_EXPLOSIVE = 'boomite';

type State = ReturnType<typeof makeState>;

function makeState(grade: number | undefined) {
  const state = createGame({ seed: 1, mineType: 'desert' });
  if (grade === undefined) delete (state as { grade?: unknown }).grade;
  else {
    state.grade = createGradeState();
    state.grade.grade = grade;
  }
  return state;
}

function makeStep(): { step: ChargeStep; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new ChargeStep(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  step.setGameConsole(gameConsole);
  return { step, gameConsole };
}

/** A 3x3 block of holes of the given depth, drilled. */
function drillNine(state: State, depth: number): void {
  for (let i = 0; i < 9; i++) {
    addHole(holeCounter, state.drillHoles, 10 + (i % 3) * 4, 10 + Math.floor(i / 3) * 4, depth, DIAMETER_M);
  }
}

/** The same block, still only planned. */
function planNine(state: State, depth: number): void {
  for (let i = 0; i < 9; i++) {
    addHole(holeCounter, state.plannedDrillHoles, 10 + (i % 3) * 4, 10 + Math.floor(i / 3) * 4, depth, DIAMETER_M);
  }
}

function stemmingField(step: ChargeStep): HTMLElement {
  return step.root.querySelector('[data-field="stemming"]') as HTMLElement;
}

function stemmingText(step: ChargeStep): string {
  return (stemmingField(step).querySelector('.bsx-stepper-value') as HTMLElement).textContent ?? '';
}

function stemmingButtons(step: ChargeStep): { minus: HTMLButtonElement; plus: HTMLButtonElement } {
  const buttons = Array.from(stemmingField(step).querySelectorAll('button')) as HTMLButtonElement[];
  return { minus: buttons[0]!, plus: buttons[buttons.length - 1]! };
}

function perHole(step: ChargeStep): HTMLElement {
  return step.root.querySelector('[data-role="charge-per-hole"]') as HTMLElement;
}

function chargeAllButton(step: ChargeStep): HTMLButtonElement {
  return step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
}

function chargeAll(step: ChargeStep): void {
  chargeAllButton(step).click();
}

const permitKgWarning = (step: ChargeStep): string =>
  step.root.querySelector('[data-role="permit-kg-warning"]')?.textContent ?? '';

beforeEach(() => {
  holeCounter.nextHoleId = 1;
  setLocale('en');
});

describe('ChargeStep permit-following default stemming (#2101)', () => {
  it('opens at the grade-0 permit stemming when nine 5 m holes are drilled and the stemming is untouched', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 5);

    step.update(state, 'sunny');

    // Filled at 2.5 m the nine holes would take 45 kg; at 2.8 m each holds 4.4 kg, 39.6 kg in all.
    expect(stemmingText(step)).toBe('2.8 m');
    expect(stemmingText(step)).toBe(`${defaultStemmingM(0, state.drillHoles, DEFAULT_EXPLOSIVE).toFixed(1)} m`);
    expect(perHole(step).textContent).toBe('4.4 kg');
  });

  it('has no kg stepper: what each hole holds is read-only', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 5);
    step.update(state, 'sunny');

    expect(step.root.querySelector('[data-field="amount"]')).toBeNull();
    expect(perHole(step)).not.toBeNull();
    expect(perHole(step).querySelectorAll('button')).toHaveLength(0);
  });

  it('Charge All fills every hole up to that stemming: it sends the stemming, never an amount', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState(0);
    drillNine(state, 5);
    step.update(state, 'sunny');

    chargeAll(step);

    expect(gameConsole).toHaveBeenCalledTimes(1);
    const cmd = gameConsole.mock.calls[0]![0] as string;
    expect(cmd).toBe(`charge hole:* explosive:${DEFAULT_EXPLOSIVE} stemming:2.8m`);
    expect(cmd).not.toContain('amount:');
  });

  it('the untouched default keeps the plan inside the permit: no over-permit warning', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 5);

    step.update(state, 'sunny');

    expect(step.root.querySelector('[data-role="permit-kg"]')!.textContent).toBe('39.6 / 40 kg');
    expect(permitKgWarning(step)).toBe('');
  });

  it('counts planned holes toward the permit share', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState(0);
    planNine(state, 5);

    step.update(state, 'sunny');

    expect(stemmingText(step)).toBe('2.8 m');
    chargeAll(step);
    // When Charge All dispatches before the holes are drilled, it sets the pattern at the shown stemming.
    for (const call of gameConsole.mock.calls) expect(call[0] as string).toContain('stemming:2.8m');
  });

  it('keeps the default stemming on a site without a permit, and Charge All fills the holes at it', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState(undefined);
    drillNine(state, 5);

    step.update(state, 'sunny');

    expect(stemmingText(step)).toBe(`${CHARGE_DEFAULT_STEMMING_M.toFixed(1)} m`);
    expect(stemmingText(step)).toBe('2.5 m');
    expect(perHole(step).textContent).toBe('5 kg');
    expect(chargeAllButton(step).disabled).toBe(false);
    chargeAll(step);
    expect(gameConsole.mock.calls[0]![0]).toBe(`charge hole:* explosive:${DEFAULT_EXPLOSIVE} stemming:2.5m`);
  });

  it('shows the default stemming and no per-hole kg when no holes are planned or drilled, grade 0 or not', () => {
    for (const grade of [0, undefined]) {
      const { step } = makeStep();
      step.update(makeState(grade), 'sunny');
      expect(stemmingText(step)).toBe('2.5 m');
      expect(perHole(step).textContent).toBe('—');
    }
  });

  it('counts every hole by its own depth, not the first one\'s', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 8);
    // One 6 m hole holds less than the 8 m ones: the pattern needs 5.6 m of stemming where nine 8 m holes need 5.8 m.
    state.drillHoles[4]!.depth = 6;

    step.update(state, 'sunny');

    expect(stemmingText(step)).toBe('5.6 m');
    // 8 m holes hold (8 - 5.6) x 2 = 4.8 kg, the 6 m hole 0.8 kg.
    expect(perHole(step).textContent).toBe('0.8–4.8 kg');
  });

  it('on a deeper grade-0 pattern the permit (not the hole) sets the charge: more stemming, the same kg a hole', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 12);

    step.update(state, 'sunny');

    expect(stemmingText(step)).toBe('9.8 m');
    expect(perHole(step).textContent).toBe('4.4 kg');
  });

  it('a grade 1 site derives its stemming from its own, larger permit', () => {
    const { step } = makeStep();
    const state = makeState(1);
    drillNine(state, 5);

    step.update(state, 'sunny');

    // 45 kg filled at the default stemming fits grade 1's 120 kg.
    expect(stemmingText(step)).toBe('2.5 m');
    expect(perHole(step).textContent).toBe('5 kg');
  });

  it('a grade 2 site with deep holes fills them under the default stemming, never the grade-0 permit\'s', () => {
    const { step } = makeStep();
    const state = makeState(2);
    drillNine(state, 12);

    step.update(state, 'sunny');

    expect(stemmingText(step)).toBe('2.5 m');
    expect(perHole(step).textContent).toBe('19 kg');
  });

  it('a pattern no stemming keeps inside the permit opens at the default, and the over-permit warning says so', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 8);
    // Keeping 40 kg would take 5.4 m of stemming: deeper than this 4 m hole, which would stay empty.
    state.drillHoles[4]!.depth = 4;

    step.update(state, 'sunny');

    expect(stemmingText(step)).toBe('2.5 m');
    expect(permitKgWarning(step)).not.toBe('');
    expect(chargeAllButton(step).disabled).toBe(false);
  });

  it('the picked explosive sets the default too: a denser one opens at more stemming', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState(0);
    drillNine(state, 5);
    step.update(state, 'sunny');
    expect(stemmingText(step)).toBe('2.8 m');

    (step.root.querySelector('[data-action="select-explosive"][data-explosive="krackle"]') as HTMLButtonElement).click();
    step.update(state, 'sunny');

    // Krackle (1.15 g/cm³) fills 2.875 kg a metre: 3.5 m of stemming leaves 4.3 kg a hole, 38.7 kg in all.
    expect(stemmingText(step)).toBe('3.5 m');
    expect(perHole(step).textContent).toBe('4.3 kg');
    chargeAll(step);
    expect(gameConsole.mock.calls[0]![0]).toBe('charge hole:* explosive:krackle stemming:3.5m');
  });
});

describe('ChargeStep player value beats the permit default (#2101)', () => {
  it('stepping the stemming up sticks across later updates', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState(0);
    drillNine(state, 5);
    step.update(state, 'sunny');

    stemmingButtons(step).plus.click();
    step.update(state, 'sunny');
    step.update(state, 'sunny');

    expect(stemmingText(step)).toBe('2.9 m');
    expect(perHole(step).textContent).toBe('4.2 kg');
    chargeAll(step);
    expect(gameConsole.mock.calls[0]![0] as string).toContain('stemming:2.9m');
  });

  it('stepping the stemming under the permit default is honoured, not clamped back: the plan warns, Charge All still sends it', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState(0);
    drillNine(state, 8);
    step.update(state, 'sunny');
    expect(stemmingText(step)).toBe('5.8 m');

    stemmingButtons(step).minus.click();
    step.update(state, 'sunny');

    expect(stemmingText(step)).toBe('5.7 m');
    // (8 - 5.7) x 2 = 4.6 kg a hole, 41.4 kg in all: over the 40 kg permit.
    expect(perHole(step).textContent).toBe('4.6 kg');
    expect(permitKgWarning(step)).not.toBe('');
    expect(chargeAllButton(step).disabled).toBe(false);
    chargeAll(step);
    expect(gameConsole.mock.calls[0]![0] as string).toContain('stemming:5.7m');
  });

  it('a player value survives more holes arriving afterwards', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 8);
    step.update(state, 'sunny');
    stemmingButtons(step).minus.click();
    stemmingButtons(step).minus.click();
    expect(stemmingText(step)).toBe('5.6 m');

    addHole(holeCounter, state.drillHoles, 30, 30, 8, DIAMETER_M);
    expect(defaultStemmingM(0, state.drillHoles, DEFAULT_EXPLOSIVE)).not.toBe(5.6);
    step.update(state, 'sunny');

    expect(stemmingText(step)).toBe('5.6 m');
  });

  it('a player value survives the permit changing under it', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 8);
    step.update(state, 'sunny');
    stemmingButtons(step).plus.click();
    expect(stemmingText(step)).toBe('5.9 m');

    state.grade = createGradeState();
    state.grade.grade = 1;
    expect(defaultStemmingM(1, state.drillHoles, DEFAULT_EXPLOSIVE)).not.toBe(5.9);
    step.update(state, 'sunny');

    expect(stemmingText(step)).toBe('5.9 m');
  });

  it('still refuses a stemming that leaves the shallowest hole no room for explosive', () => {
    const { step } = makeStep();
    const state = makeState(undefined);
    drillNine(state, 8);
    state.drillHoles[4]!.depth = 4;
    step.update(state, 'sunny');
    expect(stemmingText(step)).toBe('2.5 m');
    expect(chargeAllButton(step).disabled).toBe(false);

    // 2.5 m -> 4.0 m: the 4 m hole is all stemming.
    for (let i = 0; i < 15; i++) stemmingButtons(step).plus.click();
    step.update(state, 'sunny');

    expect(stemmingText(step)).toBe('4.0 m');
    expect(chargeAllButton(step).disabled).toBe(true);
    expect(chargeAllButton(step).nextElementSibling?.textContent ?? '')
      .toContain(t('ui.blast_workshop.charge.no_room_reason', { stemming: 4, depth: 4 }));

    stemmingButtons(step).minus.click();
    step.update(state, 'sunny');

    expect(chargeAllButton(step).disabled).toBe(false);
    expect(chargeAllButton(step).nextElementSibling?.textContent ?? '').toBe('');
  });
});
