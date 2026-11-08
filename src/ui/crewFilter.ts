// BlastSimulator2026 — crew roster filter/sort criteria (#2161).

import type { Employee, EmployeeRole, SkillCategory } from '../core/entities/Employee.js';
import type { GameState } from '../core/state/GameState.js';
import type { FilterBarSelection } from './filterBar.js';

export const CREW_SORT_KEYS = ['name', 'morale', 'fatigue', 'salary'] as const;
type CrewSortKey = typeof CREW_SORT_KEYS[number];
export const CREW_STATUS_CHOICES = ['working', 'resting', 'idle', 'stuck', 'injured'] as const;
export type CrewStatusChoice = typeof CREW_STATUS_CHOICES[number];

export interface CrewCriteria {
  role: EmployeeRole | null;
  status: CrewStatusChoice | null;
  skill: SkillCategory | null;
  sort: CrewSortKey | null;
}

/** Read the bar selection: filter = role, groups status/skill, sort. */
export function crewCriteriaFromSelection(_selection: FilterBarSelection): CrewCriteria {
  throw new Error('not implemented');
}

/** Employees matching every criterion, ordered by the sort key (stored order when none). */
export function filterEmployees(_employees: readonly Employee[], _criteria: CrewCriteria, _state: GameState): Employee[] {
  throw new Error('not implemented');
}
