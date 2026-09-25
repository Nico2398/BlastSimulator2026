// BlastSimulator2026 — Per-employee dispatch claim/promote steps (#549)
//
// The three-step-per-employee claim sequence EmployeeDispatch.ts's
// tickEmployees runs for each employee every tick: claim actions targeted at
// them, fill from their own queue or the open pool, or reserve one pool
// action ahead while busy — plus promoteActionToActive, which hands a
// claimed action to an employee. Split out of GameLoop.ts as part of #759's
// file-size split; re-exported there so GameLoop.ts stays the single public
// surface for tick-orchestration callers.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import {
  selectBestActionForEmployee, computeActionWorkTicks, resolveRestNeedKey, seedTaskTimerFields,
  isRampSegmentClaimable, findStarvedActionForEmployee, canReleaseStrandedOnFootAction,
  canReleaseStrandedVehicleGatedAction, isActionPastStuckBackoff, type SelectedAction,
} from './ActionSelection.js';
import { claimPendingAction } from './TaskDispatch.js';
import { beginRestTravel } from './RestActionHelpers.js';
import { releaseActionToOpenPool } from './TaskCancellation.js';
import { reserveVehicle, findVehicleForClaim, promoteVehicleGatedAction, isLicensedForRole } from './VehicleReservation.js';
import { createFragmentLookup, isHaulOrFragmentActionClaimable } from '../economy/HaulDispatch.js';
import { isEvacuationHoldActive } from './Evacuation.js';
import { MAX_EMPLOYEE_TASK_QUEUE_DEPTH } from '../config/balance.js';
import { alightIfMounted } from './Mount.js';
import { vehicleDriverId, findVehicleReservedForAction } from '../entities/Vehicle.js';
import { moveTo } from './MoveTo.js';

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
  // One id → fragment index for this whole pass, never a linear scan per
  // action — see createFragmentLookup's own doc comment (HaulDispatch.ts).
  const fragmentOf = createFragmentLookup(state);
  const targeted = state.pendingActions
    .filter(a => a.status === 'queued' && a.targetEmployeeId === employee.id
      // #552: a haul_debris/fragment_debris action whose fragment is no
      // longer on_ground, or (haul_debris only) whose mass no longer fits
      // remaining storage room, stays queued rather than being claimed and
      // immediately failing at pickup — mirrors the vehicle-availability
      // check (findVehicleForClaim) just below.
      && isHaulOrFragmentActionClaimable(state, a, fragmentOf)
      // #557: never re-claim a stale evacuation-relay leftover while its
      // zone is still occupied — see isEvacuationHoldActive's own doc
      // comment (Evacuation.ts).
      && !isEvacuationHoldActive(state, a)
      // #1130: a forced stuck-abandon release backs this action off for a
      // cooldown — see isActionPastStuckBackoff's own doc comment.
      && isActionPastStuckBackoff(state, a))
    .sort((a, b) => {
      // Rest actions win ties over any other targeted action, so a rest
      // queued alongside other work for this employee is always the first
      // one claimed/promoted (#1062 rest-priority ordering).
      const restRank = (x: PendingAction) => x.type === 'rest' ? 0 : 1;
      const diff = restRank(a) - restRank(b);
      return diff !== 0 ? diff : a.id - b.id;
    });

  for (const action of targeted) {
    const depth = (employee.activeActionId !== null ? 1 : 0) + employee.taskQueue.length;
    if (depth >= MAX_EMPLOYEE_TASK_QUEUE_DEPTH) break;

    const vehicleCheck = findVehicleForClaim(state, action, employee);
    if (!vehicleCheck.ok) continue; // vehicle-gated, none free right now — stays queued, retries next tick

    const claimed = claimPendingAction(state, action.id, employee.id);
    if (!claimed) continue;
    if (vehicleCheck.vehicle) reserveVehicle(state.vehicles, vehicleCheck.vehicle.id, claimed.id);
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
  // Computed once, up front, so both the taskQueue-resume branch below and
  // the empty/all-unreachable-taskQueue fallback further down can check it —
  // see promoteStarved's own call site below for why an ordinary (non-rest)
  // taskQueue resumption must not win over it.
  const starved = findStarvedActionForEmployee(state, employee);
  const promoteStarved = (): boolean => {
    if (starved === null) return false;
    const claimedStarved = claimPendingAction(state, starved.action.id, employee.id);
    if (claimedStarved === null) return false;
    result.claimed.push(claimedStarved.id);
    promoteActionToActive(state, employee, claimedStarved);
    return true;
  };

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

      // Prefer a queued rest candidate when it's reachable this tick (#1062
      // rest-priority ordering) — ahead of everything else, starvation
      // included: a needs-driven rest is never worth delaying a tick to go
      // work a starved job instead.
      const restCandidate = candidates.find(a => a.type === 'rest');
      const restSelection = restCandidate !== undefined ? selectBestActionForEmployee(state, employee, [restCandidate]) : null;
      if (restSelection !== null) {
        promoteActionToActive(state, employee, restSelection.action);
        employee.taskQueue = employee.taskQueue.filter(id => id !== restSelection.action.id);
        return;
      }

      // #1089 fix: a starved action (see promoteStarved's own doc comment
      // above) wins over resuming this employee's own ordinary (non-rest)
      // taskQueue reservation. Without this, an employee whose
      // reserveOnePoolActionAhead (step 3) keeps one reachable vehicle-gated
      // follow-up queued at all times never has an empty or fully-unreachable
      // taskQueue at the instant they go idle — the plain "resume from
      // taskQueue" ranking just below always wins first, and the starvation
      // check at the bottom of this function (needed for the empty-taskQueue
      // case) is never reached for them, defeating the whole point of the
      // override exactly as its own #1000-followup doc comment (below,
      // claimOnePoolCandidate's excludeOnFootActions) already warns against
      // for the reserve-ahead side of this same gap. Direct-traced via
      // rock-fragmenter-breaking.json in interaction mode (#1089): the one
      // idle debris_hauler driver cycled hauling job after hauling job,
      // always with one more already reserved ahead in taskQueue, while two
      // `place_building` orders starved 900+ ticks with nobody ever idle
      // long enough (by this function's own accounting) to serve them. The
      // pre-empted taskQueue entry is not lost — it was never promoted to
      // active, so it simply stays reserved for this employee's next idle
      // tick, the same as any other reachable-but-not-yet-claimed candidate.
      if (promoteStarved()) return;

      // Nothing starved to prefer — fall back to ranking the full queue.
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
      //
      // #954 follow-up (economy-full-loop regression): a vehicle-gated entry
      // among those same unreachable candidates may be reserved to a vehicle
      // nobody has boarded yet, with a different, already-idle, already-
      // licensed employee standing by who could use it right now.
      // canReleaseStrandedVehicleGatedAction (ActionSelection.ts) restores
      // this — the deleted canReassignStrandedReservation's own release half
      // (VehicleReservation.ts, dismount-on-release mechanism removed by
      // #1090), now judged by the same real resolveActionCost reachability
      // check every other claim/release decision in this file already uses.
      for (const candidate of candidates) {
        if (canReleaseStrandedVehicleGatedAction(state, employee, candidate)) {
          employee.taskQueue = employee.taskQueue.filter(id => id !== candidate.id);
          releaseActionToOpenPool(state, candidate);
        } else if (canReleaseStrandedOnFootAction(state, employee, candidate)) {
          // #1025: an on-foot taskQueue candidate this employee can no longer
          // reach (their own current cell got built over — clampToGrid froze
          // them mid-fatigue onto the exact cell a building's footprint later
          // occupies) with no other employee ever offered it, since it never
          // sat in the open pool. Release it the same way the vehicle-gated
          // branch above does, so a different, reachable employee can pick it
          // up instead of it deadlocking here forever.
          employee.taskQueue = employee.taskQueue.filter(id => id !== candidate.id);
          releaseActionToOpenPool(state, candidate);
        }
      }
    }
  }

  // #1000 (CI follow-up): a queued on-foot action starved past
  // ACTION_STARVATION_TICK_THRESHOLD wins the open pool outright, ahead of
  // any cheaper candidate claimOnePoolCandidate's cost ranking would pick.
  // Ranking alone never rescues it — an idle employee standing in a debris
  // field of hundreds of nearer haul/fragment actions re-picks one of those
  // every tick indefinitely, so an ordered building on the far side of the
  // pit stays unbuilt even while somebody is free to walk to it right now.
  // The now-deleted VehicleContinuity.ts's own starvation gate never covered
  // this: it fired only when a driver *completes* a vehicle-gated action, and
  // an employee who never completes one — churning on a claim that keeps
  // failing, or idle between rests — never passed through it at all.
  // findStarvedActionForEmployee (promoteStarved, above) covers every idle
  // employee regardless of what they were last doing. Direct-traced via
  // rock-fragmenter-breaking.json in interaction mode: both `place_building`
  // orders sat 'queued' and fully claimable (reachable, no required skill,
  // no vehicle needed) for 3,000 ticks while the one idle driver re-selected
  // the same haul_debris action on every one of them.
  if (promoteStarved()) return;

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
 *
 * `excludeOnFootActions` (#1000, corrected by #1000-followup — see
 * reserveOnePoolActionAhead's own doc comment): when true, a
 * `requiredVehicleRole === null` candidate is never considered. Without it, a
 * busy driver could reserve-ahead an on-foot action (e.g. a `place_building`
 * order) into taskQueue, where it sits un-promotable until the driver goes
 * genuinely idle (only fillIdleEmployeeFromQueueOrPool's step 2 promotes a
 * taskQueue entry, role-agnostic, once activeActionId is null) and, being no
 * longer 'queued', is invisible to findStarvedActionForEmployee too — so it
 * sits claimed but un-promotable for as long as the driver keeps finding more
 * same-role vehicle work to chain onto ahead of ever going idle, defeating
 * the whole point of the starvation override.
 *
 * A *different* vehicle-gated candidate (any non-null role) is deliberately
 * NOT excluded here, even when it doesn't match the employee's current
 * active-action role: findVehicleForClaim's own isClaimable gate below
 * already requires the employee to hold that role's licence before it's ever
 * claimable at all, so — unlike the on-foot case — such a reservation is
 * always genuinely redeemable once this employee goes idle:
 * fillIdleEmployeeFromQueueOrPool's step 2 promotes a taskQueue entry through
 * promoteActionToActive with no role filter of its own. An earlier version of
 * this restriction excluded any role mismatch outright, which stranded a
 * dual-licensed driver (e.g. one qualified for both rock_fragmenter and
 * debris_hauler) mid-chain on one vehicle role, unable to ever reserve ahead
 * a genuinely drivable action of the other role — direct-traced via
 * economy-full-loop.json: with the exact-role restriction in place, both of
 * its two drivers ended up parked (nobody aboard) deep inside the very debris
 * field their own work had just produced, each permanently unable to path to
 * the other's now-abundant backlog, so storedMassKg stopped increasing for
 * good rather than merely later. Left `false` for step 2 (idle employee),
 * which promotes taskQueue entries through the ordinary, role-agnostic path
 * (fillIdleEmployeeFromQueueOrPool) instead.
 *
 * `deferVehicleGatedToIdleAlternative` (#1002): when true, a vehicle-gated
 * candidate is skipped if a DIFFERENT employee — alive, not injured, not in
 * training, genuinely idle (activeActionId === null), not resting, and
 * licensed for that candidate's role — already exists to claim it directly
 * instead. Used only by reserveOnePoolActionAhead (step 3, a busy employee's
 * speculative lookahead reservation): without it, a busy employee whose own
 * active action is on-foot (so the #1000 on-foot exclusion above doesn't
 * apply) can immediately re-reserve-ahead a vehicle action that
 * releaseUnboardedTaskQueueVehicleReservations (called from a starvation
 * override elsewhere — NeedRestoration.ts's tickCollapse) JUST released
 * back to the pool for exactly this reason — an idle, already-licensed
 * employee standing by should get it
 * this same tick, not have it re-locked to the very employee whose own
 * detour caused the release, defeating the release's whole point. Left
 * `false` for step 2 (idle employee, fillIdleEmployeeFromQueueOrPool) —
 * whichever idle employee's own turn reaches a candidate first should claim
 * it; deferring there just because a different idle employee also exists
 * would strand the pool item between two willing candidates indefinitely.
 */
export function claimOnePoolCandidate(
  state: GameState,
  employee: Employee,
  excludeOnFootActions = false,
  deferVehicleGatedToIdleAlternative = false,
): SelectedAction | null {
  // Built once per pass: the pool holds one action per on-ground fragment
  // after a blast, and a per-action scan over the fragments made this filter
  // O(actions × fragments) for every idle employee, every tick (the
  // `level1-lose-ecology` cost createFragmentLookup's doc comment records).
  const fragmentOf = createFragmentLookup(state);
  const poolCandidates = state.pendingActions.filter(a =>
    a.status === 'queued' &&
    a.targetEmployeeId === null &&
    (!excludeOnFootActions || a.requiredVehicleRole !== null) &&
    (a.requiredSkill === null || employee.qualifications.some(q => q.category === a.requiredSkill)) &&
    // #552: see claimActionsTargetedAtEmployee's own comment on the same check.
    isHaulOrFragmentActionClaimable(state, a, fragmentOf) &&
    // #557: an open-pool action CAN carry EVACUATION_HOLD_KEY now (see that
    // constant's own doc comment, Evacuation.ts); clearResolvedEvacuationHolds
    // (called once per tick from tickEmployees) means this never permanently
    // blocks later work once the zone genuinely clears.
    !isEvacuationHoldActive(state, a) &&
    // #1130: see isActionPastStuckBackoff's own doc comment.
    isActionPastStuckBackoff(state, a)
  );

  const selection = selectBestActionForEmployee(
    state, employee, poolCandidates,
    candidate => findVehicleForClaim(state, candidate, employee).ok
      && isRampSegmentClaimable(state, candidate)
      && (!deferVehicleGatedToIdleAlternative
        || !hasIdleLicensedAlternative(state, candidate, employee)),
  );
  if (selection === null) return null;

  // Re-resolve to get the actual vehicle to reserve — selectBestActionForEmployee's
  // isClaimable gate above only reports ok/not-ok, not which vehicle. Guaranteed
  // to still succeed (single-threaded, nothing else ran between the two calls).
  const vehicleCheck = findVehicleForClaim(state, selection.action, employee);
  if (!vehicleCheck.ok) return null;

  const claimed = claimPendingAction(state, selection.action.id, employee.id);
  if (!claimed) return null;
  if (vehicleCheck.vehicle) reserveVehicle(state.vehicles, vehicleCheck.vehicle.id, claimed.id);

  return selection;
}

/**
 * True when a DIFFERENT employee than `employee` — alive, not injured, not in
 * training, genuinely idle, and licensed for `candidate`'s required vehicle
 * role — exists right now to claim `candidate` directly. `candidate` with no
 * vehicle role is never deferred (returns false) — this only exists to keep
 * a busy employee's speculative reserve-ahead from beating an idle,
 * already-qualified employee to a vehicle-gated pool item. See
 * claimOnePoolCandidate's `deferVehicleGatedToIdleAlternative` doc comment.
 */
function hasIdleLicensedAlternative(state: GameState, candidate: PendingAction, employee: Employee): boolean {
  const role = candidate.requiredVehicleRole;
  if (role === null) return false;
  return state.employees.employees.some(other =>
    other.id !== employee.id
    && other.alive
    && !other.injured
    && other.trainingState === null
    && other.activeActionId === null
    && other.restTicksRemaining === null
    && isLicensedForRole(other, role),
  );
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

  // #1000: while busy on a vehicle-gated action, never reserve ahead an
  // on-foot candidate — see claimOnePoolCandidate's own doc comment on
  // excludeOnFootActions for why only the on-foot case is actually
  // unredeemable, and why an earlier version of this guard excluded any
  // vehicle-role mismatch too broadly (economy-full-loop.json regression). A
  // foot-busy employee (activeAction.requiredVehicleRole === null) keeps the
  // unrestricted pool — nothing about its own eventual idle-promotion
  // (fillIdleEmployeeFromQueueOrPool) is role-sensitive.
  const excludeOnFootActions = activeAction.requiredVehicleRole !== null;
  // #1002: see claimOnePoolCandidate's own doc comment on
  // deferVehicleGatedToIdleAlternative — always deferred for step 3, so an
  // idle, already-licensed employee never loses a vehicle-gated pool item to
  // this employee's own speculative lookahead.
  const selection = claimOnePoolCandidate(state, employee, excludeOnFootActions, true);
  if (selection === null) return; // nothing reachable within budget — tries again next tick

  result.claimed.push(selection.action.id);
  employee.taskQueue.push(selection.action.id);
}

/**
 * Releases every unboarded, vehicle-gated action in `employee.taskQueue` back to
 * the open pool. Called when a starvation override is about to send the employee
 * off on an unrelated on-foot detour of unknown length, so a vehicle reserved
 * for a not-yet-started taskQueue entry does not sit locked and idle for that
 * whole detour — another driver can claim it immediately instead.
 *
 * Skips a taskQueue entry that is on-foot (`requiredVehicleRole === null`) or
 * whose reserved vehicle is already boarded BY `employee` THEMSELF (the
 * continuity case, findFreeVehicleForRole's own driven-by-self clause — a
 * taskQueue entry reserved onto a vehicle this employee already drives). A
 * DIFFERENT employee's occupancy is never a reason to leave the reservation in
 * place (#1115 fix): the reservation is still exclusively `employee`'s — a
 * taskQueue entry's vehicle can only ever have been boarded by someone else
 * through a path outside the ordinary reservation-checked claim (a manual
 * `vehicle driver`/test drive, e.g.) — so it is exactly the stale/invalid
 * reservation this release exists to clear, not a reason to leave it locked to
 * an employee about to go idle for a whole rest/detour. The old unconditional
 * `vehicleDriverId(vehicle) !== null` skip treated ANY occupant, self or
 * otherwise, as "already boarded, leave it" — silently leaving a reservation
 * on the pool exclusively claimed by (but unusable to) `employee` for the
 * whole rest/detour whenever a different driver held the seat
 * (WorldInvariants.ts's I5 check flags exactly this: the reservation's holder
 * is `employee`, per the action's own holderId, but the vehicle's actual
 * driver is someone else — none of I5's own validity branches accept that).
 * Fully releases matching entries: removes them from `employee.taskQueue` and
 * hands the action + vehicle back to the pool via the existing
 * `releaseActionToOpenPool` helper.
 */
export function releaseUnboardedTaskQueueVehicleReservations(state: GameState, employee: Employee): void {
  const queuedIds = [...employee.taskQueue];

  for (const actionId of queuedIds) {
    const action = state.pendingActions.find(a => a.id === actionId);
    if (!action || action.requiredVehicleRole === null) continue;

    const vehicle = findVehicleReservedForAction(state.vehicles, action.id);
    if (!vehicle) continue;
    const driverId = vehicleDriverId(vehicle);
    if (driverId !== null && driverId === employee.id) continue;

    employee.taskQueue = employee.taskQueue.filter(id => id !== action.id);
    releaseActionToOpenPool(state, action);
  }
}

/**
 * Promote a claimed action to active on `employee`: sets activeActionId,
 * sends them walking toward the target, and seeds either
 * pendingRestDuration/pendingRestNeedKey (rest) or pendingTaskDuration/
 * activeTaskSkill/pendingActionType/pendingActionPayload (everything else).
 */
export function promoteActionToActive(state: GameState, employee: Employee, action: PendingAction): void {
  employee.activeActionId = action.id;

  if (action.requiredVehicleRole !== null) {
    promoteVehicleGatedAction(state, employee, action);
    return;
  }

  // #1118: rest is the one requiredVehicleRole: null action that must NOT
  // alight a mounted employee first — beginRestTravel routes through
  // moveTo/planItinerary, which preserves mount continuity for a
  // 'reposition' goal (PlanItinerary.ts), so a mounted employee drives to
  // their rest destination instead of desyncing from their vehicle
  // (I2_mounted_position_mismatch). tickCollapse/tickNeedRestoration
  // self-claim outside this path and, like this branch, only ever *queue*
  // the rest via pendingRestDuration/pendingRestNeedKey. autoInsertNeedTasks
  // pushes 'rest' actions unclaimed (busy-employee case), so this is the
  // first point an idle employee actually starts travelling to rest.
  // Bunkhouse Tier 2+ shift-cycle rest (forceShiftRestIfNeeded) also
  // self-claims and carries no 'needKey' payload, so resolveRestNeedKey
  // returns null for it and the bookkeeping below is a no-op there.
  if (action.type === 'rest') {
    // #1091 follow-up: a no-building "rest in place" action carries a
    // targetX/targetZ snapshotted from wherever the employee stood at
    // INSERTION time (autoInsertNeedTasks, NeedTaskInsertion.ts) — but this
    // action can sit `queued` for many ticks before an idle employee ever
    // reaches this promotion. A mounted employee mid-haul drifts continuously
    // in the meantime, so by promotion time their real position has almost
    // always moved on from that stale snapshot, if only by a sub-grid-cell
    // fraction. moveTo/planItinerary's own 'reposition' goal is itinerary-
    // gated on EXACT arrival (`isLegArrived`, Locomotion.ts) while every
    // route the pathfinder can actually walk is grid-cell-quantized
    // (`findPath`'s trivial start===goal case, Pathfinding.ts) — so a target
    // that differs from the employee's current cell by less than one full
    // cell, but is not bit-for-bit identical to it, can never be reached at
    // all: the itinerary installs, the vehicle never moves (already
    // standing on the only cell the path ever names), and the employee sits
    // "traveling" (NEED_DRAIN_RATES) draining fatigue every tick until a hard
    // collapse eventually fires — confirmed live via
    // rock-fragmenter-breaking.json's own storedMassKg regression, where
    // exactly this stale-target mismatch, not a broken arrival effect, ran a
    // debris_hauler's driver fatigue to 0 before their very first delivery.
    // A building-backed target is immune (it's a fixed approach cell, never
    // re-derived), so this only re-reads the employee's CURRENT position for
    // the no-building fallback, never mutating the action's own stored
    // targetX/targetZ (EvacuationHold.ts/Evacuation.ts still need the
    // original snapshot for their own danger-zone checks).
    const [targetX, targetZ] = action.payload['buildingId'] === undefined
      ? [employee.x, employee.z]
      : [action.targetX, action.targetZ];
    beginRestTravel(state, employee, targetX, targetZ);
    if (employee.restTicksRemaining === null && employee.pendingRestDuration === null) {
      const needKey = resolveRestNeedKey(action.payload);
      if (needKey !== null) {
        employee.pendingRestDuration = computeActionWorkTicks(state, employee, action);
        employee.pendingRestNeedKey = needKey;
      }
    }
    // #1091 follow-up: this is the THIRD rest-promotion path (the other two,
    // NeedRestoration.ts's tickCollapse and ForceShiftRest.ts's
    // finishForceRest, already call this) — an ordinary taskQueue-priority
    // rest promoted here (fillIdleEmployeeFromQueueOrPool's own restCandidate
    // branch) can just as easily leave an unrelated, unboarded, reserved-ahead
    // vehicle sitting in `employee.taskQueue` for the whole rest duration as
    // either of those two triggers can — WorldInvariants.ts's own I5 check
    // deliberately excludes a RESTING holder from isPendingReserveAhead's
    // exemption specifically because all three rest triggers were assumed to
    // release this before resting starts; this one didn't. Confirmed live via
    // rock-fragmenter-breaking.json: a debris_hauler driver, mid-build,
    // reserved a haul_debris action ahead into taskQueue, then this branch
    // promoted their own proactive fatigue rest without releasing it —
    // tripping I5 for the whole 16-tick rest.
    releaseUnboardedTaskQueueVehicleReservations(state, employee);
    return;
  }

  // #1103: a currently-mounted employee claiming any OTHER on-foot action
  // (place_building, survey, charge_hole, etc.) must alight first. Without
  // this, the itinerary walk below moves employee.x/z on its own every tick
  // while the vehicle they're still nominally "mounted" in never moves — an
  // immediate and then ever-widening I2 (mounted-position-mismatch)
  // violation for the rest of the walk. Mirrors the identical
  // alight-before-boarding-elsewhere fix in PlanItinerary.ts's own
  // vehicle-gated branch.
  alightIfMounted(state, employee);

  // #1090: every other on-foot action walks via moveTo — the only entry
  // point that starts movement — rather than setting destinationX/Z
  // directly, whenever moveTo can actually resolve a route. Goal shape is
  // { actionId } (not { x, z }) so planItinerary/resolveGoal recognize a
  // 'work' goal with a real actionId — required for
  // findCheapestTransportItinerary's walk-vs-ride comparison to trigger, and
  // for a transport ride's alight step to have a valid actionId to key its
  // own release on (#1093 phase 7).
  const moveResult = moveTo(state, employee.id, { actionId: action.id });
  // A transport-ride itinerary (#1093 phase 7) may include a mode: 'drive'
  // leg for a borrowed vehicle this action never claimed through
  // promoteVehicleGatedAction — reserve it here so it isn't claimed out from
  // under the employee mid-ride.
  if (moveResult.success) {
    const driveLeg = employee.itinerary?.legs.find(leg => leg.mode === 'drive');
    if (driveLeg?.vehicleId !== null && driveLeg?.vehicleId !== undefined) {
      const rideVehicle = state.vehicles.vehicles.find(v => v.id === driveLeg.vehicleId);
      if (rideVehicle) reserveVehicle(state.vehicles, rideVehicle.id, action.id);
    }
  }
  // #1178: the legacy destinationX/Z fallback for an unreachable-right-now
  // claim target used to live here (moveTo could refuse an itinerary for it).
  // Removed — buildFootOnlyItinerary (PlanItinerary.ts) can no longer refuse
  // a non-vehicle-gated goal, so this moveTo call can no longer fail, and the
  // fallback was dead code.

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
