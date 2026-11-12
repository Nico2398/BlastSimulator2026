// BlastSimulator2026 — Integration: freight warehouse capacity is sized to the
// ore a good Dusty Hollow blast actually produces (#1531).
//
// Reference shot: `campaign start level:dusty_hollow seed:1138`, one 6 m hole at rig+(14,13)
// filled with boomite up to 4 m of stemming (see REFERENCE_STEMMING_M), auto sequence, hole dry.
// Barren rock goes to a spoil heap (#1530), so only the ORE-BEARING mass has to fit a warehouse.
// Measured on that shot under the kernel energy model: ~48,600 kg ore-bearing (the old 1x2
// pattern of 2.2 kg partial charges measured ~45,900 kg before it; under the kernel those
// small bottom charges only crack 18 voxels loose).
//
// #1574: the level now opens with a spoil heap, which shifts when the rig
// reaches the pattern and so which weather window the holes sit in. The old
// 2x2 shot (~57 t) was a wet-hole fizzle (28 voxels cleared); dry it clears
// 240 voxels (~455 t), far past any tier-1/2 depot sized for one early
// shot. The test therefore dries the holes (a weather-independent shot) and
// uses the 1x2 pattern whose dry yield is the same order as the shot the
// capacities were sized on. A tier-2 warehouse must hold the whole shot, a tier-1 must be a
// meaningful fraction of it yet still take the biggest single boulder, and a
// tier-3 must have ample headroom.
//
// The ore mass is computed from the blast, never hardcoded. Capacities are
// read through getBuildingDef so a rebalance only edits balance.ts.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { recordProfit } from '../../src/core/campaign/Campaign.js';
import { FREIGHT_WAREHOUSE_CAPACITY_KG } from '../../src/core/config/balance.js';
import { getBuildingDef } from '../../src/core/entities/Building.js';
import { isBarrenFragment } from '../../src/core/economy/SpoilHeaps.js';
import { haulBlockedReason } from '../../src/core/economy/HaulDispatch.js';
import { refreshLogisticsCapacity } from '../../src/core/engine/BuildingTaskHelpers.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { tickUntil, clearBlastZone, type Run, fundForDeliveryWait } from '../helpers/playthrough.js';

const cap = (tier: 1 | 2 | 3) => getBuildingDef('freight_warehouse', tier).capacity;

interface Shot {
  run: Run;
  state: GameState;
  oreMassKg: number;
  largestOreKg: number;
  oreIds: number[];
}

/**
 * Stemming (m) the reference hole is filled up to: 2 m of boomite (4 kg) in the 6 m hole, a good shot
 * (rated perfect, ~48.6 t of ore-bearing rock) at the order of magnitude a tier-1/2 depot is meant to
 * take. Filled to the default 2.5 m, two such holes break ~240 t, far past any tier-1/2 depot — a
 * depot is sized to an early shot's ore, not to the biggest one.
 */
const REFERENCE_STEMMING_M = 4;

/** Ticks of hauling the verification slice runs (enough for several trips). */
const HAUL_SLICE_TICKS = 400;

let shot: Shot;

/** Hire a driver licensed for the rock_fragmenter and give it one, so oversized ore gets split for the hauler. */
function crewRockFragmenter(run: Run, state: GameState): void {
  expect(run('employee hire role:driver').success).toBe(true);
  const driver = state.employees.employees[state.employees.employees.length - 1]!;
  expect(run(`employee assign_skill ${driver.id} skill:driving.rock_fragmenter level:5`).success).toBe(true);
  expect(run('vehicle buy rock_fragmenter').success).toBe(true);
  const fragmenter = state.vehicles.vehicles.find((v) => v.type === 'rock_fragmenter')!;
  expect(run(`vehicle driver ${fragmenter.id} ${driver.id}`).success).toBe(true);
}

/** Fires the reference Dusty Hollow shot, `cols` holes filled with boomite up to `stemmingM`, and reads off its ore. */
function fireReferenceShot(cols: number, stemmingM: number): Shot {
  const { runner, ctx } = createRunner();
  const run: Run = (cmd) => runner.run(cmd);
  recordProfit(ctx.campaignProfile.campaign, 'tutorial_pit', 5000);
  expect(run('campaign start level:dusty_hollow seed:1138').success).toBe(true);
  const state = ctx.state!;
  state.contracts.autoSell = false; state.contracts.autoClearRubble = false; // stock under test must not be sold off or cleared (#2145)
  run('time resume');

  // The warehouse the level opens with, raised to tier 2 (research gate skipped; capacity is the subject).
  const warehouse = state.buildings.buildings.find((b) => b.type === 'freight_warehouse')!;
  warehouse.tier = 2;
  refreshLogisticsCapacity(state);

  const rig = state.vehicles.vehicles.find((v) => v.type === 'drill_rig')!;
  const x = Math.round(rig.x) + 14;
  const z = Math.round(rig.z) + 13;
  expect(run(`drill_plan grid rows:1 cols:${cols} spacing:3 depth:6 start:${x},${z}`).success).toBe(true);
  tickUntil(run, state, 600, () => state.plannedDrillHoles.length === 0);
  fundForDeliveryWait(state); // the delivery wait (#1895) idles the crew on payroll; funding is not the subject
  run(`charge hole:* explosive:boomite stemming:${stemmingM}`);
  tickUntil(run, state, 600, () => Object.keys(state.plannedChargesByHole).length === 0);
  run('sequence auto');
  clearBlastZone(run, state);
  // A dry day: the shot must not depend on which weather window the rig reached the holes in.
  // Dried last, right before firing: water drained earlier is back by the time the zone clears.
  for (const hw of Object.values(state.holeWater)) hw.level = 0;
  expect(run('blast').success).toBe(true);

  const ore = state.logistics.fragments.filter((t) => !isBarrenFragment(t.fragment.oreDensities));
  return {
    run,
    state,
    oreMassKg: ore.reduce((sum, t) => sum + t.fragment.mass, 0),
    largestOreKg: Math.max(0, ...ore.map((t) => t.fragment.mass)),
    oreIds: ore.map((t) => t.fragment.id),
  };
}

beforeAll(() => {
  shot = fireReferenceShot(1, REFERENCE_STEMMING_M);
}, 120_000);

describe('freight warehouse capacity vs the reference Dusty Hollow blast (#1531)', () => {
  it('the reference blast yields ore-bearing rock', () => {
    expect(shot.oreIds.length).toBeGreaterThan(0);
    expect(shot.oreMassKg).toBeGreaterThan(0);
  });

  it('a tier-2 warehouse holds the whole ore-bearing mass of the blast', () => {
    expect(shot.oreMassKg).toBeLessThanOrEqual(cap(2));
  });

  it('a tier-1 warehouse holds between 25% and 100% of the ore-bearing mass (a real but partial depot)', () => {
    expect(cap(1)).toBeGreaterThanOrEqual(0.25 * shot.oreMassKg);
    expect(cap(1)).toBeLessThan(shot.oreMassKg);
  });

  it('a tier-3 warehouse has at least 3x the ore-bearing mass of headroom', () => {
    expect(cap(3)).toBeGreaterThanOrEqual(3 * shot.oreMassKg);
  });

  it('the largest single ore fragment fits a tier-1 warehouse', () => {
    expect(shot.largestOreKg).toBeLessThanOrEqual(cap(1));
  });

  it('tiers strictly increase and the defs read FREIGHT_WAREHOUSE_CAPACITY_KG', () => {
    expect(cap(1)).toBeLessThan(cap(2));
    expect(cap(2)).toBeLessThan(cap(3));
    for (const tier of [1, 2, 3] as const) expect(cap(tier)).toBe(FREIGHT_WAREHOUSE_CAPACITY_KG[tier]);
  });

  it('with a tier-2 warehouse, a spoil heap and a crewed hauler the ore hauled so far is stored, never blocked on storage, and the rest still fits', () => {
    // The reference shot breaks out to the surface, so its rubble is reachable and gets hauled (#1774).
    const { run, state } = fireReferenceShot(1, REFERENCE_STEMMING_M);
    state.cash = 5_000_000; // wages over the haul must not bankrupt the mine and freeze it
    expect(state.logistics.storageCapacityKg).toBe(cap(2));
    expect(run('build spoil_heap at:30,30').success).toBe(true);
    crewRockFragmenter(run, state);

    // Oversized rock is split by the fragmenter into new fragments, so the ore-bearing set is re-read each time.
    const oreLeft = () => state.logistics.fragments.filter((t) => t.state !== 'stored' && !isBarrenFragment(t.fragment.oreDensities));
    const massOf = (list: { fragment: { mass: number } }[]) => list.reduce((sum, t) => sum + t.fragment.mass, 0);
    let storageFull = 0;
    // A full haul of ~49 t by one hauler takes thousands of ticks (minutes of wall clock): a bounded slice of it
    // proves the property, the invariant below extrapolates it to the rest.
    tickUntil(run, state, HAUL_SLICE_TICKS, () => {
      // Crew welfare is not what this probes: a long unrelieved haul must not end the level in a revolt.
      for (const e of state.employees.employees) { e.morale = 100; e.fatigue = 100; }
      for (const action of state.pendingActions) {
        if (haulBlockedReason(state, action) === 'storage_full') storageFull++;
      }
      return oreLeft().length === 0;
    });

    expect(state.levelEnded).toBe(false);
    expect(storageFull).toBe(0);
    expect(state.logistics.storedMassKg).toBeGreaterThan(0);
    expect(state.logistics.storedMassKg).toBeLessThanOrEqual(cap(2));
    // Room never runs out before the ore does: stored + still-to-haul ore fits the tier-2 capacity.
    expect(state.logistics.storedMassKg + massOf(oreLeft())).toBeLessThanOrEqual(cap(2));
  }, 300_000);
});
