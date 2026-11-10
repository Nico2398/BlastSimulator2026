// BlastSimulator2026 — Integration: the permit-following Blast Workshop defaults (#2101).
//
// A grade-0 site (the sandbox's permit) is limited to 40 kg and 144 m² of pattern a blast. The panel's untouched
// defaults used to overrun it: nine holes charged at the default drew a strike, and (with the kit explosive)
// overflowed the hole. The defaults now follow the permit, so a player who steps nothing fires a clean, legal
// blast: the Drill step opens at the grade-0 depth, and the Charge step at the stemming that keeps the holes,
// each filled with explosive up to it, inside the permit's kilograms.
// Played through the console as the panel would send it: a 3x3 grid at the grade-0 default depth, filled with the
// default explosive up to the grade-0 default stemming (no amount: Charge All fills every hole).

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { defaultGridDepthM, defaultStemmingM } from '../../src/core/economy/PermitDefaults.js';
import { permitLimitsFor, preFireCheck } from '../../src/core/economy/PermitLimits.js';
import { fillChargeKg, patternAreaM2 } from '../../src/core/mining/ChargePlan.js';
import type { DrillHole } from '../../src/core/mining/DrillPlan.js';
import {
  CHARGE_DEFAULT_STEMMING_M,
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
  stemmingM: number;
  depthM: number;
  holesAtFire: DrillHole[];
  chargesAtFire: GameState['chargesByHole'];
  planCheck: ReturnType<typeof preFireCheck>;
}

/** Sandbox start, then the untouched-defaults shot: drill, fill every hole up to the default stemming, fire. */
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
  const pad = flattestPad((ctx as GameContext).grid!, depthM);

  run(`drill_plan grid rows:${GRID_SIDE} cols:${GRID_SIDE} spacing:${SPACING_M} depth:${depthM} start:${pad.x0 + 1},${pad.z0 + 1}`);
  tickWhile(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  // The stemming the Charge step opens at, for the holes it sees (drilled and still planned).
  const stemmingM = defaultStemmingM(state.grade?.grade, [...state.drillHoles, ...state.plannedDrillHoles], DEFAULT_EXPLOSIVE);
  run(`charge hole:* explosive:${DEFAULT_EXPLOSIVE} stemming:${stemmingM}m`);
  tickWhile(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 1500);

  const holesAtFire = state.drillHoles.map(h => ({ ...h }));
  const chargesAtFire = { ...state.chargesByHole };
  const planCheck = preFireCheck(state.grade?.grade ?? 0, chargesAtFire, patternAreaM2(holesAtFire));

  clearBlastZone(run, state);
  run('blast detonate');
  tickWhile(run, state, () => state.lastBlastReport !== null, 600);
  return { state, outputs, stemmingM, depthM, holesAtFire, chargesAtFire, planCheck };
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
    expect(played.holesAtFire).toHaveLength(GRID_SIDE * GRID_SIDE);
    expect(Object.keys(played.chargesAtFire)).toHaveLength(GRID_SIDE * GRID_SIDE);
  }, T);

  it('the default stemming is raised above 2.5 m: filled at the default, the nine holes would overrun the permit', () => {
    const played = shot();
    const filledAt = (stemmingM: number): number =>
      played.holesAtFire.reduce((sum, h) => sum + fillChargeKg(h.depth, stemmingM, h.diameter, DEFAULT_EXPLOSIVE), 0);
    expect(filledAt(CHARGE_DEFAULT_STEMMING_M)).toBeGreaterThan(permitLimitsFor(0).maxChargeKg);
    expect(played.stemmingM).toBeGreaterThan(CHARGE_DEFAULT_STEMMING_M);
    expect(played.stemmingM).toBeLessThan(played.depthM);
  }, T);

  it('every hole is filled up to that stemming, and the charge command never reports a hole it cannot fill', () => {
    const played = shot();
    for (const h of played.holesAtFire) {
      const charge = played.chargesAtFire[h.id]!;
      expect(charge.explosiveId, h.id).toBe(DEFAULT_EXPLOSIVE);
      expect(charge.stemmingM, h.id).toBe(played.stemmingM);
      expect(charge.amountKg, h.id).toBe(fillChargeKg(h.depth, played.stemmingM, h.diameter, DEFAULT_EXPLOSIVE));
      expect(charge.amountKg, h.id).toBeGreaterThan(0);
    }
    const text = played.outputs.map(o => o.output).join('\n');
    expect(text).not.toMatch(/Maximum that fits/i);
    expect(text).not.toMatch(/overflows/i);
    expect(text).not.toMatch(/No room for explosive/i);
  }, T);

  it('the plan stays within the grade-0 permit before firing, in kilograms and in pattern area', () => {
    const played = shot();
    expect(played.planCheck.over).toBe(false);
    expect(played.planCheck.planKg).toBeLessThanOrEqual(played.planCheck.limits.maxChargeKg);
    expect(played.planCheck.planAreaM2).toBeLessThanOrEqual(played.planCheck.limits.maxAreaM2);
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
