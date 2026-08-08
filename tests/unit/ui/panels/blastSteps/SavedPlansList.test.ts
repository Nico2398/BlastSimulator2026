// @vitest-environment jsdom
//
// Gap G6: `blast_plan save|load` had no UI. These cover the controls the Drill
// step now mounts — the exact command strings they dispatch, and that the rows
// render from `state.savedPlans` rather than from anything the UI kept locally.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrillStep } from '../../../../../src/ui/panels/blastSteps/Drill.js';
import { sanitizePlanName, savedPlansSignature, DEFAULT_PLAN_NAME } from '../../../../../src/ui/panels/blastSteps/SavedPlansList.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole, resetHoleIds } from '../../../../../src/core/mining/DrillPlan.js';
import type { SavedBlastPlan } from '../../../../../src/core/state/GameState.js';

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeStep(): { step: DrillStep; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new DrillStep(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  step.setGameConsole(gameConsole);
  return { step, container, gameConsole };
}

function saveBtn(step: DrillStep): HTMLButtonElement {
  return step.root.querySelector('[data-action="save-plan"]') as HTMLButtonElement;
}

function nameField(step: DrillStep): HTMLInputElement {
  return step.root.querySelector('[data-field="plan-name"]') as HTMLInputElement;
}

/** A saved plan with `holes` holes, the first `charged` of them charged. */
function makePlan(holes: number, charged = 0): SavedBlastPlan {
  const drillHoles = Array.from({ length: holes }, (_, i) => ({ id: `H${i + 1}`, x: i, z: 0, depth: 6, diameter: 0.089 }));
  const chargesByHole: SavedBlastPlan['chargesByHole'] = {};
  for (let i = 0; i < charged; i++) chargesByHole[`H${i + 1}`] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
  return { drillHoles, chargesByHole, sequenceDelays: {} };
}

beforeEach(() => resetHoleIds());

describe('DrillStep — Saved Plans (gap G6)', () => {
  it('mounts a Save control inside the Drill step', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    expect(saveBtn(step)).not.toBeNull();
    expect(nameField(step)).not.toBeNull();
    expect(step.root.textContent).toContain('Saved Plans');
  });

  it('Save with an empty name field dispatches blast_plan save under the console default — clickable with zero typing', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    step.update(state, 'sunny');

    saveBtn(step).click();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith(`blast_plan save name:${DEFAULT_PLAN_NAME}`);
    expect(gameConsole).toHaveBeenCalledWith('blast_plan save name:default');
  });

  it('Save dispatches the typed name', () => {
    const { step, gameConsole } = makeStep();
    step.update(makeState(), 'sunny');

    nameField(step).value = 'bench_7';
    saveBtn(step).click();

    expect(gameConsole).toHaveBeenCalledWith('blast_plan save name:bench_7');
  });

  it('Save sanitises a name the command line could not carry, instead of truncating it silently', () => {
    const { step, gameConsole } = makeStep();
    step.update(makeState(), 'sunny');

    nameField(step).value = ' north wall: 2 ';
    saveBtn(step).click();

    expect(gameConsole).toHaveBeenCalledWith('blast_plan save name:north_wall_2');
  });

  it('renders one row per saved plan, keyed by data-plan, each with its own Load control', () => {
    const { step } = makeStep();
    const state = makeState();
    state.savedPlans['alpha'] = makePlan(2);
    state.savedPlans['bravo'] = makePlan(4);
    step.update(state, 'sunny');

    expect(step.root.querySelectorAll('[data-action="load-plan"]')).toHaveLength(2);
    expect(step.root.querySelector('[data-plan="alpha"] [data-action="load-plan"]')).not.toBeNull();
    expect(step.root.querySelector('[data-plan="bravo"] [data-action="load-plan"]')).not.toBeNull();
  });

  it('a saved-plan row shows the name and what the plan holds', () => {
    const { step } = makeStep();
    const state = makeState();
    state.savedPlans['alpha'] = makePlan(3, 2);
    step.update(state, 'sunny');

    const row = step.root.querySelector('[data-plan="alpha"]') as HTMLElement;
    expect(row.textContent).toContain('alpha');
    expect(row.textContent).toContain('3 holes');
    expect(row.textContent).toContain('2 charged');
  });

  it('Load dispatches blast_plan load for that row alone', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    state.savedPlans['alpha'] = makePlan(2);
    state.savedPlans['bravo'] = makePlan(4);
    step.update(state, 'sunny');

    (step.root.querySelector('[data-plan="bravo"] [data-action="load-plan"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith('blast_plan load name:bravo');
  });

  it('picks up a plan saved after the first render, so the list cannot go stale', () => {
    const { step } = makeStep();
    const state = makeState();
    step.update(state, 'sunny');
    expect(step.root.querySelector('[data-action="load-plan"]')).toBeNull();

    state.savedPlans['default'] = makePlan(2); // as `blast_plan save` would leave it
    step.update(state, 'sunny');

    expect(step.root.querySelector('[data-plan="default"] [data-action="load-plan"]')).not.toBeNull();
  });

  it('shows an empty state instead of rows when nothing has been saved yet', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');

    expect(step.root.querySelector('[data-action="load-plan"]')).toBeNull();
    expect(step.root.textContent).toContain('No saved plans yet');
  });

  it('keeps the typed name across a re-render, so a state tick cannot wipe the field mid-typing', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    step.update(state, 'sunny');
    nameField(step).value = 'bench_7';

    state.savedPlans['alpha'] = makePlan(1);
    step.update(state, 'sunny');
    saveBtn(step).click();

    expect(gameConsole).toHaveBeenCalledWith('blast_plan save name:bench_7');
  });

  it('refreshLocale() keeps the saved-plan controls rendering', () => {
    const { step } = makeStep();
    const state = makeState();
    state.savedPlans['alpha'] = makePlan(1);
    step.update(state, 'sunny');

    expect(() => step.refreshLocale()).not.toThrow();
    step.update(state, 'sunny');
    expect(step.root.querySelector('[data-plan="alpha"] [data-action="load-plan"]')).not.toBeNull();
    expect(nameField(step).placeholder).toBe('Plan name');
  });
});

describe('sanitizePlanName', () => {
  it('falls back to the console default for an empty or whitespace-only field', () => {
    expect(sanitizePlanName('')).toBe('default');
    expect(sanitizePlanName('   ')).toBe('default');
  });

  it('keeps a name the command line can carry as-is', () => {
    expect(sanitizePlanName('bench-7_A')).toBe('bench-7_A');
  });

  it('replaces inner whitespace with underscores and drops characters the parser would split on', () => {
    expect(sanitizePlanName('north wall')).toBe('north_wall');
    expect(sanitizePlanName('plan:1')).toBe('plan1');
  });

  it('falls back to the default when nothing survives sanitising', () => {
    expect(sanitizePlanName('«»')).toBe('default');
  });
});

describe('savedPlansSignature', () => {
  it('is empty for no saved plans', () => {
    expect(savedPlansSignature({})).toBe('');
  });

  it('changes when a plan is added, renamed, or its contents change', () => {
    const base = savedPlansSignature({ alpha: makePlan(2) });
    expect(savedPlansSignature({ alpha: makePlan(2), bravo: makePlan(2) })).not.toBe(base);
    expect(savedPlansSignature({ bravo: makePlan(2) })).not.toBe(base);
    expect(savedPlansSignature({ alpha: makePlan(3) })).not.toBe(base);
    expect(savedPlansSignature({ alpha: makePlan(2, 1) })).not.toBe(base);
  });

  it('is stable for identical state', () => {
    expect(savedPlansSignature({ alpha: makePlan(2, 1) })).toBe(savedPlansSignature({ alpha: makePlan(2, 1) }));
  });
});
