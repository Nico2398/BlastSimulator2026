// BlastSimulator2026 — Player-facing text for a refused permit application (#1924)
// Shared by the console `permit apply` command and the Permits panel.

import type { GameState } from '../state/GameState.js';
import type { GradeApplyRefusal, GradeTargetKind } from './MineGrade.js';

/** Localised sentence explaining why an application was refused. */
export function permitRefusalText(
  _refusal: GradeApplyRefusal,
  _unmet: readonly GradeTargetKind[],
  _nextFee: number,
  _cash: number,
): string {
  // TODO: implement
  return undefined as unknown as string;
}

/** Pure dry-run of applyForGrade's checks: why it would refuse now, or null when it would accept. */
export function permitApplyBlocker(
  _state: GameState,
): { refusal: GradeApplyRefusal; unmet: GradeTargetKind[] } | null {
  // TODO: implement
  return null;
}
