// BlastSimulator2026 — Tutorial step helper functions
// Extracted from tutorialSteps.ts to keep each file under 300 lines.

import type { GameState } from '../core/state/GameState.js';
import type { NavCell } from '../core/nav/NavGrid.js';
import type { EmployeeRole } from '../core/entities/Employee.js';
import type { TutorialStep } from './tutorialSteps.js';
import { computeDangerZone, isZoneClear } from '../core/entities/Zone.js';
import { BLAST_DANGER_MARGIN_M } from '../core/config/balance.js';

/**
 * Selectors for the toolbar buttons that open each panel. The panels themselves
 * are `display:none` until the player opens them, so a step that says "open the
 * Crew panel" has to glow the button that opens it, not the hidden panel.
 */
export const TOOLBAR_TARGET = {
  blast: '#bs-toolbar [data-panel="blast"]',
  contracts: '#bs-toolbar [data-panel="contracts"]',
  ops: '#bs-toolbar [data-panel="ops"]',
  build: '#bs-toolbar [data-panel="build"]',
  vehicles: '#bs-toolbar [data-panel="vehicles"]',
  employees: '#bs-toolbar [data-panel="employees"]',
  survey: '#bs-toolbar [data-panel="survey"]',
  settings: '#bs-toolbar [data-panel="settings"]',
} as const;

/**
 * Snapshot shape for a hire step: ids of the employees who already hold the
 * target role at capture time. Completion requires an employee with that
 * role whose id is NOT in this set — plain count-increased + role-exists
 * checks false-positive when the role was already staffed before the step
 * opened (e.g. async survey resolution lag) and the player hires someone
 * else entirely.
 */
export interface HireStepSnapshot {
  prevIdsWithRole: number[];
}

/** Collect the ids of employees who already hold `role` at snapshot time. */
function captureHireStepSnapshot(state: GameState, role: EmployeeRole): HireStepSnapshot {
  return {
    prevIdsWithRole: getEmployees(state)
      .filter(e => e.role === role)
      .map(e => e.id),
  };
}

/**
 * True only when an employee holds `role` with an id absent from
 * `snapshot.prevIdsWithRole` — i.e. a genuinely new hire of that role, not
 * one that already existed when the step started.
 */
function isHireStepComplete(
  state: GameState,
  snapshot: HireStepSnapshot,
  role: EmployeeRole,
): boolean {
  return getEmployees(state).some(
    e => e.role === role && !snapshot.prevIdsWithRole.includes(e.id),
  );
}

/**
 * Helper: create a "hire employee" step that completes when an employee
 * with the given role has been hired (total count increased).
 *
 * Defaults to highlighting the Crew toolbar button, since every hire step asks
 * the player to open that panel.
 */
export function createHireStep(
  id: string,
  titleKey: string,
  textKey: string,
  role: EmployeeRole,
  highlightTarget: string = TOOLBAR_TARGET.employees,
): TutorialStep {
  return {
    id,
    titleKey,
    textKey,
    commands: [`employee hire role:${role}`],
    ...(highlightTarget ? { highlightTarget } : {}),
    captureSnapshot: (state: GameState) =>
      captureHireStepSnapshot(state, role) as unknown as Record<string, unknown>,
    isComplete: (state: GameState, snapshot: Record<string, unknown>) =>
      isHireStepComplete(state, snapshot as unknown as HireStepSnapshot, role),
  };
}

/**
 * Helper: create a hire step that also requires any pending tutorial event
 * to be resolved first. Used for steps that follow event-fire-resolve where
 * a synchronous isComplete check would fire before the event dialog is dismissed.
 */
export function createHireStepWithEventGuard(
  id: string,
  titleKey: string,
  textKey: string,
  role: EmployeeRole,
  highlightTarget: string = TOOLBAR_TARGET.employees,
): TutorialStep {
  const base = createHireStep(id, titleKey, textKey, role, highlightTarget);
  const origIsComplete = base.isComplete;
  return {
    ...base,
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      // Must wait for any pending tutorial event to be resolved first
      return state.events?.pendingEvent == null && origIsComplete(state, snapshot);
    },
  };
}

/**
 * Helper: create a step that completes when a numeric value has increased.
 * The `getValue` function is called at snapshot time and during the completion
 * check — when the current value exceeds the snapshot the step is complete.
 *
 * @param id         Unique step identifier.
 * @param titleKey   i18n key for step title.
 * @param textKey    i18n key for step text.
 * @param getValue   Function returning the numeric value to compare.
 * @param commands   Optional array of command hints shown to the player.
 */
export function createComparisonStep(
  id: string,
  titleKey: string,
  textKey: string,
  getValue: (state: GameState) => number,
  commands?: string[],
  highlightTarget?: string,
  clock?: { tickBudget?: number; waitsOnWork?: boolean },
): TutorialStep {
  return {
    id,
    titleKey,
    textKey,
    ...(commands ? { commands } : {}),
    ...(highlightTarget ? { highlightTarget } : {}),
    ...(clock?.tickBudget !== undefined ? { tickBudget: clock.tickBudget } : {}),
    ...(clock?.waitsOnWork ? { waitsOnWork: true } : {}),
    captureSnapshot: (state: GameState) => ({
      prevValue: getValue(state),
    }),
    isComplete: (state: GameState, snapshot: Record<string, unknown>) => {
      const prev = snapshot.prevValue as number;
      return getValue(state) > prev;
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
  highlightTarget?: string,
): TutorialStep {
  return {
    id,
    titleKey,
    textKey,
    autoAdvanceMs: 2000,
    ...(captureSnapshot ? { captureSnapshot } : {}),
    ...(highlightTarget ? { highlightTarget } : {}),
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
export function getVehicles(state: GameState): { id: number; driverId: number | null }[] {
  const v = getGameStateDict(state).vehicles;
  if (Array.isArray(v)) return v as unknown as { id: number; driverId: number | null }[];
  const vObj = v as Record<string, unknown> | undefined;
  return (vObj?.vehicles ?? []) as { id: number; driverId: number | null }[];
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

/**
 * Whether the Blast Report modal (`BlastReportModal.ts`) has a report armed
 * or on screen right now.
 *
 * True from the instant a blast arms a report through its real-time open
 * delay (#545, `BLAST_REPORT_DELAY_MS`) and until the player dismisses it —
 * read off a DOM marker the modal stamps on its own overlay rather than
 * GameState, the same reason `isReachable` (tutorialGuide.ts) reads the DOM
 * instead of threading a UI reference through TutorialStep: opening and
 * dismissal are UI-only state, invisible to GameState. The overlay node
 * itself stays in the DOM the whole time — only its `display` toggles — so
 * this reads correctly even while the report is armed but the overlay is
 * still `display:none` during the open delay, which a display-only check
 * would miss (#707: that miss is exactly what let the 'blast' tutorial step
 * complete, and the rail advance past it, before the report ever opened).
 */
export function isBlastReportOutstanding(): boolean {
  const overlay = document.querySelector('[data-blast-report-modal]') as HTMLElement | null;
  return overlay?.dataset['outstanding'] === 'true';
}

/**
 * True once the same danger zone the FIRE gate/console blast refusal compute
 * (computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M)) reads clear of
 * every vehicle and alive employee — the evacuate-zone tutorial step's
 * completion check (#557).
 */
export function isEvacuationZoneClear(state: GameState): boolean {
  // state.drillHoles may be absent on a minimal/mock GameState (tutorialSteps.test.ts's
  // isComplete-never-throws check) — an empty array is exactly "no danger zone yet",
  // matching computeDangerZone's own null-for-no-holes contract.
  const zone = computeDangerZone(state.drillHoles ?? [], BLAST_DANGER_MARGIN_M);
  return zone !== null && isZoneClear(zone, state.vehicles, state.employees);
}

/**
 * Helper: create the evacuate-zone step (#557) — completes once
 * isEvacuationZoneClear reads true. tickBudget 20 comfortably covers a
 * ~15-20m walk at AGENT_WALK_SPEED (2 cells/tick — 7.5-10 ticks one way).
 * Kept as a factory (like the other create*Step helpers above) so
 * tutorialSteps.ts — a grandfathered, may-only-shrink file — carries just the
 * one call site instead of the full step object.
 */
export function createEvacuateZoneStep(): TutorialStep {
  return {
    id: 'evacuate-zone',
    titleKey: 'tutorial.step_evacuate.title',
    textKey: 'tutorial.step_evacuate',
    highlightTarget: TOOLBAR_TARGET.blast,
    tickBudget: 20,
    waitsOnWork: true,
    isComplete: isEvacuationZoneClear,
  };
}
