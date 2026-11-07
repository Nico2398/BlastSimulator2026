// BlastSimulator2026 — hiring candidate filter/sort criteria (#2160).

import type { EmployeeRole, SkillCategory } from '../core/entities/Employee.js';
import type { HireCandidate } from '../core/entities/HiringPool.js';
import type { FilterBarSelection } from './filterBar.js';

export const HIRING_SORT_KEYS = ['salary', 'level'] as const;
export type HiringSortKey = typeof HIRING_SORT_KEYS[number];
/** Minimum-level choices offered (level 1 would filter nothing). */
export const HIRING_LEVEL_CHOICES = [2, 3, 4, 5] as const;

export interface HiringCriteria {
  role: EmployeeRole | null;
  skill: SkillCategory | null;
  minLevel: number | null;
  union: 'union' | 'non_union' | null;
  affordableOnly: boolean;
  sort: HiringSortKey | null;
}

/** Read the bar selection: filter = role, groups skill/level/union/affordable, sort. */
export function criteriaFromSelection(_selection: FilterBarSelection): HiringCriteria {
  throw new Error('not implemented');
}

/** Candidates matching every criterion, ordered by the sort key (pool order when none). */
export function filterCandidates(_candidates: readonly HireCandidate[], _criteria: HiringCriteria, _cash: number): HireCandidate[] {
  throw new Error('not implemented');
}
