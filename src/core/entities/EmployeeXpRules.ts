// BlastSimulator2026 — XP-per-tick award rules for employee skill proficiency.

import { XP_PER_TICK_BASE, XP_PER_TICK_LEVEL_SCALE } from '../config/balance.js';
import type { Employee, SkillCategory } from './Employee.js';
import type { PendingAction } from '../state/GameState.js';

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

/**
 * Compute the XP award(s) `employee` earns for one tick of work on `action`.
 * Pure — no state mutation, no side effects.
 * Returns [] when action.requiredSkill is null.
 * Otherwise returns exactly one award: { category: action.requiredSkill, amount }
 * where amount = computeXpPerTick(level), level = employee's current proficiency
 * in that category (default 1 if unqualified).
 */
export function computeTaskXpAwards(employee: Employee, action: PendingAction): XpAward[] {
  if (action.requiredSkill === null) return [];

  const qual = employee.qualifications.find(q => q.category === action.requiredSkill);
  const level = qual?.proficiencyLevel ?? 1;

  return [{ category: action.requiredSkill, amount: computeXpPerTick(level) }];
}
