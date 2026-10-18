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
import { FREIGHT_WAREHOUSE_CAPACITY_KG } from '../../src/core/config/balance.js';
import { assertWorldInvariants } from '../../src/core/state/WorldInvariants.js';

const SEED = 42;
// Ore on the desert seed 42 site sits in discrete deposits (#1682); (30,-4) is
// barren, so a shot there can never feed storage or the ore tally. This one
// opens the deposit centred near (40,33).
const SHOT_START = '36,30';
const RAMP_SETUP_TICKS = 600;
const HAUL_WINDOW_TICKS = 800;
const MIN_HAULED_SHARE = 0.3;
const MIN_ORDERED_SHARE = 0.8;
const MAX_STUCK_TICKS = 25;
/** The opening kit's tier-1 freight warehouse is what binds the haul: ore stops once it is full. */
const KIT_STORAGE_KG = FREIGHT_WAREHOUSE_CAPACITY_KG[1];
const MIN_STORAGE_FILL_SHARE = 0.8;
/** Upper end of what the kit stored before the fix (2-12 t); delivered ore must beat it. */
const OLD_STUCK_BASELINE_KG = 12_000;

function refresh(state: GameState): void {
  state.cash = Math.max(state.cash, 1_000_000);
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
  expect(run(`sandbox start biome:desert_badlands difficulty:normal seed:${SEED}`)).toMatchObject({ success: true });
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0; // a pending event halts `tick`; hauling pace is under test
  refresh(state);

  expect(run(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${SHOT_START}`)).toMatchObject({ success: true });
  tickWhile(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  expect(run('charge hole:* explosive:krackle amount:6 stemming:2')).toMatchObject({ success: true });
  tickWhile(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 1500);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickWhile(run, state, () => state.lastBlastReport !== null, 600);
  expect(state.lastBlastReport).not.toBeNull();

  const haulable = state.logistics.fragments.filter(f => !isOversized(f.fragment.volume));
  const haulableOre: Record<string, number> = {};
  for (const f of haulable) accumulateOreMass(haulableOre, f.fragment.volume, f.fragment.oreDensities);
  const haulableOreKg = Object.values(haulableOre).reduce((a, b) => a + b, 0);

  // Ramp depth is measured from the start surface and must land on the crater
  // floor (~9.5 m): the west start sits near 16.5 m, the east one near 13.4 m (floor 10.5).
  const ramp = side === 'west' ? 'start:12,34 end:34,34 depth:6' : 'start:62,34 end:46,34 depth:3';
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

  const baseline = oreKg(state);
  const storedBefore = state.logistics.storedMassKg;
  tickWhile(run, state, () => false, HAUL_WINDOW_TICKS, sample);
  const hauledOreKg = oreKg(state) - baseline;
  const storedKg = state.logistics.storedMassKg - storedBefore;
  return { state, haulableOreKg, rampTicks, maxStuck, hauledOreKg, storedKg, haulable };
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

  it('world invariants hold', () => {
    expect(assertWorldInvariants(result.state)).toEqual([]);
  });
});
