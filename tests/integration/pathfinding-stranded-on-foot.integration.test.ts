// BlastSimulator2026 — Integration tests: stranded on-foot pathfinding deadlock (#1025)
//
// An employee fatigue-frozen at a fractional position gets floored
// (Math.floor via Pathfinding.ts's clampToGrid) to a discrete NavGrid cell. If
// a building's footprint later occupies that exact cell, `findPath`'s own
// start-impassability check (isImpassable(startCell, avoidVehicles, true))
// reads that cell as 'blocked'/'void' and refuses to path out of it at all —
// under TODAY's (unfixed) contract, isAgentCell only bypasses occupancy
// flags, not type solidity. Every subsequent findPath call from that position
// fails permanently. When the stranded action sits only in that employee's
// own taskQueue (never promoted to active), it is invisible to the open pool
// (still 'assigned', not 'queued'), so no other employee can steal it either
// — a permanent deadlock.
//
// These reproduce the deadlock end-to-end through the real per-tick loop
// (tickCommand, mirroring events.ts's own orchestration — see
// building-scenarios-410.integration.test.ts for the harness convention this
// file follows) rather than unit-testing the individual fixed functions in
// isolation (that's Pathfinding.test.ts / NavGrid.test.ts / ActionSelection.test.ts's job).
//
// DO NOT implement anything here — only add implementation to src/.

import { describe, it, expect } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { BuildingType, BuildingTier } from '../../src/core/entities/Building.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { makeGameContext } from '../helpers/gameContext.js';
import { tickCommand } from '../../src/console/commands/events.js';
import { dispatchPendingAction, claimPendingAction } from '../../src/core/engine/TaskDispatch.js';
import { buildGameNavGrid } from '../../src/core/state/GameState.js';
import { getBuildingDef } from '../../src/core/entities/Building.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Fresh GameContext with a real GameState (seed=42, desert biome, generous size so the (24,24) fixture below sits well clear of any site-boundary notch). */
function makeCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: '42', size: '48' });
}

/** Hire one employee (no particular skill — every action here is requiredSkill: null) and return their id. Always the LAST roster entry, not employees[0] (this file hires twice per scenario B test). */
function hireOne(ctx: GameContext, role = 'driller'): number {
  const result = employeeCommand(ctx, ['hire'], { role });
  if (!result.success) throw new Error(`Setup: hire failed — ${result.output}`);
  const employees = ctx.state!.employees.employees;
  return employees[employees.length - 1]!.id;
}

/**
 * Push a Building directly onto state.buildings, bypassing placeBuilding's
 * flatness/tier-research/overlap validation entirely — this file is
 * reproducing the NavGrid-classification consequence of a completed
 * building, not exercising placement rules (that's #410's own suite). Then
 * rebuilds the live NavGrid via buildGameNavGrid (state/GameState.js), the
 * exact helper tickTaskCompletion.ts's own building-placement completion path
 * uses, so every footprint cell reclassifies to 'blocked' immediately.
 */
function placeRawBuilding(ctx: GameContext, type: BuildingType, tier: BuildingTier, x: number, z: number): void {
  const state = ctx.state!;
  const def = getBuildingDef(type, tier);
  state.buildings.buildings.push({
    id: state.buildings.nextId++,
    type,
    tier,
    x,
    z,
    hp: def.maxHp,
    active: true,
  });
  buildGameNavGrid(state, ctx.grid!, state.buildings.buildings, state.drillHoles);
}

/** Queue an open-pool, on-foot, no-skill 'general_work' PendingAction and return its id. */
function queueGeneralWorkAction(state: GameState, targetX: number, targetZ: number, durationTicks = 1): number {
  const id = state.nextPendingActionId++;
  dispatchPendingAction(state, {
    id,
    type: 'general_work',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX,
    targetZ,
    targetY: 0,
    payload: { durationTicks },
    targetEmployeeId: null,
  }, { skipQualificationCheck: true });
  return id;
}

/**
 * Claim `actionId` for `holderId` and strand it in that employee's own
 * taskQueue WITHOUT promoting it to active — reproduces exactly the #1025
 * precondition ("the stranded action sits only in that employee's own
 * taskQueue, never promoted to active"). Mirrors what reserveOnePoolActionAhead
 * (EmployeeDispatchSteps.ts) produces in real play for a busy employee
 * claiming ahead, without needing this employee to actually be busy first.
 */
function claimAndStrandInTaskQueue(state: GameState, actionId: number, holderId: number): void {
  const claimed = claimPendingAction(state, actionId, holderId);
  if (!claimed) throw new Error(`Setup: claimPendingAction failed for action ${actionId}`);
  const holder = state.employees.employees.find(e => e.id === holderId)!;
  holder.taskQueue.push(actionId);
}

/** Tick up to `maxTicks` times, one tick per call, until `predicate` holds. Returns whether it ever held (bounded — a genuine regression fails fast instead of hanging). */
function tickUntil(ctx: GameContext, maxTicks: number, predicate: () => boolean): boolean {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return true;
    tickCommand(ctx, ['1'], {});
  }
  return predicate();
}

const MAX_TICKS = 150;

describe('stranded on-foot pathfinding deadlock — scenario-runner (#1025)', () => {
  it('scenario A: an on-foot action reachable only via detour eventually completes once the employee is no longer boxed in by their own current cell', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    const holderId = hireOne(ctx);
    const holder = state.employees.employees.find(e => e.id === holderId)!;

    // Freeze the employee at a fractional position that floors to (24, 24) —
    // mirrors a fatigue-freeze mid-walk (clampToGrid uses Math.floor).
    holder.x = 24.707;
    holder.z = 24.293;

    // management_office T1 footprint is a 2x2 rect(2,2) anchored at (x,z):
    // placed at (24,24) it covers (24,24),(25,24),(24,25),(25,25) — the
    // employee's own floored cell (24,24) is now 'blocked' to itself, but
    // (23,23)/(23,24)/(23,25)/(24,23)/(25,23) stay open, so a detour exists.
    placeRawBuilding(ctx, 'management_office', 1, 24, 24);
    expect(state.navGrid!.cellAt(24, 24)!.type).toBe('blocked');
    expect(state.navGrid!.cellAt(23, 24)!.type).not.toBe('blocked'); // the open detour neighbour

    // A reachable-via-detour on-foot action, stranded in the holder's OWN
    // taskQueue only (never promoted to active) — exactly the #1025 deadlock
    // precondition.
    const actionId = queueGeneralWorkAction(state, 10, 24, 1);
    claimAndStrandInTaskQueue(state, actionId, holderId);

    const completed = tickUntil(ctx, MAX_TICKS, () => !state.pendingActions.some(a => a.id === actionId));

    // TODAY (unfixed): isImpassable's isAgentCell exemption does not bypass
    // 'blocked'/'void' type solidity, so findPath's own start-impassability
    // check (Pathfinding.ts) refuses to path out of the employee's own
    // boxed-in cell FOREVER, regardless of the open detour — this assertion
    // fails against current source. Once (a) Pathfinding.ts's isImpassable
    // and (b) NavGridReachability.ts's reachableSetFrom both treat the
    // agent's own current cell as never impassable to itself, the employee
    // finds the detour and the action completes within MAX_TICKS.
    expect(completed).toBe(true);
  });

  it('scenario B: a fully-enclosed employee never completes the stranded action themself, so it must be released to the open pool for a second employee to claim and finish', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    const holderId = hireOne(ctx);
    const holder = state.employees.employees.find(e => e.id === holderId)!;
    const rescuerId = hireOne(ctx);
    const rescuer = state.employees.employees.find(e => e.id === rescuerId)!;
    // Rescuer stands somewhere entirely clear of the building footprint below.
    rescuer.x = 5;
    rescuer.z = 5;

    holder.x = 24.707;
    holder.z = 24.293; // floors to (24, 24)

    // management_office T3 footprint is a 3x3 rect(3,3): anchored at (23,23)
    // it covers x:23-25, z:23-25 — (24,24) sits at the CENTER, so every one
    // of its 8 neighbours is also inside the footprint. No detour exists.
    placeRawBuilding(ctx, 'management_office', 3, 23, 23);
    expect(state.navGrid!.cellAt(24, 24)!.type).toBe('blocked');
    const neighbourOffsets = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of neighbourOffsets) {
      expect(state.navGrid!.cellAt(24 + dx!, 24 + dz!)!.type).toBe('blocked');
    }

    const actionId = queueGeneralWorkAction(state, 10, 24, 1);
    claimAndStrandInTaskQueue(state, actionId, holderId);

    // Snapshot the action's own holderId on every tick it's still present, so
    // once it disappears (completePendingAction removes the record) the last
    // snapshot names who actually held — and therefore finished — it. A false
    // positive (the assertion below alone) could otherwise pass even if the
    // permanently-boxed-in holder itself were somehow credited.
    let lastKnownHolderId: number | null = null;
    const completed = tickUntil(ctx, MAX_TICKS, () => {
      const action = state.pendingActions.find(a => a.id === actionId);
      if (action) lastKnownHolderId = action.holderId;
      return action === undefined;
    });

    // TODAY (unfixed): canReleaseStrandedOnFootAction doesn't exist yet and
    // EmployeeDispatchSteps.ts's fillIdleEmployeeFromQueueOrPool never
    // releases an on-foot taskQueue entry back to the open pool — the action
    // stays 'assigned' to the fully-enclosed holder FOREVER (holder can never
    // reach it, and it's invisible to the open-pool scan while still
    // 'assigned'), so this never completes and the rescuer never gets a
    // chance — this assertion fails against current source. Once (c)
    // canReleaseStrandedOnFootAction and (d) its wiring into
    // fillIdleEmployeeFromQueueOrPool both land, the action is released
    // ('queued', holderId: null) and the idle, qualified rescuer claims and
    // finishes it within MAX_TICKS.
    expect(completed).toBe(true);

    // The rescuer, not the permanently-boxed-in original holder, must be the
    // one who actually held (and so finished) it — proves the release/reclaim
    // actually happened rather than the holder somehow completing it in place.
    expect(lastKnownHolderId).toBe(rescuerId);
  });
});
