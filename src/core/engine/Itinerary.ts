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
  | { kind: 'effect'; effectId: ArrivalEffectId };

/** One foot or drive segment of an itinerary. */
export interface Leg {
  mode: 'foot' | 'drive';
  vehicleId: number | null;
  destX: number;
  destZ: number;
  arrival: 'exact' | 'adjacent';
  onArrive: ArrivalStep;
  estTicks: number;
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
