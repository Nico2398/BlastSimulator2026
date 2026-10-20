// @vitest-environment jsdom
// BlastSimulator2026 — RampTool (#1942): multi-leg drawing, grade, readout, tier check, spiral.
//
// Mirrors BuildMenu.test.ts's makeMockKit(), extended with the 'path' shape's waypoints. The tool only
// collects clicks: every length, cost, grade and refusal asserted here comes from the core helpers.

import { describe, it, expect, vi } from 'vitest';
import { RampTool } from '../../../src/ui/RampTool.js';
import { describeRampPlan } from '../../../src/ui/describeRamp.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import type { PlacementKit } from '../../../src/ui/scene/PlacementKit.js';
import type { PlacementSelection, PlacementArmConfig, PlacementConfirmHandler, PlacementChangeHandler } from '../../../src/ui/scene/PlacementController.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';
import { rampFootLine } from '../../../src/ui/rampFootLine.js';
import { rampFloorDepthAt, rampGradeBoundsDegrees, validateRampOrder, type RampDef } from '../../../src/core/mining/Ramp.js';
import { climbTiersFor, plannedRampGradeDegrees } from '../../../src/core/mining/RampGrade.js';
import { proposeRampSpiral, type SpiralSurface } from '../../../src/core/mining/RampSpiral.js';
import { t } from '../../../src/core/i18n/I18n.js';

interface Tile { x: number; z: number }
interface StripField { key: string; value: number; format?: (v: number) => string; onInc: () => void; onDec: () => void }
interface StripAction { key: string; label: string; onClick: () => void; disabled?: boolean }

function makeMockKit() {
  let armed = false;
  let phase: 'idle' | 'armed' | 'selected' = 'idle';
  let waypoints: Tile[] = [];
  let confirmHandler: PlacementConfirmHandler | null = null;
  let changeHandler: PlacementChangeHandler | null = null;
  let armConfig: PlacementArmConfig | null = null;

  const selection = (): PlacementSelection | null => {
    const a = waypoints[0]; const b = waypoints[waypoints.length - 1];
    return a && b ? { x1: a.x, z1: a.z, x2: b.x, z2: b.z } : null;
  };
  const controller = {
    get isArmed() { return armed; },
    get currentPhase() { return phase; },
    get currentShape() { return armConfig?.shape ?? 'rect'; },
    get selection() { return selection(); },
    get activeRegion() { return null; },
    get hoveredTile() { return null; },
    get previewOrigin() { return null; },
    get canConfirm() { return waypoints.length > 0; },
    get waypoints() { return waypoints as readonly Tile[]; },
    popWaypoint: vi.fn(() => { waypoints = waypoints.slice(0, -1); if (!waypoints.length) phase = 'armed'; changeHandler?.(); }),
    setConfirmHandler: (cb: PlacementConfirmHandler) => { confirmHandler = cb; },
    setCancelHandler: vi.fn(),
    setChangeHandler: (cb: PlacementChangeHandler) => { changeHandler = cb; },
    setFootprintCheck: vi.fn(),
    arm: (config: PlacementArmConfig) => { armed = true; phase = 'armed'; armConfig = config; },
    cancel: () => { armed = false; phase = 'idle'; waypoints = []; changeHandler?.(); },
    /** The player's clicks so far, in order. */
    simulateWaypoints(tiles: Tile[]) { waypoints = tiles; phase = tiles.length ? 'selected' : 'armed'; changeHandler?.(); },
    simulateConfirm() { const sel = selection(); return sel ? confirmHandler?.(sel) : undefined; },
  };
  const overlay = { update: vi.fn(), clear: vi.fn(), flashConfirm: vi.fn() };
  const strip = { show: vi.fn(), hide: vi.fn(), setConfirmHandler: vi.fn(), setCancelHandler: vi.fn() };
  return { kit: { controller, overlay, strip } as unknown as PlacementKit, controller, overlay, strip, armConfig: () => armConfig };
}

/** A square pit (30 x 30, 20 m deep) in a 60 x 60 area; used for the spiral. */
function makePitSurface(pit = { x0: 15, z0: 15, w: 30, h: 30, depth: 20 }): SpiralSurface {
  return {
    heightAt: (x, z) => (x >= pit.x0 && x < pit.x0 + pit.w && z >= pit.z0 && z < pit.z0 + pit.h ? -pit.depth : 0),
    contains: (x, z) => x >= 0 && x < 60 && z >= 0 && z < 60,
  };
}
const RIM: Tile = { x: 14, z: 30 };

function makeState(over: { cash?: number; progression?: boolean } = {}): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = over.cash ?? 10_000_000;
  if (over.progression) s.grade = { grade: 1, oreDeliveredKg: 0, deepestPitM: 0, rockBrokenM3: 0, blastsFired: 0, pending: null };
  return s;
}

function setup(opts: {
  cash?: number; progression?: boolean; surface?: SpiralSurface | null; hasConsole?: boolean; sampler?: (x: number, z: number) => number;
} = {}) {
  const k = makeMockKit();
  const gameConsole = vi.fn<[string], CommandResult>().mockReturnValue({ success: true, output: '' });
  const setStatus = vi.fn();
  const state = makeState(opts);
  const surface = opts.surface === undefined ? makePitSurface() : opts.surface;
  const tool = new RampTool({
    kit: k.kit, getState: () => state, console: opts.hasConsole === false ? undefined : gameConsole, setStatus,
    sampler: opts.sampler ?? null, spiralSurface: () => surface,
  });
  tool.arm();
  const shown = () => k.strip.show.mock.calls.at(-1)![0] as {
    fields: StripField[]; subtitle?: string; actions?: StripAction[]; readout?: string[]; confirmEnabled: boolean; confirmDisabledReason?: string;
  };
  const field = (key: string) => shown().fields.find(f => f.key === key)!;
  const action = (key: string) => shown().actions?.find(a => a.key === key);
  const lastOverlay = () => k.overlay.update.mock.calls.at(-1)![0];
  return { ...k, tool, gameConsole, setStatus, state, surface, shown, field, action, lastOverlay };
}

const A: Tile = { x: 15, z: 15 };
const B: Tile = { x: 15, z: 27 };
const C: Tile = { x: 25, z: 27 };
const SWITCHBACK_DEF: RampDef = {
  originX: 15, originZ: 15, direction: 'south', length: 22, targetDepth: 8, width: 3,
  legs: [{ direction: 'south', length: 12 }, { direction: 'east', length: 10 }],
};

describe('RampTool: arming', () => {
  it('arms the controller in the path shape and shows the strip', () => {
    const s = setup();
    expect(s.controller.isArmed).toBe(true);
    expect(s.armConfig()?.shape).toBe('path');
    expect(s.strip.show).toHaveBeenCalled();
  });

  it('arming again while armed cancels instead', () => {
    const s = setup();
    s.tool.arm();
    expect(s.controller.isArmed).toBe(false);
  });

  it('offers depth, width and grade steppers', () => {
    const s = setup();
    expect(s.shown().fields.map(f => f.key)).toEqual(expect.arrayContaining(['depth', 'width', 'grade']));
    expect(s.shown().fields[0]!.key).toBe('depth');
  });
});

describe('RampTool: ordering', () => {
  it('a plain drag A to B sends exactly the start/end form as before', () => {
    const s = setup();
    s.controller.simulateWaypoints([{ x: 5, z: 5 }, { x: 5, z: 25 }]);
    s.controller.simulateConfirm();
    expect(s.gameConsole).toHaveBeenCalledTimes(1);
    expect(s.gameConsole).toHaveBeenCalledWith('build_ramp start:5,5 end:5,25 depth:8 width:3');
  });

  it('corner clicks A, B, C send the path form with every waypoint', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    s.controller.simulateConfirm();
    expect(s.gameConsole).toHaveBeenCalledWith('build_ramp path:15,15;15,27;25,27 depth:8 width:3');
  });

  it('four waypoints are all sent', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C, { x: 25, z: 20 }]);
    s.controller.simulateConfirm();
    expect(s.gameConsole).toHaveBeenCalledWith('build_ramp path:15,15;15,27;25,27;25,20 depth:8 width:3');
  });

  it('carries the chosen depth and width', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    s.field('depth').onInc();
    s.field('width').onInc();
    s.controller.simulateConfirm();
    expect(s.gameConsole).toHaveBeenCalledWith('build_ramp path:15,15;15,27;25,27 depth:9 width:5');
  });

  it('success reports the ordered status, flashes the overlay and returns true', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    expect(s.controller.simulateConfirm()).toBe(true);
    expect(s.setStatus).toHaveBeenCalledWith(t('ui.build.ramp_ordered'));
    expect(s.overlay.flashConfirm).toHaveBeenCalled();
  });

  it('a refused order reports the console output and returns false so the tool stays armed', () => {
    const s = setup();
    s.gameConsole.mockReturnValue({ success: false, output: 'Ramp order refused' });
    s.controller.simulateWaypoints([A, B, C]);
    expect(s.controller.simulateConfirm()).toBe(false);
    expect(s.setStatus).toHaveBeenCalledWith('Ramp order refused');
    expect(s.overlay.flashConfirm).not.toHaveBeenCalled();
  });

  it('with no console wired, confirm returns false without throwing', () => {
    const s = setup({ hasConsole: false });
    s.controller.simulateWaypoints([A, B, C]);
    expect(s.controller.simulateConfirm()).toBe(false);
  });

  it('a lone waypoint cannot be confirmed as a path', () => {
    const s = setup();
    s.controller.simulateWaypoints([A]);
    expect(s.shown().confirmEnabled).toBe(false);
  });

  it('cash below the multi-leg cost disables confirm with the core refusal text', () => {
    const cost = validateRampOrder(SWITCHBACK_DEF, 10_000_000).cost;
    const s = setup({ cash: cost - 1 });
    s.controller.simulateWaypoints([A, B, C]);
    const v = validateRampOrder(SWITCHBACK_DEF, cost - 1);
    expect(v.success).toBe(false);
    expect(s.shown().confirmEnabled).toBe(false);
    expect(s.shown().confirmDisabledReason).toBe(t(v.messageKey!, v.messageParams));
  });

  it('a too-short multi-leg road at a deep target is refused with the core reason', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    for (let i = 0; i < 20; i++) s.field('depth').onInc(); // 28 m deep over 22 m of road
    const v = validateRampOrder({ ...SWITCHBACK_DEF, targetDepth: 28 }, 10_000_000);
    expect(v.success).toBe(false);
    expect(s.shown().confirmEnabled).toBe(false);
    expect(s.shown().confirmDisabledReason).toBe(t(v.messageKey!, v.messageParams));
  });
});

describe('RampTool: preview follows every leg', () => {
  it('passes the legs of a corner path to the overlay', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    expect(s.lastOverlay()).toMatchObject({
      shape: 'line', x1: 15, z1: 15, width: 3,
      legs: { originX: 15, originZ: 15, legs: [{ direction: 'south', length: 12 }, { direction: 'east', length: 10 }] },
    });
  });

  it('marks the preview refused when the order would be', () => {
    const s = setup({ cash: 1 });
    s.controller.simulateWaypoints([A, B, C]);
    expect(s.lastOverlay().refused).toBe(true);
  });

  it('clears the overlay and hides the strip on cancel', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    s.controller.cancel();
    expect(s.overlay.clear).toHaveBeenCalled();
    expect(s.strip.hide).toHaveBeenCalled();
  });
});

describe('RampTool: grade stepper', () => {
  const total = 22;
  const bounds = () => rampGradeBoundsDegrees(total, 8);

  it('starts on auto: the value is the gentlest grade and the order carries no grade argument', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    expect(s.field('grade').value).toBeCloseTo(bounds().min, 1);
    s.controller.simulateConfirm();
    expect(s.gameConsole.mock.calls[0]![0]).not.toContain('grade:');
  });

  it('stepping up moves by at most 1 degree and makes the grade explicit', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    s.field('grade').onInc();
    const v = s.field('grade').value;
    expect(v).toBeGreaterThan(bounds().min);
    expect(v).toBeLessThanOrEqual(bounds().min + 1.1);
    s.controller.simulateConfirm();
    const m = /grade:([\d.]+)/.exec(s.gameConsole.mock.calls[0]![0]);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(v, 3);
  });

  it('clamps at the gentlest grade the length allows', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    s.field('grade').onInc();
    for (let i = 0; i < 5; i++) s.field('grade').onDec();
    expect(s.field('grade').value).toBeCloseTo(bounds().min, 1);
  });

  it('clamps at the steepest cut grade', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    for (let i = 0; i < 40; i++) s.field('grade').onInc();
    expect(s.field('grade').value).toBeCloseTo(bounds().max, 1);
    expect(s.field('grade').value).toBeLessThanOrEqual(bounds().max + 1e-9);
  });

  it('a chosen grade is accepted by the core validator at both ends', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    for (let i = 0; i < 40; i++) s.field('grade').onInc();
    expect(s.shown().confirmEnabled).toBe(true);
    s.controller.simulateConfirm();
    expect(s.gameConsole.mock.calls[0]![0]).toMatch(/ grade:\d/);
  });

  it('the grade bounds follow the drawn length: a straight 12 m ramp has a steeper minimum than the 22 m switchback', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B]);
    const straight = s.field('grade').value;
    s.controller.simulateWaypoints([A, B, C]);
    expect(s.field('grade').value).toBeLessThan(straight);
  });

  it('works for a straight drag too, sending grade with the start/end form', () => {
    const s = setup();
    s.controller.simulateWaypoints([{ x: 5, z: 5 }, { x: 5, z: 25 }]);
    s.field('grade').onInc();
    s.controller.simulateConfirm();
    expect(s.gameConsole.mock.calls[0]![0]).toMatch(/^build_ramp start:5,5 end:5,25 depth:8 width:3 grade:[\d.]+$|^build_ramp start:5,5 end:5,25 depth:8 grade:[\d.]+ width:3$/);
  });
});

describe('RampTool: grade control, min end and pure display', () => {
  it('clamps at the gentlest grade when stepping down from the shown value', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    for (let i = 0; i < 40; i++) s.field('grade').onDec();
    const min = rampGradeBoundsDegrees(22, 8).min;
    const lo = Math.ceil(min * 10) / 10;
    expect(s.field('grade').value).toBeCloseTo(lo, 5);
    expect(s.field('grade').value).toBeGreaterThanOrEqual(min);
  });

  it('rendering never changes the chosen grade: a stale choice is shown clamped, then restored when the range allows', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    for (let i = 0; i < 40; i++) s.field('grade').onInc();
    const steep = s.field('grade').value;
    s.field('depth').onDec();
    s.field('depth').onDec();
    expect(s.field('grade').value).toBeLessThanOrEqual(steep);
    s.field('depth').onInc();
    s.field('depth').onInc();
    expect(s.field('grade').value).toBeCloseTo(steep, 5);
  });
});

describe('RampTool: auto spiral grade', () => {
  /** The grade the order carries after pressing Spiral without touching the grade stepper. */
  function autoSpiral(depth: number) {
    const s = setup();
    s.controller.simulateWaypoints([RIM]);
    while (s.field('depth').value < depth) s.field('depth').onInc();
    s.action('ramp-spiral')!.onClick();
    return s;
  }

  it('the shown grade, the proposal and the ordered grade are one number', () => {
    const s = autoSpiral(20);
    const shown = s.field('grade').value;
    s.controller.simulateConfirm();
    const m = /grade:([\d.]+)/.exec(s.gameConsole.mock.calls[0]![0]);
    expect(Number(m![1])).toBeCloseTo(shown, 5);
    const r = proposeRampSpiral({ fromX: RIM.x, fromZ: RIM.z, depth: 20, gradeDegrees: shown, width: 3, dir: 'cw' }, s.surface!);
    expect(r.success).toBe(true);
  });

  it('steepens past the gentlest grade when the pit does not fit it, and shows that grade', () => {
    const s = autoSpiral(20);
    const lo = Math.ceil(rampGradeBoundsDegrees(1000, 20).min * 10) / 10;
    const gentlest = proposeRampSpiral({ fromX: RIM.x, fromZ: RIM.z, depth: 20, gradeDegrees: lo, width: 3, dir: 'cw' }, s.surface!);
    expect(gentlest.success).toBe(false);
    expect(s.field('grade').value).toBeGreaterThan(lo);
    expect(s.shown().confirmEnabled).toBe(true);
  });
});

describe('RampTool: live readout', () => {
  it('matches describeRampPlan fed by the core cost and planned grade', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    const v = validateRampOrder(SWITCHBACK_DEF, s.state.cash);
    expect(v.success).toBe(true);
    expect(s.shown().readout).toEqual(describeRampPlan({
      length: 22, legs: 2, cost: v.cost, gradeDeg: plannedRampGradeDegrees(SWITCHBACK_DEF), tiers: null,
    }));
  });

  it('a straight ramp reads one leg', () => {
    const s = setup();
    s.controller.simulateWaypoints([{ x: 5, z: 5 }, { x: 5, z: 25 }]);
    const def: RampDef = { originX: 5, originZ: 5, direction: 'south', length: 20, targetDepth: 8, width: 3 };
    expect(s.shown().readout).toEqual(describeRampPlan({
      length: 20, legs: 1, cost: validateRampOrder(def, s.state.cash).cost, gradeDeg: plannedRampGradeDegrees(def), tiers: null,
    }));
  });

  it('follows the width: a wider ramp costs more and the readout says so', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    const before = s.shown().readout;
    s.field('width').onInc();
    const def = { ...SWITCHBACK_DEF, width: 5 as const };
    expect(s.shown().readout).not.toEqual(before);
    expect(s.shown().readout).toEqual(describeRampPlan({
      length: 22, legs: 2, cost: validateRampOrder(def, s.state.cash).cost, gradeDeg: plannedRampGradeDegrees(def), tiers: null,
    }));
  });

  it('shows the chosen grade once stepped', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    s.field('grade').onInc();
    const g = s.field('grade').value;
    const def = { ...SWITCHBACK_DEF, gradeDegrees: g };
    expect(s.shown().readout).toEqual(describeRampPlan({
      length: 22, legs: 2, cost: validateRampOrder(def, s.state.cash).cost, gradeDeg: g, tiers: null,
    }));
  });

  it('has no tier line on a non-progression site', () => {
    const s = setup();
    s.controller.simulateWaypoints([A, B, C]);
    expect((s.shown().readout ?? []).join('\n')).not.toContain('T1');
  });

  it('adds the tier line on a progression site, from the core climb helper', () => {
    const s = setup({ progression: true });
    s.controller.simulateWaypoints([A, B, C]);
    const g = plannedRampGradeDegrees(SWITCHBACK_DEF);
    const v = validateRampOrder(SWITCHBACK_DEF, s.state.cash);
    expect(s.shown().readout).toEqual(describeRampPlan({
      length: 22, legs: 2, cost: v.cost, gradeDeg: g, tiers: climbTiersFor(g, true),
    }));
    expect(s.shown().readout!.join('\n')).toContain('T1');
  });

  it('the tier line follows the stepped grade', () => {
    const s = setup({ progression: true });
    s.controller.simulateWaypoints([A, B, C]);
    const before = s.shown().readout!.join('\n');
    for (let i = 0; i < 40; i++) s.field('grade').onInc();
    const g = s.field('grade').value;
    const after = s.shown().readout!.join('\n');
    expect(after).not.toBe(before);
    expect(after).toContain(describeRampPlan({ length: 22, legs: 2, cost: 0, gradeDeg: g, tiers: climbTiersFor(g, true) }).at(-1)!);
  });
});

describe('RampTool: foot line over a multi-leg path', () => {
  it('samples the last leg\'s start tile and the end tile, with the floor still to drop over that leg only', () => {
    const calls: Array<[number, number]> = [];
    const sampler = (x: number, z: number): number => { calls.push([x, z]); return x === 25 && z === 27 ? 6 : 10; };
    const s = setup({ sampler });
    s.controller.simulateWaypoints([A, B, C]);
    expect(calls).toContainEqual([B.x, B.z]);
    expect(calls).toContainEqual([C.x, C.z]);
    const def = SWITCHBACK_DEF;
    const total = 22;
    const dropBefore = rampFloorDepthAt(total - 10, total, def.targetDepth, undefined);
    const expected = rampFootLine(10, 6, def.targetDepth - dropBefore, 10);
    expect(s.shown().subtitle).toBe(expected);
    expect(expected).not.toBe('');
  });
});

describe('RampTool: spiral button', () => {
  it('is offered with exactly one waypoint on a pit rim', () => {
    const s = setup();
    s.controller.simulateWaypoints([RIM]);
    expect(s.action('ramp-spiral')).toBeDefined();
    expect(s.action('ramp-spiral')!.label.length).toBeGreaterThan(0);
  });

  it('is not offered off the rim', () => {
    const s = setup();
    s.controller.simulateWaypoints([{ x: 3, z: 3 }]);
    expect(s.action('ramp-spiral')).toBeUndefined();
  });

  it('is not offered inside the pit', () => {
    const s = setup();
    s.controller.simulateWaypoints([{ x: 30, z: 30 }]);
    expect(s.action('ramp-spiral')).toBeUndefined();
  });

  it('is not offered once a second waypoint exists', () => {
    const s = setup();
    s.controller.simulateWaypoints([RIM, { x: 14, z: 40 }]);
    expect(s.action('ramp-spiral')).toBeUndefined();
  });

  it('is not offered before the first click', () => {
    const s = setup();
    expect(s.action('ramp-spiral')).toBeUndefined();
  });

  it('is not offered when no terrain seam is available', () => {
    const s = setup({ surface: null });
    s.controller.simulateWaypoints([RIM]);
    expect(s.action('ramp-spiral')).toBeUndefined();
  });

  /** Steps depth to 20 and the grade to at least 15 degrees, then returns the chosen grade. */
  function chooseDeepSpiral(s: ReturnType<typeof setup>): number {
    while (s.field('depth').value < 20) s.field('depth').onInc();
    while (s.field('grade').value < 15) s.field('grade').onInc();
    return s.field('grade').value;
  }

  it('clicking it previews the proposal from proposeRampSpiral as the overlay legs', () => {
    const s = setup();
    s.controller.simulateWaypoints([RIM]);
    const grade = chooseDeepSpiral(s);
    s.action('ramp-spiral')!.onClick();
    const r = proposeRampSpiral({ fromX: RIM.x, fromZ: RIM.z, depth: 20, gradeDegrees: grade, width: 3, dir: 'cw' }, s.surface!);
    expect(r.success).toBe(true);
    if (!r.success) return;
    const o = s.lastOverlay();
    expect(o.shape).toBe('line');
    expect(o.legs).toEqual({ originX: r.proposal.originX, originZ: r.proposal.originZ, legs: r.proposal.legs });
    expect([o.x1, o.z1]).toEqual([r.proposal.originX, r.proposal.originZ]);
    expect(s.shown().confirmEnabled).toBe(true);
  });

  it('the spiral readout matches the proposal', () => {
    const s = setup();
    s.controller.simulateWaypoints([RIM]);
    const grade = chooseDeepSpiral(s);
    s.action('ramp-spiral')!.onClick();
    const r = proposeRampSpiral({ fromX: RIM.x, fromZ: RIM.z, depth: 20, gradeDegrees: grade, width: 3, dir: 'cw' }, s.surface!);
    if (!r.success) throw new Error('fixture must propose');
    expect(s.shown().readout).toEqual(describeRampPlan({
      length: r.proposal.totalLength, legs: r.proposal.legs.length, cost: r.proposal.cost, gradeDeg: r.proposal.gradeDegrees, tiers: null,
    }));
  });

  it('confirming orders the spiral through the ramp spiral command, not build_ramp', () => {
    const s = setup();
    s.controller.simulateWaypoints([RIM]);
    const grade = chooseDeepSpiral(s);
    s.action('ramp-spiral')!.onClick();
    expect(s.controller.simulateConfirm()).toBe(true);
    expect(s.gameConsole).toHaveBeenCalledTimes(1);
    const cmd = s.gameConsole.mock.calls[0]![0];
    expect(cmd).toMatch(/^ramp spiral from:14,30 depth:20 grade:[\d.]+ width:3 dir:cw$/);
    expect(Number(/grade:([\d.]+)/.exec(cmd)![1])).toBeCloseTo(grade, 3);
    expect(s.setStatus).toHaveBeenCalledWith(t('ui.build.ramp_spiral_ordered'));
  });

  it('a pit too small for the grade shows the core refusal text and disables Confirm', () => {
    const s = setup({ surface: makePitSurface({ x0: 15, z0: 15, w: 6, h: 6, depth: 20 }) });
    const rim = { x: 14, z: 18 };
    s.controller.simulateWaypoints([rim]);
    const grade = chooseDeepSpiral(s);
    s.action('ramp-spiral')!.onClick();
    const r = proposeRampSpiral({ fromX: rim.x, fromZ: rim.z, depth: 20, gradeDegrees: grade, width: 3, dir: 'cw' }, s.surface!);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(s.shown().confirmEnabled).toBe(false);
    expect(s.shown().confirmDisabledReason).toBe(t(r.reasonKey, r.params));
  });

  it('a refused spiral is never sent', () => {
    const s = setup({ surface: makePitSurface({ x0: 15, z0: 15, w: 6, h: 6, depth: 20 }) });
    s.controller.simulateWaypoints([{ x: 14, z: 18 }]);
    chooseDeepSpiral(s);
    s.action('ramp-spiral')!.onClick();
    s.controller.simulateConfirm();
    expect(s.gameConsole).not.toHaveBeenCalled();
  });

  it('a refused spiral order from the console keeps the tool armed and shows the output', () => {
    const s = setup();
    s.gameConsole.mockReturnValue({ success: false, output: 'Spiral refused' });
    s.controller.simulateWaypoints([RIM]);
    chooseDeepSpiral(s);
    s.action('ramp-spiral')!.onClick();
    expect(s.controller.simulateConfirm()).toBe(false);
    expect(s.setStatus).toHaveBeenCalledWith('Spiral refused');
  });
});
