/**
 * BlastSimulator2026 — Scenario goal checking (command mode)
 *
 * Command mode has a state dump but no DOM, so it can only prove the
 * `equals`/`increased` half of a step's `expect` — the same fields
 * `interaction-driver.ts`'s `checkGoal` proves, minus `usable`/`blocked`/
 * `tutorialStep`, which need a live page and are checked only in
 * interaction mode (scenario-interaction-runner.ts calls `checkGoal`
 * directly there, rather than duplicating this logic).
 *
 * @module shared/scenario-goal
 */

import type { ScenarioStepGoal } from './scenario-types.js';

/**
 * Checks `goal.equals`/`goal.increased`/`goal.decreased` against
 * `before`/`after` state dumps. Returns a violation message naming the
 * field and the mismatch, or `null` when everything holds.
 * `usable`/`blocked`/`tutorialStep` are silently skipped — command mode has
 * no page to check them against, and that gap is filled by the same
 * scenario running in interaction mode.
 */
export function checkGoalAgainstState(
  goal: ScenarioStepGoal,
  before: Record<string, unknown>,
  after: Record<string, unknown> | null,
): string | null {
  if (goal.increased) {
    for (const field of goal.increased) {
      const wasRaw = before[field];
      const nowRaw = after?.[field];
      const was = typeof wasRaw === 'number' ? wasRaw : 0;
      const now = typeof nowRaw === 'number' ? nowRaw : 0;
      if (!(now > was)) {
        return `${field} should have increased but went ${was} → ${now}`;
      }
    }
  }

  if (goal.decreased) {
    for (const field of goal.decreased) {
      const wasRaw = before[field];
      const nowRaw = after?.[field];
      const was = typeof wasRaw === 'number' ? wasRaw : 0;
      const now = typeof nowRaw === 'number' ? nowRaw : 0;
      if (!(now < was)) {
        return `${field} should have decreased but went ${was} → ${now}`;
      }
    }
  }

  if (goal.equals) {
    for (const [field, expected] of Object.entries(goal.equals)) {
      const actual = after?.[field];
      if (actual !== expected) {
        return `${field} should be ${JSON.stringify(expected)} but is ${JSON.stringify(actual)}`;
      }
    }
  }

  return null;
}

/**
 * Checks a step's `commandOutcome` against the console's own result.
 * Returns a violation message naming the command and the console's refusal
 * text, or `null` when the outcome is acceptable.
 *
 * - undefined — the command must succeed; `success:false` is a violation.
 * - 'refused' — the command must fail; `success:true` is a violation.
 * - 'either' — no check, always `null`.
 *
 * TODO: implement.
 */
export function checkCommandOutcome(
  _commandOutcome: 'refused' | 'either' | undefined,
  _result: { success: boolean; output: string },
  _command: string,
): string | null {
  return null;
}
