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

import { totalSpoilKg } from '../../src/core/economy/SpoilHeaps.js';
import { upgradeFreightWarehousesToTier3 } from '../helpers/freightWarehouse.js';
import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { isFragmentSealed } from '../../src/core/economy/SealedFragments.js';
import { isAutoDebrisAction } from '../../src/core/economy/HaulDispatch.js';
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
    'stamps nothing on the SAME (18,10) site with a smaller charge (amount:1) that never breaks out (non-regression)',
    () => {
      // Since #1774 the 1 kg charge's rock stays sealed under its cap and gets no order at all, so
      // nothing can be stamped out of reach; and no 3 kg+ charge here is free of the pocket.
      const { run, state, grid } = drillChargeAndBlast(18, 10, 1);
      crewHaulingAndBuildDepot(run, state);
      const onGround = state.logistics.fragments.filter(f => f.state === 'on_ground');
      expect(onGround.length).toBeGreaterThan(0);
      expect(onGround.every(f => isFragmentSealed(grid, f.fragment.position))).toBe(true);

      for (let i = 0; i < 200; i++) {
        tickUntilFresh(run, state, () => false, 1);
        for (const action of state.pendingActions) {
          expect(action.blockedReason).not.toBe('target_unreachable');
          expect(action.blockedReason).not.toBe('debris_out_of_reach');
        }
      }
      expect(debrisActions(state)).toHaveLength(0);
      expect(state.logistics.storedMassKg).toBe(0);
    },
  );
});

// ── Rock sealed in a failed blast's void is not debris (#1774) ──────────────
//
// #1724 leaves a charge that fails to break out sealed under its intact cap.
// The dispatcher used to treat that rock as ordinary surface debris, so crews
// drove onto the cap and hauled the ore out through solid ground.

const SEALED_SEED = 42;
const SEALED_SHOT_START = '28,18';
const SEALED_WATCH_TICKS = 500;
const SEALED_DEPOT_AT = '10,10';
const SEALED_HEAP_AT = '10,16';

function topUp(state: GameState): void {
  state.cash = Math.max(state.cash, 5_000_000);
  for (const e of state.employees.employees) e.fatigue = 100;
}

function tickTopped(run: (cmd: string) => unknown, state: GameState, ticks: number, each?: () => void): void {
  for (let i = 0; i < ticks; i++) { topUp(state); run('tick 1'); each?.(); }
}

function tickToppedUntil(run: (cmd: string) => unknown, state: GameState, until: () => boolean, max: number): void {
  for (let i = 0; i < max && !until(); i++) { topUp(state); run('tick 1'); }
}

/** Drills, charges and fires a 3x3 Krackle pattern (spacing 4, depth 8) at SEALED_SHOT_START. */
function fireKrackleShot(run: (cmd: string) => unknown, state: GameState, amountKg: number): void {
  state.lastBlastReport = null;
  expect(run(`drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:${SEALED_SHOT_START}`)).toMatchObject({ success: true });
  tickToppedUntil(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  expect(state.plannedDrillHoles).toHaveLength(0);
  const chargeResult = run(`charge hole:* explosive:krackle amount:${amountKg} stemming:2`);
  expect(chargeResult).toMatchObject({ success: true });
  tickToppedUntil(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 1500);
  expect(Object.keys(state.plannedChargesByHole)).toHaveLength(0);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickToppedUntil(run, state, () => state.lastBlastReport !== null, 600);
  expect(state.lastBlastReport).not.toBeNull();
}

/** Ids of the fragments currently on the ground below their column's intact surface. */
function sealedFragmentIds(state: GameState, grid: VoxelGrid): Set<number> {
  const ids = new Set<number>();
  for (const f of state.logistics.fragments) {
    if (f.state === 'on_ground' && isFragmentSealed(grid, f.fragment.position)) ids.add(f.fragment.id);
  }
  return ids;
}

function ordersTargeting(state: GameState, fragmentIds: ReadonlySet<number>): PendingAction[] {
  return debrisActions(state).filter(a => fragmentIds.has(a.payload['fragmentId'] as number));
}

describe('Rock sealed under an intact cap is not debris work (#1774)', () => {
  it(
    'queues no haul or fragment order for the sealed rock, stores nothing, and hauls the rock of a later breakout blast',
    () => {
      const { runner, ctx } = createRunner();
      const run = (cmd: string) => runner.run(cmd);
      expect(run(`sandbox start biome:desert_badlands difficulty:normal seed:${SEALED_SEED} staffed:true`)).toMatchObject({ success: true });
      const state = ctx.state!;
      const grid = ctx.grid!;
      topUp(state);

      // Warehouse and spoil heap: staffed:true brings the crew, hauler and fragmenter but no buildings.
      const buildResult = run(`build freight_warehouse at:${SEALED_DEPOT_AT}`);
      expect(buildResult).toMatchObject({ success: true });
      tickToppedUntil(run, state, () => state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active), 600);
      expect(state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active)).toBe(true);
      expect(run(`build spoil_heap at:${SEALED_HEAP_AT}`)).toMatchObject({ success: true });

      // Sealed blast: 4 kg Krackle never breaks out of the 8 m holes.
      fireKrackleShot(run, state, 4);
      expect(state.lastBlastReport!.ratingCap).toBe('no_breakout');

      const sealed = sealedFragmentIds(state, grid);
      expect(sealed.size).toBeGreaterThan(0);
      // #1724's own criterion: every fragment sits under its column's surface.
      const onGround = state.logistics.fragments.filter(f => f.state === 'on_ground');
      expect(sealed.size).toBe(onGround.length);

      // Crew, hauler, fragmenter and warehouse run for 500 ticks; the sealed rock is never touched.
      let ordersSeen = 0;
      tickTopped(run, state, SEALED_WATCH_TICKS, () => { ordersSeen += ordersTargeting(state, sealed).length; });
      expect(state.vehicles.vehicles.some(v => v.type === 'debris_hauler')).toBe(true);
      expect(state.vehicles.vehicles.some(v => v.type === 'rock_fragmenter')).toBe(true);
      expect(ordersSeen).toBe(0);
      expect(state.pendingActions.filter(a => isAutoDebrisAction(a.type) && sealed.has(a.payload['fragmentId'] as number))).toHaveLength(0);
      expect(state.logistics.storedMassKg).toBe(0);
      expect(Object.values(state.collectedOre).reduce((a, b) => a + b, 0)).toBe(0);
      expect(state.logistics.fragments.filter(f => sealed.has(f.fragment.id) && f.state !== 'on_ground')).toHaveLength(0);

      // A breakout blast over the same void opens it: its rock is ordinary debris.
      // Fragment ids restart at 0 every blast, so earlier rock is told apart by identity, not id.
      const trackedBefore = new Set(state.logistics.fragments);
      fireKrackleShot(run, state, 10);
      expect(state.lastBlastReport!.ratingCap).not.toBe('no_breakout');
      const fresh = state.logistics.fragments.filter(f => !trackedBefore.has(f) && f.state === 'on_ground');
      expect(fresh.length).toBeGreaterThan(0);
      const open = new Set(fresh.filter(f => !isFragmentSealed(grid, f.fragment.position)).map(f => f.fragment.id));
      expect(open.size).toBeGreaterThan(0);

      tickTopped(run, state, 5);
      expect(ordersTargeting(state, open).length).toBeGreaterThan(0);
      // Barren rock lands on the spoil heap, ore in the warehouse (#1530): count both.
      const hauledKg = (): number => state.logistics.storedMassKg + totalSpoilKg(state.buildings.buildings);
      // The opened void also holds the earlier sealed rock, so wait on the breakout blast's own rock being picked up (or split by the fragmenter), not on any haul.
      const freshTracked = new Set(fresh);
      const freshStillOnGroundCount = (): number => state.logistics.fragments.filter(f => freshTracked.has(f) && f.state === 'on_ground').length;
      tickToppedUntil(run, state, () => hauledKg() > 0 && freshStillOnGroundCount() < fresh.length, 3000);
      expect(hauledKg()).toBeGreaterThan(0);
      const freshStillOnGround = freshStillOnGroundCount();
      expect(freshStillOnGround).toBeLessThan(fresh.length);
    },
    600000,
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
