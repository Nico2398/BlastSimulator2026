// BlastSimulator2026 — Console: multi-leg ramps via build_ramp path:<x>,<z>;... (#1939)

import { describe, it, expect } from 'vitest';
import {
  buildRampCommand, widenRampCommand, type MiningContext,
} from '../../../src/console/commands/mining.js';
import { buildCommand } from '../../../src/console/commands/entities.js';
import { tickCommand } from '../../../src/console/commands/events.js';
import { createRunner } from '../../../src/console/createRunner.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { RAMP_COST_PER_METER_PER_WIDTH, RAMP_CUT_SLOPE_RATIO } from '../../../src/core/config/balance.js';
import { rampBoundingFootprint, rampLegsOf } from '../../../src/core/mining/RampPath.js';
import { findRampAtTile } from '../../../src/core/mining/RampWidening.js';
import { computeVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';
import enLocale from '../../../src/core/i18n/locales/en.json';
import frLocale from '../../../src/core/i18n/locales/fr.json';
import { makeGameContext } from '../../helpers/gameContext.js';

const PATH = '5,5;5,17;15,17';
const LEGS = [{ direction: 'south', length: 12 }, { direction: 'east', length: 10 }];
const ORDER = { path: PATH, depth: '6', width: '3' };

function makeCtx(): MiningContext {
  const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 32, staffed: true });
  ctx.state!.cash = 10_000_000;
  return ctx;
}

function drive(ctx: MiningContext, maxTicks = 3000): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedRamps.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) emp.fatigue = 100;
    tickCommand(ctx, ['1'], {});
  }
}

/** Asserts a refused order left cash, queue and plan untouched. */
function expectRefused(named: Record<string, string>, ctx = makeCtx()): string {
  const cash = ctx.state!.cash;
  const actions = ctx.state!.pendingActions.length;
  const r = buildRampCommand(ctx, [], named);
  expect(r.success).toBe(false);
  expect(ctx.state!.cash).toBe(cash);
  expect(ctx.state!.plannedRamps).toHaveLength(0);
  expect(ctx.state!.pendingActions.length).toBe(actions);
  expect(r.output).not.toMatch(/^mining\./);
  expect(r.output.length).toBeGreaterThan(0);
  return r.output;
}

/** The longest literal run of a translated message, i.e. the text outside its `{param}` placeholders. */
function literalOf(key: string): string {
  setLocale('en');
  return t(key).split(/\{[^}]*\}/).sort((a, b) => b.length - a.length)[0]!.trim();
}

/** Refused for the reason named by `key`, not merely refused. */
function expectRefusedFor(key: string, named: Record<string, string>, ctx = makeCtx()): void {
  const out = expectRefused(named, ctx);
  expect(literalOf(key).length).toBeGreaterThan(5);
  expect(out).toContain(literalOf(key));
}

describe('build_ramp path: ordering', () => {
  it('orders a two-leg ramp and reports total length, legs and segments', () => {
    setLocale('en');
    const ctx = makeCtx();
    const r = buildRampCommand(ctx, [], ORDER);
    expect(r.success).toBe(true);
    const planned = ctx.state!.plannedRamps[0]!;
    expect(r.output).toBe(t('mining.build_ramp.ordered_legs', { length: 22, legs: 2, segments: planned.segments.length }));
    expect(r.output).toMatch(/Ramp ordered: 22m in 2 legs, \d+ segments queued for excavation/);
  });

  it('records the legs, first-leg direction and total length on the planned def', () => {
    const ctx = makeCtx();
    buildRampCommand(ctx, [], ORDER);
    const def = ctx.state!.plannedRamps[0]!.def;
    expect(def).toMatchObject({ originX: 5, originZ: 5, direction: 'south', length: 22, targetDepth: 6, width: 3 });
    expect(rampLegsOf(def)).toEqual(LEGS);
  });

  it.each([3, 5, 7])('charges total length x width %i x the per-width rate, corner counted once', (width) => {
    const ctx = makeCtx();
    const before = ctx.state!.cash;
    expect(buildRampCommand(ctx, [], { ...ORDER, width: String(width) }).success).toBe(true);
    expect(before - ctx.state!.cash).toBeCloseTo(22 * width * RAMP_COST_PER_METER_PER_WIDTH, 6);
  });

  it('records one built ramp with its ordered legs and a bounding-box footprint once dug', () => {
    const ctx = makeCtx();
    buildRampCommand(ctx, [], ORDER);
    drive(ctx);
    expect(ctx.state!.plannedRamps).toHaveLength(0);
    expect(ctx.state!.builtRamps).toHaveLength(1);
    const built = ctx.state!.builtRamps[0]!;
    expect(built.def.legs).toEqual(LEGS);
    expect(built.footprint).toEqual(rampBoundingFootprint({ originX: 5, originZ: 5, legs: LEGS as never }, 3));
  });

  it('digs the corridor: far end is lower than the origin by about the ordered depth', () => {
    const ctx = makeCtx();
    const grid = ctx.grid!;
    const top = computeVoxelColumnSurfaceHeight(grid, 5, 5);
    buildRampCommand(ctx, [], ORDER);
    drive(ctx);
    const bottom = computeVoxelColumnSurfaceHeight(grid, 14, 17);
    expect(top - bottom).toBeGreaterThan(4.5);
    expect(top - bottom).toBeLessThan(6.5);
  });

  it('findRampAtTile finds leg and landing tiles but not the empty corner of the L', () => {
    const ctx = makeCtx();
    buildRampCommand(ctx, [], ORDER);
    drive(ctx);
    const ramps = ctx.state!.builtRamps;
    expect(findRampAtTile(ramps, 5, 10)).not.toBeNull();
    expect(findRampAtTile(ramps, 5, 17)).not.toBeNull();
    expect(findRampAtTile(ramps, 12, 17)).not.toBeNull();
    expect(findRampAtTile(ramps, 12, 6)).toBeNull();
  });

  it('a path of two waypoints orders a single straight ramp like origin/direction/length', () => {
    const a = makeCtx();
    const b = makeCtx();
    const ra = buildRampCommand(a, [], { path: '5,5;5,16', depth: '4', width: '3' });
    const rb = buildRampCommand(b, [], { origin: '5,5', direction: 'south', length: '11', depth: '4', width: '3' });
    expect(ra.success).toBe(true);
    expect(rb.success).toBe(true);
    expect(a.state!.cash).toBe(b.state!.cash);
    expect(a.state!.plannedRamps[0]!.segments.length).toBe(b.state!.plannedRamps[0]!.segments.length);
  });

  it('accepts an explicit grade between the bounds', () => {
    const ctx = makeCtx();
    expect(buildRampCommand(ctx, [], { ...ORDER, grade: '20' }).success).toBe(true);
    expect(ctx.state!.plannedRamps[0]!.def.gradeDegrees).toBeCloseTo(20, 6);
  });

  it('is reachable through the registered runner', () => {
    const { runner } = createRunner();
    runner.run('new_game seed:1 staffed:true');
    const r = runner.run('build_ramp path:5,5;5,17;15,17 depth:6 width:3');
    expect(r.success).toBe(true);
    expect(r.output).toContain('2 legs');
  });
});

describe('build_ramp path: refusals charge nothing and queue nothing', () => {
  it('refuses a diagonal leg', () => {
    expectRefusedFor('mining.build_ramp.leg_not_cardinal', { path: '5,5;10,10', depth: '4', width: '3' });
  });

  it('refuses a zero-length leg', () => {
    const out = expectRefused({ path: '5,5;5,5;10,5', depth: '4', width: '3' });
    // Refused as a bad path, not as the unrelated default-order slope check.
    expect(out).not.toContain(literalOf('mining.build_ramp.slope_too_steep'));
  });

  it('refuses a self-crossing path', () => {
    expectRefusedFor('mining.build_ramp.legs_cross', { path: '5,5;15,5;15,11;5,11;5,1', depth: '6', width: '3' });
  });

  it('refuses a leg shorter than the width', () => {
    expectRefusedFor('mining.build_ramp.leg_too_short', { path: '5,5;5,17;9,17', depth: '4', width: '5' });
  });

  it('refuses a total over MAX_RAMP_LENGTH', () => {
    expect(expectRefused({ path: '0,0;0,700;700,700', depth: '50', width: '3' })).toBe(
      t('mining.build_ramp.too_long', { length: 1400, limit: 1000 }),
    );
  });

  it('refuses a grade above the 30 degree cut limit', () => {
    const over = String(Math.ceil((Math.atan(RAMP_CUT_SLOPE_RATIO) * 180) / Math.PI) + 1);
    expectRefusedFor('mining.build_ramp.grade_too_steep', { ...ORDER, grade: over });
  });

  it('refuses a grade gentler than the length allows', () => {
    expectRefusedFor('mining.build_ramp.grade_too_gentle', { ...ORDER, grade: '5' });
  });

  it('refuses a non-numeric grade', () => {
    expectRefusedFor('mining.build_ramp.grade_invalid', { ...ORDER, grade: 'steep' });
  });

  it('refuses a path that crosses a building footprint', () => {
    const ctx = makeCtx();
    ctx.state!.buildings.unlockedTiers.management_office = 3;
    expect(buildCommand(ctx, ['management_office'], { at: '20,20' }).success).toBe(true);
    for (let i = 0; i < 300 && ctx.state!.plannedBuildings.length > 0; i++) tickCommand(ctx, ['1'], {});
    expect(ctx.state!.buildings.buildings.length).toBeGreaterThan(0);
    expectRefusedFor('mining.build_ramp.leg_hits_building', { path: '12,21;26,21;26,29', depth: '4', width: '3' }, ctx);
  });

  it('refuses a path with a single waypoint', () => {
    expect(expectRefused({ path: '5,5', depth: '4', width: '3' })).toBe(t('mining.build_ramp.path_too_few'));
  });

  it.each(['abc', '5;5', '5,5;x,y', '5,5;,7'])('refuses malformed path %s with the usage text', (path) => {
    expect(expectRefused({ path, depth: '4', width: '3' })).toBe(t('mining.build_ramp.path_usage'));
  });

  it('refuses path combined with start/end', () => {
    expect(expectRefused({ ...ORDER, start: '5,5', end: '5,15' })).toBe(t('mining.build_ramp.path_conflict'));
  });

  it('refuses path combined with origin/direction/length', () => {
    expect(expectRefused({ ...ORDER, origin: '5,5', direction: 'south', length: '10' })).toBe(t('mining.build_ramp.path_conflict'));
  });

  it('refuses when cash is short', () => {
    const ctx = makeCtx();
    ctx.state!.cash = 10;
    expectRefusedFor('console.insufficient_funds', ORDER, ctx);
  });

  it('keeps width validation for paths', () => {
    expectRefusedFor('mining.build_ramp.invalid_width', { ...ORDER, width: '4' });
  });
});

describe('widen_ramp on a multi-leg ramp', () => {
  it('is refused with the wrapped multi_leg reason, charging nothing', () => {
    const ctx = makeCtx();
    buildRampCommand(ctx, [], ORDER);
    drive(ctx);
    const cash = ctx.state!.cash;
    const r = widenRampCommand(ctx, [], { id: '1', width: '5' });
    expect(r.success).toBe(false);
    expect(r.output).toBe(t('mining.widen_ramp.refused', { id: 1, reason: t('mining.widen_ramp.multi_leg') }));
    expect(ctx.state!.cash).toBe(cash);
    expect(ctx.state!.plannedRamps).toHaveLength(0);
  });
});

describe('multi-leg ramp i18n (#1939)', () => {
  const KEYS = [
    'mining.build_ramp.ordered_legs', 'mining.build_ramp.path_usage', 'mining.build_ramp.path_too_few',
    'mining.build_ramp.path_conflict', 'mining.build_ramp.leg_not_cardinal', 'mining.build_ramp.leg_too_short',
    'mining.build_ramp.legs_cross', 'mining.build_ramp.leg_hits_building', 'mining.build_ramp.grade_too_steep',
    'mining.build_ramp.grade_too_gentle', 'mining.build_ramp.grade_invalid', 'mining.widen_ramp.multi_leg',
    'inspector.ramp.legs', 'inspector.ramp.grade',
  ];
  const en = enLocale as Record<string, string>;
  const fr = frLocale as Record<string, string>;

  it.each(KEYS)('%s exists in en and fr and the two differ', (key) => {
    expect(en[key], `en ${key}`).toBeTruthy();
    expect(fr[key], `fr ${key}`).toBeTruthy();
    expect(fr[key]).not.toBe(en[key]);
  });
});
