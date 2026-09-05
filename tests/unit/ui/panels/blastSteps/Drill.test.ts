// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrillStep } from '../../../../../src/ui/panels/blastSteps/Drill.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole, resetHoleIds } from '../../../../../src/core/mining/DrillPlan.js';
import { installTubing, buyTubing } from '../../../../../src/core/mining/Tubing.js';
import type { PlacementKit } from '../../../../../src/ui/scene/PlacementKit.js';
import type { PlacementSelection, PlacementArmConfig, PlacementConfirmHandler, PlacementChangeHandler } from '../../../../../src/ui/scene/PlacementController.js';

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

/** Lightweight stand-in for PlacementController/SelectionOverlay/ParamStrip — enough surface for DrillStep's own arm/confirm logic, without a real Three.js scene or canvas. */
function makeMockKit() {
  let armed = false;
  let phase: 'idle' | 'armed' | 'selected' = 'idle';
  let selection: PlacementSelection | null = null;
  let confirmHandler: PlacementConfirmHandler | null = null;
  let changeHandler: PlacementChangeHandler | null = null;

  const controller = {
    get isArmed() { return armed; },
    get currentPhase() { return phase; },
    get selection() { return selection; },
    get activeRegion() { return null; },
    get canConfirm() { return selection !== null; },
    setConfirmHandler: (cb: PlacementConfirmHandler) => { confirmHandler = cb; },
    setCancelHandler: vi.fn(),
    setChangeHandler: (cb: PlacementChangeHandler) => { changeHandler = cb; },
    arm: (_config: PlacementArmConfig) => { armed = true; phase = 'armed'; },
    cancel: () => { armed = false; phase = 'idle'; selection = null; changeHandler?.(); },
    // Test-only helpers — simulate a real drag/click + confirm without a canvas.
    simulateSelect(sel: PlacementSelection) { selection = sel; phase = 'selected'; changeHandler?.(); },
    simulateConfirm() { if (selection) confirmHandler?.(selection); },
  };
  const overlay = { update: vi.fn(), clear: vi.fn(), flashConfirm: vi.fn() };
  const strip = { show: vi.fn(), hide: vi.fn(), setConfirmHandler: vi.fn(), setCancelHandler: vi.fn() };

  return { kit: { controller, overlay, strip } as unknown as PlacementKit, controller, overlay, strip };
}

function makeStep(): { step: DrillStep; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new DrillStep(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  step.setGameConsole(gameConsole);
  return { step, container, gameConsole };
}

beforeEach(() => resetHoleIds());

describe('DrillStep', () => {
  it('shows the empty state when no holes exist', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');
    expect(step.root.textContent).toContain('No holes yet');
  });

  it('renders one row per hole with id, position, and depth', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 20, 8, 0.15);
    addHole(state.drillHoles, 13, 20, 8, 0.15);

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('H1');
    expect(step.root.textContent).toContain('(10, 20)');
    expect(step.root.textContent).toContain('8.0 m');
    expect(step.root.textContent).toContain('H2');
  });

  it('shows DRY for an untubed hole when it is not raining', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 20, 8, 0.15);

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('DRY');
    expect(step.root.textContent).not.toContain('WET');
    expect(step.root.textContent).not.toContain('TUBED');
  });

  it('shows WET for an untubed hole while it is raining', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 20, 8, 0.15);

    step.update(state, 'heavy_rain');

    expect(step.root.textContent).toContain('WET');
  });

  it('shows TUBED even while raining, once tubing is installed', () => {
    const { step } = makeStep();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 20, 8, 0.15);
    buyTubing(state.tubingState, 1, state.cash);
    installTubing(state.tubingState, hole.id);

    step.update(state, 'heavy_rain');

    expect(step.root.textContent).toContain('TUBED');
    expect(step.root.textContent).not.toContain('WET');
  });

  it('treats missing weather as dry (no crash, no WET chip)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 20, 8, 0.15);

    expect(() => step.update(state, undefined)).not.toThrow();
    expect(step.root.textContent).toContain('DRY');
  });

  it('delete button dispatches drill_plan remove for that hole', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    const hole = addHole(state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');

    const deleteBtn = step.root.querySelector('[data-action="remove-hole"]') as HTMLButtonElement;
    deleteBtn.click();

    expect(gameConsole).toHaveBeenCalledWith(`drill_plan remove hole:${hole.id}`);
  });

  it('disables Clear Plan when there are no holes', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');
    const clearBtn = step.root.querySelector('[data-action="clear-holes"]') as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(true);
  });

  it('clicking Clear Plan with holes shows an inline confirm instead of clearing immediately', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');

    const clearBtn = step.root.querySelector('[data-action="clear-holes"]') as HTMLButtonElement;
    clearBtn.click();

    expect(gameConsole).not.toHaveBeenCalled();
    expect(step.root.textContent).toContain('Clear all 1 holes');
  });

  it('confirming the clear prompt dispatches drill_plan clear', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');
    (step.root.querySelector('[data-action="clear-holes"]') as HTMLButtonElement).click();
    step.update(state, 'sunny');

    const yesBtn = Array.from(step.root.querySelectorAll('button')).find(b => b.textContent === 'Yes, Clear') as HTMLButtonElement;
    yesBtn.click();

    expect(gameConsole).toHaveBeenCalledWith('drill_plan clear');
  });

  it('cancelling the clear prompt dispatches nothing and hides the prompt', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');
    (step.root.querySelector('[data-action="clear-holes"]') as HTMLButtonElement).click();
    step.update(state, 'sunny');

    const cancelBtn = Array.from(step.root.querySelectorAll('button')).find(b => b.textContent === 'Cancel') as HTMLButtonElement;
    cancelBtn.click();

    expect(gameConsole).not.toHaveBeenCalled();
    step.update(state, 'sunny');
    expect(step.root.textContent).not.toContain('Clear all');
  });

  it('grid-tool button click is a safe no-op before a placement kit is set', () => {
    const { step } = makeStep();
    const gridBtn = step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement;
    expect(() => gridBtn.click()).not.toThrow();
  });

  it('arms the grid tool and confirming a selection dispatches drill_plan grid with computed rows/cols', () => {
    const { step, gameConsole } = makeStep();
    const { kit, controller } = makeMockKit();
    step.setPlacementKit(kit);

    const gridBtn = step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement;
    gridBtn.click();
    expect(controller.isArmed).toBe(true);

    // 9m x 3m selection at 3m spacing (the tool's default) → 4 cols x 2 rows.
    controller.simulateSelect({ x1: 10, z1: 10, x2: 19, z2: 13 });
    controller.simulateConfirm();

    expect(gameConsole).toHaveBeenCalledWith(expect.stringContaining('drill_plan grid'));
    const cmd = gameConsole.mock.calls[0]![0] as string;
    expect(cmd).toContain('rows:2');
    expect(cmd).toContain('cols:4');
    expect(cmd).toContain('spacing:3');
    expect(cmd).toContain('start:10,10');
  });

  it('re-clicking the grid tool while armed cancels it instead of re-arming', () => {
    const { step } = makeStep();
    const { kit, controller } = makeMockKit();
    step.setPlacementKit(kit);
    const gridBtn = step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement;

    gridBtn.click();
    expect(controller.isArmed).toBe(true);
    gridBtn.click();
    expect(controller.isArmed).toBe(false);
  });

  it('updates the PATTERN stat cell after a grid is confirmed', () => {
    const { step } = makeStep();
    const { kit, controller } = makeMockKit();
    step.setPlacementKit(kit);
    const state = makeState();

    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 19, z2: 13 });
    controller.simulateConfirm();

    step.update(state, 'sunny');
    expect(step.root.textContent).toContain('4 × 2');
  });

  it('arms the add-hole (point) tool and confirming dispatches drill_plan add at the picked tile', () => {
    const { step, gameConsole } = makeStep();
    const { kit, controller } = makeMockKit();
    step.setPlacementKit(kit);

    const addBtn = step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement;
    addBtn.click();
    expect(controller.isArmed).toBe(true);

    controller.simulateSelect({ x1: 25, z1: 30, x2: 25, z2: 30 });
    controller.simulateConfirm();

    const cmd = gameConsole.mock.calls[0]![0] as string;
    expect(cmd).toContain('drill_plan add');
    expect(cmd).toContain('x:25');
    expect(cmd).toContain('z:30');
  });

  it('dispose() removes the step from the DOM', () => {
    const { step, container } = makeStep();
    step.dispose();
    expect(container.contains(step.root)).toBe(false);
  });
});

// ── Scroll-bounded hole list (#958) ──────────────────────────────────────────
//
// holeListEl (one row per drilled hole, unbounded) is a plain flex column
// today with no overflow/max-height at all — a full plan buries the Saved
// Plans block below the panel's fold. The fix bounds it to a
// scrollBoundedSection wrapper, leaving SavedPlansList's save/load block a
// reachable sibling after it.

/** The bounded wrapper holding hole rows: inline overflow-y:auto + numeric max-height, containing hole delete buttons. */
function findHoleListWrapper(root: HTMLElement): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('div')).find(d =>
    d.style.overflowY === 'auto'
    && /^\d+px$/.test(d.style.maxHeight)
    && d.querySelector('[data-action="remove-hole"]') !== null,
  );
}

describe('DrillStep — scroll-bounded hole list (#958)', () => {
  it('bounds the hole list to a wrapper with inline overflow-y:auto and a numeric max-height, holding every row', () => {
    const { step } = makeStep();
    const state = makeState();
    for (let i = 0; i < 50; i++) addHole(state.drillHoles, i, 0, 8, 0.15);
    step.update(state, 'sunny');

    const wrapper = findHoleListWrapper(step.root);
    expect(wrapper).not.toBeUndefined();
    expect(wrapper!.querySelectorAll('[data-action="remove-hole"]').length).toBe(50);
  });

  it('keeps the Saved Plans save/load block reachable as a sibling of the bounded hole-list wrapper', () => {
    const { step } = makeStep();
    const state = makeState();
    for (let i = 0; i < 50; i++) addHole(state.drillHoles, i, 0, 8, 0.15);
    step.update(state, 'sunny');

    const wrapper = findHoleListWrapper(step.root)!;
    expect(wrapper).not.toBeUndefined();
    expect(step.root.textContent).toContain('Saved Plans');
    const saveBtn = step.root.querySelector('[data-action="save-plan"]');
    expect(saveBtn).not.toBeNull();
    expect(wrapper.contains(saveBtn)).toBe(false);
  });
});
