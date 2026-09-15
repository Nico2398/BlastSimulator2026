// BlastSimulator2026 — moveTo (#1089)
// The only movement entry point. Plans an itinerary (via planItinerary) to a
// destination or a vehicle, and installs it on the employee for the
// locomotion tick to walk.

import type { GameState } from '../state/GameState.js';

export type MoveResult = { success: true } | { success: false; error: string };

/** Walk to (x, z), optionally via a named vehicle (a hint, not a command). */
export function moveTo(
  state: GameState,
  employeeId: number,
  target: { x: number; z: number },
  opts?: { via?: number },
): MoveResult;
/** Walk to a vehicle and board it — no destination beyond the vehicle itself. */
export function moveTo(
  state: GameState,
  employeeId: number,
  target: { vehicleId: number },
): MoveResult;
export function moveTo(
  _state: GameState,
  _employeeId: number,
  _target: { x: number; z: number } | { vehicleId: number },
  _opts?: { via?: number },
): MoveResult {
  // TODO: implement
  throw new Error('not implemented');
}
