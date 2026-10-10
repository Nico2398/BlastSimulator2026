// BlastSimulator2026 — Hiring candidate pools
// A small pool of named candidates per role, refreshed on an interval.

import {
  calculateSalary,
  generateName,
  qualificationAtLevel,
  type EmployeeRole,
  type SkillQualification,
} from './Employee.js';
import { Random } from '../math/Random.js';
import {
  CANDIDATE_SKILL_BONUS_CHANCE,
  CANDIDATE_SKILL_BONUS_MAX,
  CANDIDATE_UNION_CHANCE,
  HIRING_POOL_REFRESH_INTERVAL,
  HIRING_POOL_SIZE,
  ROLE_STARTING_QUALIFICATIONS,
  type ScriptedCandidate,
} from '../config/balance.js';

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

/** Roles that offer a candidate pool, in display order. */
export const HIRING_ROLES: readonly EmployeeRole[] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];

/** Fill every role up to HIRING_POOL_SIZE candidates, drawing ids from the pool counter. */
function topUp(pool: HiringPoolState, rng: Random): void {
  for (const role of HIRING_ROLES) {
    while (candidatesForRole(pool, role).length < HIRING_POOL_SIZE) {
      pool.candidates.push(generateCandidate(role, rng, pool.nextCandidateId++));
    }
  }
}

export function createHiringPool(seed: number, tick: number, script?: readonly ScriptedCandidate[]): HiringPoolState {
  void script; // TODO: implement
  const pool: HiringPoolState = { candidates: [], nextCandidateId: 1, lastRefreshTick: tick };
  topUp(pool, new Random(seed + tick));
  return pool;
}

export function generateCandidate(role: EmployeeRole, rng: Random, id: number): HireCandidate {
  const name = generateName(rng);
  const unionized = rng.chance(CANDIDATE_UNION_CHANCE);
  const qualifications = ROLE_STARTING_QUALIFICATIONS[role].map(q => qualificationAtLevel(q.category, q.proficiencyLevel));
  const primary = qualifications[0];
  if (primary && rng.chance(CANDIDATE_SKILL_BONUS_CHANCE)) {
    const bonus = rng.nextInt(1, CANDIDATE_SKILL_BONUS_MAX);
    const level = Math.min(5, primary.proficiencyLevel + bonus) as SkillQualification['proficiencyLevel'];
    qualifications[0] = qualificationAtLevel(primary.category, level);
  }
  return { id, role, name, unionized, qualifications, salary: calculateSalary({ role, qualifications, raises: 0 }) };
}

/** Replace the whole pool with fresh candidates (new ids). */
export function refreshHiringPool(pool: HiringPoolState, seed: number, tick: number, script?: readonly ScriptedCandidate[]): void {
  void script; // TODO: implement
  pool.candidates = [];
  pool.lastRefreshTick = tick;
  topUp(pool, new Random(seed + tick + pool.nextCandidateId));
}

/** Build the fixed candidate a script entry describes (#1600). */
export function scriptedCandidate(s: ScriptedCandidate): HireCandidate {
  void s;
  throw new Error('not implemented');
}

export function candidatesForRole(pool: HiringPoolState, role: EmployeeRole): HireCandidate[] {
  return pool.candidates.filter(c => c.role === role);
}

/** Remove and return a candidate of `role` (the given one, else the first); null when none. */
export function takeCandidate(pool: HiringPoolState, role: EmployeeRole, candidateId?: number): HireCandidate | null {
  const idx = pool.candidates.findIndex(c => c.role === role && (candidateId === undefined || c.id === candidateId));
  if (idx < 0) return null;
  return pool.candidates.splice(idx, 1)[0] ?? null;
}

export function isHiringPoolDue(pool: Pick<HiringPoolState, 'lastRefreshTick'>, tick: number): boolean {
  return tick - pool.lastRefreshTick >= HIRING_POOL_REFRESH_INTERVAL;
}
