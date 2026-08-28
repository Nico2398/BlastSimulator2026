// BlastSimulator2026 — Zone evacuation orchestration
// Finds safe destinations for entities standing inside a blast danger zone
// and routes them out before the blast fires (#557).

import type { GameState } from '../state/GameState.js';
import type { ZoneBounds, EvacuationDestination, EvacuationResult } from '../entities/Zone.js';

/**
 * Finds the nearest navigable cell outside `zone` (and clear of it by
 * EVACUATION_CLEARANCE_M) reachable from (fromX, fromZ). Returns null when
 * no safe cell can be reached.
 */
export function findSafeEvacuationCell(
  _state: GameState, _fromX: number, _fromZ: number, _zone: ZoneBounds,
): EvacuationDestination | null {
  throw new Error('not implemented');
}

/**
 * Evacuates every vehicle and employee standing inside `zone`, routing each
 * to a safe destination found via findSafeEvacuationCell. Entities with no
 * reachable safe cell are reported as stranded rather than moved.
 */
export function evacuateZone(_state: GameState, _zone: ZoneBounds): EvacuationResult {
  throw new Error('not implemented');
}
