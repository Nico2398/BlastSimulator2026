// BlastSimulator2026 — Itinerary shape (#1088)
// Pure data types for the ordered legs an employee travels to reach a goal:
// foot to a vehicle, drive to a work site, then work. Produced by
// planItinerary (PlanItinerary.ts) and consumed by the locomotion tick.
// Composes only primitives — no imports from entities/ or state/, so both
// the estimator and the executor can share this shape without coupling to
// GameState's internal fields.

/** Registered arrival effect ids an itinerary leg's `onArrive` may name. */
export type ArrivalEffectId = 'haul_load' | 'haul_unload' | 'boulder_split';

/** What happens the instant a leg's destination is reached. */
export type ArrivalStep =
  | { kind: 'none' }
  | { kind: 'board'; vehicleId: number }
  | { kind: 'alight'; releaseVehicleForActionId?: number }
  // #1202: go inside the building — the itinerary's last step, taken from a
  // cell on the building's ring (Mount.enterBuilding).
  | { kind: 'enter_building'; buildingId: number }
  | { kind: 'effect'; effectId: ArrivalEffectId; targetId?: number };

/** One foot or drive segment of an itinerary. */
export interface Leg {
  mode: 'foot' | 'drive';
  vehicleId: number | null;
  destX: number;
  destZ: number;
  arrival: 'exact' | 'adjacent';
  onArrive: ArrivalStep;
  estTicks: number;
  /**
   * leg.destX/destZ before the FIRST destination-spread ever retargeted
   * this leg (#1274) — null until a spread happens, then fixed for the
   * leg's remaining life even across further spreads. The one stable
   * identity of "what chokepoint is this mover actually queued on",
   * independent of how many times it has since been individually
   * relocated. Optional so a fixture/caller predating this field keeps
   * compiling unchanged (same pattern as RouteCommitment's own
   * fromX/fromZ/originX/originZ).
   */
  originalDestX?: number | null;
  originalDestZ?: number | null;
  /**
   * Set once `Locomotion.ts`'s `advanceLeg` has ever fallen back to a
   * vehicle-crossing route for this leg (#1263's own foot-leg fallback,
   * `avoidVehicles === false` because no avoiding route existed at all) —
   * and, from then on, sticky: every later tick reuses `avoidVehicles:
   * false` directly instead of re-deriving it from the mover's own current
   * (continuously shifting) position.
   *
   * Without this, the fallback's own `!path.found` check is re-evaluated
   * fresh every tick from wherever the mover has since walked to — and in a
   * dense grid with several parked vehicles, a strict avoiding route can be
   * findable from SOME intermediate cells along the relaxed route even
   * though it never existed from the leg's own starting cell (the case the
   * fallback exists for). The moment that happens the leg flips back to the
   * strict route for one tick, `resolveTargetWaypoint`'s climb-check
   * re-validates the in-flight `RouteCommitment` waypoint under the NEW
   * `avoidVehicles: true` and finds it blocked (it was only ever legal
   * because a vehicle sat there), discards it, and adopts the strict path's
   * own very different target — then next tick, back at (or near) the
   * position that made the strict route look findable a moment ago, flips
   * again. `RouteCommitment`'s tie-epsilon guards two similarly-shaped
   * routes of near-equal cost; it was never built to protect against two
   * routes that disagree on which cells are even legal to stand on,
   * oscillating the mover in place forever a few cells from the destination
   * (confirmed live: blast-execution-visual.json's dense 8x8/1m-spacing
   * grid, cycle 4 — 4 charge-relief employees permanently unable to land
   * their own already-ordered charge, direct-traced motionless across a
   * 9000-tick/3x-budget probe with zero further progress).
   *
   * Fixes it the same way `originalDestX`/`originalDestZ` above fixes
   * #1274's own "recompute every tick" trap: decide once, from the leg's
   * own start, and hold it — matching what `PlanItinerary.ts`'s
   * `estimateFootLegDistance` already assumed when it costed this leg from
   * a single fixed position at plan time. Optional/nullable so a
   * fixture/caller predating this field keeps compiling unchanged (never
   * true, so it behaves exactly like every leg before this fix).
   */
  crossesVehicles?: boolean;
  /**
   * Set on a leg whose destination is the one cell its arrival is for, so
   * `handleAgentOccupancyBlock`'s destination-spread step (and the traffic-jam
   * "reroute" answer's `respreadLegDestination`) must never retarget it onto
   * a "close enough" neighbour — the very thing destination-spreading exists
   * to do for an ordinary leg. Two writers:
   * - `PlanItinerary.ts`'s `lockTargetCellLeg`, on the final leg of a work
   *   itinerary for an action tied to one specific hole (`isHoleAction`,
   *   GameState.ts — #1291): the arrival gate only checks that the itinerary
   *   emptied, never where the mover stands, and the hole lands
   *   drilled/charged at its own planned x/z regardless, so a spread leg
   *   would silently service the hole from the wrong tile.
   * - `relocateIdleDestinationBlocker`'s `returnAfterRelocate` return trip
   *   (#1278 follow-up, Locomotion.ts, alongside `returnTrip` below):
   *   reclaiming that ONE specific cell is the whole point, so a
   *   consolation cell would strand the relocated occupant somewhere other
   *   than where it started, with nothing left to send it home again.
   * Optional/nullable so a fixture/caller predating this field keeps
   * compiling unchanged (never true, so it behaves exactly like every leg
   * before this fix).
   */
  neverSpread?: boolean;
  /**
   * Marks `relocateIdleDestinationBlocker`'s own `returnAfterRelocate`
   * return trip (#1278/#1283 follow-up, Locomotion.ts) — the one leg
   * `isOnReturnTripLeg` treats as inert. Kept apart from `neverSpread`,
   * which a hole-work leg also carries (#1291) while being a genuine,
   * contested claim on its cell. Optional, same reasoning as `neverSpread`.
   */
  returnTrip?: boolean;
}

/** What the itinerary is ultimately for. */
export type Goal =
  | { kind: 'work'; actionId: number }
  | { kind: 'reposition'; x: number; z: number }
  | { kind: 'rest'; buildingId: number };

/** Ordered legs plus the goal they serve and the itinerary's total cost. */
export interface Itinerary {
  legs: Leg[];
  goal: Goal;
  workTicks: number;
  estTotalTicks: number;
}
