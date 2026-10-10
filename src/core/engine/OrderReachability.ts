// BlastSimulator2026 — queued-order reachability classification (#1306)
//
// A queued action is "unreachable" (its ghost reads red) when none of the actors
// able to perform THAT action can reach its target, or no such actor exists.
// Actors are worked out per action from its own requirements (skill, vehicle
// role) and grouped by that key. Every pool is answered from a labelling of
// the grid into climb components — one per clearance, kept until the grid
// changes — so a pool costs the union of its actors' components, not a flood
// fill: actors walking about every tick re-cost nothing (#1603). An order aimed
// at one named employee is answered straight from that employee's component.
// Temporary unavailability (injured, resting, training, busy) does not remove
// an actor: alive and on the roster is enough.

import type { NavGrid } from '../nav/NavGrid.js';
import type { GameState, PendingAction, BlockedOrderReason, GhostPreview } from '../state/GameState.js';
import { findById } from '../state/IdIndex.js';
import type { Employee } from '../entities/Employee.js';
import { vehicleDriverId } from '../entities/Vehicle.js';
import type { VehicleRole, VehicleTier } from '../entities/Vehicle.js';
import { lowestFleetTier } from './VehicleReservation.js';
import { canDriveTier, licenceLevelOf } from '../entities/VehicleDriverAssignment.js';
import { isAutoDebrisAction, haulBlockedReason, createFragmentLookup, createStorageFit } from '../economy/HaulDispatch.js';
import { holdsRequiredSkill, isEligibleForWork } from '../entities/Employee.js';
import {
  computeClimbComponents,
  type ClimbComponents,
  type ReachableSet,
} from '../nav/NavGridReachability.js';
import { NAV_CLEARANCE_VEHICLE_CELLS, NAV_CLEARANCE_EMPLOYEE_CELLS } from '../config/balance.js';

/** Identity of the actor pool able to serve an order (skill + vehicle role, or one named employee). */
type OrderActorKey = string;

type OrderReachabilityVerdict = 'reachable' | 'unreachable';

/** Per-actor-pool reachability query over the current nav grid. */
interface OrderReachability {
  canReach(key: OrderActorKey, x: number, z: number): boolean;
  hasActor(key: OrderActorKey): boolean;
}

type ActorRequirements = Pick<PendingAction, 'requiredSkill' | 'requiredVehicleRole' | 'targetEmployeeId'>;

export function orderActorKey(action: ActorRequirements): OrderActorKey {
  return `${action.requiredSkill ?? '-'}|${action.requiredVehicleRole ?? '-'}|${action.targetEmployeeId ?? '-'}`;
}

interface ActorPool {
  hasActor: boolean;
  reachable: Pick<ReachableSet, 'has'> | null;
}

const NO_ACTORS: ActorPool = { hasActor: false, reachable: null };

/** Alive, on-roster employees able to act for `req` (skill, licence, named target). */
function candidateEmployees(state: GameState, req: ActorRequirements): Employee[] {
  const role = req.requiredVehicleRole;
  // No fleet vehicle of the role: no actor either way (fillPool reports NO_ACTORS); level 1 keeps the pre-tier filter.
  const neededTier = role === null ? 1 : (lowestFleetTier(state.vehicles.vehicles, role) ?? 1);
  return state.employees.employees.filter(emp =>
    emp.alive
    && (req.targetEmployeeId === null || emp.id === req.targetEmployeeId)
    && holdsRequiredSkill(emp, req.requiredSkill)
    && (role === null || canDriveTier(emp, role, neededTier)),
  );
}

/**
 * Derived reachability per game state, never serialized. Valid for one nav grid
 * at one `revision`: labellings ignore occupancy, so only a cell write
 * invalidates. One labelling per clearance, built the first time a pool needs it.
 */
interface ReachCache {
  navGrid: NavGrid;
  revision: number;
  components: Map<number, ClimbComponents>;
}

const reachCaches = new WeakMap<GameState, ReachCache>();

function cacheFor(state: GameState): ReachCache | null {
  const navGrid = state.navGrid;
  if (navGrid === null) {
    reachCaches.delete(state);
    return null;
  }
  let cache = reachCaches.get(state);
  if (cache === undefined || cache.navGrid !== navGrid || cache.revision !== navGrid.revision) {
    cache = { navGrid, revision: navGrid.revision, components: new Map() };
    reachCaches.set(state, cache);
  }
  return cache;
}

function componentsOf(cache: ReachCache, clearance: number): ClimbComponents {
  let components = cache.components.get(clearance);
  if (components === undefined) {
    components = computeClimbComponents(cache.navGrid, clearance);
    cache.components.set(clearance, components);
  }
  return components;
}

function fillPool(
  state: GameState,
  cache: ReachCache,
  req: ActorRequirements,
  employees: ReadonlyArray<Employee>,
): ActorPool {
  const onFoot = componentsOf(cache, NAV_CLEARANCE_EMPLOYEE_CELLS).reachableFrom(employees);
  const role = req.requiredVehicleRole;
  if (role === null) return { hasActor: true, reachable: onFoot };

  const candidateIds = new Set(employees.map(e => e.id));
  const vehicles = state.vehicles.vehicles.filter(v => v.type === role);
  if (vehicles.length === 0) return NO_ACTORS;
  // Best licence among the candidates: a vehicle above it has no one able to drive it, so it is no actor.
  const bestLevel = employees.reduce((best, e) => Math.max(best, licenceLevelOf(e, role)), 0);
  const usable = vehicles.filter(v => {
    if (v.tier > bestLevel) return false;
    const driverId = vehicleDriverId(v);
    return (driverId !== null && candidateIds.has(driverId)) || onFoot.has(Math.round(v.x), Math.round(v.z));
  });
  return {
    hasActor: true,
    reachable: componentsOf(cache, NAV_CLEARANCE_VEHICLE_CELLS).reachableFrom(usable),
  };
}

function buildActorPool(state: GameState, req: ActorRequirements, cache: ReachCache | null): ActorPool {
  if (cache === null) return NO_ACTORS;
  const employees = candidateEmployees(state, req);
  if (employees.length === 0) return NO_ACTORS;

  const [only] = employees;
  if (req.targetEmployeeId !== null && req.requiredVehicleRole === null && only !== undefined) {
    const components = componentsOf(cache, NAV_CLEARANCE_EMPLOYEE_CELLS);
    return { hasActor: true, reachable: { has: (x, z) => components.canReach(only.x, only.z, x, z) } };
  }

  return fillPool(state, cache, req, employees);
}

export function buildOrderReachability(
  state: GameState,
  actions: ReadonlyArray<PendingAction>,
): OrderReachability {
  const pools = new Map<OrderActorKey, ActorPool>();
  const cache = cacheFor(state);
  for (const action of actions) {
    const key = orderActorKey(action);
    if (!pools.has(key)) pools.set(key, buildActorPool(state, action, cache));
  }
  return {
    canReach: (key, x, z) => pools.get(key)?.reachable?.has(x, z) ?? false,
    hasActor: key => pools.get(key)?.hasActor ?? false,
  };
}

interface Judgement {
  verdict: OrderReachabilityVerdict;
  hasActor: boolean;
}

/**
 * Verdict for each of `targets`. A ramp layer takes the verdict of the ramp's
 * first not-done segment (the layer next in line to dig), claimed or not, so
 * layers waiting behind a half-dug layer follow that layer's verdict and never
 * flicker red because of the carve step.
 */
function judgeActions(state: GameState, targets: ReadonlyArray<PendingAction>): Map<number, Judgement> {
  const verdicts = new Map<number, Judgement>();
  if (state.navGrid === null || targets.length === 0) return verdicts;

  const rampLeadOf = new Map<number, number>();
  for (const ramp of state.plannedRamps) {
    const next = ramp.segments.find(s => !s.done);
    if (next === undefined) continue;
    for (const segment of ramp.segments) rampLeadOf.set(segment.actionId, next.actionId);
  }

  const leadActionOf = (target: PendingAction): PendingAction | undefined => {
    const leadId = rampLeadOf.get(target.id);
    return leadId === undefined ? target : findById(state.pendingActions, actionIdOf, leadId);
  };
  const judged: PendingAction[] = [];
  for (const target of targets) {
    const repAction = leadActionOf(target);
    if (repAction !== undefined) judged.push(repAction);
  }
  const reach = buildOrderReachability(state, judged);
  const judgementOf = (action: PendingAction): Judgement => {
    const key = orderActorKey(action);
    const hasActor = reach.hasActor(key);
    const reachable = hasActor && reach.canReach(key, action.targetX, action.targetZ);
    return { verdict: reachable ? 'reachable' : 'unreachable', hasActor };
  };

  for (const target of targets) {
    const repAction = leadActionOf(target);
    verdicts.set(
      target.id,
      repAction !== undefined
        ? judgementOf(repAction)
        : { verdict: 'reachable', hasActor: true },
    );
  }
  return verdicts;
}

function queuedActions(state: GameState): PendingAction[] {
  return state.pendingActions.filter(a => a.status === 'queued');
}

/** Verdict per queued, unclaimed action id. Empty without a nav grid. */
export function judgeQueuedOrders(state: GameState): Map<number, OrderReachabilityVerdict> {
  const out = new Map<number, OrderReachabilityVerdict>();
  for (const [id, j] of judgeActions(state, queuedActions(state))) out.set(id, j.verdict);
  return out;
}

/**
 * Warning reason for an action nobody can currently work, independent of
 * geography: no vehicle / licence / skill among the employees able to work now.
 * A vehicle order where licensed and skilled employees both exist but nobody
 * holds both reports `no_dual_qualified_employee`.
 */
function availabilityReason(
  eligible: ReadonlyArray<Employee>,
  action: PendingAction,
  neededTierOf: (role: VehicleRole) => VehicleTier | null,
): BlockedOrderReason | null {
  const holdsSkill = (emps: ReadonlyArray<Employee>): boolean =>
    emps.some(emp => holdsRequiredSkill(emp, action.requiredSkill));
  const role = action.requiredVehicleRole;
  if (role !== null) {
    const needed = neededTierOf(role);
    if (needed === null) return 'no_vehicle_in_fleet';
    const licensed = eligible.filter(emp => canDriveTier(emp, role, needed));
    if (licensed.length === 0) {
      return eligible.some(emp => licenceLevelOf(emp, role) > 0) ? 'licence_level_too_low' : 'no_licensed_driver';
    }
    if (holdsSkill(licensed)) return null;
    return holdsSkill(eligible) ? 'no_dual_qualified_employee' : 'no_qualified_employee';
  }
  return holdsSkill(eligible) ? null : 'no_qualified_employee';
}

const actionIdOf = (action: PendingAction): number => action.id;
const ghostIdOf = (ghost: GhostPreview): number => ghost.id;

/** Stamp blockedReason and the ghost's red flag for `targets`; returns ids needing the unqualified modal. */
function classify(state: GameState, targets: ReadonlyArray<PendingAction>): Set<number> {
  const unqualifiedIds = new Set<number>();
  const tierByRole = new Map<VehicleRole, VehicleTier | null>();
  const neededTierOf = (role: VehicleRole): VehicleTier | null => {
    if (!tierByRole.has(role)) tierByRole.set(role, lowestFleetTier(state.vehicles.vehicles, role));
    return tierByRole.get(role) ?? null;
  };
  const eligible = state.employees.employees.filter(isEligibleForWork);
  const judgements = judgeActions(state, targets);
  const fragmentOf = createFragmentLookup(state);
  const fits = createStorageFit(state);
  let flipped = false;

  for (const action of targets) {
    const judgement = judgements.get(action.id);
    const red = judgement?.verdict === 'unreachable';
    const ghost = findById(state.ghostPreviews, ghostIdOf, action.id);
    if (ghost !== undefined && judgement !== undefined) {
      // Always stamp, so a blue ghost carries an explicit `false`; only a real
      // red/blue flip needs the renderer to re-sync.
      if ((ghost.unreachable === true) !== red) flipped = true;
      ghost.unreachable = red;
    }

    if (judgement !== undefined && red && judgement.hasActor) {
      // Auto-generated debris work outside the reachable set is a normal,
      // player-owned state (#1302), not a failed order: it waits silently.
      action.blockedReason = isAutoDebrisAction(action.type) ? 'debris_out_of_reach' : 'target_unreachable';
      action.blockedLicenceLevel = null;
      continue;
    }
    const reason = availabilityReason(eligible, action, neededTierOf);
    // Only a skill nobody alive holds raises the modal: a trainee or injured
    // holder is temporarily unavailable, not absent (gameplay-employee-skills rule 5).
    if (
      reason === 'no_qualified_employee'
      && action.requiredVehicleRole === null
      // Self-dispatched repair orders wait silently for a trained mechanic (#1393).
      && action.type !== 'repair_vehicle'
      && !state.employees.employees.some(emp => emp.alive && holdsRequiredSkill(emp, action.requiredSkill))
    ) {
      unqualifiedIds.add(action.id);
    }
    action.blockedReason = reason ?? haulBlockedReason(state, action, fragmentOf, fits);
    action.blockedLicenceLevel = reason === 'licence_level_too_low' && action.requiredVehicleRole !== null
      ? neededTierOf(action.requiredVehicleRole)
      : null;
  }
  if (flipped) state.ghostPreviewsRevision++;
  return unqualifiedIds;
}

/** Where each game's rotating debris slice resumes (#1603) — derived, never serialized, like `reachCaches`. */
const debrisCursors = new WeakMap<GameState, number>();

/**
 * `queued` with its auto-debris orders cut to `perCall` of them, rotating so
 * successive calls cover every one (#1603). A large blast queues thousands of
 * debris orders, and re-judging all of them every tick cost a frame's whole
 * budget on its own; their verdicts only colour ghosts and feed warnings — a
 * debris order is vehicle-gated, so it never reaches the unqualified modal —
 * so a verdict a few ticks old is fine. Every other order is judged every call.
 */
function sliceDebris(state: GameState, queued: PendingAction[], perCall: number): PendingAction[] {
  if (!Number.isFinite(perCall)) return queued;
  const debris: PendingAction[] = [];
  const out: PendingAction[] = [];
  for (const action of queued) (isAutoDebrisAction(action.type) ? debris : out).push(action);
  if (debris.length <= perCall) return queued;
  const start = (debrisCursors.get(state) ?? 0) % debris.length;
  for (let k = 0; k < perCall; k++) out.push(debris[(start + k) % debris.length]!);
  debrisCursors.set(state, start + perCall);
  return out;
}

/**
 * Classify every queued, unclaimed action: stamp `blockedReason`, flip each
 * ghost's `unreachable` flag (bumping `ghostPreviewsRevision` only on a flip),
 * and report the actions no eligible employee could ever perform.
 * A claimed ghost is never red. `debrisPerCall` (the tick's pass) judges only
 * that many auto-debris orders per call, rotating through them — see
 * `sliceDebris`.
 */
export function classifyQueuedOrders(state: GameState, debrisPerCall = Infinity): { unqualifiedIds: Set<number> } {
  let flipped = false;
  for (const ghost of state.ghostPreviews) {
    if (ghost.claimed && ghost.unreachable === true) {
      ghost.unreachable = false;
      flipped = true;
    }
  }
  if (flipped) state.ghostPreviewsRevision++;
  return { unqualifiedIds: classify(state, sliceDebris(state, queuedActions(state), debrisPerCall)) };
}

/** Classify one freshly dispatched action so its ghost is coloured before any tick. */
export function classifyNewOrder(state: GameState, actionId: number): void {
  const action = state.pendingActions.find(a => a.id === actionId);
  if (action === undefined || action.status !== 'queued') return;
  classify(state, [action]);
}

/** Re-classify after the player changed actors or the world with no tick running. Fires no events. */
export function refreshOrderReachability(state: GameState): void {
  classifyQueuedOrders(state);
}
