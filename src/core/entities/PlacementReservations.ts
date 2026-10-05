// BlastSimulator2026 — Terrain reservations for building placement (#1390)
// Ramp and drill-hole cells that a building footprint may not cover.

import type { GameState } from '../state/GameState.js';
import { RAMP_RESERVATION_MARGIN, HOLE_RESERVATION_RADIUS } from '../config/balance.js';
import type { Rect } from '../world/WorldGen.js';

type ReservationKind = 'ramp' | 'hole';

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

/** Reservations from built/planned ramps and drilled/planned drill holes. Tolerates arrays missing from old saves. */
export function terrainReservations(
  s: Partial<Pick<GameState, 'builtRamps' | 'plannedRamps' | 'drillHoles' | 'plannedDrillHoles'>>,
): TerrainReservation[] {
  const out: TerrainReservation[] = [];
  const m = RAMP_RESERVATION_MARGIN;
  for (const r of [...(s.builtRamps ?? []), ...(s.plannedRamps ?? [])]) {
    const f = r.footprint;
    out.push({ kind: 'ramp', minX: f.minX - m, maxX: f.maxX + m, minZ: f.minZ - m, maxZ: f.maxZ + m });
  }
  const h = HOLE_RESERVATION_RADIUS;
  for (const hole of [...(s.drillHoles ?? []), ...(s.plannedDrillHoles ?? [])]) {
    const cx = Math.floor(hole.x);
    const cz = Math.floor(hole.z);
    out.push({ kind: 'hole', minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h });
  }
  return out;
}

/**
 * Kind of reservation that blocks `rect` (min-inclusive, max-exclusive, like
 * `rectOverlapsOccupants`), or null. A ramp wins over a hole.
 */
export function reservationBlocking(
  reservations: ReadonlyArray<TerrainReservation>,
  rect: Rect,
): ReservationKind | null {
  let hole = false;
  for (const r of reservations) {
    if (r.minX < rect.maxX && r.maxX >= rect.minX && r.minZ < rect.maxZ && r.maxZ >= rect.minZ) {
      if (r.kind === 'ramp') return 'ramp';
      hole = true;
    }
  }
  return hole ? 'hole' : null;
}
