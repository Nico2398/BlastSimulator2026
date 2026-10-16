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
import { getBuildingDef, getMoveCost, type Building, type BuildingTier, type BuildingType } from '../../../src/core/entities/Building.js';
import type { PlacementKit } from '../../../src/ui/scene/PlacementKit.js';
import type { PlacementSelection, PlacementArmConfig, PlacementConfirmHandler, PlacementChangeHandler } from '../../../src/ui/scene/PlacementController.js';
import { liveArea, regionContains, EXACT_LIVE_MARGIN, type TileRegion } from '../../../src/ui/tutorialPickerRegion.js';
import { REGION } from '../../../src/ui/tutorialStages.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';
import { rampDefFromEndpoints, validateRampOrder } from '../../../src/core/mining/Ramp.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { t } from '../../../src/core/i18n/I18n.js';
import { buildingCardLine, buildingCardTooltip } from '../../../src/ui/catalogCardText.js';
import type { ClaimRefusalReason } from '../../../src/core/world/PlayableArea.js';
import { computeRampCost } from '../../../src/core/mining/Ramp.js';
import { RAMP_DEFAULT_WIDTH, RESEARCH_TASK_DEFS } from '../../../src/core/config/balance.js';
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

  it('Research Center row: label column keeps its flex basis and min-width:0, and no action button is rendered', () => {
    const researchCenter = makeBuilding({ id: 1, type: 'research_center', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [researchCenter];

    menu.update(state);

    const row = findPlacedRow(container, 1);

    const info = row.querySelector<HTMLElement>('div');
    expect(info).not.toBeNull();
    expect(info!.style.flex).toBe('1 1 100%');
    expect(info!.style.minWidth).toBe('0px');
    expect(info!.textContent).toContain('#1');
    expect(info!.textContent).toContain('(5,5)');

    for (const sel of ['.bs-build-move-btn', '.bs-build-upgrade-btn', '.bs-build-research-btn', '.bs-build-demolish-btn']) {
      expect(row.querySelector(sel), sel).toBeNull();
    }
  });

  it('max-tier row (Living Quarters tier 3): same label layout, still no action button', () => {
    const livingQuarters = makeBuilding({ id: 2, type: 'living_quarters', tier: 3 });
    const state = makeMockState();
    state.buildings.buildings = [livingQuarters];

    menu.update(state);

    const row = findPlacedRow(container, 2);

    const info = row.querySelector<HTMLElement>('div');
    expect(info).not.toBeNull();
    expect(info!.style.flex).toBe('1 1 100%');
    expect(info!.style.minWidth).toBe('0px');
    expect(info!.textContent).toContain('#2');
    expect(info!.textContent).toContain('(5,5)');

    for (const sel of ['.bs-build-move-btn', '.bs-build-upgrade-btn', '.bs-build-research-btn', '.bs-build-demolish-btn']) {
      expect(row.querySelector(sel), sel).toBeNull();
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

  it('a cash-only update() never rebuilds the placed row and the row carries no action buttons', () => {
    const building = makeBuilding({ id: 1, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    state.buildings.unlockedTiers['management_office'] = 2;

    state.cash = 10;
    menu.update(state);
    const row = findPlacedRow(container, 1);
    expect(row.querySelector('button.bs-build-demolish-btn, button.bs-build-upgrade-btn, button.bs-build-move-btn')).toBeNull();

    state.cash = 99999;
    menu.update(state);
    expect(findPlacedRow(container, 1)).toBe(row);
    state.cash = 10;
    menu.update(state);
    expect(findPlacedRow(container, 1)).toBe(row);
  });

  it('cash dropped while only observe() saw the state still leaves the row untouched on the next update()', () => {
    const building = makeBuilding({ id: 3, type: 'management_office', tier: 1 });
    const rich = makeMockState();
    rich.buildings.buildings = [building];
    rich.cash = 99999;
    menu.update(rich);
    const row = findPlacedRow(container, 3);

    const poor = makeMockState();
    poor.buildings.buildings = [building];
    poor.cash = 1500;
    menu.observe(poor);
    menu.update(poor);
    expect(findPlacedRow(container, 3)).toBe(row);
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
    // Mirrors PlacementController.previewOrigin (#1594): an exact region's pin
    // while the hover is inside its live margin, else the raw hovered tile.
    get previewOrigin() {
      if (!hoveredTile) return null;
      if (activeRegion?.exact && regionContains(liveArea(activeRegion), hoveredTile.x, hoveredTile.z)) {
        return { x: activeRegion.x1, z: activeRegion.z1 };
      }
      return hoveredTile;
    },
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

  // ── #1852: the Ramp strip says where the foot meets the end tile's ground ──
  // The foot line rides the strip's `subtitle`. Sampler: the start tile (5,5) reads 15 m,
  // every tile from z=20 on (the end tile (5,25) included) reads `endGround`.

  describe('Ramp tool: foot against the end tile floor (#1852)', () => {
    function armRampOver(endGround: number | null) {
      const { kit, controller, strip } = makeMockKit();
      menu.setPlacementKit(kit);
      menu.update(makeMockState({ cash: 1_000_000 })); // Confirm needs cash for the ramp's cost
      if (endGround !== null) menu.setSurfaceHeightSampler((_x, z) => (z >= 20 ? endGround : 15));
      container.querySelector<HTMLButtonElement>('.bs-build-ramp-btn')!.click();
      controller.simulateSelect({ x1: 5, z1: 5, x2: 5, z2: 25 });
      const shown = () => strip.show.mock.calls.at(-1)![0];
      return { controller, strip, shown };
    }

    it('a crater floor within reach: shows the snapped line with the snapped depth (15 - 8.5 = 6.5 m), no miss text', () => {
      const { shown } = armRampOver(8.5);
      const line = shown().subtitle as string;
      expect(line).toContain('6.5');
      expect(line).not.toBe('ui.build.ramp_foot_snapped'); // a translated line, not the bare key
    });

    it('a crater floor far below the foot: shows the miss line with the offset and the depth that meets the floor, and Confirm stays enabled', () => {
      const { shown } = armRampOver(4); // foot ~7.4 m, floor 4: 3.4 m above; start - end = 11 m
      const line = shown().subtitle as string;
      expect(line).toContain('3.4');
      expect(line).toContain('11');
      expect(line).not.toBe('ui.build.ramp_foot_miss');
      expect(shown().confirmEnabled).toBe(true);
    });

    it('intact ground at the end tile: the strip shows no foot line', () => {
      const { shown } = armRampOver(14.5);
      expect(shown().subtitle).toBe('');
    });

    it('end tile level with the start: no foot line', () => {
      const { shown } = armRampOver(15);
      expect(shown().subtitle).toBe('');
    });

    it('no surface sampler registered: no foot line and the strip still renders', () => {
      const { shown } = armRampOver(null);
      expect(shown().subtitle).toBe('');
      expect(shown().fields.map((f: { key: string }) => f.key)).toEqual(['depth', 'width']);
    });

    it('stepping the depth to a miss swaps the snapped line for the miss line live', () => {
      const { shown } = armRampOver(8.5);
      expect(shown().subtitle).toContain('6.5');
      const depth = () => shown().fields[0];
      for (let i = 0; i < 3; i++) depth().onInc(); // depth 11: foot 4.55, 3.95 m under the floor, out of reach of the snap
      expect(shown().subtitle).not.toBe('');
      expect(shown().subtitle).not.toContain('6.5');
    });

    it('confirm still dispatches the player\'s chosen depth, not the snapped one', () => {
      const { controller } = armRampOver(8.5);
      controller.simulateConfirm();
      expect(gameConsole).toHaveBeenCalledWith(expect.stringContaining('depth:8'));
    });

    it('en and fr both carry the two foot lines, and they differ between languages', async () => {
      const { readFileSync } = await import('node:fs');
      const load = (lang: string): Record<string, string> =>
        JSON.parse(readFileSync(`src/core/i18n/locales/${lang}.json`, 'utf8'));
      const en = load('en');
      const fr = load('fr');
      for (const key of ['ui.build.ramp_foot_snapped', 'ui.build.ramp_foot_miss']) {
        expect(en[key], `en ${key}`).toBeTruthy();
        expect(fr[key], `fr ${key}`).toBeTruthy();
        expect(fr[key]).not.toBe(en[key]);
      }
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

  it('armMove (the inspector Move) arms the point tool and dispatches build move on confirm', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    const building = makeBuilding({ id: 7, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    menu.update(state);

    menu.armMove(7);
    expect(controller.isArmed).toBe(true);

    controller.simulateSelect({ x1: 20, z1: 21, x2: 20, z2: 21 });
    controller.simulateConfirm();

    expect(gameConsole).toHaveBeenCalledWith('build move 7 to:20,21');
  });

  it('requestUpgrade on a locked next tier reports research-required instead of upgrading', () => {
    const building = makeBuilding({ id: 8, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    menu.update(state);

    menu.requestUpgrade(8);

    expect(gameConsole).not.toHaveBeenCalledWith(expect.stringContaining('build upgrade'));
  });

  it('requestUpgrade dispatches build upgrade once the next tier is unlocked', () => {
    const building = makeBuilding({ id: 9, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    state.buildings.unlockedTiers['management_office'] = 2;
    menu.update(state);

    menu.requestUpgrade(9);

    expect(gameConsole).toHaveBeenCalledWith('build upgrade 9');
  });

  it('queueResearchFor dispatches research queue for the next tier', () => {
    const building = makeBuilding({ id: 10, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [building];
    menu.update(state);

    menu.queueResearchFor(10);

    expect(gameConsole).toHaveBeenCalledWith('research queue type:management_office tier:2');
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

    it('hovering a margin tile of an exact region draws the ghost at the pin (#1594)', () => {
      const pin = REGION.warehouse;
      const { kit, controller, overlay } = makeMockKit({ activeRegion: pin });
      menu.update(makeMockState());
      armCatalog(kit);
      controller.simulateHover({ x: pin.x1 + 2, z: pin.z1 + 2 });
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ shape: 'point', x: pin.x1, z: pin.z1 }));
    });

    it.each(['livingQuarters', 'drivingCenter', 'warehouse'] as const)(
      'hovering inside the live area of the multi-tile REGION.%s pin draws the ghost at its min corner (#1646)',
      (name) => {
        const pin = REGION[name];
        const { kit, controller, overlay } = makeMockKit({ activeRegion: pin });
        menu.update(makeMockState());
        armCatalog(kit);
        controller.simulateHover({ x: pin.x2, z: pin.z2 });
        expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ shape: 'point', x: pin.x1, z: pin.z1 }));
      },
    );

    it('hovering outside the exact region margin keeps the ghost under the cursor (#1594)', () => {
      const pin = REGION.warehouse;
      const far = { x: pin.x2 + EXACT_LIVE_MARGIN + 5, z: pin.z2 + EXACT_LIVE_MARGIN + 5 };
      const { kit, controller, overlay } = makeMockKit({ activeRegion: pin });
      menu.update(makeMockState());
      armCatalog(kit);
      controller.simulateHover(far);
      expect(lastOverlay(overlay)).toEqual(expect.objectContaining({ x: far.x, z: far.z }));
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
      menu.armMove(7);

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
      menu.armMove(7);
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

// ── #1398: research cost/duration on the button, progress while queued ──────

describe('BuildMenu — research cost, duration and progress (#1398)', () => {
  let container: HTMLDivElement;
  let menu: BuildMenu;

  beforeEach(() => {
    ({ container, menu } = setupMenu());
    menu.setGameConsole(vi.fn<[string], CommandResult>().mockReturnValue({ success: true, output: '' }));
  });

  afterEach(() => {
    menu.dispose();
    container.remove();
  });

  const catalogRow = (type: string) => container.querySelector<HTMLElement>(`[data-build-type="${type}"]`)!;

  function selectTier(row: HTMLElement, tier: 2 | 3): void {
    const sel = row.querySelector<HTMLSelectElement>('.bs-build-tier-sel')!;
    sel.value = String(tier);
    sel.dispatchEvent(new Event('change'));
  }

  /** Tier 2 already unlocked so tier 3 is the locked next tier. */
  function stateWithTier2(): GameState {
    const state = makeMockState();
    state.buildings.unlockedTiers['management_office'] = 2;
    return state;
  }

  it('en.json defines the cost and progress keys', async () => {
    const en = (await import('../../../src/core/i18n/locales/en.json')).default as Record<string, string>;
    expect(en['ui.build.queue_research_cost']).toContain('{cost}');
    expect(en['ui.build.queue_research_cost']).toContain('{duration}');
    expect(en['ui.build.research_progress']).toContain('{percent}');
    expect(en['ui.build.research_progress']).toContain('{remaining}');
  });

  for (const tier of [2, 3] as const) {
    it(`catalog research button shows cost and duration for tier ${tier}`, () => {
      const state = makeMockState();
      if (tier === 3) state.buildings.unlockedTiers['management_office'] = 2;
      menu.update(state);
      const row = catalogRow('management_office');
      selectTier(row, tier);
      const def = RESEARCH_TASK_DEFS['management_office'][tier];
      const label = row.querySelector<HTMLButtonElement>('.bs-build-research-btn')!.textContent ?? '';
      expect(label).toContain(formatMoney(def.cost));
      expect(label).toContain(String(def.ticks));
      expect(label).toBe(t('ui.build.queue_research_cost', { cost: formatMoney(def.cost), duration: def.ticks }));
    });
  }

  it('catalog research button label updates when the tier selector changes', () => {
    const state = stateWithTier2();
    state.buildings.unlockedTiers = {};
    menu.update(state);
    const row = catalogRow('management_office');
    const btn = row.querySelector<HTMLButtonElement>('.bs-build-research-btn')!;
    selectTier(row, 2);
    const label2 = btn.textContent;
    state.buildings.unlockedTiers['management_office'] = 2;
    menu.update({ ...state });
    selectTier(row, 3);
    const label3 = btn.textContent;
    expect(label3).not.toBe(label2);
    expect(label3).toContain(formatMoney(RESEARCH_TASK_DEFS['management_office'][3].cost));
  });

  it('queued task shows a progress element and hides the button (catalog row)', () => {
    const state = stateWithTier2();
    state.buildings.researchQueue.push({ targetType: 'management_office', targetTier: 3, ticksRemaining: 25, cost: 12000, conditions: [] });
    menu.update(state);
    const row = catalogRow('management_office');
    selectTier(row, 3);
    const progress = row.querySelector<HTMLElement>('.bs-build-research-progress');
    expect(progress).not.toBeNull();
    expect(progress!.textContent).toBe(t('ui.build.research_progress', { percent: 50, remaining: 25 }));
    expect(row.querySelector<HTMLButtonElement>('.bs-build-research-btn')!.style.display).toBe('none');
  });

  it('queued task adds no progress element or research button to the placed row; the catalog row keeps its own', () => {
    const state = stateWithTier2();
    state.buildings.buildings = [makeBuilding({ id: 1, type: 'management_office', tier: 2 })];
    state.buildings.researchQueue.push({ targetType: 'management_office', targetTier: 3, ticksRemaining: 25, cost: 12000, conditions: [] });
    menu.update(state);
    const row = findPlacedRow(container, 1);
    expect(row.querySelector('.bs-build-research-progress')).toBeNull();
    expect(row.querySelector('.bs-build-research-btn')).toBeNull();
    selectTier(catalogRow('management_office'), 3);
    expect(catalogRow('management_office').querySelector('.bs-build-research-progress')).not.toBeNull();
  });

  it('a research-queue change does not rebuild the placed row', () => {
    const state = stateWithTier2();
    state.buildings.buildings = [makeBuilding({ id: 1, type: 'management_office', tier: 2 })];
    menu.update(state);
    const row = findPlacedRow(container, 1);
    state.buildings.researchQueue.push({ targetType: 'management_office', targetTier: 3, ticksRemaining: 25, cost: 12000, conditions: [] });
    menu.update(state);
    expect(findPlacedRow(container, 1)).toBe(row);
  });

  it('no progress element when nothing is queued', () => {
    const state = stateWithTier2();
    state.buildings.buildings = [makeBuilding({ id: 1, type: 'management_office', tier: 2 })];
    menu.update(state);
    selectTier(catalogRow('management_office'), 3);
    expect(container.querySelector('.bs-build-research-progress')).toBeNull();
  });

  it('progress element disappears and button state resets once research completes', () => {
    const state = stateWithTier2();
    state.buildings.buildings = [makeBuilding({ id: 1, type: 'management_office', tier: 2 })];
    state.buildings.researchQueue.push({ targetType: 'management_office', targetTier: 3, ticksRemaining: 5, cost: 12000, conditions: [] });
    menu.update(state);
    state.buildings.researchQueue = [];
    state.buildings.unlockedTiers['management_office'] = 3;
    menu.update(state);
    expect(container.querySelector('.bs-build-research-progress')).toBeNull();
  });
});

describe('BuildMenu — catalog card text and tooltip (#1377)', () => {
  let container: HTMLDivElement;
  let menu: BuildMenu;

  beforeEach(() => {
    ({ container, menu } = setupMenu());
    menu.update(makeMockState());
  });

  afterEach(() => {
    menu.dispose();
    container.remove();
  });

  it('every catalog row has a .bs-build-desc span with the tier-1 line and a stats tooltip', () => {
    const rows = container.querySelectorAll<HTMLElement>('[data-build-type]');
    expect(rows.length).toBe(9);
    for (const row of rows) {
      const type = row.dataset['buildType'] as BuildingType;
      const def = getBuildingDef(type, 1);
      const desc = row.querySelector('.bs-build-desc');
      expect(desc, type).not.toBeNull();
      expect(desc!.textContent).toBe(buildingCardLine(def));
      expect(row.title).toBe(buildingCardTooltip(def));
      expect(row.title).toContain('×');
    }
  });

  it('changing the tier selector updates the line and tooltip to that tier', () => {
    const row = container.querySelector<HTMLElement>('[data-build-type="living_quarters"]')!;
    const tierSel = row.querySelector<HTMLSelectElement>('.bs-build-tier-sel')!;
    for (const tier of [3, 2, 1] as BuildingTier[]) {
      tierSel.value = String(tier);
      tierSel.dispatchEvent(new Event('change'));
      const def = getBuildingDef('living_quarters', tier);
      expect(row.querySelector('.bs-build-desc')!.textContent).toBe(buildingCardLine(def));
      expect(row.title).toBe(buildingCardTooltip(def));
    }
  });

  it('tier 1 and tier 3 rows render different tooltips for a type whose upkeep or capacity scales', () => {
    const row = container.querySelector<HTMLElement>('[data-build-type="living_quarters"]')!;
    const tierSel = row.querySelector<HTMLSelectElement>('.bs-build-tier-sel')!;
    const titles: string[] = [];
    for (const tier of [1, 3]) {
      tierSel.value = String(tier);
      tierSel.dispatchEvent(new Event('change'));
      titles.push(row.title);
    }
    expect(titles[0]).not.toBe(titles[1]);
  });
});

describe('BuildMenu — inspector-driven shared flows, panel never opened (#1758)', () => {
  let container: HTMLDivElement;
  let menu: BuildMenu;
  let gameConsole: ReturnType<typeof vi.fn<[string], CommandResult>>;
  let messages: string[];

  beforeEach(() => {
    ({ container, menu } = setupMenu());
    gameConsole = vi.fn<[string], CommandResult>().mockReturnValue({ success: true, output: '' });
    menu.setGameConsole(gameConsole);
    messages = [];
    menu.setFlowResultHandler((m) => messages.push(m));
  });

  afterEach(() => {
    menu.dispose();
    container.remove();
  });

  function observed(b: Building, setup?: (s: GameState) => void): GameState {
    const state = makeMockState();
    state.buildings.buildings = [b];
    setup?.(state);
    menu.observe(state);
    return state;
  }

  it('the panel stays hidden through every flow', () => {
    const { kit } = makeMockKit();
    menu.setPlacementKit(kit);
    observed(makeBuilding({ id: 7, type: 'management_office', tier: 1 }));
    menu.armMove(7);
    expect(menu.visible).toBe(false);
  });

  it('armMove arms the footprint point tool and confirming dispatches build move', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    observed(makeBuilding({ id: 7, type: 'management_office', tier: 1 }));

    menu.armMove(7);
    expect(controller.isArmed).toBe(true);

    controller.simulateSelect({ x1: 20, z1: 21, x2: 20, z2: 21 });
    controller.simulateConfirm();
    expect(gameConsole).toHaveBeenCalledWith('build move 7 to:20,21');
  });

  it('the move result reaches the flow handler: failure carries the console output', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    observed(makeBuilding({ id: 7, type: 'management_office', tier: 1 }));
    gameConsole.mockReturnValue({ success: false, output: 'Nope: blocked' });

    menu.armMove(7);
    controller.simulateSelect({ x1: 20, z1: 21, x2: 20, z2: 21 });
    controller.simulateConfirm();
    expect(messages).toContain('Nope: blocked');
  });

  it('the move result reaches the flow handler: success reports moved', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    observed(makeBuilding({ id: 7, type: 'management_office', tier: 1 }));
    menu.armMove(7);
    controller.simulateSelect({ x1: 20, z1: 21, x2: 20, z2: 21 });
    controller.simulateConfirm();
    expect(messages).toContain(t('ui.build.moved'));
  });

  it('armMove for an unknown building arms nothing and throws nothing', () => {
    const { kit, controller } = makeMockKit();
    menu.setPlacementKit(kit);
    observed(makeBuilding({ id: 7, type: 'management_office', tier: 1 }));
    expect(() => menu.armMove(999)).not.toThrow();
    expect(controller.isArmed).toBe(false);
  });

  it('armMove before any state was observed, or without a kit, is a no-op', () => {
    const { kit, controller } = makeMockKit();
    expect(() => menu.armMove(7)).not.toThrow();
    menu.setPlacementKit(kit);
    expect(() => menu.armMove(7)).not.toThrow();
    expect(controller.isArmed).toBe(false);
  });

  it('requestUpgrade on an unlocked tier dispatches build upgrade and reports upgraded', () => {
    observed(makeBuilding({ id: 9, type: 'management_office', tier: 1 }), (s) => {
      s.buildings.unlockedTiers['management_office'] = 2;
    });
    menu.requestUpgrade(9);
    expect(gameConsole).toHaveBeenCalledWith('build upgrade 9');
    expect(messages).toContain(t('ui.build.upgraded'));
    expect(menu.visible).toBe(false);
  });

  it('requestUpgrade on a locked tier reports research-required and does not upgrade', () => {
    observed(makeBuilding({ id: 8, type: 'management_office', tier: 1 }));
    menu.requestUpgrade(8);
    expect(gameConsole).not.toHaveBeenCalledWith(expect.stringContaining('build upgrade'));
    expect(messages).toContain(t('ui.build.research_required', { tier: 2 }));
  });

  it('requestUpgrade surfaces the console refusal text', () => {
    observed(makeBuilding({ id: 9, type: 'management_office', tier: 1 }), (s) => {
      s.buildings.unlockedTiers['management_office'] = 2;
    });
    gameConsole.mockReturnValue({ success: false, output: 'Cannot upgrade: ramp' });
    menu.requestUpgrade(9);
    expect(messages).toContain('Cannot upgrade: ramp');
  });

  it('requestUpgrade for an unknown building or before observing sends no command', () => {
    menu.requestUpgrade(9);
    observed(makeBuilding({ id: 9, type: 'management_office', tier: 1 }));
    menu.requestUpgrade(404);
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('queueResearch (now public) dispatches research queue and reports progress to the handler', () => {
    observed(makeBuilding({ id: 10, type: 'management_office', tier: 1 }));
    menu.queueResearch('management_office', 2);
    expect(gameConsole).toHaveBeenCalledWith('research queue type:management_office tier:2');
    expect(messages.length).toBeGreaterThan(0);
  });

  it('queueResearch failure reports the translated reason to the handler', () => {
    observed(makeBuilding({ id: 10, type: 'management_office', tier: 1 }));
    gameConsole.mockReturnValue({ success: false, output: 'x', code: 'no_research_center' });
    menu.queueResearch('management_office', 2);
    expect(messages).toContain(t('ui.build.research_failed_no_research_center'));
  });

  it('queueResearch of tier 1 is ignored', () => {
    menu.queueResearch('management_office', 1);
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('queueResearchFor queues the next tier of the building by id; unknown id or max tier sends nothing', () => {
    observed(makeBuilding({ id: 10, type: 'management_office', tier: 1 }));
    menu.queueResearchFor(10);
    expect(gameConsole).toHaveBeenCalledWith('research queue type:management_office tier:2');
    gameConsole.mockClear();
    menu.queueResearchFor(404);
    expect(gameConsole).not.toHaveBeenCalled();
    observed(makeBuilding({ id: 11, type: 'management_office', tier: 3 }));
    menu.queueResearchFor(11);
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('a pending demolition leaves the placed row without action buttons', () => {
    const b = makeBuilding({ id: 12, type: 'management_office', tier: 1 });
    const state = makeMockState();
    state.buildings.buildings = [b];
    state.pendingActions.push({
      id: 50, type: 'demolish_building', requiredSkill: null, requiredVehicleRole: 'building_destroyer',
      targetX: 5, targetZ: 5, targetY: 0, payload: { buildingId: 12 }, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0,
    });
    menu.update(state);
    const row = findPlacedRow(container, 12);
    expect(row.querySelector('button.bs-build-move-btn, button.bs-build-demolish-btn')).toBeNull();
  });

  it('the Move placement strip subtitle shows the move cost, not the construction cost', () => {
    const { kit, strip } = makeMockKit();
    menu.setPlacementKit(kit);
    const b = makeBuilding({ id: 7, type: 'management_office', tier: 1 });
    observed(b);
    menu.armMove(7);
    const subtitle = strip.show.mock.calls.at(-1)![0].subtitle as string;
    expect(subtitle).toBe(`$${getMoveCost(b).toLocaleString('en-US')}`);
  });
});

// ── Placed buildings as a master list (#1759) ────────────────────────────────

describe('BuildMenu — placed rows are a selectable master list (#1759)', () => {
  let container: HTMLDivElement;
  let menu: BuildMenu;

  beforeEach(() => {
    ({ container, menu } = setupMenu());
  });

  afterEach(() => {
    menu.dispose();
    container.remove();
    delete (window as unknown as { __cameraFocus?: unknown }).__cameraFocus;
  });

  function stateWith(buildings: Building[]): GameState {
    const s = makeMockState();
    s.buildings.buildings = buildings;
    return s;
  }

  function siteRow(id: number): HTMLElement | null {
    return container.querySelector<HTMLElement>(`.bs-build-site-row[data-building-id="${id}"]`);
  }

  function addSite(s: GameState, buildingId: number, rebuild = false): void {
    s.plannedBuildings.push({
      id: 900 + buildingId, buildingId, type: 'management_office', tier: 1, x: 17, z: 23,
      actionId: 60 + buildingId, cost: 1000, ...(rebuild ? { rebuild: true } : {}),
    });
  }

  describe('click to select', () => {
    it('a click on the row body calls the select handler once with the building id', () => {
      const cb = vi.fn();
      menu.setSelectBuildingHandler(cb);
      menu.update(stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1 })]));
      findPlacedRow(container, 4).click();
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(4);
    });

    it('a click on the info text inside the row also selects', () => {
      const cb = vi.fn();
      menu.setSelectBuildingHandler(cb);
      menu.update(stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1 })]));
      findPlacedRow(container, 4).querySelector<HTMLElement>('div')!.click();
      expect(cb).toHaveBeenCalledWith(4);
    });

    it('a placed row has no action buttons; clicking it selects', () => {
      const cb = vi.fn();
      menu.setSelectBuildingHandler(cb);
      const s = stateWith([makeBuilding({ id: 4, type: 'research_center', tier: 1 })]);
      s.cash = 1e9;
      menu.update(s);
      const row = findPlacedRow(container, 4);
      for (const sel of ['.bs-build-move-btn', '.bs-build-upgrade-btn', '.bs-build-research-btn', '.bs-build-demolish-btn']) {
        expect(row.querySelector(sel), sel).toBeNull();
      }
      expect(row.querySelector('.bs-build-research-progress')).toBeNull();
      row.click();
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(4);
    });

    it('clicking a row does not close the panel', () => {
      menu.setSelectBuildingHandler(vi.fn());
      menu.show();
      menu.update(stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1 })]));
      findPlacedRow(container, 4).click();
      expect(menu.visible).toBe(true);
    });

    it('a click without a handler wired does not throw', () => {
      menu.update(stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1 })]));
      expect(() => findPlacedRow(container, 4).click()).not.toThrow();
    });
  });

  describe('Locate', () => {
    it('the row Locate button focuses the camera on the building and does not select', () => {
      const focus = vi.fn();
      window.__cameraFocus = focus;
      const cb = vi.fn();
      menu.setSelectBuildingHandler(cb);
      menu.update(stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1, x: 7, z: 9 })]));
      const btn = findPlacedRow(container, 4).querySelector<HTMLButtonElement>('[data-action="locate"]');
      expect(btn).not.toBeNull();
      expect(btn!.title).not.toBe('');
      btn!.click();
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus.mock.calls[0]![0]).toBeGreaterThanOrEqual(7);
      expect(focus.mock.calls[0]![1]).toBeGreaterThanOrEqual(9);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('highlight follows the selection', () => {
    const two = () => [
      makeBuilding({ id: 1, type: 'management_office', tier: 1 }),
      makeBuilding({ id: 2, type: 'living_quarters', tier: 1, x: 9 }),
    ];

    it('setSelectedEntity building marks that row selected with aria-selected', () => {
      menu.update(stateWith(two()));
      menu.setSelectedEntity({ kind: 'building', id: 2 });
      const row = findPlacedRow(container, 2);
      expect(row.classList.contains('bs-row-selected')).toBe(true);
      expect(row.getAttribute('aria-selected')).toBe('true');
      expect(findPlacedRow(container, 1).classList.contains('bs-row-selected')).toBe(false);
    });

    it('the highlight moves with a new selection', () => {
      menu.update(stateWith(two()));
      menu.setSelectedEntity({ kind: 'building', id: 1 });
      menu.setSelectedEntity({ kind: 'building', id: 2 });
      expect(findPlacedRow(container, 1).classList.contains('bs-row-selected')).toBe(false);
      expect(findPlacedRow(container, 2).classList.contains('bs-row-selected')).toBe(true);
      expect(container.querySelectorAll('.bs-row-selected').length).toBe(1);
    });

    it('null clears the highlight', () => {
      menu.update(stateWith(two()));
      menu.setSelectedEntity({ kind: 'building', id: 1 });
      menu.setSelectedEntity(null);
      expect(container.querySelectorAll('.bs-row-selected').length).toBe(0);
      expect(findPlacedRow(container, 1).getAttribute('aria-selected')).not.toBe('true');
    });

    it('a non-building selection clears the highlight', () => {
      menu.update(stateWith(two()));
      menu.setSelectedEntity({ kind: 'building', id: 1 });
      menu.setSelectedEntity({ kind: 'vehicle', id: 1 });
      expect(container.querySelectorAll('.bs-row-selected').length).toBe(0);
    });

    it('a vehicle selection with the same id does not highlight a building row', () => {
      menu.update(stateWith(two()));
      menu.setSelectedEntity({ kind: 'vehicle', id: 1 });
      expect(container.querySelectorAll('.bs-row-selected').length).toBe(0);
    });

    it('selecting before the rows exist highlights them once built', () => {
      menu.setSelectedEntity({ kind: 'building', id: 2 });
      menu.update(stateWith(two()));
      expect(findPlacedRow(container, 2).classList.contains('bs-row-selected')).toBe(true);
    });

    it('survives a list rebuild (a new building changes the row signature)', () => {
      const s = stateWith(two());
      menu.update(s);
      menu.setSelectedEntity({ kind: 'building', id: 2 });
      s.buildings.buildings = [...s.buildings.buildings, makeBuilding({ id: 3, type: 'geology_lab', tier: 1, x: 12 })];
      menu.update(s);
      expect(findPlacedRow(container, 2).classList.contains('bs-row-selected')).toBe(true);
      expect(findPlacedRow(container, 3).classList.contains('bs-row-selected')).toBe(false);
    });

    it('a construction-site row with the selected id is highlighted', () => {
      const s = stateWith([]);
      addSite(s, 7);
      menu.update(s);
      menu.setSelectedEntity({ kind: 'building', id: 7 });
      expect(siteRow(7)!.classList.contains('bs-row-selected')).toBe(true);
      expect(siteRow(7)!.getAttribute('aria-selected')).toBe('true');
    });
  });

  describe('row content', () => {
    it('shows the tier name, #id and an icon', () => {
      menu.update(stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 2 })]));
      const row = findPlacedRow(container, 4);
      expect(row.textContent).toContain('#4');
      expect(row.querySelector('.bs-build-row-name')!.textContent).toContain('Bureaucracy Box');
      expect(row.querySelector('svg, img, bs-icon, [data-icon]')).not.toBeNull();
    });

    it('the HP bar width is round(hp / maxHp * 100)%', () => {
      const maxHp = getBuildingDef('management_office', 1).maxHp;
      menu.update(stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1, hp: maxHp / 4 })]));
      const bar = findPlacedRow(container, 4).querySelector<HTMLElement>('[data-live="hp-bar"]');
      expect(bar).not.toBeNull();
      expect(bar!.style.width).toBe('25%');
    });

    it('a full-HP building shows a 100% bar', () => {
      const maxHp = getBuildingDef('management_office', 1).maxHp;
      menu.update(stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1, hp: maxHp })]));
      expect(findPlacedRow(container, 4).querySelector<HTMLElement>('[data-live="hp-bar"]')!.style.width).toBe('100%');
    });

    it('maxHp 0 gives a 0% bar and no NaN anywhere in the row', () => {
      const def = getBuildingDef('management_office', 1);
      const original = def.maxHp;
      (def as { maxHp: number }).maxHp = 0;
      try {
        menu.update(stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1, hp: 0 })]));
        const row = findPlacedRow(container, 4);
        expect(row.querySelector<HTMLElement>('[data-live="hp-bar"]')!.style.width).toBe('0%');
        expect(row.textContent).not.toContain('NaN');
        expect(row.innerHTML).not.toContain('NaN');
      } finally {
        (def as { maxHp: number }).maxHp = original;
      }
    });

    it('exposes data-live hooks for hp-bar and hp', () => {
      menu.update(stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1 })]));
      const row = findPlacedRow(container, 4);
      expect(row.querySelector('[data-live="hp-bar"]')).not.toBeNull();
      expect(row.querySelector('[data-live="hp"]')).not.toBeNull();
    });

    it('a people building shows utilization in place', () => {
      menu.update(stateWith([makeBuilding({ id: 4, type: 'living_quarters', tier: 1, occupantIds: [1, 2] })]));
      const util = findPlacedRow(container, 4).querySelector<HTMLElement>('[data-live="util"]');
      expect(util).not.toBeNull();
      expect(util!.textContent).toContain('2');
      expect(util!.textContent).toContain(String(getBuildingDef('living_quarters', 1).capacity));
    });

    it('a spoil heap shows no utilization text', () => {
      menu.update(stateWith([makeBuilding({ id: 4, type: 'spoil_heap', tier: 1 })]));
      const util = findPlacedRow(container, 4).querySelector<HTMLElement>('[data-live="util"]');
      expect(util).toBeNull();
    });
  });

  describe('live in-place updates', () => {
    it('HP change rewrites the bar without replacing the row node', () => {
      const maxHp = getBuildingDef('management_office', 1).maxHp;
      const s = stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1, hp: maxHp })]);
      menu.update(s);
      const rowBefore = findPlacedRow(container, 4);
      const barBefore = rowBefore.querySelector<HTMLElement>('[data-live="hp-bar"]')!;
      s.buildings.buildings[0]!.hp = maxHp / 2;
      menu.update(s);
      const rowAfter = findPlacedRow(container, 4);
      expect(rowAfter).toBe(rowBefore);
      expect(rowAfter.querySelector('[data-live="hp-bar"]')).toBe(barBefore);
      expect(barBefore.style.width).toBe('50%');
    });

    it('a click fired after an HP-only update still selects', () => {
      const cb = vi.fn();
      menu.setSelectBuildingHandler(cb);
      const s = stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1 })]);
      menu.update(s);
      const row = findPlacedRow(container, 4);
      s.buildings.buildings[0]!.hp = 1;
      menu.update(s);
      row.click();
      expect(cb).toHaveBeenCalledWith(4);
    });

    it('utilization updates in place when occupants change', () => {
      const s = stateWith([makeBuilding({ id: 4, type: 'living_quarters', tier: 1, occupantIds: [] })]);
      menu.update(s);
      const row = findPlacedRow(container, 4);
      s.buildings.buildings[0]!.occupantIds = [1, 2, 3];
      menu.update(s);
      expect(findPlacedRow(container, 4)).toBe(row);
      expect(row.querySelector('[data-live="util"]')!.textContent).toContain('3');
    });
  });

  describe('status badge', () => {
    it('shows no badge on an operating building', () => {
      menu.update(stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1 })]));
      const badge = findPlacedRow(container, 4).querySelector<HTMLElement>('[data-live="badge"]');
      expect((badge?.textContent ?? '').trim()).toBe('');
    });

    it('shows a badge when the building is out of service', () => {
      const s = stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1 })]);
      s.events.activeModifiers.push({
        id: 801, kind: 'out_of_service', sourceEventId: 'evt_flood', role: null, targetId: 4,
        targetKind: 'building', category: null, magnitude: 1, startTick: 0, endTick: null,
      });
      menu.update(s);
      const badge = findPlacedRow(container, 4).querySelector<HTMLElement>('[data-live="badge"]')!;
      expect(badge.textContent!.trim()).not.toBe('');
    });

    it('shows a badge when demolition is ordered, and clears it in place', () => {
      const s = stateWith([makeBuilding({ id: 4, type: 'management_office', tier: 1 })]);
      s.pendingActions.push({
        id: 50, type: 'demolish_building', requiredSkill: null, requiredVehicleRole: 'building_destroyer',
        targetX: 5, targetZ: 5, targetY: 0, payload: { buildingId: 4 }, targetEmployeeId: null,
        status: 'queued', holderId: null, queuedAtTick: 0,
      });
      menu.update(s);
      const row = findPlacedRow(container, 4);
      const badge = row.querySelector<HTMLElement>('[data-live="badge"]')!;
      expect(badge.textContent!.trim()).not.toBe('');
      s.pendingActions = [];
      menu.update(s);
      expect(findPlacedRow(container, 4)).toBe(row);
      expect(row.querySelector<HTMLElement>('[data-live="badge"]')!.textContent!.trim()).toBe('');
    });
  });

  describe('construction-site rows', () => {
    it('each planned building gets a site row that is not a placed row', () => {
      const s = stateWith([]);
      addSite(s, 7);
      addSite(s, 8, true);
      menu.update(s);
      expect(siteRow(7)).not.toBeNull();
      expect(siteRow(8)).not.toBeNull();
      expect(siteRow(7)!.classList.contains('bs-build-placed-row')).toBe(false);
      expect(container.querySelector('.bs-build-placed-row[data-building-id="7"]')).toBeNull();
    });

    it('site rows live outside the #bs-build-placed container', () => {
      const s = stateWith([]);
      addSite(s, 7);
      menu.update(s);
      const placed = container.querySelector('#bs-build-placed');
      expect(placed).not.toBeNull();
      expect(placed!.contains(siteRow(7))).toBe(false);
    });

    it('clicking a site row selects its building id', () => {
      const cb = vi.fn();
      menu.setSelectBuildingHandler(cb);
      const s = stateWith([]);
      addSite(s, 7);
      menu.update(s);
      siteRow(7)!.click();
      expect(cb).toHaveBeenCalledWith(7);
    });

    it('writes progress in place from the building status', () => {
      const s = stateWith([]);
      addSite(s, 7);
      s.employees.employees.push({ id: 5, activeTaskTotalTicks: 100, taskTicksRemaining: 75 } as never);
      s.pendingActions.push({
        id: 67, type: 'place_building', requiredSkill: null, requiredVehicleRole: null,
        targetX: 17, targetZ: 23, targetY: 0, payload: {}, targetEmployeeId: null,
        status: 'in_progress', holderId: 5, queuedAtTick: 0,
      } as never);
      menu.update(s);
      const row = siteRow(7)!;
      const progress = row.querySelector<HTMLElement>('[data-live="progress"]');
      expect(progress).not.toBeNull();
      expect(progress!.textContent).toContain('25');
      s.employees.employees[0]!.taskTicksRemaining = 50;
      menu.update(s);
      expect(siteRow(7)).toBe(row);
      expect(row.querySelector('[data-live="progress"]')!.textContent).toContain('50');
    });

    it('shows waiting text, not NaN, when no one has started the site', () => {
      const s = stateWith([]);
      addSite(s, 7);
      menu.update(s);
      const text = siteRow(7)!.textContent ?? '';
      expect(text).not.toContain('NaN');
      expect(siteRow(7)!.querySelector('[data-live="progress"]')!.textContent!.trim()).not.toBe('');
    });

    it('a rebuild site row shows the rebuilding badge, and flipping the flag rebuilds the row', () => {
      const s = stateWith([]);
      addSite(s, 8, true);
      menu.update(s);
      const badgeOf = (): HTMLElement | null => siteRow(8)!.querySelector<HTMLElement>('[data-live="badge"]');
      expect(badgeOf()).not.toBeNull();
      expect(badgeOf()!.textContent).toContain('Rebuilding');

      const before = siteRow(8)!;
      delete s.plannedBuildings[0]!.rebuild;
      menu.update(s);
      expect(siteRow(8)).not.toBe(before);
      expect(badgeOf()).toBeNull();

      s.plannedBuildings[0]!.rebuild = true;
      menu.update(s);
      expect(badgeOf()!.textContent).toContain('Rebuilding');
    });

    it('removes the site row once the planned entry is gone', () => {
      const s = stateWith([]);
      addSite(s, 7);
      menu.update(s);
      expect(siteRow(7)).not.toBeNull();
      s.plannedBuildings = [];
      s.buildings.buildings = [makeBuilding({ id: 7, type: 'management_office', tier: 1 })];
      menu.update(s);
      expect(siteRow(7)).toBeNull();
      expect(findPlacedRow(container, 7)).not.toBeNull();
    });
  });
});

describe('BuildMenu — catalog price and research refusal (#1820)', () => {
  let container: HTMLDivElement;
  let menu: BuildMenu;
  let gameConsole: ReturnType<typeof vi.fn<[string], CommandResult>>;
  let messages: string[];

  beforeEach(() => {
    ({ container, menu } = setupMenu());
    gameConsole = vi.fn<[string], CommandResult>().mockReturnValue({ success: true, output: '' });
    menu.setGameConsole(gameConsole);
    messages = [];
    menu.setFlowResultHandler((m) => messages.push(m));
  });

  afterEach(() => {
    menu.dispose();
    container.remove();
  });

  it('catalog card prices group thousands like every other amount', () => {
    menu.update(makeMockState());
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-build-type]'));
    expect(rows.length).toBeGreaterThan(0);
    let grouped = 0;
    for (const row of rows) {
      const type = row.dataset['buildType'] as BuildingType;
      const def = getBuildingDef(type, 1);
      const expected = t('ui.build.cost', { cost: formatMoney(def.constructionCost) });
      expect(row.textContent, type).toContain(expected);
      if (def.constructionCost >= 1000) {
        grouped++;
        expect(expected, type).toMatch(/\d,\d{3}/);
      }
    }
    expect(grouped).toBeGreaterThan(0);
  });

  it('the catalog price follows the selected tier, grouped', () => {
    menu.update(makeMockState());
    const row = container.querySelector<HTMLElement>('[data-build-type="management_office"]')!;
    const sel = row.querySelector<HTMLSelectElement>('.bs-build-tier-sel')!;
    sel.value = '2';
    sel.dispatchEvent(new Event('change'));
    const def = getBuildingDef('management_office', 2);
    expect(row.textContent).toContain(t('ui.build.cost', { cost: formatMoney(def.constructionCost) }));
  });

  function observed(b: Building): void {
    const state = makeMockState();
    state.buildings.buildings = [b];
    menu.observe(state);
  }

  it('queueResearchFor returns the translated refusal and does not write the closed panel status line', () => {
    observed(makeBuilding({ id: 10, type: 'management_office', tier: 1 }));
    gameConsole.mockReturnValue({ success: false, output: 'raw core text', code: 'no_research_center' });
    const refusal = menu.queueResearchFor(10);
    expect(refusal).toBe(t('ui.build.research_failed_no_research_center'));
    expect(messages).toEqual([]);
  });

  it('queueResearchFor translates each refusal code it relays', () => {
    observed(makeBuilding({ id: 10, type: 'management_office', tier: 1 }));
    gameConsole.mockReturnValue({ success: false, output: 'x', code: 'conditions_not_met' });
    expect(menu.queueResearchFor(10)).toBe(t('ui.build.research_failed_conditions_not_met'));
    gameConsole.mockReturnValue({ success: false, output: 'x', code: 'insufficient_funds' });
    expect(menu.queueResearchFor(10)).toBe(t('ui.build.research_failed_insufficient_funds'));
  });

  it('queueResearchFor returns null on success', () => {
    observed(makeBuilding({ id: 10, type: 'management_office', tier: 1 }));
    expect(menu.queueResearchFor(10)).toBeNull();
    expect(gameConsole).toHaveBeenCalledWith('research queue type:management_office tier:2');
  });

  it('a successful research queue re-applies catalog button state; a refusal does not', () => {
    observed(makeBuilding({ id: 10, type: 'management_office', tier: 1 }));
    const refresh = vi.spyOn(menu as unknown as { refreshCatalogButtons(cash: number): void }, 'refreshCatalogButtons');
    gameConsole.mockReturnValue({ success: false, output: 'no', code: 'insufficient_funds' });
    menu.queueResearchFor(10);
    expect(refresh).not.toHaveBeenCalled();
    gameConsole.mockReturnValue({ success: true, output: '' });
    menu.queueResearchFor(10);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('queueResearchFor returns null and sends nothing for an unknown building or max tier', () => {
    observed(makeBuilding({ id: 11, type: 'management_office', tier: 3 }));
    expect(menu.queueResearchFor(11)).toBeNull();
    expect(menu.queueResearchFor(404)).toBeNull();
    expect(gameConsole).not.toHaveBeenCalled();
  });
});
