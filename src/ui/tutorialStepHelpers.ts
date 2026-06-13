// BlastSimulator2026 — Tutorial step helper functions
// Extracted from tutorialSteps.ts to keep each file under 300 lines.

import type { GameState } from '../core/state/GameState.js';
import type { NavCell } from '../core/nav/NavGrid.js';
import type { EmployeeRole } from '../core/entities/Employee.js';
import type { TutorialStep } from './tutorialSteps.js';

/**
 * Helper: create a "hire employee" step that completes when an employee
 * with the given role has been hired (total count increased).
 */
export function createHireStep(
  id: string,
  titleKey: string,
  textKey: string,
  role: EmployeeRole,
): TutorialStep {
  return {
    id,
    titleKey,
    textKey,
    commands: ['hire employee'],
    captureSnapshot: (state: GameState) => ({
      prevEmployeeCount: getEmployees(state).length,
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevEmployeeCount as number;
      const employees = getEmployees(state);
      return (
        employees.length > prev &&
        employees.some(e => e.role === role)
      );
    },
  };
}

/**
 * Helper: create a step that auto-advances after 2000ms.
 */
export function createAutoAdvanceStep(
  id: string,
  titleKey: string,
  textKey: string,
  captureSnapshot?: (state: GameState) => Record<string, unknown>,
): TutorialStep {
  return {
    id,
    titleKey,
    textKey,
    autoAdvanceMs: 2000,
    ...(captureSnapshot ? { captureSnapshot } : {}),
    isComplete: () => true,
  };
}

/** Count nav grid cells matching a given type. */
export function countNavCellsByType(
  cells: NavCell[][] | undefined,
  type: string,
): number {
  if (!cells) return 0;
  let count = 0;
  for (const row of cells) {
    for (const cell of row) {
      if (cell.type === type) count++;
    }
  }
  return count;
}

/** Access a top-level property on GameState by key — uses unknown cast to bypass
 *  strict index-signature check since mock state may have different shapes. */
function getGameStateDict(state: GameState): Record<string, unknown> {
  return state as unknown as Record<string, unknown>;
}

/** Safe access to employees array from mock-friendly state. */
export function getEmployees(state: GameState): { role: string; hunger: number; fatigue: number; breakNeed: number; id: number }[] {
  const e = getGameStateDict(state).employees;
  if (Array.isArray(e)) return e as unknown as { role: string; hunger: number; fatigue: number; breakNeed: number; id: number }[];
  const eObj = e as Record<string, unknown> | undefined;
  return (eObj?.employees ?? []) as { role: string; hunger: number; fatigue: number; breakNeed: number; id: number }[];
}

/** Safe access to vehicles array from mock-friendly state. */
export function getVehicles(state: GameState): { driverId: number | null }[] {
  const v = getGameStateDict(state).vehicles;
  if (Array.isArray(v)) return v as unknown as { driverId: number | null }[];
  const vObj = v as Record<string, unknown> | undefined;
  return (vObj?.vehicles ?? []) as { driverId: number | null }[];
}

/** Safe access to buildings array. */
export function getBuildings(state: GameState): { type: string }[] {
  const b = getGameStateDict(state).buildings;
  if (Array.isArray(b)) return b as unknown as { type: string }[];
  const bObj = b as Record<string, unknown> | undefined;
  return (bObj?.buildings ?? []) as { type: string }[];
}

/** Count buildings of a given type. */
export function countBuildingsOfType(state: GameState, buildingType: string): number {
  return getBuildings(state).filter(b => b.type === buildingType).length;
}

/** Count vehicles with a driver assigned. */
export function countVehiclesWithDriver(state: GameState): number {
  return getVehicles(state).filter(v => v.driverId !== null).length;
}
