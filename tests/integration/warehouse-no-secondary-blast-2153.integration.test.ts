// BlastSimulator2026 — Integration: destroying an explosive warehouse never triggers a secondary blast or crater (#2153)
//
// Warehouses hold no explosives, so a destroyed one is just a destroyed building: no detonation, no crater,
// no secondary-blast row on the report, ground unchanged. Fixture as the old #1896 suite: desert_badlands
// seed 42, single-hole pattern at (14,14), tier-1 warehouse dropped at (16,14) inside the cleared rock. A
// legacy `storedExplosives` written by hand (an old save) must stay inert.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { tickUntilFresh } from '../helpers/blastFixtures.js';

type Run = (cmd: string) => { success: boolean; output: string };

const WX = 16;
const WZ = 14;
const CX = WX + 1;
const CZ = WZ + 1;

interface Fired { state: GameState; grid: VoxelGrid; output: string }

function fire(legacyStockKg: number): Fired {
  const { runner, ctx } = createRunner();
  const run: Run = cmd => runner.run(cmd) as { success: boolean; output: string };
  expect(run('new_game mine_type:desert_badlands seed:42 size:32 staffed:true').success).toBe(true);
  const state = ctx.state!;
  state.cash = 5_000_000;
  state.finances.cash = 5_000_000;
  expect(run('drill_plan grid rows:1 cols:1 spacing:5 depth:8 start:14,14').success).toBe(true);
  tickUntilFresh(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  expect(state.drillHoles).toHaveLength(1);
  expect(run('charge hole:* explosive:krackle amount:6 stemming:2').success).toBe(true);
  tickUntilFresh(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 1500);
  expect(placeBuilding(state.buildings, 'explosive_warehouse', WX, WZ, 32, 32, 1).success).toBe(true);
  const wh = state.buildings.buildings.find(b => b.type === 'explosive_warehouse')!;
  if (legacyStockKg > 0) Object.assign(wh, { storedExplosives: { boomite: legacyStockKg } });
  for (const unit of [...state.employees.employees, ...state.vehicles.vehicles]) { unit.x = 2; unit.z = 2; }
  const res = run('blast');
  expect(res.success, res.output).toBe(true);
  expect(state.buildings.buildings.some(b => b.type === 'explosive_warehouse')).toBe(false);
  return { state, grid: ctx.grid!, output: res.output };
}

function surfaceSum(grid: VoxelGrid, radius: number): number {
  let sum = 0;
  for (let z = CZ - radius; z <= CZ + radius; z++) for (let x = CX - radius; x <= CX + radius; x++) {
    if (Math.hypot(x - CX, z - CZ) > radius) continue;
    sum += computeVoxelColumnSurfaceY(grid, x, z) ?? 0;
  }
  return sum;
}

/** Secondary-blast rows on the report: the field no longer exists in the type, so read it untyped. */
function legacyRows(state: GameState): unknown[] {
  return (state.lastBlastReport as unknown as { secondaryBlasts?: unknown[] }).secondaryBlasts ?? [];
}

describe('a destroyed warehouse is only a destroyed building (#2153)', () => {
  const plain = fire(0);
  const legacy = fire(400);

  it('records no secondary blast on the report, with or without a legacy field', () => {
    expect(legacyRows(plain.state)).toHaveLength(0);
    expect(legacyRows(legacy.state)).toHaveLength(0);
  });

  it('a legacy stock carves no crater: the ground matches the plain run', () => {
    expect(computeVoxelColumnSurfaceY(legacy.grid, CX, CZ)).toBe(computeVoxelColumnSurfaceY(plain.grid, CX, CZ));
    expect(surfaceSum(legacy.grid, 10)).toBe(surfaceSum(plain.grid, 10));
  });

  it('the blast output names no secondary blast or crater', () => {
    expect(legacy.output).not.toMatch(/secondary blast/i);
  });

  it('the destroyed warehouse is still recorded as a destroyed building', () => {
    expect(legacy.state.damage.accidents.filter(a => a.type === 'building_destroyed').length)
      .toBe(plain.state.damage.accidents.filter(a => a.type === 'building_destroyed').length);
  });
});
