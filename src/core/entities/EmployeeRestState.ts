// BlastSimulator2026 — Employee rest-state predicate.
//
// Deliberately a leaf module with type-only imports: Employee.ts re-exports
// EmployeeTraining, which pulls the engine graph back through
// VehicleDriverAssignment, so a runtime import of Employee.ts from there closes
// an import cycle (#1746).

import type { Employee } from './Employee.js';

/** Resting, or walking to a rest whose timer has not started yet (#437). */
export function isResting(employee: Pick<Employee, 'restTicksRemaining' | 'pendingRestDuration'>): boolean {
  return employee.restTicksRemaining !== null || employee.pendingRestDuration !== null;
}
