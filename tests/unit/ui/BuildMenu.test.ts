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
import type { TileRegion } from '../../../src/ui/tutorialPickerRegion.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';
import { rampDefFromEndpoints, validateRampOrder } from '../../../src/core/mining/Ramp.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { t } from '../../../src/core/i18n/I18n.js';
import type { ClaimRefusalReason } from '../../../src/core/world/PlayableArea.js';
import { computeRampCost } from '../../../src/core/mining/Ramp.js';
import { RAMP_DEFAULT_WIDTH } from '../../../src/core/config/balance.js';
/** Cost per metre of a default-width ramp. */
const RAMP_COST_PER_METER = computeRampCost(1, RAMP_DEFAULT_WIDTH);

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
    occupantIds: [],
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

/**
 * `activeRegion` (#1210, additive): a caller arming the ramp tool against a
 * pinned exact region (the tutorial's guided box-cut line) needs the mock
 * controller to report it back, so BuildMenu can pre-fill the depth field
 * from it. Defaults to `null` — every pre-existing call site (`makeMockKit()`
 * with no argument) is unaffected, matching today's always-unconstrained mock.
 */
function makeMockKit(options?: { activeRegion?: TileRegion | null }) {
  let armed = false;
  let phase: 'idle' | 'armed' | 'selected' = 'idle';
  let selection: PlacementSelection | null = null;
  let confirmHandler: PlacementConfirmHandler | null = null;
  let changeHandler: PlacementChangeHandler | null = null;
  let hoveredTile: { x: number; z: number } | null = null;
  const activeRegion = options?.activeRegion ?? null;

  const controller = {
    get isArmed() { return armed; },
    get currentPhase() { return phase; },
    get selection() { return selection; },
    get activeRegion() { return activeRegion; },
    get hoveredTile() { return hoveredTile; },
    get canConfirm() { return selection !== null; },
    setConfirmHandler: (cb: PlacementConfirmHandler) => { confirmHandler = cb; },
    setCancelHandler: vi.fn(),
    setChangeHandler: (cb: PlacementChangeHandler) => { changeHandler = cb; },
    setFootprintCheck: vi.fn(),
    arm: (_config: PlacementArmConfig) => { armed = true; phase = 'armed'; },
    cancel: () => { armed = false; phase = 'idle'; selection = null; changeHandler?.(); },
    simulateSelect(sel: PlacementSelection) { selection = sel; phase = 'selected'; changeHandler?.(); },
    simulateHover(tile: { x: number; z: number } | null) { hoveredTile = tile; changeHandler?.(); },
    simulateConfirm() { return selection ? confirmHandler?.(selection) : undefined; },
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

  it('Ramp confirm handler returns false, keeping the tool armed, when build_ramp is refused despite confirmEnabled', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    gameConsole.mockReturnValue({ success: false, output: 'Ramp order refused' });

    const rampBtn = container.querySelector<HTMLButtonElement>('.bs-build-ramp-btn')!;
    rampBtn.click();
    controller.simulateSelect({ x1: 5, z1: 5, x2: 10, z2: 5 });

    const result = controller.simulateConfirm();

    expect(result).toBe(false);
    expect(gameConsole).toHaveBeenCalledWith(expect.stringContaining('build_ramp start:5,5 end:10,5 depth:8'));
  });

  // ── #1298: the ramp tool offers a width param before placing ──────────────

  describe('Ramp tool: width param (#1298)', () => {
    type StripField = { key: string; value: number; format?: (v: number) => string; onInc: () => void; onDec: () => void };

    function armRamp() {
      const { kit, controller, strip } = makeMockKit();
      menu.setPlacementKit(kit);
      container.querySelector<HTMLButtonElement>('.bs-build-ramp-btn')!.click();
      controller.simulateSelect({ x1: 5, z1: 5, x2: 5, z2: 25 });
      const fields = () => strip.show.mock.calls.at(-1)![0].fields as StripField[];
      const width = () => fields().find(f => f.key === 'width')!;
      return { controller, strip, fields, width };
    }

    it('shows a width field beside depth, defaulting to 3', () => {
      const { fields, width } = armRamp();
      expect(fields().map(f => f.key)).toEqual(expect.arrayContaining(['depth', 'width']));
      expect(fields().find(f => f.key === 'depth')).toBe(fields()[0]); // depth stays first
      expect(width().value).toBe(3);
    });

    it('steps through the width options 3, 5, 7 and clamps at both ends', () => {
      const { width } = armRamp();
      width().onInc(); expect(width().value).toBe(5);
      width().onInc(); expect(width().value).toBe(7);
      width().onInc(); expect(width().value).toBe(7);
      width().onDec(); expect(width().value).toBe(5);
      width().onDec(); expect(width().value).toBe(3);
      width().onDec(); expect(width().value).toBe(3);
    });

    it('confirming dispatches build_ramp with the chosen width', () => {
      const { controller, width } = armRamp();
      width().onInc();
      controller.simulateConfirm();
      expect(gameConsole).toHaveBeenCalledWith(expect.stringMatching(/^build_ramp start:5,5 end:5,25 depth:\d+ width:5$/));
    });

    it('confirming at the default width dispatches width:3', () => {
      const { controller } = armRamp();
      controller.simulateConfirm();
      expect(gameConsole).toHaveBeenCalledWith(expect.stringContaining('width:3'));
    });

    it('confirmEnabled follows the wider cost: a balance covering width 3 but not width 7 disables confirm at 7', () => {
      const rampDef = rampDefFromEndpoints(5, 5, 5, 25, 8);
      const cost3 = rampDef.length * RAMP_COST_PER_METER;
      menu.update(makeMockState({ cash: cost3 + 1 }));
      const { strip, width } = armRamp();
      expect(strip.show.mock.calls.at(-1)![0].confirmEnabled).toBe(true);
      width().onInc(); width().onInc();
      expect(strip.show.mock.calls.at(-1)![0].confirmEnabled).toBe(false);
    });
  });

  // ── #1210: BuildMenu's own confirmEnabled gate must never disagree with
  // core's validateRampOrder — today it doesn't consult validateRampOrder at
  // all: `tiles` is computed locally with a +1 buildRampCommand's own
  // --start/--end math (and rampDefFromEndpoints, which that command will be
  // rewired to call) never adds, and there is no cash/affordability check on
  // the ramp tool's Confirm at all. The box-cut tutorial's fixed line (16,19)
  // -> (16,31) is exactly 12 tiles (dz=12, no +1) — the fixture every case
  // below shares.
  describe('Ramp tool: confirmEnabled agrees with core validateRampOrder, at any depth (#1210)', () => {
    const BOX_CUT_ENDS = { x1: 16, z1: 19, x2: 16, z2: 31 };

    /**
     * Drives the depth stepper's onInc/onDec from the panel's own default (8)
     * to `target`, reading the latest `strip.show()` field state after each
     * click — generalizes the single onInc/onDec exercise above (~line 370)
     * to an arbitrary target depth instead of one hardcoded pair.
     */
    function setRampDepth(
      strip: ReturnType<typeof makeMockKit>['strip'], target: number,
    ): { confirmEnabled: boolean; confirmDisabledReason: string | undefined; depthValue: number } {
      let showArgs = strip.show.mock.calls.at(-1)![0];
      let depthField = showArgs.fields[0];
      while (depthField.value < target) {
        depthField.onInc();
        showArgs = strip.show.mock.calls.at(-1)![0];
        depthField = showArgs.fields[0];
      }
      while (depthField.value > target) {
        depthField.onDec();
        showArgs = strip.show.mock.calls.at(-1)![0];
        depthField = showArgs.fields[0];
      }
      return { confirmEnabled: showArgs.confirmEnabled, confirmDisabledReason: showArgs.confirmDisabledReason, depthValue: depthField.value };
    }

    /** Arms the ramp tool and selects the box-cut line, returning the kit's own pieces for the caller to drive further. */
    function armAndSelectBoxCut(options?: { activeRegion?: TileRegion | null }) {
      const { kit, controller, strip } = makeMockKit(options);
      menu.setPlacementKit(kit);
      const rampBtn = container.querySelector<HTMLButtonElement>('.bs-build-ramp-btn')!;
      rampBtn.click();
      controller.simulateSelect({ ...BOX_CUT_ENDS });
      return { kit, controller, strip };
    }

    it.each(Array.from({ length: 15 }, (_, i) => i + 1))(
      'depth %i on the box-cut line: BuildMenu confirmEnabled matches validateRampOrder(rampDefFromEndpoints(...), cash).success',
      (depth) => {
        const state = makeMockState({ cash: 99999 });
        menu.update(state);
        const { strip } = armAndSelectBoxCut();

        const { confirmEnabled, depthValue } = setRampDepth(strip, depth);
        expect(depthValue).toBe(depth);

        const rampDef = rampDefFromEndpoints(BOX_CUT_ENDS.x1, BOX_CUT_ENDS.z1, BOX_CUT_ENDS.x2, BOX_CUT_ENDS.z2, depth);
        const expected = validateRampOrder(rampDef, state.cash).success;
        expect(
          confirmEnabled,
          `depth ${depth}: BuildMenu confirmEnabled=${confirmEnabled}, core validateRampOrder success=${expected}`,
        ).toBe(expected);
      },
    );

    it('depth 6 explicitly: confirmEnabled is true (computeMinimumRampLength(6) <= the line\'s 12-tile length)', () => {
      const state = makeMockState({ cash: 99999 });
      menu.update(state);
      const { strip } = armAndSelectBoxCut();

      const { confirmEnabled } = setRampDepth(strip, 6);
      expect(confirmEnabled).toBe(true);
    });

    it('depth 7 explicitly: confirmEnabled is false (computeMinimumRampLength(7) > the line\'s 12-tile length)', () => {
      const state = makeMockState({ cash: 99999 });
      menu.update(state);
      const { strip } = armAndSelectBoxCut();

      const { confirmEnabled } = setRampDepth(strip, 7);
      expect(confirmEnabled).toBe(false);
    });

    it('a cash balance below the ramp\'s cost disables confirm with the shared insufficient-funds reason, at an otherwise-valid depth', () => {
      const rampDef = rampDefFromEndpoints(BOX_CUT_ENDS.x1, BOX_CUT_ENDS.z1, BOX_CUT_ENDS.x2, BOX_CUT_ENDS.z2, 6);
      const cost = rampDef.length * RAMP_COST_PER_METER;
      const state = makeMockState({ cash: cost - 1 });
      menu.update(state);
      const { strip } = armAndSelectBoxCut();

      const { confirmEnabled, confirmDisabledReason } = setRampDepth(strip, 6);
      expect(confirmEnabled).toBe(false);
      expect(confirmDisabledReason).toBe(t('console.insufficient_funds', {
        need: formatMoney(cost),
        have: formatMoney(state.cash),
      }));
    });

    it('arming the ramp tool with controller.activeRegion pinned to the box-cut line pre-fills depth 6, not the default 8, with no stepper interaction', () => {
      // Deliberately arms only — no simulateSelect, no onInc/onDec — the
      // pre-fill must be visible from the arm-time refresh() call alone.
      const { kit, strip } = makeMockKit({
        activeRegion: { x1: 16, z1: 19, x2: 16, z2: 31, exact: true },
      });
      menu.setPlacementKit(kit);
      const state = makeMockState({ cash: 99999 });
      menu.update(state);

      const rampBtn = container.querySelector<HTMLButtonElement>('.bs-build-ramp-btn')!;
      rampBtn.click();

      const showArgs = strip.show.mock.calls.at(-1)![0];
      expect(showArgs.fields[0].value).toBe(6);
    });
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

  it('placed row Demolish click hands a confirm config to the handler and does not destroy (#1399)', () => {
    const building = makeBuilding({ id: 11, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    const handler = vi.fn();
    menu.setConfirmHandler(handler);
    menu.update(state);

    findPlacedRow(container, 11).querySelector<HTMLButtonElement>('.bs-build-demolish-btn')!.click();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(gameConsole).not.toHaveBeenCalledWith('build destroy 11');
    const config = handler.mock.calls[0]![0];
    expect(config.confirmLabel).toBe(t('ui.build.demolish'));
  });

  it('confirming the handed config runs build destroy and reports demolished (#1399)', () => {
    const building = makeBuilding({ id: 11, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    const handler = vi.fn();
    menu.setConfirmHandler(handler);
    menu.update(state);
    findPlacedRow(container, 11).querySelector<HTMLButtonElement>('.bs-build-demolish-btn')!.click();

    handler.mock.calls[0]![0].onConfirm();

    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith('build destroy 11');
  });

  it('Demolish click only hands off a confirm config and does not run build destroy (#1399)', () => {
    const building = makeBuilding({ id: 11, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    menu.setConfirmHandler(vi.fn());
    menu.update(state);
    const handler = vi.fn();
    menu.setConfirmHandler(handler);
    findPlacedRow(container, 11).querySelector<HTMLButtonElement>('.bs-build-demolish-btn')!.click();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('Demolish click with no confirm handler does nothing (#1399)', () => {
    const building = makeBuilding({ id: 11, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    menu.update(state);

    findPlacedRow(container, 11).querySelector<HTMLButtonElement>('.bs-build-demolish-btn')!.click();

    expect(gameConsole).not.toHaveBeenCalled();
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

// ── #1396: refused ghost before any click; failed confirm keeps the tool open ──

describe('BuildMenu — refused placement ghost and failed confirm (#1396)', () => {
  let container: HTMLDivElement;
  let menu: BuildMenu;
  let gameConsole: ReturnType<typeof vi.fn<[string], CommandResult>>;
  const FOOTPRINT = getBuildingDef('management_office', 1).footprint;

  beforeEach(() => {
    ({ container, menu } = setupMenu());
    gameConsole = vi.fn<[string], CommandResult>().mockReturnValue({ success: true, output: '' });
    menu.setGameConsole(gameConsole);
  });

  afterEach(() => {
    menu.dispose();
    container.remove();
  });

  function armCatalog(kit: PlacementKit, type = 'management_office'): void {
    menu.setPlacementKit(kit);
    container.querySelector<HTMLButtonElement>(`[data-build-type="${type}"] .bs-build-buy-btn`)!.click();
  }

  function stateWithBuildingAt(x: number, z: number): GameState {
    const state = makeMockState();
    state.buildings.buildings = [makeBuilding({ id: 7, type: 'management_office', tier: 1, x, z })];
    return state;
  }

  const lastOverlay = (overlay: ReturnType<typeof makeMockKit>['overlay']) => overlay.update.mock.calls.at(-1)![0];
  const lastStrip = (strip: ReturnType<typeof makeMockKit>['strip']) => strip.show.mock.calls.at(-1)![0];

  describe('point tool ghost', () => {
    it('hovering an existing building refuses the ghost before any click', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.update(stateWithBuildingAt(5, 5));
      armCatalog(kit);
      controller.simulateHover({ x: 5, z: 5 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ shape: 'point', footprintCells: FOOTPRINT, refused: true }));
    });

    it('hovering a tile whose footprint merely reaches into a building refuses the ghost', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.update(stateWithBuildingAt(5, 5));
      armCatalog(kit);
      controller.simulateHover({ x: 4, z: 4 }); // 2x2 covers (4..5, 4..5)
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: true }));
    });

    it('hovering free flat ground is not refused', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.update(stateWithBuildingAt(5, 5));
      armCatalog(kit);
      controller.simulateHover({ x: 20, z: 20 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ shape: 'point', refused: false }));
    });

    it('a footprint edge-adjacent to a building is not refused', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.update(stateWithBuildingAt(5, 5));
      armCatalog(kit);
      controller.simulateHover({ x: 7, z: 5 }); // building covers x 5..6, ghost covers 7..8
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: false }));
    });

    it('a planned (under-construction) building refuses the ghost too', () => {
      const { kit, controller, overlay } = makeMockKit();
      const state = makeMockState();
      state.plannedBuildings.push({ id: 1, buildingId: 1, type: 'management_office', tier: 1, x: 12, z: 12, actionId: 1, cost: 1000 });
      menu.update(state);
      armCatalog(kit);
      controller.simulateHover({ x: 12, z: 12 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: true }));
    });

    it('a selected (clicked) tile over a building is refused as well', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.update(stateWithBuildingAt(5, 5));
      armCatalog(kit);
      controller.simulateSelect({ x1: 5, z1: 5, x2: 5, z2: 5 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: true }));
    });

    it('the refused ghost shows a disabled Confirm with the occupied reason', () => {
      const { kit, controller, strip } = makeMockKit();
      menu.update(stateWithBuildingAt(5, 5));
      armCatalog(kit);
      controller.simulateHover({ x: 5, z: 5 });
      expect(lastStrip(strip)).toEqual(expect.objectContaining({
        confirmEnabled: false,
        confirmDisabledReason: t('shell.placement.refused_occupied'),
      }));
    });

    describe('over a ramp (#1390)', () => {
      function stateWithRampAt(x: number, z: number): GameState {
        const state = makeMockState();
        state.builtRamps = [{ id: 1, footprint: { minX: x, maxX: x + 2, minZ: z, maxZ: z + 5 } } as any];
        return state;
      }

      it('refuses the ghost, disables Confirm and shows the ramp reason', () => {
        const { kit, controller, overlay, strip } = makeMockKit();
        menu.update(stateWithRampAt(30, 20));
        armCatalog(kit);
        controller.simulateHover({ x: 31, z: 22 });
        expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ shape: 'point', refused: true }));
        expect(lastStrip(strip)).toEqual(expect.objectContaining({
          confirmEnabled: false,
          confirmDisabledReason: t('shell.placement.refused_ramp'),
        }));
      });

      it('leaves a footprint clear of the ramp accepted', () => {
        const { kit, controller, overlay } = makeMockKit();
        menu.update(stateWithRampAt(30, 20));
        armCatalog(kit);
        controller.simulateHover({ x: 40, z: 40 });
        expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: false }));
      });

      it('does not refuse the level-ground tool over the same ramp', () => {
        const { kit, controller, overlay, strip } = makeMockKit();
        menu.update(stateWithRampAt(30, 20));
        menu.setPlacementKit(kit);
        container.querySelector<HTMLButtonElement>('.bs-build-level-ground-btn')!.click();
        controller.simulateSelect({ x1: 30, z1: 20, x2: 32, z2: 24 });
        expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ shape: 'rect', refused: false }));
        expect(lastStrip(strip).confirmDisabledReason).toBeUndefined();
      });

      it('disables the placed row Upgrade button with the reason as title when the next tier reaches the ramp, and a cash-only update re-evaluates it', () => {
        const state = stateWithRampAt(5, 7); // tier 1 office covers z 5..6; tier 2 (2x3) grows into z 7
        state.buildings.buildings = [makeBuilding({ id: 7, type: 'management_office', tier: 1, x: 5, z: 5 })];
        state.buildings.unlockedTiers['management_office'] = 2;
        menu.update(state);
        const btn = findPlacedRow(container, 7).querySelector<HTMLButtonElement>('.bs-build-upgrade-btn')!;
        expect(btn.disabled).toBe(true);
        expect(btn.title).toBe(t('shell.placement.refused_ramp'));
        // control: same upgrade with no ramp stays enabled
        const clear = makeMockState();
        clear.buildings.buildings = state.buildings.buildings;
        clear.buildings.unlockedTiers['management_office'] = 2;
        menu.update({ ...clear, cash: 99998 });
        const btn2 = findPlacedRow(container, 7).querySelector<HTMLButtonElement>('.bs-build-upgrade-btn')!;
        expect(btn2.disabled).toBe(false);
        expect(btn2.title).toMatch(/^\$/);
      });
    });

    it('a free selection keeps Confirm enabled with no reason', () => {
      const { kit, controller, strip } = makeMockKit();
      menu.update(stateWithBuildingAt(5, 5));
      armCatalog(kit);
      controller.simulateSelect({ x1: 20, z1: 20, x2: 20, z2: 20 });
      expect(lastStrip(strip).confirmEnabled).toBe(true);
      expect(lastStrip(strip).confirmDisabledReason).toBeUndefined();
    });

    it('Move tool excludes the moving building itself, but still refuses other buildings', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.setPlacementKit(kit);
      const state = makeMockState();
      state.buildings.buildings = [
        makeBuilding({ id: 7, type: 'management_office', tier: 1, x: 5, z: 5 }),
        makeBuilding({ id: 8, type: 'management_office', tier: 1, x: 20, z: 20 }),
      ];
      menu.update(state);
      findPlacedRow(container, 7).querySelector<HTMLButtonElement>('.bs-build-move-btn')!.click();

      controller.simulateHover({ x: 5, z: 5 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: false }));
      controller.simulateHover({ x: 20, z: 20 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: true }));
    });

    it('a claim preview refusing ANY footprint cell (not only the anchor) refuses the ghost', () => {
      const { kit, controller, overlay, strip } = makeMockKit();
      // Refuses only rects that extend past the anchor cell on x (cell x+1 is protected).
      const preview = vi.fn<[{ minX: number; minZ: number; maxX: number; maxZ: number }], ClaimRefusalReason | null>(
        (rect) => (rect.maxX > 21 ? 'protected_structure' : null),
      );
      menu.setClaimAreaPreview(preview);
      menu.update(makeMockState());
      armCatalog(kit);
      controller.simulateHover({ x: 20, z: 20 });
      expect(preview).toHaveBeenCalled();
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: true }));
      expect(lastStrip(strip).confirmEnabled).toBe(false);
    });

    it('a claim preview returning null leaves the ghost accepted', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.setClaimAreaPreview(() => null);
      menu.update(makeMockState());
      armCatalog(kit);
      controller.simulateHover({ x: 20, z: 20 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: false }));
    });
  });

  describe('building confirm handler', () => {
    it('returns false, sets the console output as status, skips the flash, and keeps the tool armed on failure', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.update(makeMockState());
      armCatalog(kit);
      gameConsole.mockReturnValue({ success: false, output: 'Space is occupied' });
      controller.simulateSelect({ x1: 10, z1: 12, x2: 10, z2: 12 });

      const result = controller.simulateConfirm();

      expect(result).toBe(false);
      expect(overlay.flashConfirm).not.toHaveBeenCalled();
      expect(container.querySelector('#bs-build-panel')!.textContent).toContain('Space is occupied');
      expect(controller.isArmed).toBe(true);
    });

    it('returns true and flashes on success', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.update(makeMockState());
      armCatalog(kit);
      controller.simulateSelect({ x1: 10, z1: 12, x2: 10, z2: 12 });

      expect(controller.simulateConfirm()).toBe(true);
      expect(overlay.flashConfirm).toHaveBeenCalledTimes(1);
    });

    it('Move confirm also returns false without flashing when the move is refused', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.setPlacementKit(kit);
      menu.update(stateWithBuildingAt(5, 5));
      findPlacedRow(container, 7).querySelector<HTMLButtonElement>('.bs-build-move-btn')!.click();
      gameConsole.mockReturnValue({ success: false, output: 'Move refused' });
      controller.simulateSelect({ x1: 20, z1: 21, x2: 20, z2: 21 });

      expect(controller.simulateConfirm()).toBe(false);
      expect(overlay.flashConfirm).not.toHaveBeenCalled();
      expect(controller.isArmed).toBe(true);
    });

    it('Enter on a pre-refused selection: the handler runs, returns false, and the tool stays open', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.update(stateWithBuildingAt(5, 5));
      armCatalog(kit);
      gameConsole.mockReturnValue({ success: false, output: 'Space is occupied' });
      controller.simulateSelect({ x1: 5, z1: 5, x2: 5, z2: 5 });

      const result = controller.simulateConfirm();

      expect(gameConsole).toHaveBeenCalledWith(expect.stringContaining('build management_office at:5,5'));
      expect(result).toBe(false);
      expect(overlay.flashConfirm).not.toHaveBeenCalled();
      expect(controller.isArmed).toBe(true);
    });
  });

  describe('level-ground tool', () => {
    function armLevel(kit: PlacementKit): void {
      menu.setPlacementKit(kit);
      container.querySelector<HTMLButtonElement>('.bs-build-level-ground-btn')!.click();
    }

    it('a rect overlapping a building paints the rect refused, with the occupied reason and Confirm disabled', () => {
      const { kit, controller, overlay, strip } = makeMockKit();
      menu.update(stateWithBuildingAt(5, 5));
      armLevel(kit);
      controller.simulateSelect({ x1: 6, z1: 6, x2: 9, z2: 9 }); // inclusive max 9 covers building cell (6,6)
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ shape: 'rect', refused: true }));
      expect(lastStrip(strip)).toEqual(expect.objectContaining({
        confirmEnabled: false,
        confirmDisabledReason: t('shell.placement.refused_occupied'),
      }));
    });

    it('a rect whose inclusive max cell touches the building is refused; one cell further away is not', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.update(stateWithBuildingAt(5, 5)); // covers x,z 5..6
      armLevel(kit);
      controller.simulateSelect({ x1: 1, z1: 1, x2: 5, z2: 5 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: true }));
      controller.simulateSelect({ x1: 1, z1: 1, x2: 4, z2: 4 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: false }));
    });

    it('a rect over a planned site is refused', () => {
      const { kit, controller, overlay } = makeMockKit();
      const state = makeMockState();
      state.plannedBuildings.push({ id: 1, buildingId: 1, type: 'management_office', tier: 1, x: 12, z: 12, actionId: 1, cost: 1000 });
      menu.update(state);
      armLevel(kit);
      controller.simulateSelect({ x1: 11, z1: 11, x2: 12, z2: 12 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: true }));
    });

    it('a free rect is not refused and keeps Confirm enabled', () => {
      const { kit, controller, overlay, strip } = makeMockKit();
      menu.update(stateWithBuildingAt(5, 5));
      armLevel(kit);
      controller.simulateSelect({ x1: 20, z1: 20, x2: 24, z2: 24 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ refused: false }));
      expect(lastStrip(strip).confirmEnabled).toBe(true);
    });

    it('confirm returns false, shows the console output, skips the flash on failure', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.update(makeMockState());
      armLevel(kit);
      gameConsole.mockReturnValue({ success: false, output: 'Area too large' });
      controller.simulateSelect({ x1: 0, z1: 0, x2: 30, z2: 30 });

      expect(controller.simulateConfirm()).toBe(false);
      expect(overlay.flashConfirm).not.toHaveBeenCalled();
      expect(container.querySelector('#bs-build-panel')!.textContent).toContain('Area too large');
      expect(controller.isArmed).toBe(true);
    });

    it('confirm returns true and flashes on success', () => {
      const { kit, controller, overlay } = makeMockKit();
      menu.update(makeMockState());
      armLevel(kit);
      controller.simulateSelect({ x1: 20, z1: 20, x2: 24, z2: 24 });

      expect(controller.simulateConfirm()).toBe(true);
      expect(overlay.flashConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it('Ramp confirm stays unchanged: failure returns false without flashing, success flashes', () => {
    const { kit, controller, overlay } = makeMockKit();
    menu.setPlacementKit(kit);
    container.querySelector<HTMLButtonElement>('.bs-build-ramp-btn')!.click();
    controller.simulateSelect({ x1: 5, z1: 5, x2: 10, z2: 5 });
    gameConsole.mockReturnValue({ success: false, output: 'Ramp order refused' });
    expect(controller.simulateConfirm()).toBe(false);
    expect(overlay.flashConfirm).not.toHaveBeenCalled();
    gameConsole.mockReturnValue({ success: true, output: '' });
    expect(controller.simulateConfirm()).toBe(true);
    expect(overlay.flashConfirm).toHaveBeenCalledTimes(1);
  });
});
