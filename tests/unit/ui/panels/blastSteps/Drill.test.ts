// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrillStep } from '../../../../../src/ui/panels/blastSteps/Drill.js';
import { wetAllHoles } from '../../../../helpers/holeWater.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole } from '../../../../../src/core/mining/DrillPlan.js';
import { installTubing, buyTubing } from '../../../../../src/core/mining/Tubing.js';
import { DRILL_HOLE_DEFAULT_DIAMETER_M } from '../../../../../src/core/config/balance.js';
import type { ConfirmModalConfig } from '../../../../../src/ui/panels/ConfirmModal.js';
import type { PlacementKit } from '../../../../../src/ui/scene/PlacementKit.js';
import type { PlacementSelection, PlacementArmConfig, PlacementConfirmHandler, PlacementChangeHandler } from '../../../../../src/ui/scene/PlacementController.js';

const holeCounter = { nextHoleId: 1 };

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

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('DrillStep', () => {
  it('shows the empty state when no holes exist', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');
    expect(step.root.textContent).toContain('No holes yet');
  });

  it('renders one row per hole with id, position, and depth', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    addHole(holeCounter, state.drillHoles, 13, 20, 8, 0.15);

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('H1');
    expect(step.root.textContent).toContain('(10, 20)');
    expect(step.root.textContent).toContain('8.0 m');
    expect(step.root.textContent).toContain('H2');
  });

  it('shows DRY for an untubed hole when it is not raining', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);

    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('DRY');
    expect(step.root.textContent).not.toContain('WET');
    expect(step.root.textContent).not.toContain('TUBED');
  });

  it('shows WET for a hole that holds water', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);

    wetAllHoles(state);
    step.update(state, 'sunny');

    expect(step.root.textContent).toContain('WET');
  });

  it('shows TUBED for a dry tubed hole even while raining, once tubing is installed', () => {
    const { step } = makeStep();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    buyTubing(state.tubingState, 1, state.cash);
    installTubing(state.tubingState, hole.id, [hole.id]);

    step.update(state, 'heavy_rain');

    expect(step.root.textContent).toContain('TUBED');
    expect(step.root.textContent).not.toContain('WET');
  });

  it('treats missing weather as dry (no crash, no WET chip)', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);

    expect(() => step.update(state, undefined)).not.toThrow();
    expect(step.root.textContent).toContain('DRY');
  });

  it('delete button dispatches drill_plan remove for that hole', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
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
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');

    const clearBtn = step.root.querySelector('[data-action="clear-holes"]') as HTMLButtonElement;
    clearBtn.click();

    expect(gameConsole).not.toHaveBeenCalled();
    expect(step.root.textContent).toContain('Clear all 1 holes');
  });

  it('confirming the clear prompt dispatches drill_plan clear', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
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
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
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

    // 8m x 4m selection at 4m spacing (the tool's default, #1330) → 3 cols x 2 rows.
    controller.simulateSelect({ x1: 10, z1: 10, x2: 18, z2: 14 });
    controller.simulateConfirm();

    expect(gameConsole).toHaveBeenCalledWith(expect.stringContaining('drill_plan grid'));
    const cmd = gameConsole.mock.calls[0]![0] as string;
    expect(cmd).toContain('rows:2');
    expect(cmd).toContain('cols:3');
    expect(cmd).toContain('spacing:4');
    expect(cmd).toContain('depth:8');
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
    controller.simulateSelect({ x1: 10, z1: 10, x2: 18, z2: 14 });
    controller.simulateConfirm();

    step.update(state, 'sunny');
    expect(step.root.textContent).toContain('3 × 2');
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

  // #965: DrillStep's default diameter must stay import-identical to
  // DRILL_HOLE_DEFAULT_DIAMETER_M (src/core/config/balance.ts), the same
  // constant the console's drill_plan grid/add commands fall back to when a
  // scenario's `diameter` argument is omitted — a locally-duplicated literal
  // here (even one that numerically matches today) can silently drift from
  // that shared constant later. Drives the panel's own grid and add-hole
  // tools rather than importing a private constant, since DrillStep does not
  // export its default diameter.
  it('grid tool dispatches drill_plan grid with diameter import-identical to DRILL_HOLE_DEFAULT_DIAMETER_M', () => {
    const { step, gameConsole } = makeStep();
    const { kit, controller } = makeMockKit();
    step.setPlacementKit(kit);

    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 19, z2: 13 });
    controller.simulateConfirm();

    const cmd = gameConsole.mock.calls[0]![0] as string;
    expect(cmd).toContain(`diameter:${DRILL_HOLE_DEFAULT_DIAMETER_M}`);
  });

  it('add-hole tool dispatches drill_plan add with diameter import-identical to DRILL_HOLE_DEFAULT_DIAMETER_M', () => {
    const { step, gameConsole } = makeStep();
    const { kit, controller } = makeMockKit();
    step.setPlacementKit(kit);

    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 25, z1: 30, x2: 25, z2: 30 });
    controller.simulateConfirm();

    const cmd = gameConsole.mock.calls[0]![0] as string;
    expect(cmd).toContain(`diameter:${DRILL_HOLE_DEFAULT_DIAMETER_M}`);
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
    for (let i = 0; i < 50; i++) addHole(holeCounter, state.drillHoles, i, 0, 8, 0.15);
    step.update(state, 'sunny');

    const wrapper = findHoleListWrapper(step.root);
    expect(wrapper).not.toBeUndefined();
    expect(wrapper!.querySelectorAll('[data-action="remove-hole"]').length).toBe(50);
  });

  it('keeps the Saved Plans save/load block reachable as a sibling of the bounded hole-list wrapper', () => {
    const { step } = makeStep();
    const state = makeState();
    for (let i = 0; i < 50; i++) addHole(holeCounter, state.drillHoles, i, 0, 8, 0.15);
    step.update(state, 'sunny');

    const wrapper = findHoleListWrapper(step.root)!;
    expect(wrapper).not.toBeUndefined();
    expect(step.root.textContent).toContain('Saved Plans');
    const saveBtn = step.root.querySelector('[data-action="save-plan"]');
    expect(saveBtn).not.toBeNull();
    expect(wrapper.contains(saveBtn)).toBe(false);
  });
});

// ── Footprint awareness (#1359) ──────────────────────────────────────────────

/** State with a planned living_quarters whose footprint includes tile (10, 10). */
function makeStateWithFootprint() {
  const state = makeState();
  state.plannedBuildings.push({
    id: 1, buildingId: 1, type: 'living_quarters', tier: 1, x: 10, z: 10,
  } as unknown as (typeof state.plannedBuildings)[number]);
  return state;
}

function lastStripArg(strip: { show: ReturnType<typeof vi.fn> }) {
  return strip.show.mock.calls.at(-1)![0] as {
    result: string; confirmEnabled: boolean; confirmDisabledReason?: string;
  };
}

describe('DrillStep — footprint awareness (#1359)', () => {
  it('add-hole on a covered tile disables confirm and gives the footprint reason', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(makeStateWithFootprint(), 'sunny');

    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });

    const arg = lastStripArg(strip);
    expect(arg.confirmEnabled).toBe(false);
    expect(arg.confirmDisabledReason).toContain('Cannot drill at (10, 10)');
  });

  it('add-hole on a clear tile keeps confirm enabled with no reason', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(makeStateWithFootprint(), 'sunny');

    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 200, z1: 200, x2: 200, z2: 200 });

    const arg = lastStripArg(strip);
    expect(arg.confirmEnabled).toBe(true);
    expect(arg.confirmDisabledReason).toBeUndefined();
  });

  it('add-hole before any state update treats the tile as clear', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);

    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });

    expect(lastStripArg(strip).confirmEnabled).toBe(true);
  });

  it('grid preview shows the skipped count when some cells are under a footprint', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(makeStateWithFootprint(), 'sunny');

    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 40, z2: 40 });

    const arg = lastStripArg(strip);
    expect(arg.result).toMatch(/under buildings \(skipped\)/);
    expect(arg.confirmEnabled).toBe(true);
  });

  it('grid preview omits the skipped note when no cell is covered', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(makeStateWithFootprint(), 'sunny');

    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 200, z1: 200, x2: 209, z2: 209 });

    expect(lastStripArg(strip).result).not.toContain('skipped');
  });

  it('grid with every cell covered disables confirm and explains why', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(makeStateWithFootprint(), 'sunny');

    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });

    const arg = lastStripArg(strip);
    expect(arg.confirmEnabled).toBe(false);
    expect(arg.confirmDisabledReason).toContain('Every cell of that grid');
  });

  it('oversize grid skips the footprint preview instead of enumerating cells', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(makeStateWithFootprint(), 'sunny');

    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    // 101 x 101 cells at the 4 m default spacing > MAX_DRILL_GRID_HOLES (10 000).
    controller.simulateSelect({ x1: 10, z1: 10, x2: 410, z2: 410 });

    const arg = lastStripArg(strip);
    expect(arg.result).not.toContain('skipped');
    expect(arg.confirmEnabled).toBe(true);
  });
});

describe('DrillStep — drill notice after confirm (#1359)', () => {
  const notice = (step: DrillStep) => step.root.querySelector('[data-role="drill-notice"]') as HTMLElement;

  it('shows the console output after a successful confirm', () => {
    const { step, gameConsole } = makeStep();
    gameConsole.mockReturnValue({ success: true, output: 'Ordered 8 holes (2 skipped).' });
    const { kit, controller } = makeMockKit();
    step.setPlacementKit(kit);

    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 19, z2: 13 });
    controller.simulateConfirm();

    expect(notice(step).textContent).toBe('Ordered 8 holes (2 skipped).');
    expect(notice(step).style.display).toBe('block');
    expect(notice(step).style.color).toBe('var(--bsx-text-muted)');
  });

  it('shows a refusal in the danger colour', () => {
    const { step, gameConsole } = makeStep();
    gameConsole.mockReturnValue({ success: false, output: 'Cannot drill at (25, 30).' });
    const { kit, controller } = makeMockKit();
    step.setPlacementKit(kit);

    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 25, z1: 30, x2: 25, z2: 30 });
    controller.simulateConfirm();

    expect(notice(step).textContent).toBe('Cannot drill at (25, 30).');
    expect(notice(step).style.display).toBe('block');
    expect(notice(step).style.color).not.toBe('var(--bsx-text-muted)');
  });

  it('hides the notice when the command prints nothing', () => {
    const { step } = makeStep();
    const { kit, controller } = makeMockKit();
    step.setPlacementKit(kit);

    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 25, z1: 30, x2: 25, z2: 30 });
    controller.simulateConfirm();

    expect(notice(step).style.display).toBe('none');
  });

  it('tolerates a missing game console (no notice, no throw)', () => {
    const container = document.createElement('div');
    const step = new DrillStep(container);
    const { kit, controller } = makeMockKit();
    step.setPlacementKit(kit);

    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 25, z1: 30, x2: 25, z2: 30 });
    expect(() => controller.simulateConfirm()).not.toThrow();
    expect(notice(step).style.display).toBe('none');
  });
});

describe('DrillStep — replace-pattern confirm (#1345)', () => {
  function armAndConfirm(state: ReturnType<typeof makeState>) {
    const { step, gameConsole } = makeStep();
    const { kit, controller } = makeMockKit();
    const configs: ConfirmModalConfig[] = [];
    step.setConfirmHandler(cfg => configs.push(cfg));
    step.setPlacementKit(kit);
    step.update(state, 'sunny');
    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 18, z2: 14 });
    controller.simulateConfirm();
    return { configs, gameConsole };
  }

  it('opens the modal instead of running the grid when drilled holes exist', () => {
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 30, 30, 8, 0.15);
    const { configs, gameConsole } = armAndConfirm(state);
    expect(configs).toHaveLength(1);
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('opens the modal when only charges exist', () => {
    const state = makeState();
    state.plannedChargesByHole['H1'] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    const { configs, gameConsole } = armAndConfirm(state);
    expect(configs).toHaveLength(1);
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('confirming the modal runs the grid command with confirm:true', () => {
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 30, 30, 8, 0.15);
    const { configs, gameConsole } = armAndConfirm(state);
    configs[0]!.onConfirm();
    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole.mock.calls[0]![0]).toMatch(/^drill_plan grid .* confirm:true$/);
  });

  it('runs the grid directly, without modal, on an empty plan', () => {
    const { configs, gameConsole } = armAndConfirm(makeState());
    expect(configs).toHaveLength(0);
    expect(gameConsole.mock.calls[0]![0]).not.toContain('confirm:true');
  });

  it('runs the grid directly when the plan holds only ordered holes', () => {
    const state = makeState();
    addHole(holeCounter, state.plannedDrillHoles, 30, 30, 8, 0.15);
    const { configs, gameConsole } = armAndConfirm(state);
    expect(configs).toHaveLength(0);
    expect(gameConsole.mock.calls[0]![0]).not.toContain('confirm:true');
  });
});
