// BlastSimulator2026 — Union membership helpers (#1873)

import type { Employee } from './Employee.js';

/** Living unionized employees. */
export function unionMemberCount(_employees: readonly Pick<Employee, 'alive' | 'unionized'>[]): number {
  return 0; // TODO: implement
}

/** Salary after the member discount; non-members pay full. Rounded integer. */
export function unionDiscountedSalary(fullSalary: number, _unionized: boolean): number {
  return fullSalary; // TODO: implement
}

/** Event-timer stretch factor: 1 at all members, up to 1/UNION_TIMER_MIN_SHARE_FACTOR at none. */
export function unionEventStretch(_members: number | undefined, _living: number): number {
  return 1; // TODO: implement
}
