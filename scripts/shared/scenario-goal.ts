/**
 * BlastSimulator2026 — Scenario goal checking (command mode)
 *
 * Command mode has a state dump but no DOM, so it can only prove the
 * `equals`/`increased`/`decreased`/`changedBy` half of a step's `expect` —
 * the same fields `interaction-driver.ts`'s `checkGoal` proves, minus
 * `usable`/`blocked`/`tutorialStep`, which need a live page and are checked
 * only in interaction mode (scenario-interaction-runner.ts calls `checkGoal`
 * directly there, rather than duplicating this logic).
 *
 * @module shared/scenario-goal
 */

import type { ScenarioStepGoal } from './scenario-types.js';

/**
 * A single `equals`/`changedBy` field mismatch — the drift-report unit
 * (issue #679). Never produced for `increased`/`decreased`, which stay
 * directional-only and out of scope for drift reporting.
 */
export interface GoalMismatch {
  field: string;
  goalType: 'equals' | 'changedBy';
  expected: unknown;
  /** For 'equals': the actual field value. For 'changedBy': the actual delta (after - before), not the absolute post-state value. */
  actual: unknown;
}

/**
 * Result of checking one step's goal against its before/after state dumps.
 */
export interface GoalCheckResult {
  /** Same text/semantics as today's return value — first violation found, increased→decreased→equals→changedBy order. */
  violation: string | null;
  /** Every equals/changedBy field that mismatched, exhaustively (not just the first). Never contains increased/decreased failures. */
  mismatches: GoalMismatch[];
  /** True only when violation is non-null and every contributing failure is in `mismatches` — i.e. no increased/decreased goal also failed. */
  onlyDriftViolations: boolean;
}

/**
 * Checks `goal.equals`/`goal.increased`/`goal.decreased`/`goal.changedBy`
 * against `before`/`after` state dumps. Returns a violation message naming
 * the field and the mismatch, or `null` when everything holds.
 * `usable`/`blocked`/`tutorialStep` are silently skipped — command mode has
 * no page to check them against, and that gap is filled by the same
 * scenario running in interaction mode.
 *
 * TODO: implement — stub only during skeleton phase (#679).
 */
export function checkGoalAgainstState(
  goal: ScenarioStepGoal,
  before: Record<string, unknown>,
  after: Record<string, unknown> | null,
): GoalCheckResult {
  // TODO: implement — stub only during skeleton phase (#679).
  void goal;
  void before;
  void after;
  throw new Error('not implemented');
}

/**
 * Checks a step's `commandOutcome` against the console's own result.
 * Returns a violation message naming the command and the console's refusal
 * text, or `null` when the outcome is acceptable.
 *
 * - undefined — the command must succeed; `success:false` is a violation.
 * - 'refused' — the command must fail; `success:true` is a violation.
 * - 'either' — no check, always `null`.
 */
export function checkCommandOutcome(
  commandOutcome: 'refused' | 'either' | undefined,
  result: { success: boolean; output: string },
  command: string,
): string | null {
  if (commandOutcome === 'either') return null;

  if (commandOutcome === 'refused') {
    if (result.success === false) return null;
    return `command "${command}" was declared commandOutcome:'refused' but succeeded — the guard it was meant to prove no longer blocks it`;
  }

  if (result.success === true) return null;
  return `command "${command}" was refused by the console: ${result.output}`;
}
