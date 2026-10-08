// BlastSimulator2026 — Detonation sequence (#1362): arm, evacuate, fire.
// Stubs only; behaviour lands with the implementation phase.

import type { GameState } from '../state/GameState.js';

/** Armed-detonation record held on GameState while the site is being cleared. */
export interface PendingDetonation {
  armedTick: number;
  strandedEmployeeIds: number[];
  strandedVehicleIds: number[];
  lastEvacuationTick: number;
}

export type DetonationPhase =
  | { kind: 'idle' }
  | { kind: 'evacuating'; remaining: number }
  | { kind: 'stranded'; names: string[] }
  | { kind: 'ready' };

export type DetonationResult<T> = { success: true; data: T } | { success: false; error: string };

/** Arm the detonation and order the danger zone evacuated. */
export function armDetonation(_state: GameState): DetonationResult<PendingDetonation> {
  // TODO: implement
  return undefined as never;
}

/** Cancel an armed detonation. True when one was armed. */
export function cancelDetonation(_state: GameState): boolean {
  // TODO: implement
  return undefined as never;
}

/** Pure read of the current phase. */
export function detonationPhase(_state: GameState): DetonationPhase {
  // TODO: implement
  return undefined as never;
}

/** Advance the sequence one tick and return the resulting phase. */
export function tickDetonation(_state: GameState): DetonationPhase {
  // TODO: implement
  return undefined as never;
}
