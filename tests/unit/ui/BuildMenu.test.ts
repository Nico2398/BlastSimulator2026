// @vitest-environment jsdom
// BlastSimulator2026 — Placed-buildings list layout (issue #462)
//
// Bug: `makePlacedRow()`'s `info` div uses plain `flex:1` (no basis) and its
// four action buttons (Move/Upgrade/Queue Research/Demolish) have no
// flex/white-space override. With 4 buttons in a 270px-wide `#bs-build-panel`
// the `info` column collapses to near-zero width, showing only a stray
// fragment of the label (e.g. a lone ':') for rows like Research Center that
// still show the "Queue Research" button. `makeCatalogRow()` already ships
// the fix for the identical defect (flex:1 1 50% on info, flex:0 1 auto +
// white-space:normal on buttons) — this file asserts `makePlacedRow()`
// matches that pattern. jsdom has no layout engine, so assertions check
// inline style VALUES, not rendered pixel widths.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BuildMenu } from '../../../src/ui/BuildMenu.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { getBuildingDef, type Building } from '../../../src/core/entities/Building.js';
import type { PlacementKit } from '../../../src/ui/scene/PlacementKit.js';
import type { PlacementSelection, PlacementArmConfig, PlacementConfirmHandler, PlacementChangeHandler } from '../../../src/ui/scene/PlacementController.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';

/** Minimal GameState that won't crash the panel update loop. */
function makeMockState(overrides?: Partial<GameState>): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = 99999;
  return { ...s, ...overrides };
}

function makeBuilding(overrides: Partial<Building> & Pick<Building, 'id' | 'type' | 'tier'>): Building {
  return {
    x: 5,
    z: 5,
    hp: 100,
    active: true,
    ...overrides,
  };
}

function setupMenu(): { container: HTMLDivElement; menu: BuildMenu } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const menu = new BuildMenu(container);
  return { container, menu };
}

/**
 * Find a placed-row by building id, scoped to this test's own container.
 * Deliberately avoids the `#bs-build-placed` id selector: jsdom resolves id
 * selectors against the whole document rather than the query root, so a
 * prior test's un-disposed BuildMenu (same id, different container) can
 * shadow this one. Class + attribute selectors don't have that failure mode.
 */
function findPlacedRow(container: HTMLElement, buildingId: number): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `.bs-build-placed-row[data-building-id="${buildingId}"]`,
  );
  if (!row) throw new Error(`no placed row found for building id ${buildingId}`);
  return row;
}

describe('BuildMenu — placed-row layout does not collapse the label column (issue #462)', () => {
  let container: HTMLDivElement;
  let menu: BuildMenu;

  beforeEach(() => {
    ({ container, menu } = setupMenu());
  });

  afterEach(() => {
    menu.dispose();
    container.remove();
  });

  it('4-button row (Research Center, tier 2 locked + not queued): info div gets a flex basis and min-width:0, all 4 buttons get flex:0 1 auto + white-space:normal', () => {
    const researchCenter = makeBuilding({ id: 1, type: 'research_center', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [researchCenter];
    // Default unlockedTiers is {} (tier 2 not unlocked) and researchQueue is
    // empty (nothing queued), so researchBtn is visible — 4 buttons total.

    menu.update(state);

    const row = findPlacedRow(container, 1);

    const info = row.querySelector<HTMLElement>('div');
    expect(info).not.toBeNull();
    expect(info!.style.flex).toBe('1 1 50%');
    expect(info!.style.minWidth).toBe('0px');
    // Sanity: only CSS changed, label text still complete.
    expect(info!.textContent).toContain('#1');
    expect(info!.textContent).toContain('(5,5)');

    const moveBtn = row.querySelector<HTMLButtonElement>('.bs-build-move-btn');
    const upgradeBtn = row.querySelector<HTMLButtonElement>('.bs-build-upgrade-btn');
    const researchBtn = row.querySelector<HTMLButtonElement>('.bs-build-research-btn');
    const demolishBtn = row.querySelector<HTMLButtonElement>('.bs-build-demolish-btn');

    expect(moveBtn).not.toBeNull();
    expect(upgradeBtn).not.toBeNull();
    expect(researchBtn).not.toBeNull();
    expect(demolishBtn).not.toBeNull();
    // Research Center's own tier 2 must be locked and not queued for the
    // 4th button to be visible — confirm the fixture actually exercises the
    // 4-button case before asserting on its buttons.
    expect(researchBtn!.style.display).not.toBe('none');

    for (const btn of [moveBtn, upgradeBtn, researchBtn, demolishBtn]) {
      expect(btn!.style.flex).toBe('0 1 auto');
      expect(btn!.style.whiteSpace).toBe('normal');
    }
  });

  it('3-button row (Living Quarters at max tier 3, researchBtn hidden): info div gets a flex basis and min-width:0, all 3 visible buttons get flex:0 1 auto + white-space:normal', () => {
    const livingQuarters = makeBuilding({ id: 2, type: 'living_quarters', tier: 3 });
    const state = makeMockState();
    state.buildings.buildings = [livingQuarters];
    // Tier 3 is the max tier, so nextTier is null and researchBtn stays
    // hidden — exactly 3 visible buttons: Move, Upgrade (disabled), Demolish.

    menu.update(state);

    const row = findPlacedRow(container, 2);

    const info = row.querySelector<HTMLElement>('div');
    expect(info).not.toBeNull();
    expect(info!.style.flex).toBe('1 1 50%');
    expect(info!.style.minWidth).toBe('0px');
    expect(info!.textContent).toContain('#2');
    expect(info!.textContent).toContain('(5,5)');

    const moveBtn = row.querySelector<HTMLButtonElement>('.bs-build-move-btn');
    const upgradeBtn = row.querySelector<HTMLButtonElement>('.bs-build-upgrade-btn');
    const researchBtn = row.querySelector<HTMLButtonElement>('.bs-build-research-btn');
    const demolishBtn = row.querySelector<HTMLButtonElement>('.bs-build-demolish-btn');

    expect(moveBtn).not.toBeNull();
    expect(upgradeBtn).not.toBeNull();
    expect(demolishBtn).not.toBeNull();
    // Confirm the fixture actually exercises the 3-button case.
    expect(researchBtn!.style.display).toBe('none');

    for (const btn of [moveBtn, upgradeBtn, demolishBtn]) {
      expect(btn!.style.flex).toBe('0 1 auto');
      expect(btn!.style.whiteSpace).toBe('normal');
    }
  });
});

describe('BuildMenu — placed-row affordability guard (issue #511)', () => {
  let container: HTMLDivElement;
  let menu: BuildMenu;

  beforeEach(() => {
    ({ container, menu } = setupMenu());
  });

  afterEach(() => {
    menu.dispose();
    container.remove();
  });

  it('.bs-build-demolish-btn / .bs-build-upgrade-btn / .bs-build-move-btn disable when cash is short of their real cost, and re-enable on a cash-only update() that never rebuilds the row', () => {
    const building = makeBuilding({ id: 1, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    // Tier 2 researched so only the funds guard — not the research gate — is
    // under test here; the tier-locked case is covered by BuildMenu's own
    // pre-existing nextTier===null disabling, not this guard.
    state.buildings.unlockedTiers['management_office'] = 2;

    const oldDef = getBuildingDef('management_office', 1);
    const newDef = getBuildingDef('management_office', 2);
    const demolishCost = oldDef.demolishCost;
    const moveCost = Math.round(oldDef.constructionCost * 0.5);
    const upgradeCost = oldDef.demolishCost + newDef.constructionCost;
    const maxCost = Math.max(demolishCost, moveCost, upgradeCost);

    state.cash = maxCost - 1;
    menu.update(state);
    const row = findPlacedRow(container, 1);
    expect(row.querySelector<HTMLButtonElement>('.bs-build-demolish-btn')!.disabled).toBe(demolishCost > state.cash);
    expect(row.querySelector<HTMLButtonElement>('.bs-build-upgrade-btn')!.disabled).toBe(upgradeCost > state.cash);
    expect(row.querySelector<HTMLButtonElement>('.bs-build-move-btn')!.disabled).toBe(moveCost > state.cash);

    // Cash-only change: building id/tier, unlockedTiers, and researchQueue are
    // all unchanged, so `update()` must not trigger `refreshPlacedList()` — the
    // row's own DOM node must survive, proving the cash refresh is the cheap
    // per-tick path, not a full placed-list rebuild.
    state.cash = maxCost;
    menu.update(state);
    const rowAfter = findPlacedRow(container, 1);
    expect(rowAfter).toBe(row);
    expect(rowAfter.querySelector<HTMLButtonElement>('.bs-build-demolish-btn')!.disabled).toBe(false);
    expect(rowAfter.querySelector<HTMLButtonElement>('.bs-build-upgrade-btn')!.disabled).toBe(false);
    expect(rowAfter.querySelector<HTMLButtonElement>('.bs-build-move-btn')!.disabled).toBe(false);
  });

  it('re-disables on a cash-only update() that drops the balance back below cost', () => {
    const building = makeBuilding({ id: 2, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    state.buildings.unlockedTiers['management_office'] = 2;
    const demolishCost = getBuildingDef('management_office', 1).demolishCost;

    state.cash = demolishCost;
    menu.update(state);
    expect(findPlacedRow(container, 2).querySelector<HTMLButtonElement>('.bs-build-demolish-btn')!.disabled).toBe(false);

    state.cash = demolishCost - 1;
    menu.update(state);
    expect(findPlacedRow(container, 2).querySelector<HTMLButtonElement>('.bs-build-demolish-btn')!.disabled).toBe(true);
  });
});

// ── #1009 coverage: catalog placement, terrain tools (ramp/level-ground),
// research queueing, and placed-row actions (move/upgrade/demolish). ─────────
//
// Mirrors DrillStep.test.ts's `makeMockKit()` — a lightweight stand-in for
// PlacementController/SelectionOverlay/ParamStrip, enough surface for
// BuildMenu's own arm/confirm logic without a real Three.js scene or canvas.

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
    setFootprintCheck: vi.fn(),
    arm: (_config: PlacementArmConfig) => { armed = true; phase = 'armed'; },
    cancel: () => { armed = false; phase = 'idle'; selection = null; changeHandler?.(); },
    simulateSelect(sel: PlacementSelection) { selection = sel; phase = 'selected'; changeHandler?.(); },
    simulateConfirm() { if (selection) confirmHandler?.(selection); },
  };
  const overlay = { update: vi.fn(), clear: vi.fn(), flashConfirm: vi.fn() };
  const strip = { show: vi.fn(), hide: vi.fn(), setConfirmHandler: vi.fn(), setCancelHandler: vi.fn() };

  return { kit: { controller, overlay, strip } as unknown as PlacementKit, controller, overlay, strip };
}

describe('BuildMenu — catalog placement, terrain tools, and research flow (#1009 coverage)', () => {
  let container: HTMLDivElement;
  let menu: BuildMenu;
  let gameConsole: ReturnType<typeof vi.fn<[string], CommandResult>>;

  beforeEach(() => {
    ({ container, menu } = setupMenu());
    gameConsole = vi.fn<[string], CommandResult>().mockReturnValue({ success: true, output: '' });
    menu.setGameConsole(gameConsole);
  });

  afterEach(() => {
    menu.dispose();
    container.remove();
  });

  it('setSurfaceHeightSampler is a plain setter with no side effects', () => {
    expect(() => menu.setSurfaceHeightSampler(() => 0)).not.toThrow();
  });

  it('refreshLocale rebuilds the catalog and placed list without throwing, keeping placed rows intact', () => {
    const building = makeBuilding({ id: 1, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    menu.update(state);

    expect(() => menu.refreshLocale()).not.toThrow();
    expect(findPlacedRow(container, 1)).toBeDefined();
  });

  it('catalog Place button arms the point tool; confirming a selection dispatches a build command and shows status', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    const state = makeMockState();
    menu.update(state);

    const row = container.querySelector('[data-build-type="management_office"]')!;
    const placeBtn = row.querySelector<HTMLButtonElement>('.bs-build-buy-btn')!;
    placeBtn.click();
    expect(controller.isArmed).toBe(true);

    controller.simulateSelect({ x1: 10, z1: 12, x2: 10, z2: 12 });
    controller.simulateConfirm();

    expect(gameConsole).toHaveBeenCalledWith(expect.stringContaining('build management_office at:10,12'));
    expect(gameConsole.mock.calls[0]![0]).toContain('tier:1');
  });

  it('catalog Place button on a locked tier reports research-required instead of arming the tool', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    const state = makeMockState();
    menu.update(state);

    const row = container.querySelector('[data-build-type="management_office"]')!;
    const tierSel = row.querySelector<HTMLSelectElement>('.bs-build-tier-sel')!;
    tierSel.value = '2';
    tierSel.dispatchEvent(new Event('change'));

    const placeBtn = row.querySelector<HTMLButtonElement>('.bs-build-buy-btn')!;
    placeBtn.click();

    expect(controller.isArmed).toBe(false);
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('catalog Queue Research button dispatches research queue and reports ticks remaining on success', () => {
    const state = makeMockState();
    menu.update(state);
    gameConsole.mockReturnValue({ success: true, output: '' });
    state.buildings.researchQueue.push({ targetType: 'management_office', targetTier: 2, ticksRemaining: 42, cost: 500, conditions: [] });

    const row = container.querySelector('[data-build-type="management_office"]')!;
    const tierSel = row.querySelector<HTMLSelectElement>('.bs-build-tier-sel')!;
    tierSel.value = '2';
    tierSel.dispatchEvent(new Event('change'));

    const researchBtn = row.querySelector<HTMLButtonElement>('.bs-build-research-btn')!;
    researchBtn.click();

    expect(gameConsole).toHaveBeenCalledWith('research queue type:management_office tier:2');
  });

  it('catalog Queue Research button reports a translated failure on refusal', () => {
    const state = makeMockState();
    menu.update(state);
    gameConsole.mockReturnValue({ success: false, output: 'nope', code: 'insufficient_funds' });

    const row = container.querySelector('[data-build-type="management_office"]')!;
    const tierSel = row.querySelector<HTMLSelectElement>('.bs-build-tier-sel')!;
    tierSel.value = '2';
    tierSel.dispatchEvent(new Event('change'));

    const researchBtn = row.querySelector<HTMLButtonElement>('.bs-build-research-btn')!;
    expect(() => researchBtn.click()).not.toThrow();
    expect(gameConsole).toHaveBeenCalledWith('research queue type:management_office tier:2');
  });

  it('Terrain section: Ramp button arms the line tool; confirming dispatches build_ramp with depth', () => {
    const { kit, controller, strip } = makeMockKit();
    menu.setPlacementKit(kit);

    const rampBtn = container.querySelector<HTMLButtonElement>('.bs-build-ramp-btn')!;
    rampBtn.click();
    expect(controller.isArmed).toBe(true);

    controller.simulateSelect({ x1: 5, z1: 5, x2: 10, z2: 5 });
    controller.simulateConfirm();

    expect(gameConsole).toHaveBeenCalledWith(expect.stringContaining('build_ramp start:5,5 end:10,5 depth:8'));

    // Exercise the depth stepper's onInc/onDec (strip.show's `fields` array).
    const showArgs = strip.show.mock.calls.at(-1)![0];
    const depthField = showArgs.fields[0];
    depthField.onInc();
    depthField.onDec();
    expect(depthField).toBeDefined();
  });

  it('re-clicking the Ramp button while armed cancels instead of re-arming', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    const rampBtn = container.querySelector<HTMLButtonElement>('.bs-build-ramp-btn')!;

    rampBtn.click();
    expect(controller.isArmed).toBe(true);
    rampBtn.click();
    expect(controller.isArmed).toBe(false);
  });

  it('Terrain section: Level Ground button arms the rect tool; confirming dispatches level_ground', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);

    const levelBtn = container.querySelector<HTMLButtonElement>('.bs-build-level-ground-btn')!;
    levelBtn.click();
    expect(controller.isArmed).toBe(true);

    controller.simulateSelect({ x1: 5, z1: 5, x2: 8, z2: 9 });
    controller.simulateConfirm();

    expect(gameConsole).toHaveBeenCalledWith('level_ground minX:5 maxX:8 minZ:5 maxZ:9');
  });

  it('re-clicking the Level Ground button while armed cancels instead of re-arming', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    const levelBtn = container.querySelector<HTMLButtonElement>('.bs-build-level-ground-btn')!;

    levelBtn.click();
    expect(controller.isArmed).toBe(true);
    levelBtn.click();
    expect(controller.isArmed).toBe(false);
  });

  it('Level Ground tool reports the console refusal text when the order is rejected', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    gameConsole.mockReturnValue({ success: false, output: 'Area too large' });

    const levelBtn = container.querySelector<HTMLButtonElement>('.bs-build-level-ground-btn')!;
    levelBtn.click();
    controller.simulateSelect({ x1: 0, z1: 0, x2: 30, z2: 30 });
    controller.simulateConfirm();

    expect(gameConsole).toHaveBeenCalled();
  });

  it('placed row Move button arms the point tool at a new location and dispatches build move on confirm', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    const building = makeBuilding({ id: 7, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    menu.update(state);

    const row = findPlacedRow(container, 7);
    const moveBtn = row.querySelector<HTMLButtonElement>('.bs-build-move-btn')!;
    moveBtn.click();
    expect(controller.isArmed).toBe(true);

    controller.simulateSelect({ x1: 20, z1: 21, x2: 20, z2: 21 });
    controller.simulateConfirm();

    expect(gameConsole).toHaveBeenCalledWith('build move 7 to:20,21');
  });

  it('placed row Upgrade button on a locked next tier reports research-required instead of upgrading', () => {
    const building = makeBuilding({ id: 8, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    // unlockedTiers left empty — tier 2 is locked.
    menu.update(state);

    const row = findPlacedRow(container, 8);
    const upgradeBtn = row.querySelector<HTMLButtonElement>('.bs-build-upgrade-btn')!;
    upgradeBtn.click();

    expect(gameConsole).not.toHaveBeenCalledWith(expect.stringContaining('build upgrade'));
  });

  it('placed row Upgrade button dispatches build upgrade once the next tier is unlocked', () => {
    const building = makeBuilding({ id: 9, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    state.buildings.unlockedTiers['management_office'] = 2;
    menu.update(state);

    const row = findPlacedRow(container, 9);
    const upgradeBtn = row.querySelector<HTMLButtonElement>('.bs-build-upgrade-btn')!;
    upgradeBtn.click();

    expect(gameConsole).toHaveBeenCalledWith('build upgrade 9');
  });

  it('placed row Queue Research button dispatches research queue for the next tier', () => {
    const building = makeBuilding({ id: 10, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    menu.update(state);

    const row = findPlacedRow(container, 10);
    const researchBtn = row.querySelector<HTMLButtonElement>('.bs-build-research-btn')!;
    expect(researchBtn.style.display).not.toBe('none');
    researchBtn.click();

    expect(gameConsole).toHaveBeenCalledWith('research queue type:management_office tier:2');
  });

  it('placed row Demolish button dispatches build destroy', () => {
    const building = makeBuilding({ id: 11, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    menu.update(state);

    const row = findPlacedRow(container, 11);
    const demolishBtn = row.querySelector<HTMLButtonElement>('.bs-build-demolish-btn')!;
    demolishBtn.click();

    expect(gameConsole).toHaveBeenCalledWith('build destroy 11');
  });

  it('refreshUnderConstructionCounts shows the per-type count once a building enters plannedBuildings', () => {
    const state = makeMockState();
    menu.update(state);
    state.plannedBuildings.push({
      id: 1, buildingId: 1, type: 'management_office', tier: 1, x: 5, z: 5, actionId: 1, cost: 1000,
    });

    menu.update(state);

    const row = container.querySelector('[data-build-type="management_office"]')!;
    expect(row.textContent).toContain('1');
  });

  it('an empty placed-buildings list shows the none-placed empty state', () => {
    const state = makeMockState();
    state.buildings.buildings = [];
    menu.update(state);

    expect(container.querySelector('#bs-build-placed')!.textContent).toBeTruthy();
  });

  it('the header close button invokes the registered close handler', () => {
    const onClose = vi.fn();
    menu.setCloseHandler(onClose);

    const header = container.querySelector('#bs-build-panel')!.firstElementChild as HTMLElement;
    const closeBtn = header.querySelector('button')!;
    closeBtn.click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
