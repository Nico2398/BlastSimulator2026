// BlastSimulator2026 — hiring candidate filter/sort criteria (#2160).

import { HIRING_COSTS, type EmployeeRole, type SkillCategory } from '../core/entities/Employee.js';
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
export function criteriaFromSelection(selection: FilterBarSelection): HiringCriteria {
  const level = selection.groups['level'];
  const union = selection.groups['union'];
  return {
    role: (selection.filter as EmployeeRole | null) ?? null,
    skill: (selection.groups['skill'] as SkillCategory | null | undefined) ?? null,
    minLevel: level == null ? null : Number(level),
    union: union === 'union' || union === 'non_union' ? union : null,
    affordableOnly: selection.groups['affordable'] === 'yes',
    sort: (HIRING_SORT_KEYS as readonly string[]).includes(selection.sort ?? '') ? selection.sort as HiringSortKey : null,
  };
}

/** Level of the chosen skill, or the best qualification when none is chosen; 0 when not held. */
function levelFor(c: HireCandidate, skill: SkillCategory | null): number {
  const quals = skill === null ? c.qualifications : c.qualifications.filter(q => q.category === skill);
  return Math.max(0, ...quals.map(q => q.proficiencyLevel));
}

function matches(c: HireCandidate, k: HiringCriteria, cash: number): boolean {
  if (k.role !== null && c.role !== k.role) return false;
  if (k.skill !== null && !c.qualifications.some(q => q.category === k.skill)) return false;
  if (k.minLevel !== null && levelFor(c, k.skill) < k.minLevel) return false;
  if (k.union !== null && c.unionized !== (k.union === 'union')) return false;
  return !k.affordableOnly || HIRING_COSTS[c.role] <= cash;
}

/** Candidates matching every criterion, ordered by the sort key (pool order when none). */
export function filterCandidates(candidates: readonly HireCandidate[], criteria: HiringCriteria, cash: number): HireCandidate[] {
  const kept = candidates.filter(c => matches(c, criteria, cash));
  if (criteria.sort === 'salary') return kept.sort((a, b) => a.salary - b.salary || a.id - b.id);
  if (criteria.sort === 'level') {
    return kept.sort((a, b) => levelFor(b, criteria.skill) - levelFor(a, criteria.skill) || a.id - b.id);
  }
  return kept;
}
