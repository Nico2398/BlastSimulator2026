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
// (rows:1 cols:1 spacing:3 depth:6 diameter:0.089) with charge amount:3
// stemming:2 leaves exactly 3 NavGrid cells — (18,9), (19,10), (18,10) —
// climb-disconnected (NAV_CLEARANCE_VEHICLE_CELLS) from the freight_warehouse's
// approach cell, while most of the map stays reachable. The SAME site with
// amount:1 leaves nothing disconnected (non-regression guard). A ramp
// `start:27,9 end:17,9 depth:5`, carved by a crewed rock_digger, connects the
// pocket.
//
// Drives the real console command layer (createRunner): no DOM, no Three.js.

import { describe, it, expect } from 'vitest';
import type { GameState, PendingAction } from '../../src/core/state/GameState.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';
import {
  tickUntilFresh,
  isPocketCell,
  drillChargeAndBlast,
  crewRockDigger,
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
  expect(run('employee hire role:driver')).toMatchObject({ success: true });
  const fragmenterDriver = [...state.employees.employees].reverse().find(e => e.role === 'driver')!;
  expect(run(`employee assign_skill ${fragmenterDriver.id} skill:driving.rock_fragmenter level:5`)).toMatchObject({ success: true });
  expect(run('vehicle buy rock_fragmenter')).toMatchObject({ success: true });
  const rockFragmenter = state.vehicles.vehicles.find(v => v.type === 'rock_fragmenter')!;
  expect(run(`vehicle driver ${rockFragmenter.id} ${fragmenterDriver.id}`)).toMatchObject({ success: true });

  tickUntilFresh(run, state, () => false, 5); // let the rock_fragmenter driver board and clear its spawn tile

  expect(run('employee hire role:driver')).toMatchObject({ success: true });
  const haulerDriver = [...state.employees.employees].reverse().find(e => e.role === 'driver' && e.id !== fragmenterDriver.id)!;
  expect(run('vehicle buy debris_hauler')).toMatchObject({ success: true });
  const debrisHauler = state.vehicles.vehicles.find(v => v.type === 'debris_hauler')!;
  expect(run(`vehicle driver ${debrisHauler.id} ${haulerDriver.id}`)).toMatchObject({ success: true });

  expect(run('build freight_warehouse at:1,8')).toMatchObject({ success: true });
  tickUntilFresh(run, state, () => state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active), 400);
  expect(state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active)).toBe(true);
  // One tier-1 warehouse holds 2000 kg, less than this blast's reachable debris: without ample room the hauler stops on "storage full" and the queue never drains to just the pocket. Capacity is not what these tests probe.
  state.logistics.storageCapacityKg = 1_000_000;
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
      const { run, state } = drillChargeAndBlast(18, 10, 3, 5_000_000);
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
      const { run, state } = drillChargeAndBlast(18, 10, 3, 5_000_000);
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

      const storedBeforeRamp = state.logistics.storedMassKg;
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
      expect(state.logistics.storedMassKg - storedBeforeRamp).toBeGreaterThanOrEqual(strandedMassKg - 1e-6);
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
