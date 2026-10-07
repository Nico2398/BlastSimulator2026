// BlastSimulator2026 — Crew panel hiring section (candidate pool cards)

import type { GameState } from '../../core/state/GameState.js';
import type { EmployeeRole } from '../../core/entities/Employee.js';

export function makeHiringSection(_state: GameState, _onHire: (role: EmployeeRole, candidateId: number) => void): HTMLElement[] {
  return [];
}

/** Change-detection signature for the hiring section. */
export function hiringSignature(_state: GameState): string {
  return '';
}
