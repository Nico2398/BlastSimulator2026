// BlastSimulator2026 — queued-order reachability classification (#1306)
//
// A queued action is "unreachable" (its ghost reads red) when none of the actors
// able to perform THAT action can reach its target, or no such actor exists.
// Actors are worked out per action from its own requirements (skill, vehicle
// role) and grouped by that key, so the cost is one employee fill plus (for
// vehicle-gated keys) one vehicle fill per distinct key. An order aimed at one
// named employee on foot (a rest order) is answered from a single shared
// labelling of the grid instead of a fill of its own, so N such orders cost one
// pass, not N — bounded by the grid and the distinct keys, never by actors.
// Temporary unavailability (injured, resting, training, busy) does not remove
// an actor: alive and on the roster is enough.

import type { NavGrid } from '../nav/NavGrid.js';
import type { GameState, PendingAction, BlockedOrderReason } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import { vehicleDriverId } from '../entities/Vehicle.js';
import { isLicensedForRole } from './VehicleReservation.js';
import { isAutoDebrisAction, haulBlockedReason, createFragmentLookup, createStorageFit } from '../economy/HaulDispatch.js';
import { holdsRequiredSkill, isEligibleForWork } from '../entities/Employee.js';
import {
  computeClimbReachableSetFromSources,
  computeClimbComponents,
  reachSourceCellIndex,
  type ClimbComponents,
  type ReachableSet,
} from '../nav/NavGridReachability.js';
import { NAV_CLEARANCE_VEHICLE_CELLS, NAV_CLEARANCE_EMPLOYEE_CELLS, ORDER_REACH_CACHE_MAX_KEYS } from '../config/balance.js';

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
  return state.employees.employees.filter(emp =>
    emp.alive
    && (req.targetEmployeeId === null || emp.id === req.targetEmployeeId)
    && holdsRequiredSkill(emp, req.requiredSkill)
    && (req.requiredVehicleRole === null || isLicensedForRole(emp, req.requiredVehicleRole)),
  );
}

/**
 * Derived reachability per game state, never serialized. Valid for one nav grid
 * at one `revision`: fills ignore occupancy, so only a cell write invalidates.
 * `fills` is in least-recently-used order (oldest first).
 */
interface ReachCache {
  navGrid: NavGrid;
  revision: number;
  components: ClimbComponents | null;
  fills: Map<OrderActorKey, { signature: string; pool: ActorPool }>;
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
    cache = { navGrid, revision: navGrid.revision, components: null, fills: new Map() };
    reachCaches.set(state, cache);
  }
  return cache;
}

function sortedUniqueCells(navGrid: NavGrid, sources: ReadonlyArray<{ x: number; z: number }>): number[] {
  const cells = new Set<number>();
  for (const s of sources) cells.add(reachSourceCellIndex(navGrid, s.x, s.z));
  return [...cells].sort((a, b) => a - b);
}

/**
 * Everything a fill-backed pool's reachable set depends on besides the grid.
 * Vehicles key on their rounded position, not the clamped fill cell: `fillPool`
 * tests the unclamped rounded cell against the on-foot set, so an out-of-grid
 * vehicle must not share a signature with the in-grid one it clamps onto.
 */
function poolSignature(state: GameState, navGrid: NavGrid, req: ActorRequirements, employees: ReadonlyArray<Employee>): string {
  const cells = sortedUniqueCells(navGrid, employees).join(',');
  const role = req.requiredVehicleRole;
  if (role === null) return cells;
  const ids = employees.map(e => e.id).sort().join(',');
  const vehicles = state.vehicles.vehicles
    .filter(v => v.type === role)
    .map(v => `${v.id}:${Math.round(v.x)},${Math.round(v.z)}:${vehicleDriverId(v) ?? '-'}`)
    .sort()
    .join(',');
  return `${cells}|${ids}|${vehicles}`;
}

function fillPool(
  state: GameState,
  navGrid: NavGrid,
  req: ActorRequirements,
  employees: ReadonlyArray<Employee>,
): ActorPool {
  const onFoot = computeClimbReachableSetFromSources(navGrid, employees, NAV_CLEARANCE_EMPLOYEE_CELLS);
  const role = req.requiredVehicleRole;
  if (role === null) return { hasActor: true, reachable: onFoot };

  const candidateIds = new Set(employees.map(e => e.id));
  const vehicles = state.vehicles.vehicles.filter(v => v.type === role);
  if (vehicles.length === 0) return NO_ACTORS;
  const usable = vehicles.filter(v => {
    const driverId = vehicleDriverId(v);
    return (driverId !== null && candidateIds.has(driverId)) || onFoot.has(Math.round(v.x), Math.round(v.z));
  });
  return {
    hasActor: true,
    reachable: computeClimbReachableSetFromSources(navGrid, usable, NAV_CLEARANCE_VEHICLE_CELLS),
  };
}

function buildActorPool(state: GameState, req: ActorRequirements, cache: ReachCache | null): ActorPool {
  if (cache === null) return NO_ACTORS;
  const navGrid = cache.navGrid;
  const employees = candidateEmployees(state, req);
  if (employees.length === 0) return NO_ACTORS;

  const [only] = employees;
  if (req.targetEmployeeId !== null && req.requiredVehicleRole === null && only !== undefined) {
    const components = cache.components ??= computeClimbComponents(navGrid, NAV_CLEARANCE_EMPLOYEE_CELLS);
    return { hasActor: true, reachable: { has: (x, z) => components.canReach(only.x, only.z, x, z) } };
  }

  const key = orderActorKey(req);
  const signature = poolSignature(state, navGrid, req, employees);
  const hit = cache.fills.get(key);
  cache.fills.delete(key); // re-inserted below as most recently used
  if (hit !== undefined && hit.signature === signature) {
    cache.fills.set(key, hit);
    return hit.pool;
  }
  const pool = fillPool(state, navGrid, req, employees);
  cache.fills.set(key, { signature, pool });
  return pool;
}

function evictOverflow(cache: ReachCache | null): void {
  if (cache === null) return;
  while (cache.fills.size > ORDER_REACH_CACHE_MAX_KEYS) {
    const oldest = cache.fills.keys().next();
    if (oldest.done === true) break;
    cache.fills.delete(oldest.value);
  }
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
  evictOverflow(cache);
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

  const byId = new Map(state.pendingActions.map(a => [a.id, a]));
  const rampLeadOf = new Map<number, number>();
  for (const ramp of state.plannedRamps) {
    const next = ramp.segments.find(s => !s.done);
    if (next === undefined) continue;
    for (const segment of ramp.segments) rampLeadOf.set(segment.actionId, next.actionId);
  }

  const leadActionOf = (target: PendingAction): PendingAction | undefined => {
    const leadId = rampLeadOf.get(target.id);
    return leadId === undefined ? target : byId.get(leadId);
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
  state: GameState,
  eligible: ReadonlyArray<Employee>,
  action: PendingAction,
): BlockedOrderReason | null {
  const holdsSkill = (emps: ReadonlyArray<Employee>): boolean =>
    emps.some(emp => holdsRequiredSkill(emp, action.requiredSkill));
  const role = action.requiredVehicleRole;
  if (role !== null) {
    if (!state.vehicles.vehicles.some(v => v.type === role)) return 'no_vehicle_in_fleet';
    const licensed = eligible.filter(emp => isLicensedForRole(emp, role));
    if (licensed.length === 0) return 'no_licensed_driver';
    if (holdsSkill(licensed)) return null;
    return holdsSkill(eligible) ? 'no_dual_qualified_employee' : 'no_qualified_employee';
  }
  return holdsSkill(eligible) ? null : 'no_qualified_employee';
}

/** Stamp blockedReason and the ghost's red flag for `targets`; returns ids needing the unqualified modal. */
function classify(state: GameState, targets: ReadonlyArray<PendingAction>): Set<number> {
  const unqualifiedIds = new Set<number>();
  const eligible = state.employees.employees.filter(isEligibleForWork);
  const judgements = judgeActions(state, targets);
  const fragmentOf = createFragmentLookup(state);
  const fits = createStorageFit(state);
  const ghostById = new Map(state.ghostPreviews.map(g => [g.id, g]));
  let flipped = false;

  for (const action of targets) {
    const judgement = judgements.get(action.id);
    const red = judgement?.verdict === 'unreachable';
    const ghost = ghostById.get(action.id);
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
      continue;
    }
    const reason = availabilityReason(state, eligible, action);
    // Only a skill nobody alive holds raises the modal: a trainee or injured
    // holder is temporarily unavailable, not absent (gameplay-employee-skills rule 5).
    if (
      reason === 'no_qualified_employee'
      && action.requiredVehicleRole === null
      && !state.employees.employees.some(emp => emp.alive && holdsRequiredSkill(emp, action.requiredSkill))
    ) {
      unqualifiedIds.add(action.id);
    }
    action.blockedReason = reason ?? haulBlockedReason(state, action, fragmentOf, fits);
  }
  if (flipped) state.ghostPreviewsRevision++;
  return unqualifiedIds;
}

/**
 * Classify every queued, unclaimed action: stamp `blockedReason`, flip each
 * ghost's `unreachable` flag (bumping `ghostPreviewsRevision` only on a flip),
 * and report the actions no eligible employee could ever perform.
 * A claimed ghost is never red.
 */
export function classifyQueuedOrders(state: GameState): { unqualifiedIds: Set<number> } {
  let flipped = false;
  for (const ghost of state.ghostPreviews) {
    if (ghost.claimed && ghost.unreachable === true) {
      ghost.unreachable = false;
      flipped = true;
    }
  }
  if (flipped) state.ghostPreviewsRevision++;
  return { unqualifiedIds: classify(state, queuedActions(state)) };
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
