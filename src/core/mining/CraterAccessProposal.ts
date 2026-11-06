// BlastSimulator2026 — Proposed access ramp into a crater that stranded rubble (#2144)
// The game proposes, the player decides and pays (#2095): nothing here orders, charges or digs.

import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { RampDef } from './Ramp.js';

export type AccessRampProposal =
  | { ok: true; def: RampDef; cost: number; length: number; orderCount: number; line: string }
  | { ok: false; reasonKey: string };

/**
 * The ramp into the stranded crater with the most out-of-reach orders, planned by `planCraterAccess`; null when no
 * debris order is out of reach, or an access ramp is already being dug. `line` is the `build_ramp` console order.
 */
export function proposeAccessRamp(_state: GameState, _grid: VoxelGrid): AccessRampProposal | null {
  throw new Error('not implemented');
}
