// BlastSimulator2026 — Terrain reservations for building placement (#1390)
// Ramp and drill-hole cells that a building footprint may not cover.

import type { GameState } from '../state/GameState.js';
import type { Rect } from '../world/WorldGen.js';

export type ReservationKind = 'ramp' | 'hole';

/** Reserved cell range, inclusive on all four edges. */
export interface TerrainReservation {
  kind: ReservationKind;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Translation key for the refusal message of each reservation kind. */
export const RESERVATION_ERROR_KEY: Record<ReservationKind, string> = {
  ramp: 'shell.placement.refused_ramp',
  hole: 'shell.placement.refused_hole',
};

/** Reservations from built/planned ramps and drilled/planned drill holes. */
export function terrainReservations(
  _s: Pick<GameState, 'builtRamps' | 'plannedRamps' | 'drillHoles' | 'plannedDrillHoles'>,
): TerrainReservation[] {
  // TODO: implement
  return [];
}

/**
 * Kind of reservation that blocks `rect` (min-inclusive, max-exclusive, like
 * `rectOverlapsOccupants`), or null. A ramp wins over a hole.
 */
export function reservationBlocking(
  _reservations: ReadonlyArray<TerrainReservation>,
  _rect: Rect,
): ReservationKind | null {
  // TODO: implement
  return null;
}
