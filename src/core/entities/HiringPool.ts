// BlastSimulator2026 — Hiring candidate pools
// A small pool of named candidates per role, refreshed on an interval.

import type { EmployeeRole, SkillQualification } from './Employee.js';
import type { Random } from '../math/Random.js';

export interface HireCandidate {
  id: number;
  role: EmployeeRole;
  name: string;
  unionized: boolean;
  qualifications: SkillQualification[];
  /** Salary per pay cycle. */
  salary: number;
}

export interface HiringPoolState {
  candidates: HireCandidate[];
  nextCandidateId: number;
  lastRefreshTick: number;
}

export function createHiringPool(_seed: number, _tick: number): HiringPoolState {
  throw new Error('not implemented');
}

export function generateCandidate(_role: EmployeeRole, _rng: Random, _id: number): HireCandidate {
  throw new Error('not implemented');
}

export function refreshHiringPool(_pool: HiringPoolState, _seed: number, _tick: number): void {
  throw new Error('not implemented');
}

export function candidatesForRole(_pool: HiringPoolState, _role: EmployeeRole): HireCandidate[] {
  throw new Error('not implemented');
}

/** Remove and return a candidate of `role` (the given one, else the first); null when none. */
export function takeCandidate(_pool: HiringPoolState, _role: EmployeeRole, _candidateId?: number): HireCandidate | null {
  throw new Error('not implemented');
}

export function isHiringPoolDue(_pool: Pick<HiringPoolState, 'lastRefreshTick'>, _tick: number): boolean {
  throw new Error('not implemented');
}
