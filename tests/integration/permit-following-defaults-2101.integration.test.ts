// BlastSimulator2026 — Integration: the permit-following Blast Workshop defaults (#2101).
//
// A grade-0 site (the sandbox's permit) is limited to nine holes and 40 kg a blast. The panel's
// untouched defaults used to be 8 m holes and 7 kg a hole: nine holes charged at the default
// overran the permit, drew a strike, and (with the kit explosive) overflowed the hole. The
// defaults now follow the permit, so a player who steps nothing fires a clean, legal blast.
// Played through the console as the panel would send it: a 3x3 grid at the grade-0 default
// depth, charged at the grade-0 default amount of the default explosive.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { defaultChargeKg, defaultGridDepthM } from '../../src/core/economy/PermitDefaults.js';
import { preFireCheck } from '../../src/core/economy/PermitLimits.js';
import {
  CHARGE_DEFAULT_STEMMING_M,
  DRILL_HOLE_DEFAULT_DIAMETER_M,
  EXPLOSIVE_DELIVERY_TICKS,
  SANDBOX_FLAT_PAD_SIZE,
} from '../../src/core/config/balance.js';
import { fundForDeliveryWait, clearBlastZone } from '../helpers/playthrough.js';

const BIOME = 'desert_badlands';
const DEFAULT_EXPLOSIVE = 'boomite';
const GRID_SIDE = 3;
const SPACING_M = 4;

function refresh(state: GameState): void {
  fundForDeliveryWait(state);
  for (const e of state.employees.employees) e.fatigue = 100;
}

function tickWhile(run: (c: string) => unknown, state: GameState, until: () => boolean, max: number): void {
  for (let n = 0; n < max && !until(); n++) { refresh(state); run('tick 1'); }
}

/** Flattest ore-bearing pad of the grid, where the sandbox guarantees a flat drill site. */
function flattestPad(grid: VoxelGrid, depthM: number): { x0: number; z0: number } {
  const size = SANDBOX_FLAT_PAD_SIZE;
  let best = { x0: 0, z0: 0, spread: Infinity };
  for (let x0 = 0; x0 + size <= grid.sizeX; x0 += 3) {
    for (let z0 = 0; z0 + size <= grid.sizeZ; z0 += 3) {
      let lo = Infinity, hi = -Infinity, oreCells = 0;
      for (let x = x0; x < x0 + size; x++) for (let z = z0; z < z0 + size; z++) {
        const y = computeVoxelColumnSurfaceY(grid, x, z)!;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
        for (let d = 0; d < depthM; d++) if (grid.oresAt(x, y - d, z)) oreCells++;
      }
      if (oreCells > 0 && hi - lo < best.spread) best = { x0, z0, spread: hi - lo };
    }
  }
  return best;
}

interface Played {
  state: GameState;
  outputs: { command: string; success: boolean; output: string }[];
  chargeKg: number;
  depthM: number;
  holesAtFire: number;
  chargesAtFire: GameState['chargesByHole'];
  planCheck: ReturnType<typeof preFireCheck>;
}

/** Sandbox start, then the untouched-defaults shot: drill, charge, fire. */
function playDefaultShot(seed: number, kit: 'full' | 'digger'): Played {
  const { runner, ctx } = createRunner();
  const outputs: Played['outputs'] = [];
  const run = (command: string) => {
    const res = runner.run(command);
    outputs.push({ command, success: res.success, output: res.output });
    return res;
  };
  expect(run(`sandbox start biome:${BIOME} kit:${kit} seed:${seed}`)).toMatchObject({ success: true });
  const state = (ctx as GameContext).state!;
  state.events.eventFreqMultiplier = 0; // a pending event halts `tick`
  refresh(state);

  const depthM = defaultGridDepthM(state.grade?.grade);
  const chargeKg = defaultChargeKg(
    state.grade?.grade, GRID_SIDE * GRID_SIDE, depthM, CHARGE_DEFAULT_STEMMING_M, DRILL_HOLE_DEFAULT_DIAMETER_M,
  );
  const pad = flattestPad((ctx as GameContext).grid!, depthM);

  run(`drill_plan grid rows:${GRID_SIDE} cols:${GRID_SIDE} spacing:${SPACING_M} depth:${depthM} start:${pad.x0 + 1},${pad.z0 + 1}`);
  tickWhile(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  run(`charge hole:* explosive:${DEFAULT_EXPLOSIVE} amount:${chargeKg}kg stemming:${CHARGE_DEFAULT_STEMMING_M}m`);
  tickWhile(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, EXPLOSIVE_DELIVERY_TICKS + 1500);

  const holesAtFire = state.drillHoles.length;
  const chargesAtFire = { ...state.chargesByHole };
  const planCheck = preFireCheck(state.grade?.grade ?? 0, chargesAtFire, holesAtFire);

  clearBlastZone(run, state);
  run('blast detonate');
  tickWhile(run, state, () => state.lastBlastReport !== null, 600);
  return { state, outputs, chargeKg, depthM, holesAtFire, chargesAtFire, planCheck };
}

describe.each([
  { seed: 42, kit: 'full' as const },
  { seed: 12345, kit: 'digger' as const },
])('untouched permit defaults on desert_badlands seed $seed, $kit kit (#2101)', ({ seed, kit }) => {
  // Memoised per describe block; computed inside the first test so a failure reports per test.
  let cached: Played | undefined;
  const shot = (): Played => (cached ??= playDefaultShot(seed, kit));
  const T = 600_000;

  it('every command of the shot succeeds', () => {
    const played = shot();
    const failed = played.outputs.filter(o => !o.success);
    expect(failed, failed.map(f => `${f.command} -> ${f.output}`).join('\n')).toEqual([]);
  }, T);

  it('drills nine holes and charges every one of them', () => {
    const played = shot();
    expect(played.holesAtFire).toBe(GRID_SIDE * GRID_SIDE);
    expect(Object.keys(played.chargesAtFire)).toHaveLength(GRID_SIDE * GRID_SIDE);
  }, T);

  it('the charge command never reports the amount overflowing a hole', () => {
    const played = shot();
    const text = played.outputs.map(o => o.output).join('\n');
    expect(text).not.toMatch(/Maximum that fits/i);
    expect(text).not.toMatch(/overflows/i);
    expect(text).not.toMatch(/at most \d+(\.\d+)? kg fits/i);
  }, T);

  it('the plan stays within the grade-0 permit before firing', () => {
    const played = shot();
    expect(played.planCheck.over).toBe(false);
    expect(played.planCheck.planKg).toBeLessThanOrEqual(played.planCheck.limits.maxChargeKg);
    expect(played.planCheck.planHoles).toBeLessThanOrEqual(played.planCheck.limits.maxHoles);
  }, T);

  it('firing draws no permit strike', () => {
    const played = shot();
    expect(played.state.grade?.strikeTicks ?? []).toEqual([]);
  }, T);

  it('the blast clears rock and is not rated bad', () => {
    const played = shot();
    const report = played.state.lastBlastReport;
    expect(report).not.toBeNull();
    expect(report!.clearedVoxels).toBeGreaterThan(0);
    expect(report!.rating).not.toBe('bad');
  }, T);
});
