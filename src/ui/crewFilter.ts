// BlastSimulator2026 — crew roster filter/sort criteria (#2161).

import type { Employee, EmployeeRole, SkillCategory } from '../core/entities/Employee.js';
import { computeEmployeeActivity, type EmployeeActivityKind } from '../core/entities/EmployeeActivity.js';
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

/** Activity kinds each activity-backed status choice covers; `injured` reads the flag instead. */
const STATUS_KINDS: Record<Exclude<CrewStatusChoice, 'injured'>, readonly EmployeeActivityKind[]> = {
  working: ['working', 'driving', 'driving_to_task', 'walking', 'training'],
  resting: ['resting'],
  idle: ['idle'],
  stuck: ['stuck', 'collapsed'],
};

/** Read the bar selection: filter = role, groups status/skill, sort. */
export function crewCriteriaFromSelection(selection: FilterBarSelection): CrewCriteria {
  const status = selection.groups['status'];
  return {
    role: (selection.filter as EmployeeRole | null) ?? null,
    status: (CREW_STATUS_CHOICES as readonly string[]).includes(status ?? '') ? status as CrewStatusChoice : null,
    skill: (selection.groups['skill'] as SkillCategory | null | undefined) ?? null,
    sort: (CREW_SORT_KEYS as readonly string[]).includes(selection.sort ?? '') ? selection.sort as CrewSortKey : null,
  };
}

function matchesStatus(e: Employee, status: CrewStatusChoice, state: GameState): boolean {
  if (status === 'injured') return e.injured;
  return STATUS_KINDS[status].includes(computeEmployeeActivity(e, state.vehicles).kind);
}

const SORTERS: Record<CrewSortKey, (a: Employee, b: Employee) => number> = {
  name: (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  morale: (a, b) => a.morale - b.morale,
  fatigue: (a, b) => a.fatigue - b.fatigue,
  salary: (a, b) => b.salary - a.salary,
};

/** Employees matching every criterion, ordered by the sort key (stored order when none). */
export function filterEmployees(employees: readonly Employee[], criteria: CrewCriteria, state: GameState): Employee[] {
  const kept = employees.filter(e =>
    (criteria.role === null || e.role === criteria.role)
    && (criteria.skill === null || e.qualifications.some(q => q.category === criteria.skill))
    && (criteria.status === null || matchesStatus(e, criteria.status, state)));
  const cmp = criteria.sort === null ? null : SORTERS[criteria.sort];
  return cmp ? kept.sort((a, b) => cmp(a, b) || a.id - b.id) : kept;
}
