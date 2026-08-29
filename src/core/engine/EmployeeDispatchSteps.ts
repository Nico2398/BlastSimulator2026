// BlastSimulator2026 — Per-employee dispatch claim/promote steps (#549)
//
// The three-step-per-employee claim sequence EmployeeDispatch.ts's
// tickEmployees runs for each employee every tick: claim actions targeted at
// them, fill from their own queue or the open pool, or reserve one pool
// action ahead while busy — plus the shared promoteActionToActive that both
// this module and VehicleContinuity.ts use to hand a claimed action to an
// employee. Split out of GameLoop.ts as part of #759's file-size split;
// re-exported there so GameLoop.ts stays the single public surface for
// tick-orchestration callers.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import {
  selectBestActionForEmployee, computeActionWorkTicks, resolveRestNeedKey, seedTaskTimerFields,
  isRampSegmentClaimable, type SelectedAction,
} from './ActionSelection.js';
import { claimPendingAction } from './TaskDispatch.js';
import { reserveVehicle, findVehicleForClaim, promoteVehicleGatedAction } from './VehicleReservation.js';
import { isHaulOrFragmentActionClaimable } from '../economy/HaulDispatch.js';
import { isEvacuationHoldActive } from './Evacuation.js';
import { MAX_EMPLOYEE_TASK_QUEUE_DEPTH } from '../config/balance.js';

export interface TickEmployeesResult {
  claimed: number[];     // IDs of PendingActions that were newly claimed (queued -> assigned) this tick
  unqualified: number[]; // IDs of PendingActions no roster employee can ever do
  waiting: number[];     // IDs of PendingActions still queued after this tick (busy/unreachable/no budget left)
}

/**
 * Step 1 of tickEmployees: claim every still-queued action targeted
 * specifically at `employee`, up to MAX_EMPLOYEE_TASK_QUEUE_DEPTH total
 * (active + taskQueue). These are never contested by another employee, so no
 * cost ranking is needed — just claim in a deterministic (id-ascending)
 * order. The first one claimed while the employee is still idle is promoted
 * straight to active; any further ones go onto taskQueue.
 */
export function claimActionsTargetedAtEmployee(state: GameState, employee: Employee, result: TickEmployeesResult): void {
  const targeted = state.pendingActions
    .filter(a => a.status === 'queued' && a.targetEmployeeId === employee.id
      // #552: a haul_debris/fragment_debris action whose fragment is no
      // longer on_ground, or (haul_debris only) whose mass no longer fits
      // remaining storage room, stays queued rather than being claimed and
      // immediately failing at pickup — mirrors the vehicle-availability
      // check (findVehicleForClaim) just below.
      && isHaulOrFragmentActionClaimable(state, a)
      // #557: never re-claim a stale evacuation-relay leftover while its
      // zone is still occupied — see isEvacuationHoldActive's own doc
      // comment (Evacuation.ts).
      && !isEvacuationHoldActive(state, a))
    .sort((a, b) => a.id - b.id);

  for (const action of targeted) {
    const depth = (employee.activeActionId !== null ? 1 : 0) + employee.taskQueue.length;
    if (depth >= MAX_EMPLOYEE_TASK_QUEUE_DEPTH) break;

    const vehicleCheck = findVehicleForClaim(state, action, employee);
    if (!vehicleCheck.ok) continue; // vehicle-gated, none free right now — stays queued, retries next tick

    const claimed = claimPendingAction(state, action.id, employee.id);
    if (!claimed) continue;
    if (vehicleCheck.vehicle) reserveVehicle(vehicleCheck.vehicle, claimed.id);
    result.claimed.push(action.id);

    if (employee.activeActionId === null) {
      promoteActionToActive(state, employee, action);
    } else {
      employee.taskQueue.push(action.id);
    }
  }
}

/**
 * Step 2 of tickEmployees: called only when `employee` is still idle after
 * step 1. Recomputes the cheapest entry from the employee's own taskQueue, or
 * — when taskQueue is empty, or nothing in it is reachable this tick — claims
 * exactly one candidate from the open pool (targetEmployeeId === null).
 * Never both in the same tick.
 */
export function fillIdleEmployeeFromQueueOrPool(state: GameState, employee: Employee, result: TickEmployeesResult): void {
  if (employee.taskQueue.length > 0) {
    // Prune stale entries first: a queued id goes stale when the action it
    // named was claimed here (e.g. by claimActionsTargetedAtEmployee pushing
    // a same-tick, already-busy targeted rest request onto taskQueue instead
    // of promoting it) but then completed/was removed through a different
    // path before this employee ever got back to it — a synchronous
    // tickCollapse rest superseding it, for instance. Left unpruned, an
    // empty candidates list used to short-circuit below and strand the
    // employee idle forever, never falling through to the open pool even
    // once genuinely nothing remained to resume.
    employee.taskQueue = employee.taskQueue.filter(id => {
      const a = state.pendingActions.find(entry => entry.id === id);
      return a !== undefined && a.status === 'assigned' && a.holderId === employee.id;
    });

    if (employee.taskQueue.length > 0) {
      const candidates = employee.taskQueue.map(id => state.pendingActions.find(a => a.id === id)!);

      const selection = selectBestActionForEmployee(state, employee, candidates);
      if (selection !== null) {
        promoteActionToActive(state, employee, selection.action);
        employee.taskQueue = employee.taskQueue.filter(id => id !== selection.action.id);
        return;
      }
      // #816: falls through to the open pool below instead of returning here
      // when nothing queued is reachable this tick. A queued entry can go
      // permanently (not just this-tick) unreachable without ever being
      // pruned by the status/holderId check above — e.g. autoInsertNeedTasks
      // (NeedTaskInsertion.ts) inserts a targeted 'rest' action whose target
      // falls back to the employee's own CURRENT position when no building
      // services the need yet ("rest in place"); if that position was a
      // place_building construction site the employee was actively working,
      // the site later completes and the NavGrid patch (tickTaskCompletion.ts)
      // turns that exact tile 'blocked' — the queued rest's own target
      // coordinate is never revisited or invalidated, so it silently becomes
      // an unreachable goal `findPath` (Pathfinding.ts) permanently refuses.
      // Direct-traced via tutorial-interactive.json's own `set_policy
      // mode:continuous` sequence: an employee stuck exactly this way
      // (taskQueue holding one permanently-unreachable rest action) never
      // dispatched to any of 9 queued, fully-claimable drill_hole actions for
      // 9000+ ticks — the early `return` below meant this idle employee was
      // never even offered the open pool, since a queue-with-something-in-it
      // (however stale) always won by construction. Retrying the stale entry
      // every tick (never dropped here) still costs nothing beyond one failed
      // `selectBestActionForEmployee` call — it stays available to resume
      // automatically if its target ever becomes walkable again (a blast,
      // e.g.), it just no longer blocks this employee from doing anything
      // else in the meantime.
    }
  }

  const selection = claimOnePoolCandidate(state, employee);
  if (selection === null) return; // nothing reachable within budget — stays idle, retries next tick

  result.claimed.push(selection.action.id);
  promoteActionToActive(state, employee, selection.action);
}

/**
 * Filter the open pool (targetEmployeeId === null, still 'queued') down to
 * candidates `employee` qualifies for, pick the cheapest reachable one (via
 * selectBestActionForEmployee), and claim it. Used by both
 * fillIdleEmployeeFromQueueOrPool (idle employee, step 2 of tickEmployees)
 * and reserveOnePoolActionAhead (busy employee, step 3) below — the only
 * difference between the two call sites is what they do with the claimed
 * action (promote to active vs. push onto taskQueue), which each leaves to
 * the caller rather than this helper.
 *
 * Returns null when nothing in the pool is both reachable and claimable
 * within budget, or (defensively — never happens single-threaded) if the
 * selected candidate was claimed by someone else between the filter and the
 * claim itself.
 *
 * Vehicle availability (findVehicleForClaim) is threaded into
 * selectBestActionForEmployee's own isClaimable gate (#552) rather than
 * checked only after ranking picks a single winner — the previous shape
 * ranked by cost/distance alone, then applied the vehicle check to just that
 * top candidate; when it failed (e.g. the nearest debris item needs a
 * rock_fragmenter but only a debris_hauler driver is free), the employee
 * gave up for the tick instead of falling through to the next-cheapest
 * candidate they could actually perform. Folding the check into selection
 * lets it fall through to the next-ranked candidate — isClaimable is applied
 * as a pre-filter over the whole pool before ranking (#611), so it no longer
 * shares the bounded ACTION_SELECTION_MAX_PATH_ATTEMPTS window with the
 * reachability check; that budget is spent entirely on resolveActionCost —
 * generalizes to any action type whose claim can fail this gate, not just
 * haul/fragment ones.
 */
export function claimOnePoolCandidate(state: GameState, employee: Employee): SelectedAction | null {
  const poolCandidates = state.pendingActions.filter(a =>
    a.status === 'queued' &&
    a.targetEmployeeId === null &&
    (a.requiredSkill === null || employee.qualifications.some(q => q.category === a.requiredSkill)) &&
    // #552: see claimActionsTargetedAtEmployee's own comment on the same check.
    isHaulOrFragmentActionClaimable(state, a) &&
    // #557: an open-pool action CAN carry EVACUATION_HOLD_KEY now (see that
    // constant's own doc comment, Evacuation.ts); clearResolvedEvacuationHolds
    // (called once per tick from tickEmployees) means this never permanently
    // blocks later work once the zone genuinely clears.
    !isEvacuationHoldActive(state, a)
  );

  const selection = selectBestActionForEmployee(
    state, employee, poolCandidates,
    candidate => findVehicleForClaim(state, candidate, employee).ok && isRampSegmentClaimable(state, candidate),
  );
  if (selection === null) return null;

  // Re-resolve to get the actual vehicle to reserve — selectBestActionForEmployee's
  // isClaimable gate above only reports ok/not-ok, not which vehicle. Guaranteed
  // to still succeed (single-threaded, nothing else ran between the two calls).
  const vehicleCheck = findVehicleForClaim(state, selection.action, employee);
  if (!vehicleCheck.ok) return null;

  const claimed = claimPendingAction(state, selection.action.id, employee.id);
  if (!claimed) return null;
  if (vehicleCheck.vehicle) reserveVehicle(vehicleCheck.vehicle, claimed.id);

  return selection;
}

/**
 * Step 3 of tickEmployees: called only when `employee` is still busy after
 * steps 1-2 (activeActionId !== null). Reserves exactly one more open-pool
 * candidate ahead into taskQueue, when there is room under
 * MAX_EMPLOYEE_TASK_QUEUE_DEPTH.
 */
export function reserveOnePoolActionAhead(state: GameState, employee: Employee, result: TickEmployeesResult): void {
  const activeAction = state.pendingActions.find(a => a.id === employee.activeActionId);
  if (activeAction === undefined || activeAction.type === 'rest') return;

  const depth = 1 + employee.taskQueue.length;
  if (depth >= MAX_EMPLOYEE_TASK_QUEUE_DEPTH) return;

  const selection = claimOnePoolCandidate(state, employee);
  if (selection === null) return; // nothing reachable within budget — tries again next tick

  result.claimed.push(selection.action.id);
  employee.taskQueue.push(selection.action.id);
}

/**
 * Promote a claimed action to active on `employee`: sets activeActionId,
 * sends them walking toward the target, and seeds either
 * pendingRestDuration/pendingRestNeedKey (rest) or pendingTaskDuration/
 * activeTaskSkill/pendingActionType/pendingActionPayload (everything else).
 * Also used by VehicleContinuity.ts's tryContinueVehicleGatedAction.
 */
export function promoteActionToActive(state: GameState, employee: Employee, action: PendingAction): void {
  employee.activeActionId = action.id;

  if (action.requiredVehicleRole !== null) {
    promoteVehicleGatedAction(state, employee, action);
    return;
  }

  employee.destinationX = action.targetX;
  employee.destinationZ = action.targetZ;

  // tickCollapse/tickNeedRestoration self-claim outside this path and, like
  // this branch, only ever *queue* the rest via pendingRestDuration/
  // pendingRestNeedKey. autoInsertNeedTasks pushes 'rest' actions unclaimed
  // (busy-employee case), so this is the first point an idle employee
  // actually starts walking to rest. Bunkhouse Tier 2+ shift-cycle rest
  // (forceShiftRestIfNeeded) also self-claims and carries no 'needKey'
  // payload, so resolveRestNeedKey returns null for it and this block is a
  // no-op there.
  if (action.type === 'rest') {
    if (employee.restTicksRemaining === null && employee.pendingRestDuration === null) {
      const needKey = resolveRestNeedKey(action.payload);
      if (needKey !== null) {
        employee.pendingRestDuration = computeActionWorkTicks(state, employee, action);
        employee.pendingRestNeedKey = needKey;
      }
    }
    return;
  }

  // Non-rest actions queue their task duration here — a skill-required
  // action's claimed employee is guaranteed (by the qualification filters
  // upstream) to hold requiredSkill, so computeActionWorkTicks' proficiency
  // lookup always succeeds. requiredSkill === null (e.g. a console `employee
  // dispatch` with no skill: param — src/console/commands/employees.ts) has
  // no qualification to scale off, so it's treated as Rookie baseline
  // (proficiency level 1) rather than being skipped — skipping it left
  // pendingTaskDuration/taskTicksRemaining never seeded, so ArrivalGate could
  // never promote the action to in_progress and it, and its ghost, leaked in
  // state forever (#547 review). pendingActionType/pendingActionPayload stay
  // set through to completion (tickTaskProgress clears them) so completion
  // handling (e.g. survey resolution) still knows what work just finished.
  seedTaskTimerFields(state, employee, action);
}
