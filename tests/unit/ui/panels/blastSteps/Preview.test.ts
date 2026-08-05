// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreviewStep } from '../../../../../src/ui/panels/blastSteps/Preview.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole, resetHoleIds } from '../../../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../../../src/core/mining/ChargePlan.js';
import { SOFTWARE_TIER_COSTS } from '../../../../../src/core/mining/Software.js';
import type { GameState } from '../../../../../src/core/state/GameState.js';

function makeState(): GameState {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeStep(): { step: PreviewStep; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new PreviewStep(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  step.setGameConsole(gameConsole);
  return { step, container, gameConsole };
}

function chargedPlan(): GameState {
  const state = makeState();
  const hole = addHole(state.drillHoles, 10, 10, 8, 0.15);
  const charge = createCharge('boomite', 5, 2, hole.depth);
  if ('charge' in charge) state.chargesByHole[hole.id] = charge.charge;
  state.sequenceDelays[hole.id] = 0;
  return state;
}

function tierRow(step: PreviewStep, n: number): HTMLElement {
  return step.root.querySelector(`[data-tier="${n}"]`) as HTMLElement;
}

beforeEach(() => resetHoleIds());

describe('PreviewStep', () => {
  it('renders 4 tier rows, all locked (no checkmark, no buy button) at tier 0 except T1 which is buyable', () => {
    const { step } = makeStep();
    step.update(makeState());

    expect(tierRow(step, 1).querySelector('[data-action="buy-tier"]')).not.toBeNull();
    expect(tierRow(step, 2).querySelector('[data-action="buy-tier"]')).toBeNull();
    expect(tierRow(step, 2).querySelector('bs-icon[name="check"]')).toBeNull();
  });

  it('shows a checkmark for an owned tier and a buy button only for the next one', () => {
    const { step } = makeStep();
    const state = makeState();
    state.softwareTier = 2;
    step.update(state);

    expect(tierRow(step, 1).querySelector('bs-icon[name="check"]')).not.toBeNull();
    expect(tierRow(step, 2).querySelector('bs-icon[name="check"]')).not.toBeNull();
    expect(tierRow(step, 3).querySelector('[data-action="buy-tier"]')).not.toBeNull();
    expect(tierRow(step, 4).querySelector('[data-action="buy-tier"]')).toBeNull();
    expect(tierRow(step, 4).querySelector('bs-icon[name="check"]')).toBeNull();
  });

  it('the buy button shows the real SOFTWARE_TIER_COSTS price, not a stale one', () => {
    const { step } = makeStep();
    step.update(makeState());

    const buyBtn = tierRow(step, 1).querySelector('[data-action="buy-tier"]') as HTMLButtonElement;
    expect(buyBtn.textContent).toContain(`$${SOFTWARE_TIER_COSTS[1]}`);
  });

  it('buying a tier dispatches buy_software with no args', () => {
    const { step, gameConsole } = makeStep();
    step.update(makeState());

    (tierRow(step, 1).querySelector('[data-action="buy-tier"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('buy_software');
  });

  it('disables the buy button when cash is short', () => {
    const { step } = makeStep();
    const state = makeState();
    state.cash = 0;
    step.update(state);

    const buyBtn = tierRow(step, 1).querySelector('[data-action="buy-tier"]') as HTMLButtonElement;
    expect(buyBtn.disabled).toBe(true);
  });

  it('shows the "drill a plan first" reason and disables Run Analysis when there are no holes', () => {
    const { step } = makeStep();
    step.update(makeState());

    const runBtn = step.root.querySelector('[data-action="run-analysis"]') as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(step.root.textContent).toContain('Drill and charge a plan first');
  });

  it('disables Run Analysis with a different reason when holes exist but the plan is incomplete', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15); // drilled, not charged/sequenced
    step.update(state);

    const runBtn = step.root.querySelector('[data-action="run-analysis"]') as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(step.root.textContent).toContain('Finish charging and sequencing');
  });

  it('enables Run Analysis once the plan is complete, and it dispatches blast_preview', () => {
    const { step, gameConsole } = makeStep();
    step.update(chargedPlan());

    const runBtn = step.root.querySelector('[data-action="run-analysis"]') as HTMLButtonElement;
    expect(runBtn.disabled).toBe(false);
    runBtn.click();

    expect(gameConsole).toHaveBeenCalledWith('blast_preview');
  });

  it('shows "run analysis to see predictions" when a plan exists but has not been analyzed yet', () => {
    const { step } = makeStep();
    step.update(chargedPlan());

    expect(step.root.textContent).toContain('Run analysis to see predictions');
  });

  it('renders real predicted values once state.lastBlastPreview is populated, respecting the tier lock', () => {
    const { step } = makeStep();
    const state = chargedPlan();
    state.softwareTier = 2;
    state.lastBlastPreview = {
      tier: 2,
      energy: { affectedVoxels: 42, minEnergy: 1.5, maxEnergy: 9.25 },
      fragments: { fractured: 7, cracked: 3, unaffected: 1, avgFragmentSizeCm: 55.4 },
      projections: null,
      vibrations: null,
    };
    step.update(state);

    expect(step.root.textContent).toContain('42');
    expect(step.root.textContent).toContain('1.5–9.3');
    expect(step.root.textContent).toContain('7');
    expect(step.root.textContent).toContain('55 cm');
    // Tier-3/4 rows are locked — real projection/vibration data must not leak through as text,
    // the row should read the "Requires T3"/"Requires T4" placeholder instead.
    expect(step.root.textContent).toContain('Requires T3');
    expect(step.root.textContent).toContain('Requires T4');
  });

  it('dispose() removes the step from the DOM', () => {
    const { step, container } = makeStep();
    step.dispose();
    expect(container.contains(step.root)).toBe(false);
  });

  it('refreshLocale() does not throw and keeps rendering', () => {
    const { step } = makeStep();
    step.update(makeState());
    expect(() => step.refreshLocale()).not.toThrow();
    step.update(makeState());
    expect(tierRow(step, 1)).not.toBeNull();
  });
});
