// BlastSimulator2026 — Candidate sheet: a hiring candidate's full character sheet (#2164)

import type { GameState } from '../core/state/GameState.js';
import type { EmployeeRole } from '../core/entities/Employee.js';
import type { HireCandidate } from '../core/entities/HiringPool.js';

/** Sheet for `c`: role, every qualification, pay, union status and trade-off, fee, Hire button with refusal reason. */
export function makeCandidateSheet(
  _state: GameState,
  _c: HireCandidate,
  _onHire: (role: EmployeeRole, candidateId: number) => void,
  _onClose: () => void,
): HTMLElement {
  throw new Error('not implemented');
}
