// BlastSimulator2026 — planItinerary (#1088)
// Pure function that plans the ordered legs an employee would travel to
// reach a goal, at two fidelities: 'estimate' (octile heuristic, cheap,
// for action-cost ranking) and 'exact' (real pathfinding, for the
// executor). Nothing consumes this yet (phase 3a, see gameplay-vehicle-fleet).
// Read-only: never mutates state, never reserves/boards a vehicle.

import { isFootprintAction, type GameState, type PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Goal, Itinerary, Leg } from './Itinerary.js';
import { octileHeuristic, findExactPath } from '../nav/Pathfinding.js';
import { AGENT_WALK_SPEED, VEHICLE_TRANSPORT_PLANNING_ENABLED, VEHICLE_SEAT_COUNT, TRANSPORT_ALIGHT_FINISH_WALK_CELLS, NAV_CLEARANCE_EMPLOYEE_CELLS } from '../config/balance.js';
import { computeActionWorkTicks, cellsToTravelTicks } from './ActionSelection.js';
import { findFreeVehicleForRole } from './VehicleReservation.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';
import { getVehicleDefByTier, getAllVehicleRoles, findVehicleReservedForAction, vehicleRequiredClearanceCells, type Vehicle, type VehicleRole } from '../entities/Vehicle.js';
import { isDestinationOccupied } from './EntityMovementTick.js';
import { fragmentApproachCell } from '../economy/FragmentApproach.js';
import { isOversized } from '../mining/BlastCalc.js';
// Economy -> engine -> economy: findHaulDepotApproach (HaulingTask.ts) needs
// no vehicle/employee-claim machinery of its own, only a NavGrid lookup, so
// importing it here closes a cycle no differently than the existing
// MoveTo.ts -> PlanItinerary.ts -> VehicleReservation.ts one documented above
// — every edge is a function called from inside another function's body,
// never evaluated at module-load time.
import { findHaulDepotApproach } from '../economy/HaulingTask.js';
import { getBuildingDef } from '../entities/Building.js';
import { findBuildingApproachCell } from '../nav/BuildingApproach.js';

export type PlanFidelity = 'estimate' | 'exact';

/** Goal resolved to a travel target, the vehicle role (if any) it's gated behind, and its work ticks. */
export interface ResolvedGoal {
  targetX: number;
  targetZ: number;
  requiredVehicleRole: VehicleRole | null;
  workTicks: number;
  /** The goal's own action id, for a 'work' goal — used to look up an already-reserved vehicle. Null for 'reposition'/'rest', which never carry a required vehicle role. */
  actionId: number | null;
}

/**
 * Step 1 of planItinerary: resolves `goal` to a travel target and its
 * vehicle-gating, or null when the goal names something that doesn't exist
 * (an action or building id that's gone).
 *
 * `actionHint`, when supplied for a 'work' goal, is used directly instead of
 * an `Array.find` over `state.pendingActions` for it (#1090 perf follow-up:
 * ActionSelection.ts's estimateActionCost/resolveActionCost already hold the
 * exact action they're costing — re-finding it by id here made ranking a
 * pool of N candidates O(N) per candidate, O(N²) overall, the same class of
 * two-growing-collections cost the pool itself already guards against
 * elsewhere via createFragmentLookup. Every other caller of planItinerary
 * (moveTo's own 'reposition'/'work' goals) has no such action in hand and
 * simply omits the hint, falling back to the lookup unchanged.
 */
function resolveGoal(state: GameState, employee: Employee, goal: Goal, actionHint?: PendingAction): ResolvedGoal | null {
  if (goal.kind === 'work') {
    const action = actionHint ?? state.pendingActions.find(a => a.id === goal.actionId);
    if (!action) return null;
    return {
      targetX: action.targetX,
      targetZ: action.targetZ,
      requiredVehicleRole: action.requiredVehicleRole,
      workTicks: computeActionWorkTicks(state, employee, action),
      actionId: action.id,
    };
  }

  if (goal.kind === 'reposition') {
    return { targetX: goal.x, targetZ: goal.z, requiredVehicleRole: null, workTicks: 0, actionId: null };
  }

  // 'rest' (#1204): resolves to the building's ring approach cell — an
  // employee entering a building goes in on foot from its ring, never
  // straight onto its own (blocked) footprint origin — mirroring #1203's
  // identical resolution for the training-enrolment walk.
  const building = state.buildings.buildings.find(b => b.id === goal.buildingId);
  if (!building) return null;
  const def = getBuildingDef(building.type, building.tier);
  const approach = findBuildingApproachCell(state.navGrid, building, def, employee.x, employee.z);
  return { targetX: approach.x, targetZ: approach.z, requiredVehicleRole: null, workTicks: 0, actionId: null };
}

/**
 * Distance oracle shared by every leg this planner produces. 'estimate' is
 * the cheap octile heuristic and never fails. 'exact' calls the real
 * pathfinder, falling back to the octile heuristic when no NavGrid exists
 * yet — mirroring resolveActionCost's own null-navGrid convention
 * (ActionSelection.ts) — and returns null when the target is genuinely
 * unreachable on the current NavGrid.
 *
 * Uses `findExactPath` (Pathfinding.ts) rather than `findPath` directly:
 * `findPath` can report `found: true` after its own `clampToGrid` silently
 * redirected an out-of-bounds (toX, toZ) onto the nearest in-grid cell — a
 * "successful" path whose real endpoint is not the leg's own destX/destZ.
 * `findExactPath` rejects exactly that case (#1109). Locomotion's
 * `isLegArrived` checks the UNCLAMPED destX/destZ exactly, so a leg built
 * from a clamped path can never actually arrive: every following tick
 * re-resolves the identical clamped, already-there path, reports "moved"
 * with zero real movement, and never once hits a failed-path tick to trip
 * the stuck-abandon safety net (#1103, confirmed live:
 * level1-playthrough-win.json's own `vehicle move 3 to:10,-2` — a
 * corridor-clearing coordinate one row past the navmesh's own south edge —
 * parks employee #4 at the clamped (10,0) from tick 15 onward, indefinitely,
 * and EmployeeDispatch.ts's own mid-itinerary dispatch guard (#1089) then
 * correctly refuses to double-book them, permanently removing one of three
 * survivors from the roster for the rest of the run). Failing the plan here
 * — same outcome as a genuinely unreachable target — is what the
 * corridor-clearing use case already expects: the console's `vehicle move`
 * command surfaces "No route available" instead of installing a leg that
 * can never resolve.
 *
 * `avoidVehicles` (#1090, #954): threaded straight through to
 * `findExactPath`, mirroring `resolveActionCost`'s own former occupancy rule
 * (ActionSelection.ts, deleted along with `resolveVehicleGatedWalkTarget`) and
 * `Locomotion.ts`'s own `advanceLeg` (the executor) now that goal resolution
 * (and its vehicle-gated walk target) also lives in this planner. A drive leg
 * always passes `false` (see the drive-leg call site's own comment below — a
 * drive leg routes around live vehicle occupancy at each step instead, not
 * via this static flag). A foot leg (including the leg to reach and board a
 * vehicle) passes `!isDestinationOccupied(state, toX, toZ)`: normally
 * `true` — an ordinary walk avoids every occupied cell (vehicle- or
 * fragment-occupied alike; `isCellOccupied` treats both as one obstacle) —
 * except when the leg's own destination is itself occupied (boarding a
 * vehicle sitting there, or charging a hole a drill_rig still sits on), which
 * flips it to `false` so the walk can reach that exact occupied cell instead
 * of refusing a route to it. A vehicle boxed in by other vehicles on every
 * neighbour cell is still reachable via its own board leg (destination = the
 * vehicle's own, always-occupied, cell); a target boxed in by FRAGMENT
 * occupancy with its own cell unoccupied stays correctly unreachable either
 * way, since that destination's own occupancy state is what the exemption
 * keys off, not the obstacle type blocking the cells around it.
 */
export function estimateLegDistance(
  state: GameState,
  fidelity: PlanFidelity,
  agentId: number,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  avoidVehicles: boolean,
  requiredClearance: number = NAV_CLEARANCE_EMPLOYEE_CELLS,
): number | null {
  if (fidelity === 'estimate' || state.navGrid === null) {
    return octileHeuristic(fromX, fromZ, toX, toZ);
  }

  const path = findExactPath(state.navGrid, { agentId, fromX, fromZ, toX, toZ, avoidVehicles, requiredClearance });
  return path.found ? path.totalCost : null;
}

/**
 * The foot-to-vehicle leg every fresh (not-yet-mounted) vehicle-gated
 * itinerary starts with: walk to within one tile of `vehicle` and board it.
 * Shared by planItinerary's own vehicle-gated branch below and MoveTo.ts's
 * board-only itinerary (`moveTo(state, id, {vehicleId})`), which is exactly
 * this one leg with nothing appended after it.
 */
export function buildBoardLeg(
  state: GameState,
  employee: Employee,
  vehicle: Vehicle,
  fidelity: PlanFidelity,
): Leg | null {
  // Never avoid vehicle occupancy on the way to a vehicle we are going to
  // board (#1166). `!isDestinationOccupied(...)` asked the NavGrid whether a
  // vehicle is standing on the destination — but for this leg the answer is
  // true by construction, since the destination IS `vehicle`'s own cell. It
  // only ever read false when the grid's occupancy was stale, which it
  // routinely is for a vehicle that has never moved: NavGrid.build seeds
  // `vehicleOccupied` from the vehicle list and Locomotion.ts's
  // writeVehiclePosition maintains it thereafter, so a vehicle bought into an
  // already-built world is marked by neither until its first drive.
  //
  // Read false, this planned `avoidVehicles: true` instead, and the walk to
  // board had to dodge every OTHER parked vehicle. Under #1151's slope gate
  // that is frequently no route at all — on seed 42 the starting fleet parks
  // across z=2, the only climb-legal row off the crew's z=0 spawn strip, so
  // `vehicle driver 5 3` was refused "No route to vehicle" for a vehicle
  // whose cell findPath reaches in 37 waypoints with the flag off.
  const footDist = estimateLegDistance(state, fidelity, employee.id, employee.x, employee.z, vehicle.x, vehicle.z, false);
  if (footDist === null) return null;

  return {
    mode: 'foot',
    vehicleId: vehicle.id,
    destX: vehicle.x,
    destZ: vehicle.z,
    arrival: 'adjacent',
    onArrive: { kind: 'board', vehicleId: vehicle.id },
    estTicks: cellsToTravelTicks(footDist, AGENT_WALK_SPEED),
  };
}

/**
 * Whether `vehicle` has a free seat for `employee` — already aboard counts as
 * free (continuity never needs a second seat). Shared with MoveTo.ts's
 * board-only itinerary, which runs the identical availability check before
 * committing to a route.
 */
export function hasFreeSeatFor(vehicle: Vehicle, employee: Employee): boolean {
  return vehicle.occupantIds.includes(employee.id) || vehicle.occupantIds.length < VEHICLE_SEAT_COUNT[vehicle.type];
}

/**
 * Resolves which vehicle a vehicle-gated goal drives: an explicit `via` hint
 * names it outright (must still have a free seat); absent that, reuse the
 * reservation already made for `reservedActionId`, if any, otherwise the
 * cheapest free vehicle of `role`. Shared by planItinerary's own generic
 * vehicle-gated branch and planFragmentTaskItinerary below — both resolve a
 * goal's vehicle identically, differing only in what they build the
 * itinerary out of once they have it (#1091).
 */
function resolveVehicleForGoal(
  state: GameState,
  employee: Employee,
  role: VehicleRole,
  via: number | undefined,
  reservedActionId: number | null,
): Vehicle | null {
  if (via !== undefined) {
    const vehicle = state.vehicles.vehicles.find(v => v.id === via);
    return vehicle && hasFreeSeatFor(vehicle, employee) ? vehicle : null;
  }

  const reserved = reservedActionId !== null
    ? findVehicleReservedForAction(state.vehicles, reservedActionId)
    : null;
  return reserved ?? findFreeVehicleForRole(state, role, employee) ?? null;
}

/**
 * A zero-length alight leg for an employee currently mounted in a DIFFERENT
 * vehicle than the one they're about to board — null when not mounted at
 * all (nothing to alight from first). #1103: without this, a foot leg
 * walking to board a new vehicle would move employee.x/z on its own while
 * the old vehicle, whose x/z is written only from ITS OWN occupant's advance
 * (Locomotion.ts), never moves, instantly splitting the two positions apart
 * (I2). Applying the 'alight' step the very same tick it becomes current
 * (Locomotion.advanceItinerary's own continuity-leg handling) avoids idling a
 * tick for a movement that would never fire. Shared, via buildMountLegs
 * below, by planItinerary's own generic vehicle-gated branch and
 * planFragmentTaskItinerary (#1091).
 */
function buildAlightLegIfMountedElsewhere(employee: Employee): Leg | null {
  if (!isMounted(employee.locomotion)) return null;
  return {
    mode: 'foot',
    vehicleId: null,
    destX: employee.x,
    destZ: employee.z,
    arrival: 'exact',
    onArrive: { kind: 'alight' },
    estTicks: 0,
  };
}

/**
 * The mount sequence every vehicle-gated itinerary needs before it can drive
 * anywhere: already mounted in `vehicle` keeps continuity (no legs, drive
 * from the employee's own position); otherwise alight-if-mounted-elsewhere
 * then board `vehicle`, driving from its position instead once boarded.
 * Shared by planItinerary's own generic vehicle-gated branch,
 * planFragmentTaskItinerary and buildTransportRideItinerary below — all
 * three need this exact prefix before diverging on what they drive to
 * (#1091, #1093). Returns null when no route to board `vehicle` exists
 * (buildBoardLeg failed), same "stays queued, retries next tick" contract as
 * every other null return in this file.
 *
 * Also returns `def` (`getVehicleDefByTier(vehicle.type, vehicle.tier)`):
 * every caller needs it right after this call to time its own drive leg, so
 * computing it here once — `vehicle` is already in hand — saves each of the
 * three call sites its own identical lookup.
 */
function buildMountLegs(
  state: GameState,
  employee: Employee,
  vehicle: Vehicle,
  fidelity: PlanFidelity,
): { legs: Leg[]; driveFromX: number; driveFromZ: number; def: ReturnType<typeof getVehicleDefByTier> } | null {
  const def = getVehicleDefByTier(vehicle.type, vehicle.tier);

  if (isMounted(employee.locomotion) && mountedVehicleId(employee.locomotion) === vehicle.id) {
    return { legs: [], driveFromX: employee.x, driveFromZ: employee.z, def };
  }

  const legs: Leg[] = [];
  const alightLeg = buildAlightLegIfMountedElsewhere(employee);
  if (alightLeg) legs.push(alightLeg);

  const boardLeg = buildBoardLeg(state, employee, vehicle, fidelity);
  if (boardLeg === null) return null;
  legs.push(boardLeg);

  const driveFromX = vehicle.x;
  const driveFromZ = vehicle.z;
  return { legs, driveFromX, driveFromZ, def };
}

/**
 * Shared unreachable-target gate for `buildDriveLeg` and
 * `buildFootOnlyItinerary` (#1178): `dist` is the real estimate from
 * `estimateLegDistance`, or null when the target isn't reachable right now.
 * A plain call must still fail fast on that (returns null, same "stays
 * queued, retries next tick" contract as every other null return in this
 * file) — but a caller that opted into `allowUnreachable` wants a
 * best-effort route anyway, so it falls back to the octile heuristic for
 * the distance and still gets a leg installed. advanceLeg/advanceItinerary's
 * existing stuck/abandon tracking (Locomotion.ts) takes it from here if the
 * route genuinely never resolves.
 */
function resolveEffectiveDistance(
  dist: number | null,
  allowUnreachable: boolean,
  fromX: number, fromZ: number, toX: number, toZ: number,
): number | null {
  if (dist === null && !allowUnreachable) return null;
  return dist ?? octileHeuristic(fromX, fromZ, toX, toZ);
}

/**
 * A drive leg from (`fromX`, `fromZ`) to (`toX`, `toZ`), timed at
 * `def.speed`, ending in `onArrive` — the shape four sites in this file
 * build: the resumed-cargo depot leg, the fresh drive-to-fragment leg, the
 * depot leg for a fresh haul (all three ending in an `{ kind: 'effect' }`
 * step), and the generic vehicle-gated branch's own plain drive leg (ending
 * in `{ kind: 'none' }`) (#1091). `avoidVehicles` is always `false`: mirrors
 * Locomotion.ts's own advanceLeg (the executor) — a drive leg ignores
 * NavCell.vehicleOccupied entirely at the static-pathfinding level (a
 * vehicle must be able to drive onto another vehicle's or a fragment's cell
 * to interact with it) and instead routes around a live vehicle-vs-vehicle
 * occupancy check at each step, not baked into this route-cost estimate.
 * Returns null when no route exists, same "stays queued, retries next tick"
 * contract as every other null return in this file.
 *
 * `arrival` (phase 7, #1093): 'exact' for every existing call site (a drive
 * leg that ends the itinerary or hands off to a work/haul effect at the
 * precise target); 'adjacent' for a transport-ride leg that alights near the
 * target rather than on it, leaving a short foot leg to finish the trip.
 */
function buildDriveLeg(
  state: GameState,
  fidelity: PlanFidelity,
  vehicle: Vehicle,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  onArrive: Leg['onArrive'],
  def: ReturnType<typeof getVehicleDefByTier>,
  arrival: 'exact' | 'adjacent',
  // #1178: when true, an unreachable-right-now target still installs a leg
  // (octile-heuristic estTicks) instead of refusing the plan — see this
  // function's own doc comment above `dist`.
  allowUnreachable: boolean,
): Leg | null {
  const dist = estimateLegDistance(state, fidelity, vehicle.id, fromX, fromZ, toX, toZ, false, vehicleRequiredClearanceCells(vehicle));
  const effectiveDist = resolveEffectiveDistance(dist, allowUnreachable, fromX, fromZ, toX, toZ);
  if (effectiveDist === null) return null;

  return {
    mode: 'drive',
    vehicleId: vehicle.id,
    destX: toX,
    destZ: toZ,
    arrival,
    onArrive,
    estTicks: cellsToTravelTicks(effectiveDist, def.speed),
  };
}

/**
 * A single foot leg straight from `employee`'s own position to
 * (`targetX`, `targetZ`), at walking speed, plus `workTicks` of work once
 * there. Shared by planItinerary's own no-vehicle-role branch and its
 * no-vehicle-available fallback for a vehicle-gated goal (see that call
 * site's own doc comment) — both plan the identical single-leg itinerary,
 * differing only in why no vehicle enters the route. Refuses (returns null)
 * for a target unreachable right now UNLESS the caller opts in via
 * `allowUnreachable` (#1178, single-mover unification, mirroring
 * `buildDriveLeg`'s identical gate) — an unreachable-right-now target then
 * still gets a leg, timed off the octile heuristic instead of a real path —
 * see the `dist` fallback below. Default `false`: a plain reposition/claim
 * call must still fail fast for a genuinely-unreachable target (e.g. #1109's
 * out-of-bounds case, or an employee boxed in on every neighbour cell) —
 * only `beginRestTravel` and Zone.ts's foot-evacuee branch opt in.
 */
function buildFootOnlyItinerary(
  state: GameState,
  employee: Employee,
  goal: Goal,
  fidelity: PlanFidelity,
  targetX: number,
  targetZ: number,
  workTicks: number,
  allowUnreachable: boolean,
): Itinerary | null {
  const dist = estimateLegDistance(state, fidelity, employee.id, employee.x, employee.z, targetX, targetZ, !isDestinationOccupied(state, targetX, targetZ));
  const effectiveDist = resolveEffectiveDistance(dist, allowUnreachable, employee.x, employee.z, targetX, targetZ);
  if (effectiveDist === null) return null;

  const footLeg: Leg = {
    mode: 'foot',
    vehicleId: null,
    destX: targetX,
    destZ: targetZ,
    arrival: 'exact',
    // #1204: a rest goal's foot leg ends by entering the living_quarters it
    // targets, unseen for the whole stay, instead of resting visibly on its
    // ring — mirrors #1203's identical enter_building step for training.
    onArrive: goal.kind === 'rest' ? { kind: 'enter_building', buildingId: goal.buildingId } : { kind: 'none' },
    estTicks: cellsToTravelTicks(effectiveDist, AGENT_WALK_SPEED),
  };

  return { legs: [footLeg], goal, workTicks, estTotalTicks: footLeg.estTicks + workTicks };
}

/**
 * Plans a haul_debris/fragment_debris work goal's itinerary: the fragment-
 * targeting drive leg(s) — to the fragment, and for a haul, on to the depot —
 * each ending in an ArrivalEffects.ts effect (`haul_load`, `haul_unload`,
 * `boulder_split`) rather than the generic single-target-then-work shape
 * `planItinerary`'s own fallback below builds for every other action type.
 * Split out because these two action types are the only ones needing more
 * than one drive leg to reach their work (#1091 — see HaulingTask.ts's and
 * BoulderBreaking.ts's own reduced surface, which used to drive this
 * themselves via tickHaulingProgress/tickBreakProgress phase machines on
 * `Vehicle`).
 */
function planFragmentTaskItinerary(
  state: GameState,
  employee: Employee,
  goal: Goal,
  fidelity: PlanFidelity,
  action: PendingAction,
  opts?: { via?: number },
): Itinerary | null {
  const role = action.requiredVehicleRole;
  if (role === null) return null; // defensive — both action types always carry a role

  const vehicle = resolveVehicleForGoal(state, employee, role, opts?.via, action.id);
  if (!vehicle) return null;

  const fragmentId = action.payload['fragmentId'];
  if (typeof fragmentId !== 'number') return null;

  const mount = buildMountLegs(state, employee, vehicle, fidelity);
  if (mount === null) return null;
  const { legs, driveFromX, driveFromZ, def } = mount;

  // Resume-after-interruption (#1091): the reserved vehicle already carries
  // this exact fragment as payload — its haul_load leg already ran before an
  // earlier policy-driven interruption/pause left the reservation (and the
  // cargo) intact rather than releasing it (isCommittedToOwnCargo,
  // VehicleReservation.ts). Only the depot leg is left to plan.
  if (action.type === 'haul_debris' && vehicle.payload !== null && vehicle.payload.fragmentId === fragmentId) {
    const depotApproach = findHaulDepotApproach(state, driveFromX, driveFromZ);
    if (depotApproach === null) return null;

    const depotLeg = buildDriveLeg(state, fidelity, vehicle, driveFromX, driveFromZ, depotApproach.x, depotApproach.z, { kind: 'effect', effectId: 'haul_unload' }, def, 'exact', false);
    if (depotLeg === null) return null;
    legs.push(depotLeg);

    return { legs, goal, workTicks: 0, estTotalTicks: legs.reduce((sum, leg) => sum + leg.estTicks, 0) };
  }

  // A fresh haul, or a break — both start with a drive to the fragment
  // itself. Re-validated here (not just at claim time): the fragment must
  // still be on_ground, and (haul only) not have become oversized, or
  // (break only) still be oversized, by the time this itinerary is actually
  // planned/replanned.
  const tracked = state.logistics.fragments.find(f => f.fragment.id === fragmentId && f.state === 'on_ground');
  if (!tracked) return null;
  if (action.type === 'fragment_debris' && !isOversized(tracked.fragment.volume)) return null;
  if (action.type === 'haul_debris' && isOversized(tracked.fragment.volume)) return null;

  const approach = fragmentApproachCell(tracked.fragment, state, vehicle.id);
  const toFragmentLeg = buildDriveLeg(state, fidelity, vehicle, driveFromX, driveFromZ, approach.x, approach.z, { kind: 'effect', effectId: action.type === 'haul_debris' ? 'haul_load' : 'boulder_split' }, def, 'exact', false);
  if (toFragmentLeg === null) return null;
  legs.push(toFragmentLeg);

  if (action.type === 'fragment_debris') {
    return { legs, goal, workTicks: 0, estTotalTicks: legs.reduce((sum, leg) => sum + leg.estTicks, 0) };
  }

  // haul_debris: one more leg on to the depot — no active one means this
  // goal stays unresolvable, same "stays queued, retries next tick" contract
  // as every other null return in this file.
  const depotApproach = findHaulDepotApproach(state, approach.x, approach.z);
  if (depotApproach === null) return null;

  const toDepotLeg = buildDriveLeg(state, fidelity, vehicle, approach.x, approach.z, depotApproach.x, depotApproach.z, { kind: 'effect', effectId: 'haul_unload' }, def, 'exact', false);
  if (toDepotLeg === null) return null;
  legs.push(toDepotLeg);

  return { legs, goal, workTicks: 0, estTotalTicks: legs.reduce((sum, leg) => sum + leg.estTicks, 0) };
}

/**
 * True when `action` is one of the two action types (`isFootprintAction`,
 * GameState.ts) whose own target cell(s) stop being walkable once the
 * action completes — `place_building` (the footprint goes permanently
 * NavGrid-blocked) and `level_ground` (actively carved out from under
 * whoever's standing there).
 *
 * A transport ride must never alight on ground it cannot guarantee stays
 * walkable: unlike every other 'work' goal (survey, charge_hole, drill_hole,
 * general_work, ...), which never changes its own target's walkability,
 * these two can turn the exact cell a borrowed vehicle just parked on into
 * permanently blocked terrain — stranding it there for good. Since
 * `findFreeVehicleForRole` picks the nearest free vehicle by raw distance
 * with no reachability check of its own, every later dispatch call that
 * would otherwise pick a stranded vehicle as "nearest free" fails
 * identically, starving whichever employee keeps landing on it (confirmed
 * live via buildings.integration.test.ts's #1000 starved-backlog
 * regression). `buildTransportRideItinerary` skips riding entirely for
 * these two rather than trying to compute a footprint-aware safe alight
 * point: a multi-cell footprint's approach path walks straight through its
 * own interior to reach a target cell that isn't necessarily on its edge,
 * so any fixed backoff can still land inside it, and searching the real
 * path for the first waypoint outside an arbitrarily-sized footprint
 * perturbs dispatch pacing/positions enough, over a long run, to trigger an
 * unrelated latent two-vehicle depot-occupancy deadlock
 * (`Locomotion.ts`'s `handleOccupancyBlock`, which has no time-based
 * abandon escape for two actively-driven vehicles blocking each other) —
 * confirmed live via the same #1000 regression test timing out instead of
 * merely failing once that backoff search was in place. Riding to
 * construction/levelling work has little value anyway (a build order's own
 * target never moves), so scoping the ride comparison away from these two
 * action types costs nothing the feature is actually for.
 */
function targetBecomesBlocked(action: PendingAction | undefined): boolean {
  return action !== undefined && isFootprintAction(action.type);
}

/**
 * Resolves where a transport ride (`buildTransportRideItinerary`) should
 * alight: an actual cell on the real route to (`targetX`, `targetZ`),
 * `TRANSPORT_ALIGHT_FINISH_WALK_CELLS` waypoints short of it, rather than a
 * straight-line interpolated point.
 *
 * This must be a real path waypoint — always an integer NavGrid cell,
 * per `findExactPath`/`directLineWalk`'s own convention — and not an
 * arbitrary fractional point along the (`fromX`,`fromZ`)-to-target line: the
 * movement engine's own 'exact'-arrival completion test
 * (`AgentAdvance.ts`'s `legComplete`/`exhaustedFreshPath`) only ever snaps an
 * agent onto one of the fresh path's own integer waypoints, never onto an
 * arbitrary fractional `destX`/`destZ` that isn't one of them — a leg
 * targeting a synthesized non-waypoint fractional point can advance every
 * tick without `isLegArrived` (Locomotion.ts) ever once reporting true,
 * stalling the whole itinerary forever. Every other 'exact'-arrival leg in
 * this file already targets an integer cell (a building/depot/fragment
 * approach cell) for the same reason.
 *
 * 'estimate' fidelity never walks a real agent, so it skips the real
 * pathfind and returns a cheap straight-line-interpolated point instead —
 * accurate enough for cost ranking, and unreachable-safe since `estimate`
 * fidelity's own `estimateLegDistance` branch (octileHeuristic) never checks
 * walkability either.
 *
 * Returns null when the route doesn't exist, or when it's already within
 * `TRANSPORT_ALIGHT_FINISH_WALK_CELLS` waypoints of the target (no room to
 * alight short of it — riding wouldn't save anything over walking anyway).
 */
function resolveRideAlightPoint(
  state: GameState,
  fidelity: PlanFidelity,
  agentId: number,
  fromX: number,
  fromZ: number,
  targetX: number,
  targetZ: number,
  requiredClearance: number,
): { x: number; z: number } | null {
  if (fidelity === 'estimate' || state.navGrid === null) {
    const dx = targetX - fromX;
    const dz = targetZ - fromZ;
    const totalDist = Math.hypot(dx, dz);
    if (totalDist <= TRANSPORT_ALIGHT_FINISH_WALK_CELLS) return null;
    const rideFraction = (totalDist - TRANSPORT_ALIGHT_FINISH_WALK_CELLS) / totalDist;
    return { x: fromX + dx * rideFraction, z: fromZ + dz * rideFraction };
  }

  const path = findExactPath(state.navGrid, { agentId, fromX, fromZ, toX: targetX, toZ: targetZ, avoidVehicles: false, requiredClearance });
  if (!path.found || path.waypoints.length <= TRANSPORT_ALIGHT_FINISH_WALK_CELLS + 1) return null;

  const wp = path.waypoints[path.waypoints.length - 1 - TRANSPORT_ALIGHT_FINISH_WALK_CELLS]!;
  return { x: wp.x, z: wp.z };
}

/**
 * Builds a transport-ride itinerary for a non-vehicle-gated 'work' goal
 * (phase 7, #1093): mount legs onto `vehicle` (see `buildMountLegs`), then a
 * drive leg to the real-route alight point `resolveRideAlightPoint` computes
 * — `TRANSPORT_ALIGHT_FINISH_WALK_CELLS` waypoints short of
 * (`resolved.targetX`, `resolved.targetZ`) — with `onArrive: { kind:
 * 'alight', releaseVehicleForActionId: resolved.actionId }` (the ride is a
 * borrowed vehicle for this one trip, not a reservation the action itself
 * needs, so alighting must free it), then a foot leg covering the remaining
 * distance into the exact target.
 *
 * The drive leg is planned with `arrival: 'exact'` to that computed alight
 * point, rather than driving all the way to the target itself under a loose
 * `arrival: 'adjacent'` tolerance (distance <= 1, which includes 0 — a
 * single fast tick can, and did, overshoot straight onto the target cell
 * itself). Returns null for a `place_building`/`level_ground` goal outright
 * (`targetBecomesBlocked` — see its own doc comment), when
 * `resolved.actionId` is null (defensive — every caller already guards this),
 * when `resolveRideAlightPoint` finds no room to alight short of the target,
 * or when any leg's route doesn't exist — same "stays queued, retries next
 * tick" contract as every other null return in this file.
 */
export function buildTransportRideItinerary(
  state: GameState,
  employee: Employee,
  goal: Goal,
  fidelity: PlanFidelity,
  resolved: ResolvedGoal,
  vehicle: Vehicle,
  action?: PendingAction,
): Itinerary | null {
  if (targetBecomesBlocked(action)) return null;
  // Every caller of this function already guards resolved.actionId !== null
  // before calling it (planItinerary's own findCheapestTransportItinerary
  // call site) — this is a defensive self-check matching this file's own
  // "every unresolvable case returns null" contract, not a real dispatch
  // path.
  if (resolved.actionId === null) return null;

  const mount = buildMountLegs(state, employee, vehicle, fidelity);
  if (mount === null) return null;
  const { legs, driveFromX, driveFromZ, def } = mount;

  const alight = resolveRideAlightPoint(
    state, fidelity, employee.id, driveFromX, driveFromZ, resolved.targetX, resolved.targetZ,
    vehicleRequiredClearanceCells(vehicle),
  );
  if (alight === null) return null;

  const driveLeg = buildDriveLeg(
    state, fidelity, vehicle, driveFromX, driveFromZ, alight.x, alight.z,
    { kind: 'alight', releaseVehicleForActionId: resolved.actionId }, def, 'exact', false,
  );
  if (driveLeg === null) return null;
  legs.push(driveLeg);

  // Real remaining distance from wherever `alight` actually landed — not a
  // flat TRANSPORT_ALIGHT_FINISH_WALK_CELLS assumption — since a diagonal
  // waypoint step can be up to sqrt(2) cells from the target, not exactly 1.
  const footDist = estimateLegDistance(state, fidelity, employee.id, alight.x, alight.z, resolved.targetX, resolved.targetZ, !isDestinationOccupied(state, resolved.targetX, resolved.targetZ));
  if (footDist === null) return null;

  const footLeg: Leg = {
    mode: 'foot',
    vehicleId: null,
    destX: resolved.targetX,
    destZ: resolved.targetZ,
    arrival: 'exact',
    onArrive: { kind: 'none' },
    estTicks: cellsToTravelTicks(footDist, AGENT_WALK_SPEED),
  };
  legs.push(footLeg);

  const estTotalTicks = legs.reduce((sum, leg) => sum + leg.estTicks, 0) + resolved.workTicks;
  return { legs, goal, workTicks: resolved.workTicks, estTotalTicks };
}

/**
 * Finds the cheapest ride itinerary across every vehicle role for a
 * non-vehicle-gated 'work' goal (phase 7, #1093): iterates
 * `getAllVehicleRoles()`, uses `findFreeVehicleForRole` to find a free
 * vehicle per role, builds a ride candidate per free role via
 * `buildTransportRideItinerary`, and returns the cheapest one — by
 * `estTotalTicks` — only when it is strictly cheaper than `footCost` (the
 * cost of the plain on-foot itinerary already available for this goal).
 * Returns null when no ride is cheaper than walking, or no vehicle role has
 * a free vehicle at all.
 */
export function findCheapestTransportItinerary(
  state: GameState,
  employee: Employee,
  goal: Goal,
  fidelity: PlanFidelity,
  resolved: ResolvedGoal,
  footCost: number,
  action?: PendingAction,
): Itinerary | null {
  let best: Itinerary | null = null;

  for (const role of getAllVehicleRoles()) {
    const vehicle = findFreeVehicleForRole(state, role, employee);
    if (!vehicle) continue;

    const candidate = buildTransportRideItinerary(state, employee, goal, fidelity, resolved, vehicle, action);
    if (candidate === null) continue;
    if (best === null || candidate.estTotalTicks < best.estTotalTicks) best = candidate;
  }

  return best !== null && best.estTotalTicks < footCost ? best : null;
}

export function planItinerary(
  state: GameState,
  employee: Employee,
  goal: Goal,
  fidelity: PlanFidelity,
  // #1089: a caller-supplied vehicle hint — moveTo's `via` — names the exact
  // vehicle to plan a reposition goal through, overriding the goal's own
  // (null, for 'reposition') role-based selection below. Reused by a 'work'
  // goal too (harmless: no caller passes both today), so the override lives
  // in one place rather than being special-cased per goal kind.
  // `action`, for a 'work' goal, is a perf-only hint — see resolveGoal's own
  // doc comment (#1090).
  // `allowUnreachable` (#1178, single-mover unification): threaded through to
  // buildDriveLeg's vehicle-gated drive leg below — a best-effort route
  // instead of a refusal when the target is unreachable right now.
  opts?: { via?: number; action?: PendingAction; allowUnreachable?: boolean },
): Itinerary | null {
  // haul_debris/fragment_debris (#1091): these two action types need more
  // than the generic single-drive-leg-then-work shape the rest of this
  // function builds, so they're diverted to their own planner up front —
  // see planFragmentTaskItinerary's own doc comment.
  if (goal.kind === 'work') {
    const action = opts?.action ?? state.pendingActions.find(a => a.id === goal.actionId);
    if (action && (action.type === 'haul_debris' || action.type === 'fragment_debris')) {
      return planFragmentTaskItinerary(state, employee, goal, fidelity, action, opts);
    }
  }

  const resolved = resolveGoal(state, employee, goal, opts?.action);
  if (resolved === null) return null;

  const role = resolved.requiredVehicleRole;
  // A 'reposition' goal carries no role of its own — an employee already
  // mounted planning one implicitly keeps driving the vehicle they're in
  // (Zone.ts's already-driven-relocate case: `moveTo(state,
  // vehicleDriverId(v), {x, z})`, no explicit `via`) rather than stepping off
  // it to walk, which
  // would desync their position from the vehicle's (I2) without ever
  // alighting. An explicit `via` always wins when both are present.
  const via = opts?.via ?? (
    goal.kind === 'reposition' && isMounted(employee.locomotion)
      ? mountedVehicleId(employee.locomotion) ?? undefined
      : undefined
  );

  if (role === null && via === undefined) {
    const footItinerary = buildFootOnlyItinerary(state, employee, goal, fidelity, resolved.targetX, resolved.targetZ, resolved.workTicks, opts?.allowUnreachable ?? false);
    if (footItinerary === null) return null;

    if (VEHICLE_TRANSPORT_PLANNING_ENABLED && goal.kind === 'work' && resolved.actionId !== null) {
      // Same hint-with-fallback convention as resolveGoal's own actionHint
      // (#1090) — every current caller already supplies opts.action, this
      // just keeps a caller that doesn't from silently losing the footprint
      // guard `resolveRideAlightPoint` relies on.
      const action = opts?.action ?? state.pendingActions.find(a => a.id === resolved.actionId);
      const transportItinerary = findCheapestTransportItinerary(state, employee, goal, fidelity, resolved, footItinerary.estTotalTicks, action);
      if (transportItinerary !== null) return transportItinerary;
    }

    return footItinerary;
  }

  // Vehicle-gated: an explicit `via` hint names the vehicle outright; absent
  // that, reuse the reservation already made for this action, if any,
  // otherwise the cheapest free vehicle of the required role — same lookup
  // resolveVehicleGatedWalkTarget (ActionSelection.ts, deleted along with
  // this whole function) used. #1090: unlike a "defensive" fallback to a
  // plain on-foot walk when no vehicle is reserved or free, planItinerary
  // reports this goal genuinely unresolvable — a vehicle-gated action has no
  // valid on-foot substitute, so a route that doesn't actually exist in the
  // real dispatch (no vehicle to drive) must not be costed as though it
  // does. Matches findVehicleForClaim's own real dispatch-time refusal in
  // this state.
  const vehicle = resolveVehicleForGoal(state, employee, role!, via, resolved.actionId);
  if (!vehicle) return null;

  const mount = buildMountLegs(state, employee, vehicle, fidelity);
  if (mount === null) return null;
  const { legs, driveFromX, driveFromZ, def } = mount;

  const driveLeg = buildDriveLeg(state, fidelity, vehicle, driveFromX, driveFromZ, resolved.targetX, resolved.targetZ, { kind: 'none' }, def, 'exact', opts?.allowUnreachable ?? false);
  if (driveLeg === null) return null;
  legs.push(driveLeg);

  const estTotalTicks = legs.reduce((sum, leg) => sum + leg.estTicks, 0) + resolved.workTicks;
  return { legs, goal, workTicks: resolved.workTicks, estTotalTicks };
}
