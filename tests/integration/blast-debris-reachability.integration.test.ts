// BlastSimulator2026 — Integration: a blast can leave debris (or any resource
// an employee is expected to walk to) sitting in a NavGrid region
// topologically disconnected from where ground crew operate, with no
// observable signal — issue #1231.
//
// Reproduction history: the first version of this file replayed the EXACT
// original tutorial_pit blast plan scripts/scenario-defs/economy-full-loop.json
// used before PR #1233 relocated it (`drill_plan grid rows:2 cols:2 spacing:3
// depth:6 start:10,10 diameter:0.089`, recovered from `git show a8d371f2 --
// scripts/scenario-defs/economy-full-loop.json`). A direct-traced empirical
// check of that geometry (standalone repro harness driving createRunner
// through this exact command sequence, then NavGrid.computeClimbReachableSet
// from the real post-depot approach cell) showed it does NOT match the
// premise the original test asserted: the debris field splits, with the
// majority of debris actions (162 of 219) climb-disconnected from the depot
// and a genuine minority (57) reachable and hauled — not the "every action at
// this site is unreachable" shape the original test's first case claimed, and
// not the "nothing here is ever unreachable" shape its (14,6) non-regression
// case claimed either (that site showed the same kind of split, 103
// unreachable of 187, when checked the same way). Neither of those two shapes
// is what issue #1231 itself describes — a "closed pocket of size 6",
// i.e. a SMALL disconnected component, not most of a crater. That specific
// numeric fixture also turns out to belong to a different, larger level than
// tutorial_pit (the PR's own commit message cites reachable-set sizes of 1508
// and 3043 cells — impossible on tutorial_pit's 32x32=1024-cell grid), so
// replaying it here was always an approximation, not a literal repro.
//
// This version instead constructs a minimal, independently-verified
// synthetic reproduction on tutorial_pit: a single-hole blast (rows:1 cols:1,
// far smaller than the four-hole grid above) at (18,10), spacing:3 depth:6
// diameter:0.089. With charge amount:3 stemming:2, this blast's own debris
// field leaves exactly 3 NavGrid cells — (18,9), (19,10), (18,10) — climb-
// disconnected (NAV_CLEARANCE_VEHICLE_CELLS) from the freight_warehouse's
// approach cell, while the depot's own reachable component stays large
// (989 of the grid's 1024 cells, direct-traced) and the debris actions
// targeting those 3 cells are a small minority (14 of 75) of this blast's own
// debris actions — the "small pocket, most of the map still reachable" shape
// #1231 actually describes. Confirmed permanent (not merely slow) by running
// 1000+ extra ticks past the point storedMassKg plateaus: the pocket's own
// action count and cell set never change, while every reachable action's
// mass genuinely gets delivered (storedMassKg 0 -> 787.5 -> 1837.5 -> holds).
// The SAME site with a smaller charge (amount:1 instead of amount:3,
// otherwise identical) leaves 0 cells disconnected — direct-traced the same
// way — and is this file's non-regression guard: a small blast at the exact
// same coordinates whose entire debris field is reachable and gets hauled,
// proving the classifier doesn't over-flag a genuinely-connected site.
//
// Drives the real console command layer (createRunner), exactly the way
// tests/integration/collapse-vehicle-recovery.integration.test.ts and
// tests/integration/blast-report-modal-save-load.integration.test.ts do —
// no DOM, no Three.js, real ticks through the real tick pipeline (NavGrid is
// patched synchronously off the `terrain:updated` event the blast emits,
// NavGridSync.ts, so no extra rebuild delay is needed beyond ordinary ticks).

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState, PendingAction } from '../../src/core/state/GameState.js';

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

/** The 3 tutorial_pit NavGrid cells this file's own direct trace confirmed permanently climb-disconnected (NAV_CLEARANCE_VEHICLE_CELLS) from the freight_warehouse's approach cell, for the (18,10) amount:3 blast below. */
const POCKET_CELLS: ReadonlySet<string> = new Set(['18,9', '19,10', '18,10']);
function isPocketCell(x: number, z: number): boolean {
  return POCKET_CELLS.has(`${x},${z}`);
}

/**
 * Hires a driller, licenses them for the drill_rig, drills+charges+sequences
 * a single hole at (startX, startZ) with the given charge amount (spacing:3
 * depth:6 diameter:0.089, stemming:2 — this file's own verified parameters),
 * then detonates it. Returns the runner/state plus a bound `run` so callers
 * can continue driving ticks afterward.
 */
function drillChargeAndBlast(startX: number, startZ: number, amount: number): { run: (cmd: string) => unknown; state: GameState } {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);

  expect(run('campaign start level:tutorial_pit cash:250000')).toMatchObject({ success: true });
  const state = ctx.state!;

  expect(run('employee hire role:driller')).toMatchObject({ success: true });
  const driller = state.employees.employees.find(e => e.role === 'driller')!;

  expect(run('vehicle buy drill_rig')).toMatchObject({ success: true });
  expect(run(`employee assign_skill ${driller.id} skill:driving.drill_rig level:1`)).toMatchObject({ success: true });

  expect(run(`drill_plan grid rows:1 cols:1 spacing:3 depth:6 start:${startX},${startZ} diameter:0.089`)).toMatchObject({ success: true });
  tickUntilFresh(run, state, () => state.plannedDrillHoles.length === 0, 400);
  expect(state.plannedDrillHoles.length).toBe(0);
  expect(state.drillHoles.length).toBe(1);

  expect(run(`charge hole:* explosive:boomite amount:${amount} stemming:2`)).toMatchObject({ success: true });
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
function debrisActions(state: GameState): PendingAction[] {
  return state.pendingActions.filter(a => a.type === 'haul_debris' || a.type === 'fragment_debris');
}

describe('Blast debris left in an unreachable NavGrid pocket (#1231)', () => {
  it(
    "flags only the debris actions targeting the verified 3-cell disconnected pocket with blockedReason 'target_unreachable' (never resolved), while the reachable majority of the same blast's debris genuinely gets hauled",
    () => {
      const { run, state } = drillChargeAndBlast(18, 10, 3);
      crewHaulingAndBuildDepot(run, state);

      // One more small, bounded round beyond the depot's own wait_until above
      // — the NavGrid was already patched synchronously by the blast itself
      // (NavGridSync's `terrain:updated` subscription), so this is only for
      // tickEmployees' classification pass (EmployeeDispatch.ts) to run at
      // least once against a depot that now actually exists. Direct-traced:
      // no real hauling work has happened yet at this checkpoint (storedMassKg
      // is still 0), so the classification below reflects the blast's own
      // geometry, not partial progress.
      tickUntilFresh(run, state, () => false, 3);
      expect(state.logistics.storedMassKg).toBe(0);

      const actionsRightAfterDepot = debrisActions(state);
      expect(actionsRightAfterDepot.length).toBeGreaterThan(0);
      const pocketActionsRightAfterDepot = actionsRightAfterDepot.filter(a => isPocketCell(a.targetX, a.targetZ));
      const reachableActionsRightAfterDepot = actionsRightAfterDepot.filter(a => !isPocketCell(a.targetX, a.targetZ));
      expect(pocketActionsRightAfterDepot.length).toBeGreaterThan(0);
      expect(reachableActionsRightAfterDepot.length).toBeGreaterThan(0);
      for (const action of pocketActionsRightAfterDepot) {
        expect(action.blockedReason).toBe('target_unreachable');
        expect(action.status).toBe('queued');
      }
      for (const action of reachableActionsRightAfterDepot) {
        expect(action.blockedReason).not.toBe('target_unreachable');
      }

      // Reachable debris genuinely gets hauled — direct-traced to reach
      // storedMassKg > 0 well within 400 ticks of this exact setup.
      tickUntilFresh(run, state, () => state.logistics.storedMassKg > 0, 400);
      expect(state.logistics.storedMassKg).toBeGreaterThan(0);

      // Prove the pocket never resolves — no employee is ever wrongly
      // dispatched to an unreachable target (already true today via
      // ActionSelection.ts's own per-employee reachability screen; only the
      // blockedReason assertion is new). Bounded, not thousands of ticks —
      // direct-traced to still hold 1000+ ticks past this point.
      tickUntilFresh(run, state, () => false, 300);

      const finalActions = debrisActions(state);
      const pocketActionsFinal = finalActions.filter(a => isPocketCell(a.targetX, a.targetZ));
      expect(pocketActionsFinal.length).toBeGreaterThan(0);
      for (const action of pocketActionsFinal) {
        expect(action.status).toBe('queued');
        expect(action.blockedReason).toBe('target_unreachable');
      }
    },
  );

  it(
    'does NOT flag target_unreachable on the SAME (18,10) site with a smaller charge (amount:1) whose entire debris field the direct trace confirmed fully reachable (non-regression)',
    () => {
      const { run, state } = drillChargeAndBlast(18, 10, 1);
      crewHaulingAndBuildDepot(run, state);

      tickUntilFresh(run, state, () => false, 3);

      const actionsRightAfterDepot = debrisActions(state);
      expect(actionsRightAfterDepot.length).toBeGreaterThan(0);
      for (const action of actionsRightAfterDepot) {
        expect(action.blockedReason).not.toBe('target_unreachable');
      }

      // Hauling should actually make progress here — the direct trace of
      // this exact setup reaches storedMassKg > 0 well within 400 ticks.
      tickUntilFresh(run, state, () => state.logistics.storedMassKg > 0, 400);
      expect(state.logistics.storedMassKg).toBeGreaterThan(0);

      for (const action of debrisActions(state)) {
        expect(action.blockedReason).not.toBe('target_unreachable');
      }
    },
  );
});
