// BlastSimulator2026 — Integration: a blast can leave debris sitting in a
// NavGrid region topologically disconnected from where ground crew operate.
// That is a LEGITIMATE, player-owned outcome (#1302, reversing the premise of
// #1231): debris is physically simulated and goes where it goes. Fragments are
// never moved, rejected or adjusted for reachability. The auto-generated
// haul_debris / fragment_debris work waits silently, stamped
// 'debris_out_of_reach' (never 'target_unreachable', which stays reserved for
// work the player explicitly ordered), and resumes on its own once the player
// connects the pocket (here: a ramp).
//
// Fixture (empirically traced on tutorial_pit): a single-hole blast at (18,10)
// (rows:1 cols:1 spacing:3 depth:6 diameter:0.089) with charge amount:5
// stemming:2 leaves exactly 9 NavGrid cells (POCKET_CELLS in blastFixtures) —
// amount:3 was used before the blast floored to grade (#1723): its extra
// pit-floor debris then parked a fragmenter on the pocket's rim cell, so the
// fixture moved to the 5 kg pocket, whose debris stays inside the pit —
// climb-disconnected (NAV_CLEARANCE_VEHICLE_CELLS) from the freight_warehouse's
// approach cell, while most of the map stays reachable. The SAME site with
// amount:1 leaves nothing disconnected (non-regression guard). A ramp
// `start:27,9 end:17,9 depth:5`, carved by a crewed rock_digger, connects the
// pocket.
//
// Drives the real console command layer (createRunner): no DOM, no Three.js.

import { createRunner } from '../../src/console/createRunner.js';
import { totalSpoilKg } from '../../src/core/economy/SpoilHeaps.js';
import { upgradeFreightWarehousesToTier3 } from '../helpers/freightWarehouse.js';
import { describe, it, expect } from 'vitest';
import { computeVoxelColumnSurfaceY } from '../../src/core/world/VoxelGrid.js';
import type { MiningContext } from '../../src/console/commands/mining/types.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { GENERATED_TERRAIN_GRID_SIZE_Y } from '../helpers/gameContext.js';
import type { GameState, PendingAction } from '../../src/core/state/GameState.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';
import {
  tickUntilFresh,
  isPocketCell,
  drillChargeAndBlast,
  drillGridChargeAndBlast,
  crewRockDigger,
  hireDriver,
} from '../helpers/blastFixtures.js';

/**
 * Crews a rock_fragmenter and a debris_hauler (mirrors economy-full-loop.json's
 * own ordering rationale: rock_fragmenter first and given a few ticks to
 * clear its spawn tile before the debris_hauler is purchased, so neither
 * vehicle ever blocks the other's spawn point), then orders and waits for an
 * active freight_warehouse at (1,8) — the same site economy-full-loop.json
 * builds at.
 */
function crewHaulingAndBuildDepot(run: (cmd: string) => unknown, state: GameState): void {
  hireDriver(run, state);
  const fragmenterDriver = [...state.employees.employees].reverse().find(e => e.role === 'driver')!;
  expect(run(`employee assign_skill ${fragmenterDriver.id} skill:driving.rock_fragmenter level:5`)).toMatchObject({ success: true });
  expect(run('vehicle buy rock_fragmenter')).toMatchObject({ success: true });
  const rockFragmenter = state.vehicles.vehicles.find(v => v.type === 'rock_fragmenter')!;
  expect(run(`vehicle driver ${rockFragmenter.id} ${fragmenterDriver.id}`)).toMatchObject({ success: true });

  tickUntilFresh(run, state, () => false, 5); // let the rock_fragmenter driver board and clear its spawn tile

  hireDriver(run, state);
  const haulerDriver = [...state.employees.employees].reverse().find(e => e.role === 'driver' && e.id !== fragmenterDriver.id)!;
  expect(run('vehicle buy debris_hauler')).toMatchObject({ success: true });
  const debrisHauler = state.vehicles.vehicles.find(v => v.type === 'debris_hauler')!;
  expect(run(`vehicle driver ${debrisHauler.id} ${haulerDriver.id}`)).toMatchObject({ success: true });

  expect(run('build freight_warehouse at:1,8')).toMatchObject({ success: true });
  tickUntilFresh(run, state, () => state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active), 400);
  expect(state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active)).toBe(true);
  // One tier-1 warehouse holds 2000 kg, less than this blast's reachable debris: without ample room the hauler stops on "storage full" and the queue never drains to just the pocket. Capacity is not what these tests probe, so the depot is upgraded to tier 3 (15000 kg).
  upgradeFreightWarehousesToTier3(state, 75_000);
  // Barren rock goes to a spoil heap, not the warehouse (#1530); crewless, so it lands at once.
  expect(run('build spoil_heap at:1,4')).toMatchObject({ success: true });
}

/** Every currently-queued debris action (haul_debris/fragment_debris) still sitting in pendingActions. */
function debrisActions(state: GameState): PendingAction[] {
  return state.pendingActions.filter(a => a.type === 'haul_debris' || a.type === 'fragment_debris');
}

/** Ticks until every remaining debris action is parked out of reach (the reachable part of the blast is fully hauled). */
function tickUntilOnlyStrandedDebrisRemains(run: (cmd: string) => unknown, state: GameState): void {
  tickUntilFresh(run, state, () => {
    const actions = debrisActions(state);
    return actions.length > 0 && actions.every(a => a.blockedReason === 'debris_out_of_reach');
  }, 1500);
}

describe('Blast debris left in an unreachable NavGrid pocket is a normal, player-owned state (#1302)', () => {
  it(
    "stamps debris_out_of_reach (never target_unreachable) on exactly the pocket's debris, leaves it queued where physics put it, while the reachable majority is hauled",
    () => {
      // Generous cash: wages over the long wait must not bankrupt the mine, which freezes it (#1313).
      const { run, state } = drillChargeAndBlast(18, 10, 5, 5_000_000);
      const placedAtBlast = new Map(state.logistics.fragments.map(f => [f.fragment.id, { ...f.fragment.position }]));
      expect(placedAtBlast.size).toBeGreaterThan(0);
      crewHaulingAndBuildDepot(run, state);

      tickUntilFresh(run, state, () => false, 3);
      expect(state.logistics.storedMassKg).toBe(0);

      const early = debrisActions(state);
      const pocketEarly = early.filter(a => isPocketCell(a.targetX, a.targetZ));
      const reachableEarly = early.filter(a => !isPocketCell(a.targetX, a.targetZ));
      expect(pocketEarly.length).toBeGreaterThan(0);
      expect(reachableEarly.length).toBeGreaterThan(0);
      for (const action of pocketEarly) {
        expect(action.blockedReason).toBe('debris_out_of_reach');
        expect(action.status).toBe('queued');
      }
      for (const action of reachableEarly) expect(action.blockedReason ?? null).toBeNull();
      // 'target_unreachable' is reserved for player-ordered work (#1302).
      expect(early.some(a => a.blockedReason === 'target_unreachable')).toBe(false);

      // The reachable majority genuinely gets hauled; what remains is only the pocket.
      tickUntilOnlyStrandedDebrisRemains(run, state);
      expect(state.logistics.storedMassKg).toBeGreaterThan(0);
      const remaining = debrisActions(state);
      expect(remaining.length).toBeGreaterThan(0);
      for (const action of remaining) {
        expect(isPocketCell(action.targetX, action.targetZ)).toBe(true);
        expect(action.blockedReason).toBe('debris_out_of_reach');
        expect(action.status).toBe('queued');
      }
      expect(state.pendingActions.some(a => a.blockedReason === 'target_unreachable')).toBe(false);

      // Stranded fragments are left exactly where the blast physics put them.
      const strandedStillOnGround = state.logistics.fragments.filter(f => f.state === 'on_ground' && placedAtBlast.has(f.fragment.id));
      expect(strandedStillOnGround.length).toBeGreaterThan(0);
      for (const tracked of strandedStillOnGround) {
        expect(tracked.fragment.position).toEqual(placedAtBlast.get(tracked.fragment.id));
      }

      // Waiting longer changes nothing: no hauling, no new stamp, no escalation.
      const storedBefore = state.logistics.storedMassKg;
      tickUntilFresh(run, state, () => false, 200);
      expect(state.logistics.storedMassKg).toBe(storedBefore);
      for (const action of debrisActions(state)) {
        expect(action.blockedReason).toBe('debris_out_of_reach');
      }
    },
    120000,
  );

  it(
    'starts hauling stranded debris once a ramp connects the pocket, and the debris_out_of_reach stamp clears',
    () => {
      // Generous cash: wages over the long wait for the plateau must not starve the ramp order.
      const { run, state } = drillChargeAndBlast(18, 10, 5, 5_000_000);
      crewHaulingAndBuildDepot(run, state);
      crewRockDigger(run, state); // crewed up front; it has no work until the ramp is ordered
      tickUntilOnlyStrandedDebrisRemains(run, state);

      const strandedCount = debrisActions(state).length;
      expect(strandedCount).toBeGreaterThan(0);
      const strandedIds = new Set(debrisActions(state).map(a => a.payload['fragmentId'] as number));
      // Haulable stranded mass recorded BEFORE the ramp (fragment_debris splits pieces, so assert on mass, not ids, at the end).
      const strandedMassKg = state.logistics.fragments
        .filter(f => strandedIds.has(f.fragment.id) && f.state === 'on_ground')
        .reduce((sum, f) => sum + f.fragment.mass, 0);
      expect(strandedMassKg).toBeGreaterThan(0);

      // Barren rock lands on the spoil heap, ore in the warehouse (#1530): count both.
      const hauledKg = (): number => state.logistics.storedMassKg + totalSpoilKg(state.buildings.buildings);
      const storedBeforeRamp = hauledKg();
      expect(run('build_ramp start:27,9 end:17,9 depth:5')).toMatchObject({ success: true });
      tickUntilFresh(run, state, () => !state.pendingActions.some(a => a.type === 'dig_ramp_segment'), 800);
      expect(state.pendingActions.some(a => a.type === 'dig_ramp_segment')).toBe(false);

      // Classification runs at the start of each employee tick, so the stamps from before the final segment completed
      // are refreshed one tick later. Let one pass run, then any stamp is a regression: the ramp connected the pocket for good.
      tickUntilFresh(run, state, () => false, 1);
      let sawOutOfReach = false;
      let sawTargetUnreachable = false;
      tickUntilFresh(run, state, () => {
        for (const a of state.pendingActions) {
          if (a.blockedReason === 'debris_out_of_reach') sawOutOfReach = true;
          if (a.blockedReason === 'target_unreachable') sawTargetUnreachable = true;
        }
        return debrisActions(state).length === 0;
      }, 4000);

      // The crew clears the whole pocket with no further order: no livelock on a repeating route.
      expect(debrisActions(state)).toHaveLength(0);
      expect(state.logistics.fragments.filter(f => f.state === 'on_ground' && isPocketCell(Math.round(f.fragment.position.x), Math.round(f.fragment.position.z)))).toHaveLength(0);
      expect(hauledKg() - storedBeforeRamp).toBeGreaterThanOrEqual(strandedMassKg - 1e-6);
      expect(sawOutOfReach).toBe(false);
      expect(sawTargetUnreachable).toBe(false);
      expectNoWorldInvariantViolations(state);
    },
    600000,
  );

  it(
    'stamps nothing on the SAME (18,10) site with a smaller charge (amount:1) whose entire debris field is reachable (non-regression)',
    () => {
      const { run, state } = drillChargeAndBlast(18, 10, 1);
      crewHaulingAndBuildDepot(run, state);

      tickUntilFresh(run, state, () => false, 3);

      const actions = debrisActions(state);
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(action.blockedReason).not.toBe('target_unreachable');
        expect(action.blockedReason).not.toBe('debris_out_of_reach');
      }

      tickUntilFresh(run, state, () => state.logistics.storedMassKg > 0, 400);
      expect(state.logistics.storedMassKg).toBeGreaterThan(0);

      for (const action of debrisActions(state)) {
        expect(action.blockedReason).not.toBe('debris_out_of_reach');
      }
    },
  );
});

// ── Floor to grade across a pattern (#1740) ──────────────────────────────────
// floorToGrade used to lift a hole's one-voxel breakout only beside a column floored in
// the SAME pass. At 4 m spacing the rock between holes is broken to grade by earlier
// passes, so every hole left a 1 m pit; at 3 m spacing breakout lines stayed as
// trenches. Both strand debris in pockets the crew cannot climb out of.

const FLAT_ROCK = { composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 };

/** Levels the whole site to the surface found at (18,10), so the blast starts from a flat site the crew can drive across. */
function flattenSite(ctx: MiningContext): number {
  const grid = ctx.grid!;
  const { minX, minZ, sizeX, sizeZ } = ctx.state!.world!;
  const maxX = minX + sizeX - 1;
  const maxZ = minZ + sizeZ - 1;
  const top = computeVoxelColumnSurfaceY(grid, 18, 10)!;
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      for (let y = 0; y < GENERATED_TERRAIN_GRID_SIZE_Y; y++) {
        if (y <= top) grid.setVoxel(x, y, z, FLAT_ROCK);
        else grid.clearVoxel(x, y, z);
      }
    }
  }
  // The NavGrid learns about a carve through this event, exactly as after a real blast.
  ctx.emitter.emit('terrain:updated', {
    region: { minX, maxX, minZ, maxZ, minY: 0, maxY: GENERATED_TERRAIN_GRID_SIZE_Y - 1 },
  });
  return top;
}

interface PatternBlast {
  run: (cmd: string) => unknown;
  state: GameState;
  grid: VoxelGrid;
  preSurfaceY: number;
  /** Post-blast surface Y of every column inside the pattern's bounding rectangle. */
  footprintSurfaces: number[];
}

function blastFlatPattern(spacing: number, amount: number): PatternBlast {
  let preSurfaceY = 0;
  const startX = 18 - spacing;
  const startZ = 10 - spacing;
  const { run, state, ctx } = drillGridChargeAndBlast({
    rows: 3, cols: 3, spacing, startX, startZ, amount,
    flatten: c => { preSurfaceY = flattenSite(c); },
  });
  const grid = ctx.grid!;
  const footprintSurfaces: number[] = [];
  for (let z = startZ; z <= startZ + 2 * spacing; z++) {
    for (let x = startX; x <= startX + 2 * spacing; x++) {
      footprintSurfaces.push(computeVoxelColumnSurfaceY(grid, x, z)!);
    }
  }
  return { run, state, grid, preSurfaceY, footprintSurfaces };
}

/** The crater floor: the surface height most footprint columns share. */
function craterFloorY(surfaces: number[]): number {
  const counts = new Map<number, number>();
  for (const y of surfaces) counts.set(y, (counts.get(y) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

describe('A 3x3 pattern floors to a flush crater at any spacing (#1740)', () => {
  // Charge per hole is sized so each spacing breaks one continuous crater (a lighter charge leaves unbroken pillars between holes).
  for (const { spacing, amount } of [{ spacing: 4, amount: 8 }, { spacing: 3, amount: 6 }]) {
    it(
      `${spacing} m spacing: no footprint column ends below the crater floor, and no debris is out of reach once a ramp reaches the crater`,
      () => {
        const { run, state, grid, preSurfaceY, footprintSurfaces } = blastFlatPattern(spacing, amount);
        // Pattern-edge columns the blast never reached still stand at the original surface; every column it did break must sit on one floor.
        const crater = footprintSurfaces.filter(y => y < preSurfaceY);
        const floorY = craterFloorY(crater);

        expect(floorY).toBeLessThan(preSurfaceY); // the blast really dug a crater
        const pits = crater.filter(y => y !== floorY);
        expect(pits, `columns off the crater floor ${floorY}: ${pits.join(',')}`).toHaveLength(0);

        // A ramp from the flat rim down to the floor: nothing in the crater may stay stamped out of reach.
        expect(computeVoxelColumnSurfaceY(grid, 18, 10)).toBe(floorY);
        crewHaulingAndBuildDepot(run, state);
        crewRockDigger(run, state);
        // The site is 32 m square: the ramp climbs out of the crater to the south rim, ending on the crater's last floor row.
        let rampEndZ = 10;
        while (computeVoxelColumnSurfaceY(grid, 18, rampEndZ + 1) === floorY) rampEndZ++;
        expect(run(`build_ramp start:18,${rampEndZ + 12} end:18,${rampEndZ} depth:${preSurfaceY - floorY}`)).toMatchObject({ success: true });
        tickUntilFresh(run, state, () => !state.pendingActions.some(a => a.type === 'dig_ramp_segment'), 1500);
        expect(state.pendingActions.filter(a => a.type === 'dig_ramp_segment')).toHaveLength(0);

        // Classification runs at the start of each employee tick: give it a pass after the last segment.
        // Debris thrown outside the pattern may land on the surrounding site; the ramp must serve the crater itself.
        const inCrater = (a: PendingAction): boolean =>
          a.targetX >= 18 - spacing && a.targetX <= 18 + spacing && a.targetZ >= 10 - spacing && a.targetZ <= 10 + spacing;
        const strandedInCrater = (): number =>
          state.pendingActions.filter(a => a.blockedReason === 'debris_out_of_reach' && inCrater(a)).length;
        tickUntilFresh(run, state, () => false, 2);
        tickUntilFresh(run, state, () => strandedInCrater() === 0, 1500); // the crew classifies a few pieces per tick
        expect(debrisActions(state).filter(inCrater).length).toBeGreaterThan(0);
        expect(strandedInCrater(), 'crater debris still stamped debris_out_of_reach after the ramp').toBe(0);
      },
      600000,
    );
  }
});

// ── 3 m breakout pockets (#1792) ─────────────────────────────────────────────
// #1740 lifted a one-voxel breakout only beside a column ending AT grade. At 3 m
// spacing a 2x2 pocket at the centre of four holes (or a line cell between two)
// has only sub-grade neighbours, so the pit survived and its rubble was stranded.
// Repro: sandbox desert_badlands seed 42, 3x3 Krackle 8 kg, spacing 3, depth 8,
// stemming 2.5 at (28,18); the pocket is cells (29-30, 22-23).

interface SandboxShot {
  run: (cmd: string) => ReturnType<ReturnType<typeof createRunner>['runner']['run']>;
  state: GameState;
  grid: VoxelGrid;
  tickWhile: (until: () => boolean, max: number) => void;
  /** Post-blast surface Y of every column the blast lowered. */
  craterSurfaces: number[];
}

/** Sandbox seed 42: 3x3 Krackle 8 kg, spacing 3, depth 8, stemming 2.5, starting at (startX, startZ). */
function blastSandboxPattern(biome: string, startX: number, startZ: number): SandboxShot {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:${biome} difficulty:normal seed:42 staffed:true`)).toMatchObject({ success: true });
  const state = ctx.state!;
  const grid = ctx.grid!;
  const refresh = (): void => {
    state.cash = Math.max(state.cash, 1_000_000);
    for (const e of state.employees.employees) e.fatigue = 100;
  };
  const tickWhile = (until: () => boolean, max: number): void => {
    for (let i = 0; i < max && !until(); i++) { refresh(); run('tick 1'); }
  };
  refresh();

  expect(run(`drill_plan grid rows:3 cols:3 spacing:3 depth:8 start:${startX},${startZ}`)).toMatchObject({ success: true });
  tickWhile(() => state.plannedDrillHoles.length === 0, 800);
  expect(run('charge hole:* explosive:krackle amount:8 stemming:2.5')).toMatchObject({ success: true });
  tickWhile(() => Object.keys(state.plannedChargesByHole).length === 0, 800);

  const before = new Map<string, number>();
  for (let z = startZ - 8; z < startZ + 22; z++) for (let x = startX - 10; x < startX + 22; x++) before.set(`${x},${z}`, computeVoxelColumnSurfaceY(grid, x, z)!);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickWhile(() => state.lastBlastReport !== null, 400);
  expect(state.lastBlastReport).not.toBeNull();

  const craterSurfaces: number[] = [];
  for (const [key, y0] of before) {
    const [x, z] = key.split(',').map(Number) as [number, number];
    const y = computeVoxelColumnSurfaceY(grid, x, z)!;
    if (y0 - y > 0) craterSurfaces.push(y);
  }
  return { run, state, grid, tickWhile, craterSurfaces };
}

describe('A 3 m pattern on desert seed 42 leaves no one-voxel pocket and no stranded debris (#1792)', () => {
  it(
    'no crater column ends under its neighbours\' floor, and no order stays debris_out_of_reach once a ramp reaches the crater',
    () => {
      const { run, state, grid, tickWhile, craterSurfaces } = blastSandboxPattern('desert_badlands', 28, 18);
      expect(craterSurfaces.length).toBeGreaterThan(20);
      const floorY = craterFloorY(craterSurfaces);
      const pits = craterSurfaces.filter(y => y < floorY);
      expect(pits, `crater columns under the floor ${floorY}: ${pits.join(',')}`).toHaveLength(0);
      for (const z of [22, 23]) {
        for (const x of [29, 30]) expect(computeVoxelColumnSurfaceY(grid, x, z), `pocket cell ${x},${z}`).toBe(floorY);
      }

      expect(run('build_ramp start:32,46 end:32,26 depth:8')).toMatchObject({ success: true });
      tickWhile(() => !state.pendingActions.some(a => a.type === 'dig_ramp_segment'), 3000);
      expect(state.pendingActions.filter(a => a.type === 'dig_ramp_segment')).toEqual([]);

      // Classification runs at the start of each employee tick: give it a pass after the last segment, then wait for the sweep.
      tickWhile(() => false, 2);
      const stranded = (): number => state.pendingActions.filter(a => a.blockedReason === 'debris_out_of_reach').length;
      tickWhile(() => stranded() === 0, 1500);
      expect(debrisActions(state).length).toBeGreaterThan(0);
      expect(stranded(), 'orders still stamped debris_out_of_reach after the ramp').toBe(0);
    },
    600000,
  );

  it('green foothills seed 42 at (28,28): every crater column reads one floor', () => {
    const { craterSurfaces } = blastSandboxPattern('green_foothills', 28, 28);
    expect(craterSurfaces.length).toBeGreaterThan(20);
    const floorY = craterFloorY(craterSurfaces);
    const off = craterSurfaces.filter(y => y !== floorY);
    expect(off, `crater columns off the floor ${floorY}: ${off.join(',')}`).toHaveLength(0);
    expect(floorY).toBe(9);
  }, 600000);
});
