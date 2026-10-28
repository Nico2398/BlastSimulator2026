// @vitest-environment jsdom
// #2101: the Charge step's opening amount follows the site's permit grade, and
// the player's own stepping always beats that default.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChargeStep } from '../../../../../src/ui/panels/blastSteps/Charge.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole } from '../../../../../src/core/mining/DrillPlan.js';
import { createGradeState } from '../../../../../src/core/economy/MineGrade.js';
import { CHARGE_DEFAULT_AMOUNT_KG } from '../../../../../src/core/config/balance.js';

const holeCounter = { nextHoleId: 1 };
const DIAMETER_M = 0.089;

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

function amountField(step: ChargeStep): HTMLElement {
  return step.root.querySelector('[data-field="amount"]') as HTMLElement;
}

function amountText(step: ChargeStep): string {
  return (amountField(step).querySelector('.bsx-stepper-value') as HTMLElement).textContent ?? '';
}

function amountButtons(step: ChargeStep): { minus: HTMLButtonElement; plus: HTMLButtonElement } {
  const buttons = Array.from(amountField(step).querySelectorAll('button')) as HTMLButtonElement[];
  return { minus: buttons[0]!, plus: buttons[buttons.length - 1]! };
}

function chargeAll(step: ChargeStep): void {
  (step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement).click();
}

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('ChargeStep permit-following default amount (#2101)', () => {
  it('opens at the grade-0 permit share when nine 5 m holes are drilled and the stemming is untouched', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 5);

    step.update(state, 'sunny');

    expect(amountText(step)).toBe('4 kg');
  });

  it('Charge All sends that permit-following amount when the stepper is untouched', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState(0);
    drillNine(state, 5);
    step.update(state, 'sunny');

    chargeAll(step);

    const cmd = gameConsole.mock.calls[0]![0] as string;
    expect(cmd).toContain('amount:4kg');
    expect(cmd).not.toContain('amount:7kg');
  });

  it('counts planned holes toward the permit share', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState(0);
    planNine(state, 5);

    step.update(state, 'sunny');

    expect(amountText(step)).toBe('4 kg');
    chargeAll(step);
    // Charge All may be disabled until holes are drilled; when it dispatches, it uses the shown amount.
    for (const call of gameConsole.mock.calls) expect(call[0] as string).toContain('amount:4kg');
  });

  it('keeps the old default on a site without a permit', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState(undefined);
    drillNine(state, 5);

    step.update(state, 'sunny');

    expect(amountText(step)).toBe(`${CHARGE_DEFAULT_AMOUNT_KG} kg`);
    expect(amountText(step)).toBe('7 kg');
    chargeAll(step);
    // 7 kg overflows a 5 m hole at the default stemming, so Charge All stays disabled and sends nothing.
    for (const call of gameConsole.mock.calls) expect(call[0] as string).toContain('amount:7kg');
  });

  it('shows the old default when no holes are planned or drilled, grade 0 or not', () => {
    for (const grade of [0, undefined]) {
      const { step } = makeStep();
      step.update(makeState(grade), 'sunny');
      expect(amountText(step)).toBe('7 kg');
    }
  });

  it('derives the default from the shallowest hole, not the first', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 8);
    // One short hole: capacity there (4 - 2.5) * 2 = 3 kg, tighter than the permit share.
    state.drillHoles[4]!.depth = 4;

    step.update(state, 'sunny');

    expect(amountText(step)).toBe('3 kg');
  });

  it('on a deeper grade-0 pattern, the permit share (not the hole) is the limit', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 12);

    step.update(state, 'sunny');

    expect(amountText(step)).toBe('4 kg');
  });

  it('a grade 1 site derives its default from its own, larger permit', () => {
    const { step } = makeStep();
    const state = makeState(1);
    drillNine(state, 5);

    step.update(state, 'sunny');

    // Hole-bound (5 kg fits a 5 m hole at 2.5 m stemming), permit-feasible at grade 1.
    expect(amountText(step)).toBe('5 kg');
  });

  it('a grade 2 site with deep holes is limited by the explosive, never by the grade-0 permit', () => {
    const { step } = makeStep();
    const state = makeState(2);
    drillNine(state, 12);

    step.update(state, 'sunny');

    const shown = parseInt(amountText(step), 10);
    expect(shown).toBeGreaterThan(4);
  });
});

describe('ChargeStep player value beats the permit default (#2101)', () => {
  it('stepping the amount down sticks across later updates', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState(0);
    drillNine(state, 5);
    step.update(state, 'sunny');

    amountButtons(step).minus.click();
    step.update(state, 'sunny');
    step.update(state, 'sunny');

    expect(amountText(step)).toBe('3 kg');
    chargeAll(step);
    expect(gameConsole.mock.calls[0]![0] as string).toContain('amount:3kg');
  });

  it('stepping the amount up past the permit share is honoured, not clamped back', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState(0);
    drillNine(state, 8);
    step.update(state, 'sunny');
    expect(amountText(step)).toBe('4 kg');

    amountButtons(step).plus.click();
    step.update(state, 'sunny');

    expect(amountText(step)).toBe('5 kg');
    chargeAll(step);
    expect(gameConsole.mock.calls[0]![0] as string).toContain('amount:5kg');
  });

  it('a player value survives more holes arriving afterwards', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 8);
    step.update(state, 'sunny');
    amountButtons(step).plus.click();
    amountButtons(step).plus.click();
    expect(amountText(step)).toBe('6 kg');

    addHole(holeCounter, state.drillHoles, 30, 30, 8, DIAMETER_M);
    step.update(state, 'sunny');

    expect(amountText(step)).toBe('6 kg');
  });

  it('a player value survives the permit changing under it', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 8);
    step.update(state, 'sunny');
    amountButtons(step).minus.click();
    expect(amountText(step)).toBe('3 kg');

    state.grade = createGradeState();
    state.grade.grade = 1;
    step.update(state, 'sunny');

    expect(amountText(step)).toBe('3 kg');
  });

  it('still refuses an amount that overflows the shallowest hole, as before', () => {
    const { step } = makeStep();
    const state = makeState(0);
    drillNine(state, 5);
    step.update(state, 'sunny');
    const chargeAllBtn = step.root.querySelector('[data-action="charge-all"]') as HTMLButtonElement;
    expect(chargeAllBtn.disabled).toBe(false);

    // 4 kg default -> 5 kg fits the 5 m hole, 6 kg overflows it.
    amountButtons(step).plus.click();
    amountButtons(step).plus.click();
    step.update(state, 'sunny');

    expect(amountText(step)).toBe('6 kg');
    expect(chargeAllBtn.disabled).toBe(true);
    expect(chargeAllBtn.nextElementSibling?.textContent ?? '').toContain('Shallowest hole is 5 m');
  });
});
