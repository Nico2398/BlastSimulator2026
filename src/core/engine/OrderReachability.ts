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
// A vehicle order's target may be a narrow approach cell beside a building:
// it counts as reachable when it touches the vehicle component (#1840).
// Temporary unavailability (injured, resting, training, busy) does not remove
// an actor: alive and on the roster is enough.

import type { NavGrid } from '../nav/NavGrid.js';
import { isProgressionSite, type GameState, type PendingAction, type BlockedOrderReason, type GhostPreview } from '../state/GameState.js';
import { findById } from '../state/IdIndex.js';
import { isDrillHoleBuried } from '../mining/BuriedHoles.js';
import type { Employee } from '../entities/Employee.js';
import { vehicleDriverId, vehicleMaxSlopeRatio } from '../entities/Vehicle.js';
import type { Vehicle, VehicleRole, VehicleTier } from '../entities/Vehicle.js';
import { retargetBesideRampLayers, retargetRampLayers } from './RampLayerRetarget.js';
import { lowestFleetTier, minVehicleTierFor } from './VehicleReservation.js';
import { clearWalkOnlyPin } from './TaskCancellation.js';
import { canDriveTier, licenceLevelOf } from '../entities/VehicleDriverAssignment.js';
import { isAutoDebrisAction, haulBlockedReason, createFragmentLookup, createStorageFit } from '../economy/HaulDispatch.js';
import { holdsRequiredSkill, isEligibleForWork } from '../entities/Employee.js';
import {
  computeClimbComponents,
  type ClimbComponents,
  type ReachableSet,
} from '../nav/NavGridReachability.js';
import { isChargeDeliveryPending } from '../mining/ExplosiveStock.js';
import { dockedFrom, withDockingCells } from '../nav/DockingReach.js';
import { buildingRingCells, buildingRingTouches } from '../nav/BuildingApproach.js';
import { haulDestinationOf } from '../economy/SpoilHeaps.js';
import { oreGradeScaleOf } from '../economy/OreGrade.js';
import { freightWarehouseSites, spoilHeapSites } from '../entities/BuildingWarehouse.js';
import { getBuildingDef } from '../entities/Building.js';
import { NAV_CLEARANCE_VEHICLE_CELLS, NAV_CLEARANCE_EMPLOYEE_CELLS, NAV_MAX_SLOPE_RATIO, VEHICLE_MAX_SLOPE_RATIO, VEHICLE_MAX_SLOPE_DEGREES } from '../config/balance.js';
import { steepestBlockingRamp } from '../mining/RampGrade.js';

/** Identity of the actor pool able to serve an order (skill + vehicle role, or one named employee). */
type OrderActorKey = string;

type OrderReachabilityVerdict = 'reachable' | 'unreachable';

/** Per-actor-pool reachability query over the current nav grid. */
interface OrderReachability {
  canReach(key: OrderActorKey, x: number, z: number): boolean;
  hasActor(key: OrderActorKey): boolean;
}

/** `type`/`payload` are optional: without them the order has no tier floor (1). */
type ActorRequirements = Pick<PendingAction, 'requiredSkill' | 'requiredVehicleRole' | 'targetEmployeeId'>
  & Partial<Pick<PendingAction, 'type' | 'payload'>>;

/** Lowest vehicle tier the order needs (1 without a vehicle role); the one place pools, verdicts and classification read it. */
function orderTierFloor(req: ActorRequirements): VehicleTier {
  if (req.requiredVehicleRole === null || req.type === undefined || req.payload === undefined) return 1;
  return minVehicleTierFor({ type: req.type, payload: req.payload });
}

export function orderActorKey(action: ActorRequirements): OrderActorKey {
  const floor = orderTierFloor(action);
  return `${action.requiredSkill ?? '-'}|${action.requiredVehicleRole ?? '-'}|${action.targetEmployeeId ?? '-'}${floor > 1 ? `|t${floor}` : ''}`;
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
  const neededTier = role === null ? 1 : (lowestFleetTier(state.vehicles.vehicles, role, orderTierFloor(req)) ?? 1);
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
 * invalidates. One labelling per clearance and climb limit, built the first time a pool needs it.
 */
interface ReachCache {
  navGrid: NavGrid;
  revision: number;
  components: Map<string, ClimbComponents>;
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

function componentsOf(cache: ReachCache, clearance: number, maxSlopeRatio: number = NAV_MAX_SLOPE_RATIO): ClimbComponents {
  const key = `${clearance}|${maxSlopeRatio}`;
  let components = cache.components.get(key);
  if (components === undefined) {
    components = computeClimbComponents(cache.navGrid, clearance, maxSlopeRatio);
    cache.components.set(key, components);
  }
  return components;
}

function fillPool(
  state: GameState,
  cache: ReachCache,
  req: ActorRequirements,
  employees: ReadonlyArray<Employee>,
  uniformRatio?: number,
): ActorPool {
  const onFoot = componentsOf(cache, NAV_CLEARANCE_EMPLOYEE_CELLS).reachableFrom(employees);
  const role = req.requiredVehicleRole;
  if (role === null) return { hasActor: true, reachable: onFoot };

  const candidateIds = new Set(employees.map(e => e.id));
  const floor = orderTierFloor(req);
  const vehicles = state.vehicles.vehicles.filter(v => v.type === role && v.tier >= floor);
  if (vehicles.length === 0) return NO_ACTORS;
  // Best licence among the candidates: a vehicle above it has no one able to drive it, so it is no actor.
  const bestLevel = employees.reduce((best, e) => Math.max(best, licenceLevelOf(e, role)), 0);
  const usable = vehicles.filter(v => {
    if (v.tier > bestLevel) return false;
    const driverId = vehicleDriverId(v);
    return (driverId !== null && candidateIds.has(driverId)) || onFoot.has(Math.round(v.x), Math.round(v.z));
  });
  // Every vehicle climbs at the site's one vehicle limit (#2045).
  const ratio = uniformRatio ?? vehicleMaxSlopeRatio(isProgressionSite(state));
  // A vehicle parked on a docking cell stands for the cells it docked from (#2045).
  const vehicleReach = componentsOf(cache, NAV_CLEARANCE_VEHICLE_CELLS, ratio).reachableFrom(dockedFrom(cache.navGrid, usable, NAV_CLEARANCE_VEHICLE_CELLS));
  // A clearance-1 approach cell beside a building is where a vehicle docks (#1840).
  // Role-agnostic: applies to every vehicle-gated order, not only demolition.
  return { hasActor: true, reachable: withDockingCells(cache.navGrid, vehicleReach, NAV_CLEARANCE_VEHICLE_CELLS) };
}

function buildActorPool(state: GameState, req: ActorRequirements, cache: ReachCache | null, uniformRatio?: number): ActorPool {
  if (cache === null) return NO_ACTORS;
  const employees = candidateEmployees(state, req);
  if (employees.length === 0) return NO_ACTORS;

  const [only] = employees;
  if (req.targetEmployeeId !== null && req.requiredVehicleRole === null && only !== undefined) {
    const components = componentsOf(cache, NAV_CLEARANCE_EMPLOYEE_CELLS);
    return { hasActor: true, reachable: { has: (x, z) => components.canReach(only.x, only.z, x, z) } };
  }

  return fillPool(state, cache, req, employees, uniformRatio);
}

/**
 * Climb reachability for one employee on foot, from the labelling the order
 * pools already share (#1603): `canReach(x, z, tx, tz)` answers exactly what
 * `computeClimbReachableSet(navGrid, x, z).has(tx, tz)` does, without a flood
 * fill per question. Null with no nav grid.
 */
export function employeeClimbReach(state: GameState): ClimbComponents | null {
  const cache = cacheFor(state);
  return cache === null ? null : componentsOf(cache, NAV_CLEARANCE_EMPLOYEE_CELLS);
}

/**
 * Label the current nav grid for every clearance the order pools use, ahead
 * of the tick that would otherwise pay for it (#1603): a blast reshapes the
 * grid, and its first tick after classifying thousands of new haul orders
 * was the one that also relabelled it. Pure cache warm-up — no verdict changes.
 */
export function warmOrderReachability(state: GameState): void {
  const cache = cacheFor(state);
  if (cache === null) return;
  componentsOf(cache, NAV_CLEARANCE_EMPLOYEE_CELLS);
  componentsOf(cache, NAV_CLEARANCE_VEHICLE_CELLS, vehicleMaxSlopeRatio(isProgressionSite(state)));
}

export function buildOrderReachability(
  state: GameState,
  actions: ReadonlyArray<PendingAction>,
  uniformRatio?: number,
): OrderReachability {
  const pools = new Map<OrderActorKey, ActorPool>();
  const cache = cacheFor(state);
  for (const action of actions) {
    const key = orderActorKey(action);
    if (!pools.has(key)) pools.set(key, buildActorPool(state, action, cache, uniformRatio));
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
 * Whether a haul order's pool can also drive on to a depot for its rubble (a freight warehouse, or a spoil heap for
 * barren rock): a hauler that reaches the rubble in a pit with no road out can load it and never unload it, so the
 * order is out of reach until the player opens a way out (#2045). True for every other order, and while no depot of
 * the kind stands (the order then reads no warehouse or no spoil heap). Memoised per pool and destination.
 */
function haulDepotReach(state: GameState, reach: OrderReachability): (action: PendingAction, key: OrderActorKey) => boolean {
  const memo = new Map<string, boolean>();
  const fragmentOf = createFragmentLookup(state);
  const gradeScale = oreGradeScaleOf(state.world);
  return (action, key) => {
    if (action.type !== 'haul_debris') return true;
    const tracked = fragmentOf(action.payload['fragmentId'] as number);
    if (tracked === undefined) return true;
    const destination = haulDestinationOf(tracked.fragment, gradeScale);
    const memoKey = `${key}|${destination}`;
    let reaches = memo.get(memoKey);
    if (reaches === undefined) {
      const sites = destination === 'spoil_heap' ? spoilHeapSites(state.buildings) : freightWarehouseSites(state.buildings);
      reaches = sites.length === 0 || sites.some(site => {
        const depot = state.buildings.buildings.find(b => b.id === site.id);
        return depot !== undefined && buildingRingTouches(depot, getBuildingDef(depot.type, depot.tier), (x, z) => reach.canReach(key, x, z));
      });
      memo.set(memoKey, reaches);
    }
    return reaches;
  };
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
  const reachesDepot = haulDepotReach(state, reach);
  const judgementOf = (action: PendingAction): Judgement => {
    const key = orderActorKey(action);
    const hasActor = reach.hasActor(key);
    const reachable = hasActor && reach.canReach(key, action.targetX, action.targetZ) && reachesDepot(action, key);
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
  neededTierOf: (role: VehicleRole, floor: VehicleTier) => VehicleTier | null,
  vehicles: ReadonlyArray<Vehicle>,
): BlockedOrderReason | null {
  const holdsSkill = (emps: ReadonlyArray<Employee>): boolean =>
    emps.some(emp => holdsRequiredSkill(emp, action.requiredSkill));
  const role = action.requiredVehicleRole;
  if (role !== null) {
    // Existing reasons win: nothing of the role owned, then nobody licensed at all; only then a missing reaching rig.
    const shortfall = roleShortfall(vehicles, eligible, role);
    if (shortfall !== null) return shortfall;
    const floor = orderTierFloor(action);
    if (floor > 1) {
      // A rig tier the order needs: owned and drivable by an eligible employee, else no reaching vehicle.
      const reaching = vehicles.some(v =>
        v.type === role && v.tier >= floor && eligible.some(emp => canDriveTier(emp, role, v.tier)));
      if (!reaching) return 'no_reaching_vehicle';
    }
    const needed = neededTierOf(role, floor);
    if (needed === null) return 'no_vehicle_in_fleet';
    const licensed = eligible.filter(emp => canDriveTier(emp, role, needed));
    if (licensed.length === 0) {
      return 'licence_level_too_low';
    }
    if (holdsSkill(licensed)) return null;
    return holdsSkill(eligible) ? 'no_dual_qualified_employee' : 'no_qualified_employee';
  }
  return holdsSkill(eligible) ? null : 'no_qualified_employee';
}

/**
 * Why a vehicle order is unreachable on a progression site, when the walking climb limit would reach it:
 * names the steepest built ramp too steep for vehicles (#1938, #2045).
 */
function rampTooSteepDetail(
  state: GameState,
  action: PendingAction,
  reachAtWalkingLimit: OrderReachability,
): PendingAction['blockedDetail'] | undefined {
  if (action.requiredVehicleRole === null || !reachAtWalkingLimit.canReach(orderActorKey(action), action.targetX, action.targetZ)) return undefined;
  const blocking = steepestBlockingRamp(state, VEHICLE_MAX_SLOPE_RATIO);
  if (blocking === null) return undefined;
  return {
    key: 'order.blocked.ramp_too_steep',
    params: {
      id: blocking.ramp.id,
      grade: Math.round(blocking.gradeDeg * 10) / 10,
      max: VEHICLE_MAX_SLOPE_DEGREES,
    },
  };
}

const actionIdOf = (action: PendingAction): number => action.id;
const ghostIdOf = (ghost: GhostPreview): number => ghost.id;

/** Stamp blockedReason and the ghost's red flag for `targets`; returns ids needing the unqualified modal. */
function classify(state: GameState, targets: ReadonlyArray<PendingAction>): Set<number> {
  const unqualifiedIds = new Set<number>();
  const tierByRole = new Map<string, VehicleTier | null>();
  const neededTierOf = (role: VehicleRole, floor: VehicleTier): VehicleTier | null => {
    const key = `${role}|${floor}`;
    if (!tierByRole.has(key)) tierByRole.set(key, lowestFleetTier(state.vehicles.vehicles, role, floor));
    return tierByRole.get(key) ?? null;
  };
  const eligible = state.employees.employees.filter(isEligibleForWork);
  const judgements = judgeActions(state, targets);
  const progression = isProgressionSite(state);
  let reachAtFlatLimit: OrderReachability | null = null; // built on the first red vehicle order of a progression site
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
      action.blockedReason = isDrillHoleBuried(state, action) ? 'buried_under_rubble'
        : isAutoDebrisAction(action.type) ? 'debris_out_of_reach' : 'target_unreachable';
      action.blockedLicenceLevel = null;
      delete action.blockedDetail;
      const role = action.requiredVehicleRole;
      if (role !== null && progression) {
        reachAtFlatLimit ??= buildOrderReachability(state, targets, NAV_MAX_SLOPE_RATIO);
        const detail = rampTooSteepDetail(state, action, reachAtFlatLimit);
        if (detail !== undefined) action.blockedDetail = detail;
      }
      continue;
    }
    delete action.blockedDetail;
    const reason = availabilityReason(eligible, action, neededTierOf, state.vehicles.vehicles);
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
    // Buried first: rubble over the hole is the cause a player can act on, even when the pit also reads unreachable.
    action.blockedReason = (isDrillHoleBuried(state, action) ? 'buried_under_rubble' : null)
      ?? reason
      ?? (isChargeDeliveryPending(action, state.tickCount) ? 'explosives_in_transit' : null)
      ?? haulBlockedReason(state, action, fragmentOf, fits);
    action.blockedLicenceLevel = action.requiredVehicleRole === null ? null
      : reason === 'licence_level_too_low' ? neededTierOf(action.requiredVehicleRole, orderTierFloor(action))
      : reason === 'no_reaching_vehicle' ? orderTierFloor(action)
      : null;
  }
  if (flipped) state.ghostPreviewsRevision++;
  return unqualifiedIds;
}

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
  // A save is untrusted input: anything but a safe non-negative integer restarts the rotation.
  const saved = state.debrisClassifyCursor;
  const start = (Number.isSafeInteger(saved) && saved! >= 0 ? saved! : 0) % debris.length;
  for (let k = 0; k < perCall; k++) out.push(debris[(start + k) % debris.length]!);
  state.debrisClassifyCursor = start + perCall;
  return out;
}

/**
 * A ramp layer's work target follows the digger's reach: a lead layer whose
 * band centre sits on an unreachable fill cell moves to a reachable column of
 * its own cells (else of the ramp's other segments, else a column beside them, #2082), so the verdict, ghost and dispatcher all read the same target.
 */
function retargetQueuedRampLayers(state: GameState): void {
  if (state.navGrid === null || state.plannedRamps.length === 0) return;
  const rampLayers = state.pendingActions.filter(a => a.status === 'queued' && a.type === 'dig_ramp_segment');
  if (rampLayers.length === 0) return;
  const reach = buildOrderReachability(state, rampLayers);
  const canReach = (action: PendingAction, x: number, z: number): boolean => reach.canReach(orderActorKey(action), x, z);
  retargetRampLayers(state, canReach);
  retargetBesideRampLayers(state, canReach);
}

/**
 * A queued order pinned to one employee by an interrupted walk (`walkOnlyPinnedBy`) goes back to the
 * whole pool once that employee can no longer perform it — a vehicle upgraded in place to a tier their
 * licence does not cover, say — else nobody could ever claim it (#2085). A permanent target is untouched.
 */
function releaseUnservableWalkPins(state: GameState): void {
  for (const action of state.pendingActions) {
    const pinned = action.targetEmployeeId;
    if (action.status !== 'queued' || pinned === null || action.payload['walkOnlyPinnedBy'] !== pinned) continue;
    if (!candidateEmployees(state, action).some(emp => emp.id === pinned)) clearWalkOnlyPin(action);
  }
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
  releaseUnservableWalkPins(state);
  retargetQueuedRampLayers(state);
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

/** Why no actor can serve `role`: the fleet holds no such vehicle, or no eligible employee is licensed to drive one; null when both exist. */
export function roleShortfall(
  vehicles: ReadonlyArray<Vehicle>,
  eligible: ReadonlyArray<Employee>,
  role: VehicleRole,
): 'no_vehicle_in_fleet' | 'no_licensed_driver' | null {
  if (!vehicles.some(v => v.type === role)) return 'no_vehicle_in_fleet';
  if (!eligible.some(emp => licenceLevelOf(emp, role) > 0)) return 'no_licensed_driver';
  return null;
}

/** Targets of queued orders of any type whose stamped verdict is debris_out_of_reach or buried_under_rubble (#2082); reads the stamped verdicts, no fill. */
export function strandedDebrisTargets(state: GameState): ReadonlyArray<{ x: number; z: number; y: number }> {
  const out: { x: number; z: number; y: number }[] = [];
  for (const a of state.pendingActions) {
    if (a.status !== 'queued') continue;
    if (a.blockedReason !== 'debris_out_of_reach' && a.blockedReason !== 'buried_under_rubble') continue;
    out.push({ x: a.targetX, z: a.targetZ, y: a.targetY });
  }
  return out;
}

/**
 * Whether a vehicle can drive to (x, z) from the rally point or from a haul depot (a freight warehouse or spoil heap,
 * docked onto from its ring), at the site's vehicle climb limit: the network a crater access ramp must start on (#2082)
 * and a parked vehicle is moved onto (#2045). A depot anchors it too, because the road that matters is the one the
 * loads travel: a building raised beside the rally can wall the rally into a pocket while the fleet hauls on (#2093).
 * Null without a nav grid or a rally point.
 */
export function siteVehicleReach(state: GameState): ((x: number, z: number) => boolean) | null {
  const cache = cacheFor(state);
  const rally = state.rallyPoint;
  if (cache === null || rally === undefined) return null;
  const ratio = vehicleMaxSlopeRatio(isProgressionSite(state));
  const rings = [...freightWarehouseSites(state.buildings), ...spoilHeapSites(state.buildings)].flatMap(site => {
    const depot = state.buildings.buildings.find(b => b.id === site.id);
    return depot === undefined ? [] : buildingRingCells(depot, getBuildingDef(depot.type, depot.tier));
  });
  const anchors = [rally, ...dockedFrom(cache.navGrid, rings, NAV_CLEARANCE_VEHICLE_CELLS)];
  const reach = componentsOf(cache, NAV_CLEARANCE_VEHICLE_CELLS, ratio).reachableFrom(anchors);
  return (x, z) => reach.has(x, z);
}
