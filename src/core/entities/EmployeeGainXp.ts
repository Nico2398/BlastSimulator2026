// BlastSimulator2026 — XP gain and level-up logic for employee skills.

import type { EmployeeState, SkillCategory } from './Employee.js';
import { XP_THRESHOLDS } from '../config/balance.js';
import type { EventEmitter } from '../state/EventEmitter.js';

export interface GainXpResult {
  leveledUp: boolean;
  oldLevel: 1 | 2 | 3 | 4 | 5;
  newLevel: 1 | 2 | 3 | 4 | 5;
}

/** Award XP to an employee skill; levels up when XP_THRESHOLDS are crossed. Emits 'employee:levelup' per level gained. Returns null if employee or skill not found. */
export function gainXp(
  state: EmployeeState,
  employeeId: number,
  category: SkillCategory,
  xpAmount: number,
  emitter?: EventEmitter,
): GainXpResult | null {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp) return null;

  if (!Number.isFinite(xpAmount) || !Number.isInteger(xpAmount) || xpAmount < 0) {
    throw new RangeError('xpAmount must be a finite, non-negative integer');
  }

  const qual = emp.qualifications.find(q => q.category === category);
  if (!qual) return null;

  const oldLevel = qual.proficiencyLevel;
  qual.xp += xpAmount;

  while (qual.proficiencyLevel < 5) {
    const nextLevel = (qual.proficiencyLevel + 1) as 2 | 3 | 4 | 5;
    if (qual.xp < XP_THRESHOLDS[nextLevel]) break;
    const prevLevel = qual.proficiencyLevel;
    qual.proficiencyLevel = nextLevel;
    emitter?.emit('employee:levelup', { employeeId, category, oldLevel: prevLevel, newLevel: nextLevel });
  }

  return { leveledUp: qual.proficiencyLevel > oldLevel, oldLevel, newLevel: qual.proficiencyLevel };
}
