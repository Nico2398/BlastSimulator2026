// BlastSimulator2026 — Integration: a stocked Explosive Warehouse destroyed by accident carves its own crater (#1896)
//
// #1394 made a destroyed stocked warehouse detonate and hurt what stands near it, but the
// ground stayed as it was. The detonation now goes through the blast pipeline: one synthetic
// hole at the footprint centre, charged with the stored explosives, so the broken rock becomes
// fragments the crew must haul and the nav grid / drawn terrain follow as after any blast.
// Damage radius and chaining are unchanged; a demolition does not detonate; an empty
// warehouse leaves the ground untouched.
//
// Fixture: desert_badlands seed 42 (size 32). A single-hole pattern at (14,14) is drilled and
// charged; a tier-1 warehouse (2x2) is then dropped at (16,14) — its footprint falls inside the
// cleared rock, so the blast destroys it (centre 17,15). Everything is evacuated first so the
// only terrain change under test is the crater.

import { describe, it, expect, afterEach } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { MiningContext } from '../../src/console/commands/mining/types.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { buildGameNavGrid } from '../../src/core/state/GameState.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { findPath } from '../../src/core/nav/Pathfinding.js';
import { setLocale } from '../../src/core/i18n/I18n.js';
import { EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';
import { tickUntilFresh } from '../helpers/blastFixtures.js';
import { equipDemolition, tickUntilDemolished } from '../helpers/demolition.js';

type Run = (cmd: string) => { success: boolean; output: string };

const WX = 16;
const WZ = 14;
/** Footprint centre of the tier-1 (2x2) warehouse at (WX, WZ). */
const CX = WX + 1;
const CZ = WZ + 1;
const NEAR = 6;

interface World { run: Run; state: GameState; ctx: MiningContext; grid: VoxelGrid }

afterEach(() => setLocale('en'));

/** Drilled + charged single-hole pattern at (14,14) with a warehouse at (WX,WZ) holding `stockKg` boomite; not yet fired. */
function prepare(stockKg: number): World {
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
  tickUntilFresh(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, EXPLOSIVE_DELIVERY_TICKS + 1500);
  expect(placeBuilding(state.buildings, 'explosive_warehouse', WX, WZ, 32, 32, 1).success).toBe(true);
  const wh = state.buildings.buildings.find(b => b.type === 'explosive_warehouse')!;
  if (stockKg > 0) wh.storedExplosives = { boomite: stockKg };
  for (const unit of [...state.employees.employees, ...state.vehicles.vehicles]) { unit.x = 2; unit.z = 2; }
  return { run, state, ctx, grid: ctx.grid! };
}

function fire(stockKg: number, locale: 'en' | 'fr' = 'en'): World & { out: string } {
  const w = prepare(stockKg);
  setLocale(locale);
  const res = w.run('blast');
  expect(res.success).toBe(true);
  expect(w.state.buildings.buildings.some(b => b.type === 'explosive_warehouse')).toBe(false);
  return { ...w, out: res.output };
}

/** Sum of column surface heights in a disc around the footprint centre: lower = more rock removed. */
function surfaceSum(grid: VoxelGrid, radius = NEAR): number {
  let sum = 0;
  for (let z = CZ - radius; z <= CZ + radius; z++) for (let x = CX - radius; x <= CX + radius; x++) {
    if (Math.hypot(x - CX, z - CZ) > radius) continue;
    sum += computeVoxelColumnSurfaceY(grid, x, z) ?? 0;
  }
  return sum;
}

interface CraterReportRow { buildingId: number; explosivesKg: number; craterVoxels: number; craterFragments: number }
function craterRows(state: GameState): CraterReportRow[] {
  return (state.lastBlastReport!.secondaryBlasts ?? []) as unknown as CraterReportRow[];
}

describe('stocked warehouse destroyed by a blast carves a crater (#1896)', () => {
  it('lowers the ground at the footprint compared with the same blast on an empty warehouse', () => {
    const stocked = fire(300);
    const empty = fire(0);
    expect(computeVoxelColumnSurfaceY(stocked.grid, CX, CZ)!).toBeLessThan(computeVoxelColumnSurfaceY(empty.grid, CX, CZ)!);
    expect(surfaceSum(stocked.grid)).toBeLessThan(surfaceSum(empty.grid));
  });

  it('records a secondary blast with a positive crater on the report', () => {
    const { state } = fire(300);
    const rows = craterRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.explosivesKg).toBe(300);
    expect(rows[0]!.craterVoxels).toBeGreaterThan(0);
    expect(rows[0]!.craterFragments).toBeGreaterThan(0);
  });

  it('a 400 kg stock breaks a bigger crater than a 100 kg stock', () => {
    const small = fire(100);
    const big = fire(400);
    expect(craterRows(big.state)[0]!.craterVoxels).toBeGreaterThan(craterRows(small.state)[0]!.craterVoxels);
    expect(surfaceSum(big.grid, 10)).toBeLessThan(surfaceSum(small.grid, 10));
  });

  it('an empty warehouse destroyed by the same blast leaves the ground and records no crater', () => {
    const empty = fire(0);
    expect(empty.state.lastBlastReport!.secondaryBlasts ?? []).toHaveLength(0);
    // the only difference from a stocked run is the crater: a second empty run is identical
    const again = fire(0);
    expect(surfaceSum(again.grid, 10)).toBe(surfaceSum(empty.grid, 10));
  });

  it('a demolished stocked warehouse does not detonate and leaves the ground', () => {
    const w = prepare(300);
    const before = surfaceSum(w.grid, 10);
    equipDemolition(w.ctx);
    const id = w.state.buildings.buildings.find(b => b.type === 'explosive_warehouse')!.id;
    expect(w.run(`build destroy ${id}`).success).toBe(true);
    tickUntilDemolished(w.ctx);
    expect(w.state.buildings.buildings.some(b => b.type === 'explosive_warehouse')).toBe(false);
    expect(surfaceSum(w.grid, 10)).toBe(before);
    expect(w.state.lastBlastReport).toBeNull();
    expect(w.state.damage.accidents.filter(a => a.type === 'building_destroyed')).toHaveLength(0);
  });
});

describe('crater fragments (#1896)', () => {
  it('adds the crater rock to the blast fragments with unique ids', () => {
    const w = fire(300);
    const fragments = w.ctx.lastBlastFragmentData!;
    const ids = fragments.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    // more fragments than the pattern's own blast reported: the crater's are merged in
    expect(fragments.length).toBeGreaterThan(w.state.lastBlastReport!.fragmentCount);
    expect(craterRows(w.state)[0]!.craterFragments).toBeGreaterThan(0);
  });

  it('adds no crater fragments for an empty warehouse', () => {
    const w = fire(0);
    expect(w.ctx.lastBlastFragmentData!.length).toBe(w.state.lastBlastReport!.fragmentCount);
  });

  it('a bigger stock leaves more fragments', () => {
    const small = fire(100);
    const big = fire(400);
    expect(big.ctx.lastBlastFragmentData!.length).toBeGreaterThan(small.ctx.lastBlastFragmentData!.length);
  });
});

describe('nav grid around the crater (#1896)', () => {
  function snapshot(state: GameState): string[] {
    const nav = state.navGrid!;
    const rows: string[] = [];
    for (let z = CZ - 8; z <= CZ + 8; z++) for (let x = CX - 8; x <= CX + 8; x++) {
      const c = nav.cellAt(x, z);
      rows.push(`${x},${z}:${c?.type}:${c?.surfaceY}`);
    }
    return rows;
  }

  it('the patched cells at the crater match a full rebuild', () => {
    const w = fire(300);
    const patched = snapshot(w.state);
    buildGameNavGrid(w.state, w.grid, w.state.buildings.buildings, w.state.drillHoles);
    expect(snapshot(w.state)).toEqual(patched);
  });

  it('the cell at the crater centre sits lower than after the empty-warehouse blast', () => {
    const stocked = fire(300);
    const empty = fire(0);
    const lowered = stocked.state.navGrid!.cellAt(CX, CZ)!.surfaceY!;
    expect(lowered).toBeLessThan(empty.state.navGrid!.cellAt(CX, CZ)!.surfaceY!);
    expect(lowered).toBe(computeVoxelColumnSurfaceY(stocked.grid, CX, CZ));
  });

  it('a path leads into the crater and across it', () => {
    const w = fire(300);
    const nav = w.state.navGrid!;
    const into = findPath(nav, { agentId: 1, fromX: 4, fromZ: 4, toX: CX, toZ: CZ, avoidVehicles: false });
    expect(into.found).toBe(true);
    const across = findPath(nav, { agentId: 1, fromX: CX - 5, fromZ: CZ, toX: CX + 5, toZ: CZ, avoidVehicles: false });
    expect(across.found).toBe(true);
  });
});

describe('player notice (#1896)', () => {
  it('names the warehouse, the stored kg and the crater in English', () => {
    const { out, state } = fire(300);
    const id = craterRows(state)[0]!.buildingId;
    const line = out.split('\n').find(l => l.includes(`#${id}`) && l.includes('300'));
    expect(line).toBeDefined();
    expect(line!.toLowerCase()).toContain('crater');
  });

  it('names the warehouse, the stored kg and the crater in French', () => {
    const { out, state } = fire(300, 'fr');
    const id = craterRows(state)[0]!.buildingId;
    const line = out.split('\n').find(l => l.includes(`#${id}`) && l.includes('300'));
    expect(line).toBeDefined();
    expect(line!.toLowerCase()).toContain('cratère');
  });

  it('prints no crater notice for an empty warehouse', () => {
    const { out } = fire(0);
    expect(out.toLowerCase()).not.toContain('crater');
  });
});
