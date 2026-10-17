// BlastSimulator2026 — Union membership helpers (#1873)

import type { Employee } from './Employee.js';
import { UNION_MEMBER_SALARY_DISCOUNT_PCT, UNION_TIMER_MIN_SHARE_FACTOR } from '../config/balance.js';

/** Living unionized employees. */
export function unionMemberCount(employees: readonly Pick<Employee, 'alive' | 'unionized'>[]): number {
  return employees.filter(e => e.alive && e.unionized).length;
}

/** Salary after the member discount; non-members pay full. Rounded integer. */
export function unionDiscountedSalary(fullSalary: number, unionized: boolean): number {
  if (!unionized) return fullSalary;
  return Math.max(1, Math.round(fullSalary * (1 - UNION_MEMBER_SALARY_DISCOUNT_PCT / 100)));
}

/** Event-timer stretch factor: 1 at all members, up to 1/UNION_TIMER_MIN_SHARE_FACTOR at none. */
export function unionEventStretch(members: number | undefined, living: number): number {
  if (members === undefined || living <= 0) return 1;
  const share = Math.min(1, members / living);
  const f = UNION_TIMER_MIN_SHARE_FACTOR;
  return 1 / (f + (1 - f) * share);
}
