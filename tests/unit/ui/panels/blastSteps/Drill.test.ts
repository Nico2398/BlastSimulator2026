// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrillStep } from '../../../../../src/ui/panels/blastSteps/Drill.js';
import { wetAllHoles } from '../../../../helpers/holeWater.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import {
  addHole, holeNumericId, createGridPlan, gridCellPositions, drillHoleCost, estimateDrillWorkTicks,
} from '../../../../../src/core/mining/DrillPlan.js';
import type { DrillHole } from '../../../../../src/core/mining/DrillPlan.js';
import { installTubing, buyTubing } from '../../../../../src/core/mining/Tubing.js';
import {
  DRILL_HOLE_DEFAULT_DIAMETER_M, DRILL_GRID_DEFAULT_SPACING_M, HOLE_CELL_MAX_SIDE_M,
} from '../../../../../src/core/config/balance.js';
import { t, setLocale } from '../../../../../src/core/i18n/I18n.js';
import { addBlastFragments } from '../../../../../src/core/economy/Logistics.js';
import { formatMoney } from '../../../../../src/core/economy/formatMoney.js';
import { formatGameDuration } from '../../../../../src/ui/formatGameDuration.js';
import { holeStatusExplain, drillFieldExplain } from '../../../../../src/ui/blastWorkshopExplain.js';
import type { EntityOpener } from '../../../../../src/ui/entityLinks.js';
import type { FragmentData } from '../../../../../src/core/mining/BlastExecution.js';
import { createGradeState, type GradeState } from '../../../../../src/core/economy/MineGrade.js';
import { gridAreaLimitWarning, permitPreview } from '../../../../../src/ui/panels/permitPreview.js';
import type { ConfirmModalConfig } from '../../../../../src/ui/panels/ConfirmModal.js';
import type { PlacementKit } from '../../../../../src/ui/scene/PlacementKit.js';
import { ParamStrip } from '../../../../../src/ui/scene/ParamStrip.js';
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

/** A grid placement's holes as the permit measures them: one `spacing` × `burden` cell each. */
function gridPlanHoles(x1: number, z1: number, rows: number, cols: number, spacing = DRILL_GRID_DEFAULT_SPACING_M, burden = spacing): DrillHole[] {
  return createGridPlan({ nextHoleId: 1 }, { x: x1, z: z1 }, rows, cols, spacing, 8, DRILL_HOLE_DEFAULT_DIAMETER_M, burden);
}

/** The grid strip's RESULT with no note after it: every cell clear of buildings and the plan within the permit. */
function plainGridResult(cols: number, rows: number): string {
  return `${cols} × ${rows} ${t('ui.blast_workshop.drill.holes_section')}`;
}

/** The strip readout line giving the area of `holes` against the permit of `grade`. */
function permitAreaLine(grade: GradeState | undefined, holes: readonly Pick<DrillHole, 'id' | 'x' | 'z' | 'spacingM' | 'burdenM'>[]): string {
  return t('ui.blast_workshop.drill.permit_area', { area: permitPreview(grade, { holes, charges: {} }, 0)!.areaText });
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
    const hole = addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    state.holeWater[hole.id] = { level: 0.8, porosity: 0.03 };

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

/** What the placement strip was last asked to show. */
interface StripShown {
  subtitle: string;
  fields: { key: string; label: string; explain?: string; value: number; onInc: () => void; onDec: () => void }[];
  actions?: { key: string; label: string; onClick: () => void }[];
  result: string;
  readout?: string[];
  confirmEnabled: boolean;
  confirmDisabledReason?: string;
}

function lastStripArg(strip: { show: ReturnType<typeof vi.fn> }): StripShown {
  return strip.show.mock.calls.at(-1)![0] as StripShown;
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

// ── Depth stepper follows the fleet's best rig (#1679) ───────────────────────

type StripField = { key: string; value: number; onInc: () => void; onDec: () => void };
type StripArg = { fields: StripField[]; confirmDisabledReason?: string; instruction?: string; result: string };

function depthFieldOf(strip: { show: ReturnType<typeof vi.fn> }): StripField {
  const arg = strip.show.mock.calls.at(-1)![0] as StripArg;
  return arg.fields.find(f => f.key === 'depth')!;
}

function stateWithRigTier(tier: 1 | 2 | 3) {
  const state = makeState();
  state.vehicles.vehicles = state.vehicles.vehicles.filter(v => v.type !== 'drill_rig');
  state.vehicles.vehicles.push({ id: 900, type: 'drill_rig', tier } as unknown as (typeof state.vehicles.vehicles)[number]);
  return state;
}

/** Click the depth increment far past any plausible cap and return the resulting depth. */
function pushDepthToMax(strip: { show: ReturnType<typeof vi.fn> }): number {
  for (let i = 0; i < 60; i++) depthFieldOf(strip).onInc();
  return depthFieldOf(strip).value;
}

describe('DrillStep — depth stepper capped at fleet reach (#1679)', () => {
  for (const [tier, reach] of [[1, 12], [2, 24], [3, 40]] as const) {
    for (const tool of ['grid-tool', 'add-hole-tool'] as const) {
      it(`${tool}: tier-${tier} rig caps the depth stepper at ${reach} m`, () => {
        const { step } = makeStep();
        const { kit, controller, strip } = makeMockKit();
        step.setPlacementKit(kit);
        step.update(stateWithRigTier(tier), 'sunny');
        (step.root.querySelector(`[data-action="${tool}"]`) as HTMLButtonElement).click();
        controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });

        expect(pushDepthToMax(strip)).toBe(reach);
      });
    }
  }

  it('the best rig wins when the fleet holds several tiers', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    const state = stateWithRigTier(1);
    state.vehicles.vehicles.push({ id: 901, type: 'drill_rig', tier: 2 } as unknown as (typeof state.vehicles.vehicles)[number]);
    step.update(state, 'sunny');
    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });

    expect(pushDepthToMax(strip)).toBe(24);
  });

  it('the reach cap is not a hardcoded 40: a default tier-1 fleet stops at 12 m', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    const state = makeState();
    step.update(state, 'sunny');
    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });

    expect(pushDepthToMax(strip)).toBeLessThanOrEqual(12);
  });

  it('boundary: the minimum stays 1 m', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(stateWithRigTier(1), 'sunny');
    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });

    for (let i = 0; i < 30; i++) depthFieldOf(strip).onDec();
    expect(depthFieldOf(strip).value).toBe(1);
  });

  it('a previously chosen depth is clamped down when the reach shrinks', () => {
    const { step, gameConsole } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(stateWithRigTier(3), 'sunny');
    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });
    expect(pushDepthToMax(strip)).toBe(40);
    controller.cancel();

    step.update(stateWithRigTier(1), 'sunny');
    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });
    controller.simulateConfirm();

    expect(gameConsole.mock.calls[0]![0] as string).toContain('depth:12');
  });

  it('says why: the strip text states the reach from ui.blast_workshop.drill.depth_reach', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(stateWithRigTier(1), 'sunny');
    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });

    const reason = t('ui.blast_workshop.drill.depth_reach', { reach: 12 });
    expect(reason).not.toMatch(/depth_reach/);
    expect(reason).toContain('12');
    expect(JSON.stringify(strip.show.mock.calls.at(-1)![0])).toContain(reason);
  });
});

// The permit caps the ground a shot works (Σ spacing × burden of its holes), not how many holes do it:
// grade 0 allows 144 m², nine holes of the default 4 m × 4 m cell.
describe('DrillStep — permit area warning (#1925)', () => {
  function sized(progression: boolean, x2: number, z2: number) {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    const state = makeState();
    if (progression) state.grade = createGradeState();
    step.update(state, 'sunny');
    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2, z2 });
    return { arg: lastStripArg(strip), strip };
  }

  it('a 4x4 grid over the grade-0 area limit shows a warning in the strip, confirm stays enabled', () => {
    // Default 4 m mesh: 12 m x 12 m -> 4 x 4 holes of 16 m² = 256 m².
    const { arg } = sized(true, 22, 22);
    const warning = gridAreaLimitWarning(createGradeState(), gridPlanHoles(10, 10, 4, 4));
    expect(warning).not.toBeNull();
    expect(arg.confirmEnabled).toBe(true);
    expect(arg.result).toContain(warning!);
    // Literal check so the assertion does not merely echo the helper under test.
    expect(arg.result).toContain('256 / 144 m²');
  });

  it('a 3x3 grid exactly at the area limit shows no warning', () => {
    const { arg } = sized(true, 18, 18);
    expect(gridAreaLimitWarning(createGradeState(), gridPlanHoles(10, 10, 3, 3))).toBeNull();
    expect(arg.confirmEnabled).toBe(true);
    expect(arg.result).toBe(plainGridResult(3, 3));
  });

  it('the same oversize grid on a non-progression site shows no warning', () => {
    const { arg } = sized(false, 22, 22);
    expect(arg.confirmEnabled).toBe(true);
    expect(arg.result).toBe(plainGridResult(4, 4));
  });

  it('the burden counts as much as the spacing: nine holes at 4 x 5 m go over the limit', () => {
    const { strip } = sized(true, 18, 18);
    lastStripArg(strip).fields.find(f => f.key === 'burden')!.onInc();

    // z 10..18 at a 5 m burden still rounds to 3 rows: 3 x 3 holes of 20 m² = 180 m².
    const arg = lastStripArg(strip);
    expect(arg.subtitle).toBe('3 × 3');
    expect(arg.result).toContain(gridAreaLimitWarning(createGradeState(), gridPlanHoles(10, 10, 3, 3, 4, 5))!);
    expect(arg.result).toContain('180 / 144 m²');
  });
});

describe('DrillStep — diameter stepper follows fleet rigs (#1934)', () => {
  function diameterFieldOf(strip: { show: ReturnType<typeof vi.fn> }): StripField {
    return (strip.show.mock.calls.at(-1)![0] as StripArg).fields.find(f => f.key === 'diameter')!;
  }

  function armAddTool(tier: 1 | 2 | 3) {
    const made = makeStep();
    const { kit, controller, strip } = makeMockKit();
    made.step.setPlacementKit(kit);
    made.step.update(stateWithRigTier(tier), 'sunny');
    (made.step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });
    return { ...made, controller, strip, kit };
  }

  for (const [tier, widestMm] of [[1, 89], [2, 127], [3, 165]] as const) {
    it(`tier-${tier} rig: stepper tops out at ${widestMm} mm`, () => {
      const { strip } = armAddTool(tier);
      for (let i = 0; i < 5; i++) diameterFieldOf(strip).onInc();
      expect(diameterFieldOf(strip).value).toBe(widestMm);
    });
  }

  it('steps through the options in order and back down to the narrowest', () => {
    const { strip } = armAddTool(3);
    expect(diameterFieldOf(strip).value).toBe(89);
    diameterFieldOf(strip).onInc();
    expect(diameterFieldOf(strip).value).toBe(127);
    diameterFieldOf(strip).onInc();
    expect(diameterFieldOf(strip).value).toBe(165);
    for (let i = 0; i < 5; i++) diameterFieldOf(strip).onDec();
    expect(diameterFieldOf(strip).value).toBe(89);
  });

  it('the command carries the stepped diameter', () => {
    const { gameConsole, controller, strip } = armAddTool(2);
    diameterFieldOf(strip).onInc();
    controller.simulateConfirm();
    expect(gameConsole.mock.calls[0]![0] as string).toContain('diameter:0.127');
  });

  it('a chosen diameter is clamped down when the wide rig is lost', () => {
    const { step, gameConsole, controller, strip } = armAddTool(3);
    for (let i = 0; i < 5; i++) diameterFieldOf(strip).onInc();
    expect(diameterFieldOf(strip).value).toBe(165);
    controller.cancel();

    step.update(stateWithRigTier(1), 'sunny');
    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 10, z2: 10 });
    expect(diameterFieldOf(strip).value).toBe(89);
    controller.simulateConfirm();
    expect(gameConsole.mock.calls[0]![0] as string).toContain('diameter:0.089');
  });
});

// ── Grid shape: burden, staggered rows, the mesh cell ───────────────────────

describe('DrillStep — burden stepper and staggered layout', () => {
  /** The grid tool armed over x 10..18 / z 10..14: 3 columns × 2 rows on the default 4 m mesh. */
  function armGrid(state = makeState()) {
    const made = makeStep();
    const mock = makeMockKit();
    made.step.setPlacementKit(mock.kit);
    made.step.update(state, 'sunny');
    (made.step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    mock.controller.simulateSelect({ x1: 10, z1: 10, x2: 18, z2: 14 });
    return { ...made, ...mock, state };
  }
  type Armed = ReturnType<typeof armGrid>;
  const field = (h: Armed, key: string) => lastStripArg(h.strip).fields.find(f => f.key === key)!;
  const layoutButton = (h: Armed) => lastStripArg(h.strip).actions?.find(a => a.key === 'grid-layout');
  const layoutLabel = (layout: 'square' | 'staggered') =>
    t('ui.blast_workshop.drill.layout_button', { layout: t(`ui.blast_workshop.drill.layout_${layout}`) });
  /** Confirm the selection; the drill_plan grid command it dispatched. */
  const confirmed = (h: Armed): string => {
    h.controller.simulateConfirm();
    return h.gameConsole.mock.calls.map(c => String(c[0])).filter(c => c.startsWith('drill_plan grid')).at(-1) ?? '';
  };
  /** The stat strip's mesh value once the step has re-rendered. */
  const mesh = (h: Armed): string | null => {
    h.step.update(h.state, 'sunny');
    return h.step.root.querySelector('[data-role="drill-mesh"]')?.textContent ?? null;
  };

  it('the grid strip steps spacing, burden, depth and diameter, the burden opening at the spacing', () => {
    const h = armGrid();
    expect(lastStripArg(h.strip).fields.map(f => f.key)).toEqual(['spacing', 'burden', 'depth', 'diameter']);
    expect(field(h, 'burden').label).toBe(t('ui.blast_workshop.drill.burden'));
    expect(field(h, 'burden').value).toBe(DRILL_GRID_DEFAULT_SPACING_M);
    expect(field(h, 'burden').value).toBe(field(h, 'spacing').value);
  });

  it('the burden follows the spacing until the player steps it, then keeps its own value', () => {
    const h = armGrid();
    field(h, 'spacing').onInc();
    expect([field(h, 'spacing').value, field(h, 'burden').value]).toEqual([5, 5]);
    field(h, 'spacing').onDec();
    field(h, 'spacing').onDec();
    expect([field(h, 'spacing').value, field(h, 'burden').value]).toEqual([3, 3]);

    field(h, 'burden').onInc();
    expect([field(h, 'spacing').value, field(h, 'burden').value]).toEqual([3, 4]);
    for (let i = 0; i < 3; i++) field(h, 'spacing').onInc();
    expect([field(h, 'spacing').value, field(h, 'burden').value]).toEqual([6, 4]);
  });

  it('boundary: the burden stepper stays between 1 and 20 m', () => {
    const h = armGrid();
    for (let i = 0; i < 30; i++) field(h, 'burden').onDec();
    expect(field(h, 'burden').value).toBe(1);
    for (let i = 0; i < 30; i++) field(h, 'burden').onInc();
    expect(field(h, 'burden').value).toBe(20);
  });

  it('rows come from the burden: the same 4 m deep selection lays out 3 rows at a 2 m burden', () => {
    const h = armGrid();
    expect(lastStripArg(h.strip).subtitle).toBe('3 × 2');
    field(h, 'burden').onDec();
    field(h, 'burden').onDec();

    expect(lastStripArg(h.strip).subtitle).toBe('3 × 3');
    const cmd = confirmed(h);
    expect(cmd).toContain('rows:3');
    expect(cmd).toContain('cols:3');
    expect(cmd).toContain(' burden:2');
  });

  it('the command names the burden only when it differs from the spacing', () => {
    expect(confirmed(armGrid())).not.toContain('burden:');

    const followed = armGrid();
    field(followed, 'spacing').onInc(); // the burden follows to 5 m: still a square mesh
    const followedCmd = confirmed(followed);
    expect(followedCmd).toContain('spacing:5');
    expect(followedCmd).not.toContain('burden:');

    const stepped = armGrid();
    field(stepped, 'burden').onDec();
    expect(confirmed(stepped)).toContain(' burden:3');
  });

  it('the layout button toggles between aligned and staggered rows', () => {
    const h = armGrid();
    expect(layoutButton(h)?.label).toBe(layoutLabel('square'));
    layoutButton(h)!.onClick();
    expect(layoutButton(h)?.label).toBe(layoutLabel('staggered'));
    layoutButton(h)!.onClick();
    expect(layoutButton(h)?.label).toBe(layoutLabel('square'));
    expect(layoutLabel('square')).not.toBe(layoutLabel('staggered'));
  });

  it('the command adds pattern:staggered only while the layout is staggered', () => {
    expect(confirmed(armGrid())).not.toContain('pattern:');

    const staggered = armGrid();
    layoutButton(staggered)!.onClick();
    expect(confirmed(staggered)).toContain(' pattern:staggered');

    const toggledBack = armGrid();
    layoutButton(toggledBack)!.onClick();
    layoutButton(toggledBack)!.onClick();
    expect(confirmed(toggledBack)).not.toContain('pattern:');
  });

  it('a staggered grid with its own burden sends one command naming both, in the console syntax', () => {
    const h = armGrid();
    field(h, 'burden').onDec();
    layoutButton(h)!.onClick();

    // z 10..14 at a 3 m burden still rounds to 2 rows.
    expect(confirmed(h)).toBe(
      `drill_plan grid rows:2 cols:3 spacing:4 burden:3 pattern:staggered depth:8 diameter:${DRILL_HOLE_DEFAULT_DIAMETER_M} start:10,10`,
    );
  });

  it('the stat strip shows the mesh as spacing × burden', () => {
    const h = armGrid();
    expect(mesh(h)).toBe('4 × 4 m');
    field(h, 'spacing').onInc();
    expect(mesh(h)).toBe('5 × 5 m');
    field(h, 'burden').onDec();
    expect(mesh(h)).toBe('5 × 4 m');
  });

  it('the pattern cell names a staggered layout once such a grid is confirmed', () => {
    const staggered = armGrid();
    layoutButton(staggered)!.onClick();
    confirmed(staggered);
    staggered.step.update(staggered.state, 'sunny');
    expect(staggered.step.root.textContent).toContain(`3 × 2 · ${t('ui.blast_workshop.drill.layout_staggered')}`);

    const aligned = armGrid();
    confirmed(aligned);
    aligned.step.update(aligned.state, 'sunny');
    expect(aligned.step.root.textContent).toContain('3 × 2');
    expect(aligned.step.root.textContent).not.toContain(t('ui.blast_workshop.drill.layout_staggered'));
  });
});

describe('DrillStep — burden and layout controls on the real strip', () => {
  /** The grid tool armed over x 10..18 / z 10..14, drawing into a real ParamStrip a player clicks. */
  function armWithRealStrip() {
    const { step, gameConsole } = makeStep();
    const mock = makeMockKit();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const kit = { controller: mock.controller, overlay: mock.overlay, strip: new ParamStrip(host) } as unknown as PlacementKit;
    step.setPlacementKit(kit);
    step.update(makeState(), 'sunny');
    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    mock.controller.simulateSelect({ x1: 10, z1: 10, x2: 18, z2: 14 });
    const confirmed = (): string => {
      mock.controller.simulateConfirm();
      return gameConsole.mock.calls.map(c => String(c[0])).filter(c => c.startsWith('drill_plan grid')).at(-1) ?? '';
    };
    return { host, confirmed };
  }
  // The strip rebuilds on every change: query afresh after each click.
  const shown = (host: HTMLElement, key: string) => host.querySelector(`[data-field="${key}"] .bsx-stepper-value`)?.textContent;
  const stepButton = (host: HTMLElement, key: string, dir: 'dec' | 'inc') =>
    host.querySelectorAll<HTMLButtonElement>(`[data-field="${key}"] .bsx-stepper-btn`)[dir === 'dec' ? 0 : 1]!;
  const layoutButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-action="grid-layout"]');

  it('a [data-field="burden"] stepper follows the spacing until clicked, and its clicks reach the command', () => {
    const { host, confirmed } = armWithRealStrip();
    expect(shown(host, 'burden')).toBe('4 m');

    stepButton(host, 'spacing', 'inc').click();
    expect(shown(host, 'burden')).toBe('5 m');
    stepButton(host, 'burden', 'dec').click();

    expect(shown(host, 'spacing')).toBe('5 m');
    expect(shown(host, 'burden')).toBe('4 m');
    expect(confirmed()).toContain(' spacing:5 burden:4 ');
  });

  it('the [data-action="grid-layout"] button flips its label and the command between aligned and staggered', () => {
    const { host, confirmed } = armWithRealStrip();
    const label = (layout: 'square' | 'staggered') =>
      t('ui.blast_workshop.drill.layout_button', { layout: t(`ui.blast_workshop.drill.layout_${layout}`) });
    expect(layoutButton(host)?.textContent).toBe(label('square'));

    layoutButton(host)!.click();

    expect(layoutButton(host)?.textContent).toBe(label('staggered'));
    expect(confirmed()).toContain(' pattern:staggered ');
  });
});

describe('DrillStep — the overlay marks the holes the grid drills', () => {
  function armed(state: ReturnType<typeof makeState>, sel: { x1: number; z1: number; x2: number; z2: number }) {
    const { step } = makeStep();
    const { kit, controller, overlay, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(state, 'sunny');
    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect(sel);
    return { overlay, strip };
  }
  const lastOverlay = (overlay: { update: ReturnType<typeof vi.fn> }) =>
    overlay.update.mock.calls.at(-1)![0] as { holeCells?: { x: number; z: number }[]; holeSpacing?: number };

  it('an aligned grid marks every cell of its mesh as exact cells, not as a spacing hint', () => {
    const { overlay } = armed(makeState(), { x1: 10, z1: 10, x2: 18, z2: 14 });
    expect(lastOverlay(overlay).holeCells).toEqual(gridCellPositions({ x: 10, z: 10 }, 2, 3, 4));
    expect(lastOverlay(overlay).holeSpacing).toBeUndefined();
  });

  it('a burden and a staggered layout move the marks onto the holes they drill', () => {
    const { overlay, strip } = armed(makeState(), { x1: 10, z1: 10, x2: 18, z2: 16 });
    lastStripArg(strip).fields.find(f => f.key === 'burden')!.onDec();
    lastStripArg(strip).actions!.find(a => a.key === 'grid-layout')!.onClick();

    // z 10..16 at a 3 m burden: 3 rows, the middle one shifted 2 m.
    expect(lastOverlay(overlay).holeCells).toEqual(gridCellPositions({ x: 10, z: 10 }, 3, 3, 4, 3, 'staggered'));
    expect(lastOverlay(overlay).holeCells).toContainEqual({ x: 12, z: 13 });
  });

  it('cells under a building are not marked: they will not be drilled', () => {
    const { overlay } = armed(makeStateWithFootprint(), { x1: 10, z1: 10, x2: 26, z2: 14 });
    const cells = lastOverlay(overlay).holeCells!;
    expect(cells).toHaveLength(9);
    expect(cells).not.toContainEqual({ x: 10, z: 10 });
    expect(cells).toEqual(gridCellPositions({ x: 10, z: 10 }, 2, 5, 4).filter(c => !(c.x === 10 && c.z === 10)));
  });

  it('boundary: a grid too large for the command marks nothing rather than enumerating it', () => {
    // 101 x 101 cells at the 4 m default spacing > MAX_DRILL_GRID_HOLES.
    const { overlay } = armed(makeStateWithFootprint(), { x1: 10, z1: 10, x2: 410, z2: 410 });
    expect(lastOverlay(overlay).holeCells).toEqual([]);
  });
});

describe('DrillStep — drilling readout: metres, rig work and cost', () => {
  function armed(tool: 'grid-tool' | 'add-hole-tool', state: ReturnType<typeof makeState>, sel: { x1: number; z1: number; x2: number; z2: number }) {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(state, 'sunny');
    (step.root.querySelector(`[data-action="${tool}"]`) as HTMLButtonElement).click();
    controller.simulateSelect(sel);
    return { strip, field: (key: string) => lastStripArg(strip).fields.find(f => f.key === key)! };
  }

  /** The readout line for `count` holes of `depth` m × `diameter` m drilled at the pace of a tier-`tier` rig. */
  function drillLine(count: number, depth: number, diameter: number, tier: 1 | 2 | 3): string {
    const holes = Array.from({ length: count }, () => ({ depth, diameter }));
    return t('ui.blast_workshop.drill.drill_readout', {
      holes: count,
      metres: count * depth,
      time: formatGameDuration(estimateDrillWorkTicks(holes, tier)),
      cost: formatMoney(count * drillHoleCost(depth, diameter)),
    });
  }

  const GRID_3X3 = { x1: 10, z1: 10, x2: 18, z2: 18 };

  it('the grid readout gives the metres, the rig work and the cash its holes cost', () => {
    // No permit and no rig: 8 m holes of 89 mm at a tier-1 rig's pace.
    const readout = lastStripArg(armed('grid-tool', makeState(), GRID_3X3).strip).readout!;
    expect(readout).toEqual([drillLine(9, 8, DRILL_HOLE_DEFAULT_DIAMETER_M, 1)]);
    // 9 holes; 9 x 8 m = 72 m; 9 x $96 = $864.
    expect(readout[0]).toContain('9 holes');
    expect(readout[0]).toContain('72 m');
    expect(readout[0]).toContain('$864');
  });

  it('the rig work is estimated with the best rig the fleet owns', () => {
    const fleet = stateWithRigTier(1);
    fleet.vehicles.vehicles.push({ id: 901, type: 'drill_rig', tier: 3 } as unknown as (typeof fleet.vehicles.vehicles)[number]);
    const best = lastStripArg(armed('grid-tool', fleet, GRID_3X3).strip).readout![0]!;
    const slow = lastStripArg(armed('grid-tool', stateWithRigTier(1), GRID_3X3).strip).readout![0]!;

    expect(best).toBe(drillLine(9, 8, DRILL_HOLE_DEFAULT_DIAMETER_M, 3));
    expect(slow).toBe(drillLine(9, 8, DRILL_HOLE_DEFAULT_DIAMETER_M, 1));
    expect(best).not.toBe(slow);
  });

  it('the readout follows the depth and bore steppers', () => {
    const { strip, field } = armed('grid-tool', stateWithRigTier(2), GRID_3X3);
    field('depth').onInc();
    field('diameter').onInc();

    // 9 holes of 9 m at 127 mm: 81 m, 9 x $154 = $1,386.
    const readout = lastStripArg(strip).readout!;
    expect(readout).toEqual([drillLine(9, 9, 0.127, 2)]);
    expect(readout[0]).toContain('81 m');
    expect(readout[0]).toContain('$1,386');
  });

  it('cells under a building are not drilled, so they add no metres and no cost', () => {
    const { strip } = armed('grid-tool', makeStateWithFootprint(), { x1: 10, z1: 10, x2: 26, z2: 14 });
    expect(lastStripArg(strip).readout).toEqual([drillLine(9, 8, DRILL_HOLE_DEFAULT_DIAMETER_M, 1)]);
  });

  it('on a permit site a second line gives the grid area against the permit', () => {
    const state = makeState();
    state.grade = createGradeState();
    const { strip, field } = armed('grid-tool', state, GRID_3X3);
    const depth = field('depth').value; // the grade's opening depth

    const readout = lastStripArg(strip).readout!;
    expect(readout).toEqual([
      drillLine(9, depth, DRILL_HOLE_DEFAULT_DIAMETER_M, 1),
      permitAreaLine(state.grade, gridPlanHoles(10, 10, 3, 3)),
    ]);
    expect(readout[1]).toContain('144 / 144 m²');
  });

  it('before a selection there is nothing to price', () => {
    const { step } = makeStep();
    const { kit, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(makeState(), 'sunny');
    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    expect(lastStripArg(strip).readout).toEqual([]);
  });

  it('add hole: the readout prices the one hole', () => {
    const readout = lastStripArg(armed('add-hole-tool', makeState(), { x1: 25, z1: 30, x2: 25, z2: 30 }).strip).readout!;
    expect(readout).toEqual([drillLine(1, 8, DRILL_HOLE_DEFAULT_DIAMETER_M, 1)]);
    expect(readout[0]).toContain('$96');
  });

  it('add hole: a tile under a building is not drilled, so it shows no readout', () => {
    const { strip } = armed('add-hole-tool', makeStateWithFootprint(), { x1: 10, z1: 10, x2: 10, z2: 10 });
    expect(lastStripArg(strip).readout).toEqual([]);
  });
});

// ── Plan-area permit warnings and the used / limit readout (#2167) ──────────

describe('DrillStep — the permit warning measures the plan a placement leaves (#2167)', () => {
  /**
   * State holding `drilled` drilled then `planned` ordered holes on one row 4 m apart from (100, 100):
   * once the row has two holes each works a 4 m × 4 m cell (16 m²). Grade 0 (144 m²) unless `progression` is off.
   */
  function stateWithRow(drilled: number, planned: number, progression = true) {
    const state = makeState();
    if (progression) state.grade = createGradeState();
    for (let i = 0; i < drilled; i++) addHole(holeCounter, state.drillHoles, 100 + i * 4, 100, 8, 0.15);
    for (let i = 0; i < planned; i++) addHole(holeCounter, state.plannedDrillHoles, 100 + (drilled + i) * 4, 100, 8, 0.15);
    return state;
  }

  /** The tile 4 m past the last of `count` row holes: a hole added there works one more 16 m² cell. */
  const nextInRow = (count: number) => ({ x1: 100 + count * 4, z1: 100, x2: 100 + count * 4, z2: 100 });

  /** The plan an added hole at `sel` leaves: every hole already in `state`, plus it. */
  const withAdded = (state: ReturnType<typeof makeState>, sel: { x1: number; z1: number }) =>
    [...state.drillHoles, ...state.plannedDrillHoles, { id: 'add', x: sel.x1, z: sel.z1 }];

  function armed(tool: 'grid-tool' | 'add-hole-tool', state: ReturnType<typeof makeState>, sel: { x1: number; z1: number; x2: number; z2: number }) {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(state, 'sunny');
    (step.root.querySelector(`[data-action="${tool}"]`) as HTMLButtonElement).click();
    controller.simulateSelect(sel);
    return { arg: lastStripArg(strip), step, controller, strip };
  }

  // Default 4 m mesh: x/z 10..14 is 2 x 2 holes (64 m²), 10..18 is 3 x 3 (144 m²), 10..22 is 4 x 4 (256 m²).
  const GRID_2X2 = { x1: 10, z1: 10, x2: 14, z2: 14 };
  const GRID_3X3 = { x1: 10, z1: 10, x2: 18, z2: 18 };
  const GRID_4X4 = { x1: 10, z1: 10, x2: 22, z2: 22 };

  it('grid tool: a grid replaces the plan, so the holes already planned do not count toward its area', () => {
    // Ten existing holes (160 m²) are over the permit on their own; the 2 x 2 grid replacing them is 64 m².
    const state = stateWithRow(6, 4);
    expect(permitPreview(state.grade, { holes: [...state.drillHoles, ...state.plannedDrillHoles], charges: {} }, 0)!.areaOver).toBe(true);

    const { arg } = armed('grid-tool', state, GRID_2X2);

    expect(arg.result).toBe(plainGridResult(2, 2));
    expect(arg.readout).toContain(permitAreaLine(state.grade, gridPlanHoles(10, 10, 2, 2)));
    expect(arg.readout!.join('\n')).toContain('64 / 144 m²');
    expect(arg.confirmEnabled).toBe(true);
  });

  it('grid tool: a grid over the limit warns with the same text whatever the plan held before', () => {
    const warning = gridAreaLimitWarning(createGradeState(), gridPlanHoles(10, 10, 4, 4))!;
    expect(warning).toBeTruthy();
    expect(armed('grid-tool', stateWithRow(0, 0), GRID_4X4).arg.result).toContain(warning);
    expect(armed('grid-tool', stateWithRow(3, 3), GRID_4X4).arg.result).toContain(warning);
  });

  it('grid tool: a grid exactly at the limit shows no warning and reads the full area', () => {
    const { arg } = armed('grid-tool', stateWithRow(0, 0), GRID_3X3);
    expect(arg.result).toBe(plainGridResult(3, 3));
    expect(arg.readout!.join('\n')).toContain('144 / 144 m²');
    expect(arg.confirmEnabled).toBe(true);
  });

  it('the warning carries the consequence text for the grid area, and the readout leaves the area to it', () => {
    const { arg } = armed('grid-tool', stateWithRow(0, 0), GRID_4X4);
    const consequence = permitPreview(createGradeState(), { holes: gridPlanHoles(10, 10, 4, 4), charges: {} }, 0)!.consequenceText;
    expect(consequence.length).toBeGreaterThan(0);
    expect(arg.result).toContain(consequence);
    // Only the drilling line: the warning already names the area and the limit.
    expect(arg.readout).toHaveLength(1);
    expect(arg.readout!.join('\n')).not.toContain(t('ui.blast_workshop.drill.permit_area', { area: '' }).trim());
  });

  it('footprint-covered cells are not drilled: a 10-cell grid with one cell under a building fits the limit', () => {
    // 5 x 2 = 10 cells at (10,10)..(26,14); the building covers (10,10), so 9 holes (144 m²) are drilled.
    const state = makeStateWithFootprint();
    state.grade = createGradeState();
    const covered = armed('grid-tool', state, { x1: 10, z1: 10, x2: 26, z2: 14 });
    expect(covered.arg.result).toBe(`${plainGridResult(5, 2)} — ${t('ui.blast_workshop.drill.grid_skipped_preview', { count: 1 })}`);
    expect(covered.arg.readout!.join('\n')).toContain('144 / 144 m²');

    // Control: the same 10 cells away from the building are all drilled — 160 m² — and overflow.
    const clear = makeStateWithFootprint();
    clear.grade = createGradeState();
    const free = armed('grid-tool', clear, { x1: 200, z1: 200, x2: 216, z2: 204 });
    expect(free.arg.result).toContain(gridAreaLimitWarning(createGradeState(), gridPlanHoles(200, 200, 2, 5))!);
    expect(free.arg.result).toContain('160 / 144 m²');
  });

  it('no grade: never warns, however large the grid, and reads no permit area', () => {
    // 30 m / 4 m = 7.5 rounds to 8 steps: 9 x 9 holes, 1296 m².
    const { arg } = armed('grid-tool', stateWithRow(30, 30, false), { x1: 10, z1: 10, x2: 40, z2: 40 });
    expect(arg.result).toBe(plainGridResult(9, 9));
    expect(arg.readout).toHaveLength(1);
    expect(arg.confirmEnabled).toBe(true);
  });

  it('add hole: the tenth hole of a 4 m row takes the plan past 144 m² and warns, confirm stays enabled', () => {
    const state = stateWithRow(5, 4);
    const sel = nextInRow(9);
    const { arg } = armed('add-hole-tool', state, sel);
    const warning = gridAreaLimitWarning(createGradeState(), withAdded(state, sel))!;
    expect(warning).toBeTruthy();
    expect(arg.result).toBe(`1 — ${warning}`);
    expect(arg.result).toContain('160 / 144 m²');
    expect(arg.confirmEnabled).toBe(true);
  });

  it('add hole: the ninth hole lands exactly on the limit and shows no warning', () => {
    const { arg } = armed('add-hole-tool', stateWithRow(5, 3), nextInRow(8));
    expect(arg.result).toBe('1');
    expect(arg.readout!.join('\n')).toContain('144 / 144 m²');
    expect(arg.confirmEnabled).toBe(true);
  });

  it('add hole: drilled and ordered holes both count toward the plan', () => {
    expect(armed('add-hole-tool', stateWithRow(9, 0), nextInRow(9)).arg.result).toContain('160 / 144 m²');
    expect(armed('add-hole-tool', stateWithRow(0, 9), nextInRow(9)).arg.result).toContain('160 / 144 m²');
    expect(armed('add-hole-tool', stateWithRow(4, 4), nextInRow(8)).arg.result).toBe('1');
  });

  it('add hole: the area decides, not the count — a ninth hole set apart from the row works the widest cell and warns', () => {
    // Eight row holes (128 m²) plus one far from them, given a HOLE_CELL_MAX_SIDE_M square (64 m²): 192 m².
    const state = stateWithRow(5, 3);
    const sel = { x1: 10, z1: 10, x2: 10, z2: 10 };
    const { arg } = armed('add-hole-tool', state, sel);
    expect(arg.result).toContain(gridAreaLimitWarning(createGradeState(), withAdded(state, sel))!);
    expect(arg.result).toContain(`${8 * 16 + HOLE_CELL_MAX_SIDE_M ** 2} / 144 m²`);
  });

  it('add hole: with no existing holes a lone hole works one default cell and shows no warning', () => {
    const { arg } = armed('add-hole-tool', stateWithRow(0, 0), { x1: 10, z1: 10, x2: 10, z2: 10 });
    expect(arg.result).toBe('1');
    expect(arg.readout!.join('\n')).toContain(`${DRILL_GRID_DEFAULT_SPACING_M ** 2} / 144 m²`);
  });

  it('add hole: no grade never warns', () => {
    const { arg } = armed('add-hole-tool', stateWithRow(20, 20, false), nextInRow(40));
    expect(arg.result).toBe('1');
    expect(arg.readout).toHaveLength(1);
  });

  it('confirming an over-permit grid still dispatches the drill_plan command', () => {
    const { step, gameConsole } = makeStep();
    const { kit, controller } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(stateWithRow(0, 0), 'sunny');
    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect(GRID_4X4);
    controller.simulateConfirm();
    expect(gameConsole.mock.calls.some(c => String(c[0]).startsWith('drill_plan grid'))).toBe(true);
  });
});

describe('DrillStep — permit area used / limit in the holes header (#2167)', () => {
  const readout = (step: DrillStep) => step.root.querySelector('[data-role="permit-area"]') as HTMLElement | null;

  /** `drilled` drilled then `planned` ordered holes on one row 4 m apart: 16 m² each once there are two. */
  function withHoles(drilled: number, planned: number, progression = true) {
    const state = makeState();
    if (progression) state.grade = createGradeState();
    for (let i = 0; i < drilled; i++) addHole(holeCounter, state.drillHoles, 10 + i * 4, 10, 8, 0.15);
    for (let i = 0; i < planned; i++) addHole(holeCounter, state.plannedDrillHoles, 10 + (drilled + i) * 4, 10, 8, 0.15);
    return state;
  }

  it('shows "0 / 144 m²" with no holes at all when the mine has a grade', () => {
    const { step } = makeStep();
    step.update(withHoles(0, 0), 'sunny');
    expect(readout(step)).not.toBeNull();
    expect(readout(step)!.textContent).toBe('0 / 144 m²');
    expect(readout(step)!.textContent).toBe(permitPreview(createGradeState(), { holes: [], charges: {} }, 0)!.areaText);
  });

  it('measures drilled and planned holes together', () => {
    const { step } = makeStep();
    const state = withHoles(3, 2);
    step.update(state, 'sunny');
    expect(readout(step)!.textContent).toBe('80 / 144 m²');
    expect(readout(step)!.textContent).toBe(
      permitPreview(state.grade, { holes: [...state.drillHoles, ...state.plannedDrillHoles], charges: {} }, 0)!.areaText,
    );
  });

  it('follows the plan as holes are added', () => {
    const { step } = makeStep();
    step.update(withHoles(2, 0), 'sunny');
    expect(readout(step)!.textContent).toBe('32 / 144 m²');
    step.update(withHoles(2, 4), 'sunny');
    expect(readout(step)!.textContent).toBe('96 / 144 m²');
  });

  it('a grid hole counts its own spacing × burden cell', () => {
    const { step } = makeStep();
    const state = makeState();
    state.grade = createGradeState();
    state.plannedDrillHoles.push(...createGridPlan(holeCounter, { x: 10, z: 10 }, 3, 3, 4, 8, DRILL_HOLE_DEFAULT_DIAMETER_M, 3));
    step.update(state, 'sunny');
    // 9 holes of 4 m x 3 m.
    expect(readout(step)!.textContent).toBe('108 / 144 m²');
  });

  it('at the limit it is not marked over', () => {
    const { step } = makeStep();
    step.update(withHoles(5, 4), 'sunny');
    expect(readout(step)!.textContent).toBe('144 / 144 m²');
    expect(readout(step)!.dataset['over']).toBe('false');
  });

  it('over the limit it is marked data-over="true"', () => {
    const { step } = makeStep();
    step.update(withHoles(6, 4), 'sunny');
    expect(readout(step)!.textContent).toBe('160 / 144 m²');
    expect(readout(step)!.dataset['over']).toBe('true');
  });

  it('the over mark clears when the plan drops back under the limit', () => {
    const { step } = makeStep();
    step.update(withHoles(6, 4), 'sunny');
    step.update(withHoles(4, 2), 'sunny');
    expect(readout(step)!.textContent).toBe('96 / 144 m²');
    expect(readout(step)!.dataset['over']).not.toBe('true');
  });

  it('absent or empty when the mine has no grade, even with holes', () => {
    const { step } = makeStep();
    step.update(withHoles(0, 0, false), 'sunny');
    expect(readout(step)?.textContent ?? '').toBe('');
    step.update(withHoles(4, 4, false), 'sunny');
    expect(readout(step)?.textContent ?? '').toBe('');
    expect(readout(step)?.dataset['over']).not.toBe('true');
  });

  it('empties again when the grade disappears', () => {
    const { step } = makeStep();
    step.update(withHoles(2, 0), 'sunny');
    expect(readout(step)!.textContent).toBe('32 / 144 m²');
    step.update(withHoles(2, 0, false), 'sunny');
    expect(readout(step)?.textContent ?? '').toBe('');
  });

  it('being over the permit disables nothing in the step', () => {
    const { step } = makeStep();
    step.update(withHoles(8, 8), 'sunny');
    expect(readout(step)!.dataset['over']).toBe('true');
    expect((step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).disabled).toBe(false);
    expect((step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).disabled).toBe(false);
    expect((step.root.querySelector('[data-action="clear-holes"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

// ── Explanations and entity links (#2168) ────────────────────────────────────

function makeOpener(): EntityOpener & { open: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> } {
  return { open: vi.fn(), focus: vi.fn() };
}

/** The status chip of the row whose label reads `label`. */
function chipWithLabel(root: HTMLElement, label: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('.bsx-chip')].find(c => c.textContent === label);
}

/** The row of a hole: the parent of its remove button. */
function rowOf(root: HTMLElement, index = 0): HTMLElement {
  return root.querySelectorAll('[data-action="remove-hole"]')[index]!.parentElement as HTMLElement;
}

function rubbleAt(id: number, x: number, z: number): FragmentData {
  return {
    id, position: { x, y: 0, z }, volume: 0.3, mass: 1000, rockId: 'cruite', oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
    halfExtents: { x: 0.3, y: 0.3, z: 0.3 }, shapeSeed: id, origin: { x, y: 0, z },
  };
}

describe('DrillStep — status chips explain themselves (#2168)', () => {
  it('a WET chip carries the wet explanation', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    wetAllHoles(state);
    step.update(state, 'sunny');
    const c = chipWithLabel(step.root, t('ui.blast_workshop.drill.status_wet'))!;
    expect(c).toBeDefined();
    expect(c.dataset['explain']).toBe(holeStatusExplain('wet'));
    expect(c.dataset['explain']!.length).toBeGreaterThan(0);
  });

  it('a TUBED chip carries the tubed explanation', () => {
    const { step } = makeStep();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    buyTubing(state.tubingState, 1, state.cash);
    installTubing(state.tubingState, hole.id, [hole.id]);
    step.update(state, 'sunny');
    const c = chipWithLabel(step.root, t('ui.blast_workshop.drill.status_tubed'))!;
    expect(c.dataset['explain']).toBe(holeStatusExplain('tubed'));
  });

  it('a DRY chip carries the dry explanation', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');
    const c = chipWithLabel(step.root, t('ui.blast_workshop.drill.status_dry'))!;
    expect(c.dataset['explain']).toBe(holeStatusExplain('dry'));
  });

  it('an ORDERED chip carries the ordered explanation', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.plannedDrillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');
    const c = chipWithLabel(step.root, t('ui.blast_workshop.drill.status_ordered'))!;
    expect(c.dataset['explain']).toBe(holeStatusExplain('ordered'));
  });

  it('a Buried chip carries the buried explanation', () => {
    const { step } = makeStep();
    const state = makeState();
    state.grade = createGradeState();
    addHole(holeCounter, state.plannedDrillHoles, 20, 20, 8, 0.15);
    addBlastFragments(state.logistics, [rubbleAt(1, 20, 20)]);
    step.update(state, 'sunny');
    const c = chipWithLabel(step.root, t('ui.blast_workshop.drill.status_buried'))!;
    expect(c).toBeDefined();
    expect(c.dataset['explain']).toBe(holeStatusExplain('buried'));
  });

  it('the five chips read differently from each other', () => {
    const texts = (['wet', 'tubed', 'dry', 'ordered', 'buried'] as const).map(holeStatusExplain);
    expect(new Set(texts).size).toBe(5);
  });

  it('the explanation follows a language switch after refreshLocale', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');
    try {
      setLocale('fr');
      step.refreshLocale();
      step.update(state, 'sunny');
      const c = chipWithLabel(step.root, t('ui.blast_workshop.drill.status_dry'))!;
      expect(c.dataset['explain']).toBe(holeStatusExplain('dry'));
    } finally {
      setLocale('en');
    }
  });
});

describe('DrillStep — drill setting explanations (#2168)', () => {
  type ExplainField = { key: string; label: string; explain?: string };
  const fieldsOf = (strip: { show: ReturnType<typeof vi.fn> }) =>
    (strip.show.mock.calls.at(-1)![0] as { fields: ExplainField[] }).fields;

  it('the grid tool strip gives Spacing, Burden, Depth and Diameter each an explanation', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(makeState(), 'sunny');
    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 16, z2: 16 });

    const fields = fieldsOf(strip);
    for (const key of ['spacing', 'burden', 'depth', 'diameter'] as const) {
      const f = fields.find(x => x.key === key)!;
      expect(f, key).toBeDefined();
      expect(f.explain, key).toBe(drillFieldExplain(key));
      expect(f.explain!.length).toBeGreaterThan(0);
    }
  });

  it('the add-hole strip explains Depth and Diameter', () => {
    const { step } = makeStep();
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(makeState(), 'sunny');
    (step.root.querySelector('[data-action="add-hole-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 12, z1: 12, x2: 12, z2: 12 });

    const fields = fieldsOf(strip);
    expect(fields.find(x => x.key === 'depth')!.explain).toBe(drillFieldExplain('depth'));
    expect(fields.find(x => x.key === 'diameter')!.explain).toBe(drillFieldExplain('diameter'));
  });

  it('the four setting explanations differ from each other', () => {
    const texts = (['spacing', 'burden', 'depth', 'diameter'] as const).map(drillFieldExplain);
    expect(new Set(texts).size).toBe(4);
  });

  // The stat strip reads Pattern, Mesh (spacing × burden) and Depth; the spacing has no cell of its own.
  // The depth cell explains depth in the depth stepper's words.
  for (const [cell, labelKey, explanation, explainKey] of [
    ['pattern', 'ui.blast_workshop.drill.pattern', () => t('ui.explain.drill_field_pattern'), 'ui.explain.drill_field_pattern'],
    ['mesh', 'ui.blast_workshop.drill.mesh', () => t('ui.explain.drill_field_mesh'), 'ui.explain.drill_field_mesh'],
    ['depth', 'ui.blast_workshop.drill.depth', () => drillFieldExplain('depth'), 'ui.explain.drill_field_depth'],
  ] as const) {
    it(`the stat strip's ${cell} label carries the ${cell} explanation`, () => {
      const { step } = makeStep();
      step.update(makeState(), 'sunny');
      const label = [...step.root.querySelectorAll<HTMLElement>('span')].find(s => s.textContent === t(labelKey))!;
      expect(label).toBeDefined();
      const holder = label.closest<HTMLElement>('[data-explain]');
      expect(holder).not.toBeNull();
      expect(holder!.dataset['explain']).toBe(explanation());
      expect(holder!.dataset['explain']).not.toBe(explainKey); // a real text, not a missing key
    });
  }

  it('the stat strip no longer has a Spacing cell: spacing and burden read together as the mesh', () => {
    const { step } = makeStep();
    step.update(makeState(), 'sunny');
    const labels = [...step.root.querySelectorAll<HTMLElement>('span')].map(s => s.textContent);
    expect(labels).toContain(t('ui.blast_workshop.drill.mesh'));
    expect(labels).not.toContain(t('ui.blast_workshop.drill.spacing'));
  });
});

describe('DrillStep — hole rows open the inspector (#2168)', () => {
  it('clicking a drilled hole row opens that hole through the opener', () => {
    const { step } = makeStep();
    const opener = makeOpener();
    step.setEntityOpener(opener);
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    addHole(holeCounter, state.drillHoles, 13, 20, 8, 0.15);
    step.update(state, 'sunny');

    rowOf(step.root, 1).click();

    expect(opener.open).toHaveBeenCalledTimes(1);
    expect(opener.open).toHaveBeenCalledWith('hole', holeNumericId(state.drillHoles[1]!.id));
  });

  it('an ordered (not yet drilled) row opens too', () => {
    const { step } = makeStep();
    const opener = makeOpener();
    step.setEntityOpener(opener);
    const state = makeState();
    const hole = addHole(holeCounter, state.plannedDrillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');

    rowOf(step.root).click();

    expect(opener.open).toHaveBeenCalledWith('hole', holeNumericId(hole.id));
  });

  it('a buried ordered row opens too', () => {
    const { step } = makeStep();
    const opener = makeOpener();
    step.setEntityOpener(opener);
    const state = makeState();
    state.grade = createGradeState();
    const hole = addHole(holeCounter, state.plannedDrillHoles, 20, 20, 8, 0.15);
    addBlastFragments(state.logistics, [rubbleAt(1, 20, 20)]);
    step.update(state, 'sunny');
    expect(chipWithLabel(step.root, t('ui.blast_workshop.drill.status_buried'))).toBeDefined();

    rowOf(step.root).click();

    expect(opener.open).toHaveBeenCalledWith('hole', holeNumericId(hole.id));
  });

  it('clicking the row text (id label) also opens the hole', () => {
    const { step } = makeStep();
    const opener = makeOpener();
    step.setEntityOpener(opener);
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');

    const idLabel = [...rowOf(step.root).querySelectorAll('span')].find(s => s.textContent === hole.id)!;
    idLabel.click();

    expect(opener.open).toHaveBeenCalledWith('hole', holeNumericId(hole.id));
  });

  it('the remove button still removes and does not open the hole', () => {
    const { step, gameConsole } = makeStep();
    const opener = makeOpener();
    step.setEntityOpener(opener);
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');

    (step.root.querySelector('[data-action="remove-hole"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith(`drill_plan remove hole:${hole.id}`);
    expect(opener.open).not.toHaveBeenCalled();
  });

  it('the remove button of an ordered row does not open the hole either', () => {
    const { step, gameConsole } = makeStep();
    const opener = makeOpener();
    step.setEntityOpener(opener);
    const state = makeState();
    const hole = addHole(holeCounter, state.plannedDrillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');

    (step.root.querySelector('[data-action="remove-hole"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith(`drill_plan remove hole:${hole.id}`);
    expect(opener.open).not.toHaveBeenCalled();
  });

  it('without an opener a row click does nothing and nothing throws', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');

    expect(() => rowOf(step.root).click()).not.toThrow();
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('an opener wired after the rows were rendered takes effect on the next render', () => {
    const { step } = makeStep();
    const state = makeState();
    const hole = addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');

    const opener = makeOpener();
    step.setEntityOpener(opener);
    addHole(holeCounter, state.drillHoles, 13, 20, 8, 0.15); // changes the signature: rows rebuild
    step.update(state, 'sunny');
    rowOf(step.root, 0).click();

    expect(opener.open).toHaveBeenCalledWith('hole', holeNumericId(hole.id));
  });

  it('unwiring the opener (undefined) makes rows inert again', () => {
    const { step } = makeStep();
    const opener = makeOpener();
    step.setEntityOpener(opener);
    const state = makeState();
    addHole(holeCounter, state.drillHoles, 10, 20, 8, 0.15);
    step.update(state, 'sunny');

    step.setEntityOpener(undefined);
    addHole(holeCounter, state.drillHoles, 13, 20, 8, 0.15);
    step.update(state, 'sunny');
    rowOf(step.root, 0).click();

    expect(opener.open).not.toHaveBeenCalled();
  });
});
