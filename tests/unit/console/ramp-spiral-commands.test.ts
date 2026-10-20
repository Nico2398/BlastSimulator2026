// BlastSimulator2026 — Console: `ramp spiral` proposes and orders a spiral haul road (#1940)

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { tickCommand } from '../../../src/console/commands/events.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { computeRampCost } from '../../../src/core/mining/Ramp.js';
import { rampLegsOf, rampTotalLength } from '../../../src/core/mining/RampPath.js';
import {
  getSmoothTerrainSurfaceY, resolveExposedCompId, setVoxelColumnSurfaceHeight,
} from '../../../src/core/world/VoxelGrid.js';
import type { RunnerWithContext } from '../../../src/console/createRunner.js';

type GameContext = RunnerWithContext['ctx'];

const SIZE = 64;
const RIM_Y = 30;
/** Pit void: x,z in [PIT_MIN, PIT_MAX). 30 x 30 tiles. */
const PIT_MIN = 15;
const PIT_MAX = 45;
const PIT_DEPTH = 24;

/** Level the whole site to RIM_Y, then dig a rectangular pit PIT_DEPTH below it. */
function carveSquarePit(ctx: GameContext, min = PIT_MIN, max = PIT_MAX): void {
  const grid = ctx.grid!;
  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) {
      if (!grid.containsColumn(x, z)) continue;
      const target = x >= min && x < max && z >= min && z < max ? RIM_Y - PIT_DEPTH : RIM_Y;
      const compId = resolveExposedCompId(grid, x, z, target);
      setVoxelColumnSurfaceHeight(grid, x, z, target, compId);
    }
  }
}

const ENGINES = new WeakMap<GameContext, RunnerWithContext>();

function makeCtx(pit: [number, number] = [PIT_MIN, PIT_MAX]): GameContext {
  const engine = createRunner();
  const started = engine.runner.run(`new_game seed:1 size:${SIZE} staffed:true`);
  if (!started.success) throw new Error(started.output);
  const ctx = engine.ctx;
  ENGINES.set(ctx, engine);
  ctx.state!.cash = 10_000_000;
  carveSquarePit(ctx, pit[0], pit[1]);
  return ctx;
}

function run(ctx: GameContext, line: string) {
  return ENGINES.get(ctx)!.runner.run(line);
}

const FROM = `from:${PIT_MIN - 1},${(PIT_MIN + PIT_MAX) / 2}`;
const BASE = `ramp spiral ${FROM} depth:20 grade:15 width:3 dir:cw`;

function snapshot(ctx: GameContext) {
  return {
    cash: ctx.state!.cash,
    planned: ctx.state!.plannedRamps.length,
    actions: ctx.state!.pendingActions.length,
  };
}

describe('test fixture', () => {
  it('digs a level-rimmed pit', () => {
    const ctx = makeCtx();
    expect(getSmoothTerrainSurfaceY(ctx.grid!, 5, 5)).toBeGreaterThan(RIM_Y - 1.5);
    expect(getSmoothTerrainSurfaceY(ctx.grid!, 30, 30)).toBeLessThan(RIM_Y - PIT_DEPTH + 2);
  });
});

describe('ramp spiral ... preview', () => {
  it('prints the legs, total length and cost, and changes nothing', () => {
    setLocale('en');
    const ctx = makeCtx();
    const before = snapshot(ctx);
    const r = run(ctx, `${BASE} preview`);
    expect(r.success).toBe(true);
    expect(r.output).not.toMatch(/^mining\./);
    expect(snapshot(ctx)).toEqual(before);
    // total length of a 20 m drop at 15 degrees is at least 74 m
    const lengths = r.output.match(/\d+/g)!.map(Number);
    expect(lengths.some(n => n >= 74)).toBe(true);
    // cost shown for the length ordered
    expect(r.output).toMatch(/\d/);
  });

  it('lists every leg with its direction', () => {
    const ctx = makeCtx();
    const r = run(ctx, `${BASE} preview`);
    expect(r.success).toBe(true);
    expect(r.output).toMatch(/north|south|east|west/i);
  });

  it('shows the same total length the real order then uses', () => {
    const a = makeCtx();
    const b = makeCtx();
    const preview = run(a, `${BASE} preview`);
    run(b, BASE);
    const total = rampTotalLength(rampLegsOf(b.state!.plannedRamps[0]!.def));
    expect(preview.output).toContain(String(Math.round(total)));
  });

  it('works for ccw as well as cw', () => {
    const ctx = makeCtx();
    expect(run(ctx, `ramp spiral ${FROM} depth:20 grade:15 width:3 dir:ccw preview`).success).toBe(true);
  });

  it('defaults dir when none is given', () => {
    const ctx = makeCtx();
    expect(run(ctx, `ramp spiral ${FROM} depth:20 grade:15 width:3 preview`).success).toBe(true);
  });
});

describe('ramp spiral (order)', () => {
  it('orders a multi-leg PlannedRamp and charges the proposal cost', () => {
    const ctx = makeCtx();
    const before = ctx.state!.cash;
    const r = run(ctx, BASE);
    expect(r.success).toBe(true);
    expect(ctx.state!.plannedRamps).toHaveLength(1);
    const def = ctx.state!.plannedRamps[0]!.def;
    expect(def.legs!.length).toBeGreaterThanOrEqual(2);
    expect(def.width).toBe(3);
    const total = rampTotalLength(rampLegsOf(def));
    expect(total).toBeGreaterThanOrEqual(74);
    expect(before - ctx.state!.cash).toBeCloseTo(computeRampCost(total, 3), 6);
  });

  it('queues dig_ramp_segment actions', () => {
    const ctx = makeCtx();
    run(ctx, BASE);
    const segs = ctx.state!.pendingActions.filter(a => a.type === 'dig_ramp_segment');
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.length).toBe(ctx.state!.plannedRamps[0]!.segments.length);
  });

  it('records the requested depth on the planned def', () => {
    const ctx = makeCtx();
    run(ctx, BASE);
    expect(ctx.state!.plannedRamps[0]!.def.targetDepth).toBe(20);
  });

  it('cw and ccw orders differ in their leg sequence', () => {
    const a = makeCtx();
    const b = makeCtx();
    run(a, BASE);
    run(b, BASE.replace('dir:cw', 'dir:ccw'));
    expect(a.state!.plannedRamps[0]!.def.legs).not.toEqual(b.state!.plannedRamps[0]!.def.legs);
  });

  it('refuses when cash is short, charging and queuing nothing', () => {
    const ctx = makeCtx();
    ctx.state!.cash = 10;
    const before = snapshot(ctx);
    const r = run(ctx, BASE);
    expect(r.success).toBe(false);
    expect(snapshot(ctx)).toEqual(before);
  });

  it('can be driven to completion into one built ramp', () => {
    const ctx = makeCtx();
    run(ctx, BASE);
    for (let i = 0; i < 4000 && ctx.state!.plannedRamps.length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) emp.fatigue = 100;
      tickCommand(ctx, ['1'], {});
    }
    expect(ctx.state!.plannedRamps).toHaveLength(0);
    expect(ctx.state!.builtRamps).toHaveLength(1);
    expect(ctx.state!.builtRamps[0]!.def.legs!.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ramp spiral refusals', () => {
  it('a too-small pit refuses with both lengths, charging nothing', () => {
    const ctx = makeCtx([28, 36]);
    const before = snapshot(ctx);
    const r = run(ctx, `ramp spiral from:27,32 depth:20 grade:15 width:3 dir:cw`);
    expect(r.success).toBe(false);
    expect(snapshot(ctx)).toEqual(before);
    expect(r.output).not.toMatch(/^mining\./);
    // "This grade needs {needed} m of wall; this pit offers {offered} m."
    const nums = r.output.match(/\d+(?:\.\d+)?/g)!.map(Number);
    expect(nums.length).toBeGreaterThanOrEqual(2);
    expect(nums.some(n => n >= 74)).toBe(true);
    expect(r.output).toMatch(/needs/i);
    expect(r.output).toMatch(/offers/i);
  });

  it('refuses the same too-small pit in preview mode', () => {
    const ctx = makeCtx([28, 36]);
    const r = run(ctx, `ramp spiral from:27,32 depth:20 grade:15 width:3 preview`);
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/offers/i);
  });

  it('refuses a start tile on flat ground away from the pit', () => {
    const ctx = makeCtx();
    const before = snapshot(ctx);
    const r = run(ctx, 'ramp spiral from:3,3 depth:20 grade:15 width:3 dir:cw');
    expect(r.success).toBe(false);
    expect(snapshot(ctx)).toEqual(before);
    expect(r.output).not.toMatch(/^mining\./);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('prints usage when from is missing', () => {
    const ctx = makeCtx();
    const r = run(ctx, 'ramp spiral depth:20 grade:15 width:3');
    expect(r.success).toBe(false);
    expect(r.output).not.toMatch(/^mining\./);
    expect(r.output.length).toBeGreaterThan(0);
  });

  it('prints usage when depth is missing', () => {
    const ctx = makeCtx();
    const r = run(ctx, `ramp spiral ${FROM} grade:15 width:3`);
    expect(r.success).toBe(false);
    expect(r.output).not.toMatch(/^mining\./);
  });

  it('rejects a bad dir', () => {
    const ctx = makeCtx();
    const before = snapshot(ctx);
    const r = run(ctx, `ramp spiral ${FROM} depth:20 grade:15 width:3 dir:sideways`);
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/cw|ccw/);
    expect(snapshot(ctx)).toEqual(before);
  });

  it('rejects an invalid width', () => {
    const ctx = makeCtx();
    const r = run(ctx, `ramp spiral ${FROM} depth:20 grade:15 width:4`);
    expect(r.success).toBe(false);
    expect(r.output).not.toMatch(/^mining\./);
  });

  it('rejects a non-numeric grade', () => {
    const ctx = makeCtx();
    const r = run(ctx, `ramp spiral ${FROM} depth:20 grade:steep width:3`);
    expect(r.success).toBe(false);
    expect(r.output).not.toMatch(/^mining\./);
  });

  it('rejects an unknown ramp subcommand', () => {
    const ctx = makeCtx();
    expect(run(ctx, 'ramp helix').success).toBe(false);
  });

  it('refuses before a game exists', () => {
    expect(createRunner().runner.run(`${BASE} preview`).success).toBe(false);
  });
});
