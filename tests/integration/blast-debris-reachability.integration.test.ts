// BlastSimulator2026 — Integration: a blast can leave debris (or any resource
// an employee is expected to walk to) sitting in a NavGrid region
// topologically disconnected from where ground crew operate, with no
// observable signal — issue #1231.
//
// Reproduction path taken: the EXACT original tutorial_pit blast plan
// scripts/scenario-defs/economy-full-loop.json used before PR #1233
// relocated it — `drill_plan grid rows:2 cols:2 spacing:3 depth:6
// start:10,10 diameter:0.089` — recovered from that PR's own diff
// (`git show a8d371f2 -- scripts/scenario-defs/economy-full-loop.json`).
// That PR's own commit message and the relocated step's `description` record
// a direct trace of this exact defect: the (10,10) grid's debris field
// landed in a NavGrid region of reach-size ~1508, climb-disconnected from
// the freight_warehouse's own ~3043-cell component, once #1197's diagonal
// corner-cutting fix closed the illegal hop that used to bridge them. Every
// one of that trace's ~217 pending haul_debris/fragment_debris actions sat
// in the disconnected pocket — not a partial split — confirmed permanent
// (not merely slow) by running 2000+ extra ticks with zero storedMassKg
// movement. #1231 gives that state a name: blockedReason ===
// 'target_unreachable'. The relocated (14,6) grid is this same file's
// non-regression guard: its debris shares the depot's own connected
// component and must never be flagged.
//
// Drives the real console command layer (createRunner), exactly the way
// tests/integration/collapse-vehicle-recovery.integration.test.ts and
// tests/integration/blast-report-modal-save-load.integration.test.ts do —
// no DOM, no Three.js, real ticks through the real tick pipeline (NavGrid is
// patched synchronously off the `terrain:updated` event the blast emits,
// NavGridSync.ts, so no extra rebuild delay is needed beyond ordinary ticks).

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';

/** Keeps every living employee's fatigue topped up so a long drill/haul run is never derailed by a needs collapse mid-drive (mirrors blast-report-modal-save-load.integration.test.ts's fireBlast helper). */
function refreshFatigue(state: GameState): void {
  for (const emp of state.employees.employees) emp.fatigue = 100;
}

/** Runs `tick 1` up to `maxTicks` times, refreshing fatigue every round, until `predicate()` holds. */
function tickUntilFresh(run: (cmd: string) => unknown, state: GameState, predicate: () => boolean, maxTicks: number): void {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    refreshFatigue(state);
    run('tick 1');
  }
}

/**
 * Hires a driller, licenses them for the drill_rig, drills+charges+sequences
 * a 2x2 grid at (startX, startZ) with the exact parameters
 * economy-full-loop.json used pre-#1233 (spacing:3 depth:6 diameter:0.089,
 * boomite amount:3 stemming:2), then detonates it. Returns the runner/state
 * plus a bound `run` so callers can continue driving ticks afterward.
 */
function drillChargeAndBlast(startX: number, startZ: number): { run: (cmd: string) => unknown; state: GameState } {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);

  expect(run('campaign start level:tutorial_pit cash:250000')).toMatchObject({ success: true });
  const state = ctx.state!;

  expect(run('employee hire role:driller')).toMatchObject({ success: true });
  const driller = state.employees.employees.find(e => e.role === 'driller')!;

  expect(run('vehicle buy drill_rig')).toMatchObject({ success: true });
  expect(run(`employee assign_skill ${driller.id} skill:driving.drill_rig level:1`)).toMatchObject({ success: true });

  expect(run(`drill_plan grid rows:2 cols:2 spacing:3 depth:6 start:${startX},${startZ} diameter:0.089`)).toMatchObject({ success: true });
  tickUntilFresh(run, state, () => state.plannedDrillHoles.length === 0, 400);
  expect(state.plannedDrillHoles.length).toBe(0);
  expect(state.drillHoles.length).toBe(4);

  expect(run('charge hole:* explosive:boomite amount:3 stemming:2')).toMatchObject({ success: true });
  tickUntilFresh(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 400);
  expect(Object.keys(state.plannedChargesByHole).length).toBe(0);

  expect(run('sequence auto')).toMatchObject({ success: true });
  expect(run('blast')).toMatchObject({ success: true });
  expect(state.lastBlastReport).not.toBeNull();

  return { run, state };
}

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
  expect(run(`employee assign_skill ${fragmenterDriver.id} skill:driving.excavator level:5`)).toMatchObject({ success: true });
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
}

/** Every currently-queued debris action (haul_debris/fragment_debris) still sitting in pendingActions. */
function debrisActions(state: GameState) {
  return state.pendingActions.filter(a => a.type === 'haul_debris' || a.type === 'fragment_debris');
}

describe('Blast debris left in an unreachable NavGrid pocket (#1231)', () => {
  it(
    "flags every debris action at the ORIGINAL pre-#1197-relocation blast site (10,10) with blockedReason 'target_unreachable', and none is ever worked",
    () => {
      const { run, state } = drillChargeAndBlast(10, 10);
      crewHaulingAndBuildDepot(run, state);

      // One more small, bounded round beyond the depot's own wait_until above
      // — the NavGrid was already patched synchronously by the blast itself
      // (NavGridSync's `terrain:updated` subscription), so this is only for
      // tickEmployees' classification pass (EmployeeDispatch.ts) to run at
      // least once against a depot that now actually exists.
      tickUntilFresh(run, state, () => false, 3);

      const actions = debrisActions(state);
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(action.blockedReason).toBe('target_unreachable');
        expect(action.status).toBe('queued');
      }

      // Prove it never resolves — no employee is ever wrongly dispatched to
      // an unreachable target (already true today via ActionSelection.ts's
      // own per-employee reachability screen; only the blockedReason
      // assertion above is new). Bounded, not thousands of ticks — mirrors
      // the PR's own 2000+-tick trace at a scale that still fits a unit-test
      // budget.
      tickUntilFresh(run, state, () => false, 300);

      expect(state.logistics.storedMassKg).toBe(0);
      const stillQueued = debrisActions(state);
      expect(stillQueued.length).toBeGreaterThan(0);
      for (const action of stillQueued) {
        expect(action.status).toBe('queued');
        expect(action.blockedReason).toBe('target_unreachable');
      }
    },
  );

  it(
    "does NOT flag target_unreachable on the CURRENT relocated blast site (14,6) economy-full-loop.json actually uses today (non-regression)",
    () => {
      const { run, state } = drillChargeAndBlast(14, 6);
      crewHaulingAndBuildDepot(run, state);

      tickUntilFresh(run, state, () => false, 3);

      const actionsRightAfterDepot = debrisActions(state);
      for (const action of actionsRightAfterDepot) {
        expect(action.blockedReason).not.toBe('target_unreachable');
      }

      // Hauling should actually make progress here — economy-full-loop.json's
      // own direct trace reaches storedMassKg > 0 well within a few hundred
      // ticks of this exact setup.
      tickUntilFresh(run, state, () => state.logistics.storedMassKg > 0, 400);
      expect(state.logistics.storedMassKg).toBeGreaterThan(0);

      for (const action of debrisActions(state)) {
        expect(action.blockedReason).not.toBe('target_unreachable');
      }
    },
  );
});
