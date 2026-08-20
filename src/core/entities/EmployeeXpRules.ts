// BlastSimulator2026 — XP-per-tick award rules for employee skill proficiency.

import { XP_PER_TICK_BASE, XP_PER_TICK_LEVEL_SCALE } from '../config/balance.js';
import type { Employee, SkillCategory } from './Employee.js';
import type { PendingAction } from '../state/GameState.js';
import { ROLE_LICENCE_REQUIRED } from './VehicleDriverAssignment.js';

/**
 * Compute the XP awarded per tick for an employee working at the given
 * proficiency level.
 *
 * Formula: XP_PER_TICK_BASE + floor(proficiencyLevel * XP_PER_TICK_LEVEL_SCALE)
 */
export function computeXpPerTick(proficiencyLevel: 1 | 2 | 3 | 4 | 5): number {
  return XP_PER_TICK_BASE + Math.floor(proficiencyLevel * XP_PER_TICK_LEVEL_SCALE);
}

/** One skill-category/amount XP grant for a single tick of work. */
export interface XpAward {
  category: SkillCategory;
  amount: number;
}

/** Award amount for `category` at employee's current proficiency (default level 1). */
function computeAwardFor(employee: Employee, category: SkillCategory): XpAward {
  const qual = employee.qualifications.find(q => q.category === category);
  const level = qual?.proficiencyLevel ?? 1;
  return { category, amount: computeXpPerTick(level) };
}

/**
 * Compute the XP award(s) `employee` earns for one tick of work on `action`.
 * Pure — no state mutation, no side effects.
 * Returns [] when both action.requiredSkill and action.requiredVehicleRole are null.
 * When action.requiredSkill is set, pushes an award for that skill category first.
 * When action.requiredVehicleRole is set, also pushes an award for the licence
 * category that role maps to (`ROLE_LICENCE_REQUIRED`). An action can carry both
 * (e.g. drill_hole), yielding two awards, requiredSkill's first.
 * Each award's amount = computeXpPerTick(level), level = employee's current
 * proficiency in that award's own category (default 1 if unqualified).
 */
export function computeTaskXpAwards(employee: Employee, action: PendingAction): XpAward[] {
  const awards: XpAward[] = [];

  if (action.requiredSkill !== null) {
    awards.push(computeAwardFor(employee, action.requiredSkill));
  }

  if (action.requiredVehicleRole !== null) {
    awards.push(computeAwardFor(employee, ROLE_LICENCE_REQUIRED[action.requiredVehicleRole]));
  }

  return awards;
}
