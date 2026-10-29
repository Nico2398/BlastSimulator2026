// BlastSimulator2026 — Integration: opening-kit blast, ramp, haul (#1719).
//
// The Normal sandbox opening kit (no fragmenter, no staffed:true) fires a 3x3
// shot, then orders a ramp into the crater. A ramp layer's work target is its
// band centre; when that sits over the crater the digger cannot stand there
// and the last layers stayed `target_unreachable` forever, so the ramp never
// finished and almost none of the ore was hauled (2-12 t). The lead layer must
// retarget to the reachable column nearest its centre.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { isOversized } from '../../src/core/mining/BlastCalc.js';
import { accumulateOreMass } from '../../src/core/mining/BlastOreReport.js';
import { FREIGHT_WAREHOUSE_CAPACITY_KG, EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';
import { assertWorldInvariants } from '../../src/core/state/WorldInvariants.js';
import { fundForDeliveryWait } from '../helpers/playthrough.js';
import { findPath } from '../../src/core/nav/Pathfinding.js';
import { NavGrid, isStepClimbable } from '../../src/core/nav/NavGrid.js';
import { NAV_MAX_SLOPE_RATIO } from '../../src/core/config/balance.js';
import { defineRampSegments, carveRampSegment, type RampDef } from '../../src/core/mining/Ramp.js';
import { rampCenterline } from '../../src/core/mining/RampPath.js';
import { getAllBiomes } from '../../src/core/world/BiomeCatalog.js';

const SEED = 42;
// Hauled tonnage is the subject, so the site keeps its full ore grade (ore_grade:1); the sandbox default 0.08 (#1944) thins the ore this test counts.
// Ore on the desert seed 42 site sits in discrete deposits (#1682); (30,-4) is
// barren, so a shot there can never feed storage or the ore tally. This one
// opens the deposit centred near (40,33).
const SHOT_START = '36,30';
// Re-measured (#2115): the one driver also crews the fragmenter, so the west ramp finishes at ~684 ticks (east ~435), was under 600.
const RAMP_SETUP_TICKS = 750;
const HAUL_WINDOW_TICKS = 800;
const MIN_HAULED_SHARE = 0.3;
const MIN_ORDERED_SHARE = 0.8;
const MAX_STUCK_TICKS = 25;
/** The opening kit's tier-1 freight warehouse is what binds the haul: ore stops once it is full. */
const KIT_STORAGE_KG = FREIGHT_WAREHOUSE_CAPACITY_KG[1];
const MIN_STORAGE_FILL_SHARE = 0.8;
/** Upper end of what the kit stored before the fix (2-12 t); delivered ore must beat it. */
const OLD_STUCK_BASELINE_KG = 12_000;

/** Ramp orders per side, with the rim tile behind the top, the first ramp tile and the crater-floor end tile. */
const RAMP_ORDER = {
  west: 'start:12,34 end:34,34 depth:6',
  east: 'start:62,34 end:46,34 depth:3',
} as const;
const RAMP_GEOMETRY = {
  west: { rim: { x: 9, z: 34 }, behind: { x: 11, z: 34 }, first: { x: 12, z: 34 }, end: { x: 34, z: 34 }, depth: 6, length: 22 },
  east: { rim: { x: 65, z: 34 }, behind: { x: 63, z: 34 }, first: { x: 62, z: 34 }, end: { x: 46, z: 34 }, depth: 3, length: 16 },
} as const;

function refresh(state: GameState): void {
  fundForDeliveryWait(state);
  for (const e of state.employees.employees) e.fatigue = 100;
}

function tickWhile(run: (c: string) => unknown, state: GameState, until: () => boolean, max: number, each?: () => void): number {
  let n = 0;
  for (; n < max && !until(); n++) { refresh(state); run('tick 1'); each?.(); }
  return n;
}

/** Ore mass delivered to storage. Barren rock goes to the spoil heap and never counts; stored ore is this same tally, so nothing is added twice. */
const oreKg = (state: GameState): number =>
  Object.values(state.collectedOre).reduce((a, b) => a + b, 0);

function openingKitHaul(side: 'west' | 'east') {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:desert_badlands difficulty:normal seed:${SEED} ore_grade:1`)).toMatchObject({ success: true });
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0; // a pending event halts `tick`; hauling pace is under test
  refresh(state);

  expect(run(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${SHOT_START}`)).toMatchObject({ success: true });
  tickWhile(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  expect(run('charge hole:* explosive:krackle amount:6 stemming:2')).toMatchObject({ success: true });
  tickWhile(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, EXPLOSIVE_DELIVERY_TICKS + 1500);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickWhile(run, state, () => state.lastBlastReport !== null, 600);
  expect(state.lastBlastReport).not.toBeNull();

  const haulable = state.logistics.fragments.filter(f => !isOversized(f.fragment.volume));
  const haulableOre: Record<string, number> = {};
  for (const f of haulable) accumulateOreMass(haulableOre, f.fragment.volume, f.fragment.oreDensities);
  const haulableOreKg = Object.values(haulableOre).reduce((a, b) => a + b, 0);

  // Counted from the blast (#2115): the kit's fragmenter breaks the boulders up during
  // the ramp, so the warehouse can fill before the ramp is done.
  const baseline = oreKg(state);
  const storedBefore = state.logistics.storedMassKg;

  // Ramp depth is measured from the start surface and must land on the crater
  // floor (~9.5 m): the west start sits near 16.5 m, the east one near 13.4 m (floor 10.5).
  const ramp = RAMP_ORDER[side];
  const firstTile = RAMP_GEOMETRY[side].first;
  const groundAtFirstTile = ctx.state!.navGrid!.cellAt(firstTile.x, firstTile.z)!.surfaceY!;
  expect(run(`build_ramp ${ramp}`)).toMatchObject({ success: true });
  const stuck = new Map<number, number>();
  let maxStuck = 0;
  const sample = () => {
    for (const a of state.pendingActions) {
      if (a.blockedReason === 'target_unreachable') {
        const n = (stuck.get(a.id) ?? 0) + 1;
        stuck.set(a.id, n);
        maxStuck = Math.max(maxStuck, n);
      } else stuck.delete(a.id);
    }
  };
  const rampTicks = tickWhile(run, state, () => !state.pendingActions.some(a => a.type === 'dig_ramp_segment'), RAMP_SETUP_TICKS, sample);

  tickWhile(run, state, () => false, HAUL_WINDOW_TICKS, sample);
  const hauledOreKg = oreKg(state) - baseline;
  const storedKg = state.logistics.storedMassKg - storedBefore;
  return { state, grid: ctx.grid!, groundAtFirstTile, haulableOreKg, rampTicks, maxStuck, hauledOreKg, storedKg, haulable };
}

describe.each(['west', 'east'] as const)('opening kit: blast, ramp from the %s, haul (#1719)', (side) => {
  let result: ReturnType<typeof openingKitHaul>;
  beforeAll(() => { result = openingKitHaul(side); }, 600_000);

  it('every ramp segment completes within the setup window', () => {
    const { state, rampTicks } = result;
    expect(rampTicks).toBeLessThan(RAMP_SETUP_TICKS);
    expect(state.pendingActions.filter(a => a.type === 'dig_ramp_segment')).toEqual([]);
    expect(state.builtRamps.length).toBe(1);
  });

  it('no order stays target_unreachable for more than a few ticks', () => {
    expect(result.maxStuck).toBeLessThanOrEqual(MAX_STUCK_TICKS);
  });

  it('most haulable debris is reachable (not debris_out_of_reach)', () => {
    const { state, haulable } = result;
    if (haulable.length === 0) throw new Error('blast produced no haulable fragments');
    const outOfReach = state.pendingActions.filter(a => a.blockedReason === 'debris_out_of_reach').length;
    expect((haulable.length - outOfReach) / haulable.length).toBeGreaterThanOrEqual(MIN_ORDERED_SHARE);
  });

  it('delivered ore runs until a real limit binds, well above the old stuck baseline', () => {
    const { hauledOreKg, haulableOreKg, storedKg } = result;
    expect(haulableOreKg).toBeGreaterThan(0);
    // The warehouse limits stored fragment mass (ore-bearing rock, not the ore kg inside it).
    expect(storedKg).toBeGreaterThanOrEqual(
      Math.min(MIN_HAULED_SHARE * haulableOreKg, MIN_STORAGE_FILL_SHARE * KIT_STORAGE_KG),
    );
    expect(hauledOreKg).toBeGreaterThan(OLD_STUCK_BASELINE_KG);
  });

  // #2043: the ramp's top joins the continuous ground, so a vehicle limited to the ramp's own grade can use it.
  it('the first ramp tile keeps the ground height it had before the ramp (no lip), and the step from the rim tile behind it is enterable at 30 degrees', () => {
    const nav = result.state.navGrid!;
    const g = RAMP_GEOMETRY[side];
    const behind = nav.cellAt(g.behind.x, g.behind.z)!.surfaceY!;
    const first = nav.cellAt(g.first.x, g.first.z)!.surfaceY!;
    // The step from the rim tile is the terrain's own gradient there (0.1 m west, 0.35 m east), not a ramp-made lip.
    expect(Math.abs(first - result.groundAtFirstTile), `first ramp tile moved ${result.groundAtFirstTile} -> ${first}`).toBeLessThanOrEqual(1e-6);
    expect(isStepClimbable(behind, first, 1, NAV_MAX_SLOPE_RATIO)).toBe(true);
  });

  it('a vehicle limited to the ramp grade drives from the rim to the crater floor over the carved ramp', () => {
    const nav = result.state.navGrid!;
    const g = RAMP_GEOMETRY[side];
    const ownGrade = g.depth / g.length + 0.03;
    const path = findPath(nav, {
      agentId: -1, fromX: g.rim.x, fromZ: g.rim.z, toX: g.end.x, toZ: g.end.z,
      avoidVehicles: false, maxSlopeRatio: ownGrade,
    });
    expect(path.found).toBe(true);
    const last = path.waypoints[path.waypoints.length - 1]!;
    expect(Math.hypot(last.x - g.end.x, last.z - g.end.z)).toBeLessThanOrEqual(1.5);
    // Every consecutive pair of waypoints is within the vehicle's limit, top step included.
    for (let i = 1; i < path.waypoints.length; i++) {
      const a = path.waypoints[i - 1]!;
      const b = path.waypoints[i]!;
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      expect(isStepClimbable(nav.cellAt(a.x, a.z)?.surfaceY, nav.cellAt(b.x, b.z)?.surfaceY, run, ownGrade)).toBe(true);
    }
  });

  it('world invariants hold', () => {
    expect(assertWorldInvariants(result.state)).toEqual([]);
  });
});

// #2043: the ramp's top must join the ground for every terrain, not just the opening-kit site.
describe('ramp top joins the ground across biomes and seeds (#2043)', () => {
  const SEEDS = [42, 7, 13, 101];
  const VEHICLE_LIMIT_DEGREES = 20;
  const MIN_DRIVEABLE_SHARE = 0.95;
  const RAMP: RampDef = { originX: 16, originZ: 34, direction: 'east', length: 30, targetDepth: 8, width: 3 };

  it('a 15 degree ramp is enterable and descends within a 20 degree vehicle limit on at least 95% of sites', () => {
    const limit = Math.tan((VEHICLE_LIMIT_DEGREES * Math.PI) / 180);
    const failures: string[] = [];
    let total = 0;
    for (const biome of getAllBiomes()) {
      for (const seed of SEEDS) {
        const { runner, ctx } = createRunner();
        expect(runner.run(`sandbox start biome:${biome.id} difficulty:normal seed:${seed}`)).toMatchObject({ success: true });
        const grid = ctx.grid!;
        for (const s of defineRampSegments(grid, RAMP)) carveRampSegment(grid, s);
        const nav = NavGrid.buildNavGrid(grid, [], []);
        const line = rampCenterline({ originX: RAMP.originX, originZ: RAMP.originZ, legs: [{ direction: 'east', length: RAMP.length }] });
        const tiles = [{ x: RAMP.originX - 1, z: RAMP.originZ }, ...line];
        let ok = true;
        for (let i = 1; i < tiles.length; i++) {
          const from = nav.cellAt(tiles[i - 1]!.x, tiles[i - 1]!.z)?.surfaceY;
          const to = nav.cellAt(tiles[i]!.x, tiles[i]!.z)?.surfaceY;
          if (!isStepClimbable(from, to, 1, limit)) { ok = false; break; }
        }
        total++;
        if (!ok) failures.push(`${biome.id}/${seed}`);
      }
    }
    expect((total - failures.length) / total, `undriveable: ${failures.join(', ')}`).toBeGreaterThanOrEqual(MIN_DRIVEABLE_SHARE);
  }, 300_000);
});
