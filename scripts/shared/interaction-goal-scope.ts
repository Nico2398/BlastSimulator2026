/**
 * BlastSimulator2026 — Which half of a step's `expect` interaction mode owns
 *
 * Interaction mode is a **reachability** proof: a player can get to this
 * state by clicking, the control existed, it was usable, the click landed.
 * Command mode is the **magnitude** proof: it advances the clock in explicit
 * `tick`/`wait_until` beats with no browser between it and the engine, so an
 * exact figure means the same thing on every machine.
 *
 * Both modes read the same `expect`, and for most goals that is right — a
 * `holeCount: 6` after a drill step is the outcome of that step's own clicks
 * and is exactly what the UI path should prove. But a goal pinning a field
 * whose value depends on the *trajectory taken* rather than on what the step
 * did cannot hold in both modes at once, because the two modes deliberately
 * take different trajectories:
 *
 *   A `role: 'player'` step runs its whole `interaction` array in interaction
 *   mode, while command mode runs only the step's plain `command` string. A
 *   step that chains extra `tick` rounds in interaction mode (event
 *   resolution, a retry) puts interaction mode's absolute `tickCount` ahead
 *   of command mode's for the rest of the file. In-game events are seeded by
 *   `Random(seed + tickCount)`, so once the clocks diverge the two modes draw
 *   different outcomes, and every field downstream of a random draw — cash
 *   first — follows. Neither mode is doing anything wrong; the assertion is
 *   simply not about the same run any more. Issue #697 traced this end to end
 *   and paid for it with a starting-cash cushion on one scenario; #1069's
 *   three red shards, none of which was a gameplay regression, are the same
 *   mechanism arriving through a `src/core/` threshold change.
 *
 * So those goals are scoped to command mode. **Nothing is dropped from the
 * suite**: command mode reads `step.expect` unscoped and asserts every one of
 * them on every pull request, in the `scenario` channel, deterministically and
 * in a fraction of the time. This module only decides what the browser also
 * re-asserts, and it can only ever narrow that — never widen it.
 *
 * @module shared/interaction-goal-scope
 */

import type { ScenarioStepGoal } from './scenario-types.js';

/** The two `expect` goal kinds that pin an exact figure. */
type ScopedGoalKind = 'equals' | 'changedBy';

/**
 * One goal left to command mode, for the runner to report. A scenario that
 * quietly checked less than it used to would be a worse outcome than the
 * flake it replaces, so every skip is counted and named.
 */
interface DeferredGoal {
  field: string;
  goalType: ScopedGoalKind;
  reason: string;
}

/**
 * State-dump fields whose exact value describes the trajectory a run took
 * rather than what a step did, keyed by the goal kinds that pin it.
 *
 * Deliberately an explicit, individually-reasoned list rather than a pattern
 * — the same shape as `BOOTSTRAP_COMMAND_ALLOWLIST` (interaction-executor.ts)
 * and for the same reason: an entry here removes a real assertion from the
 * browser channel, so each one is argued on its own merits and reviewed as
 * such. Adding a field to dodge a red shard is exactly the drift this exists
 * to stop — a shard red on any other field is a finding, not an entry.
 */
export const TRAJECTORY_COUPLED_GOAL_FIELDS: Readonly<Record<string, {
  readonly kinds: readonly ScopedGoalKind[];
  readonly reason: string;
}>> = {
  /**
   * The clock itself, and the seed of every in-game event draw. Interaction
   * mode legitimately consumes ticks command mode does not (a step's
   * `interaction` array may chain `tick` rounds its `command` string has no
   * equivalent for), so an absolute `tickCount` is wrong in the browser by
   * construction, and a per-step `changedBy` pins a tick budget that the same
   * beat is entitled to exceed when it retries.
   */
  tickCount: {
    kinds: ['equals', 'changedBy'],
    reason: 'interaction mode consumes ticks command mode does not; the clock is command mode\'s to assert',
  },
  /**
   * The chained running total most sensitive to a diverged event draw: one
   * extra event fires, a fine or a payout lands, and every later absolute is
   * off by a figure that has nothing to do with the step asserting it. Only
   * `equals` is scoped out — `changedBy: {cash: -1000}` is step-local, states
   * what this step's own actions cost, and is the form the authoring rule
   * already asks for; it stays checked in both modes.
   */
  cash: {
    kinds: ['equals'],
    reason: 'a chained absolute balance follows the event draws a diverged clock produces; changedBy stays checked in both modes',
  },
};

/**
 * Drops the entries of `record` that `TRAJECTORY_COUPLED_GOAL_FIELDS` scopes
 * to command mode for this goal kind, collecting what it dropped. Returns
 * `undefined` for the whole record when nothing survives, so `checkGoal`'s
 * own `if (goal.increased || goal.equals || ...)` short-circuit still skips
 * the state fetch for a step left with no state goal at all.
 */
function scopeRecord<T>(
  record: Record<string, T> | undefined,
  goalType: ScopedGoalKind,
  deferred: DeferredGoal[],
): Record<string, T> | undefined {
  if (record === undefined) return undefined;

  const kept: Record<string, T> = {};
  for (const [field, value] of Object.entries(record)) {
    const rule = TRAJECTORY_COUPLED_GOAL_FIELDS[field];
    if (rule !== undefined && rule.kinds.includes(goalType)) {
      deferred.push({ field, goalType, reason: rule.reason });
      continue;
    }
    kept[field] = value;
  }

  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * Splits a step's `expect` into the half interaction mode proves and the half
 * it leaves to command mode.
 *
 * `usable`/`blocked`/`tutorialStep` are untouched — they need a live page and
 * are the reachability claim itself. `increased`/`decreased` are untouched
 * too: a direction survives a diverged trajectory, and fails exactly when the
 * step stops moving the field it is actually testing.
 *
 * @returns `scoped` — the goal to hand `checkGoal`; `deferred` — every goal
 *   left to command mode, named, for the runner to report.
 */
export function scopeGoalToInteraction(goal: ScenarioStepGoal): {
  scoped: ScenarioStepGoal;
  deferred: DeferredGoal[];
} {
  const deferred: DeferredGoal[] = [];
  const equals = scopeRecord(goal.equals, 'equals', deferred);
  const changedBy = scopeRecord(goal.changedBy, 'changedBy', deferred);

  if (deferred.length === 0) return { scoped: goal, deferred };

  const scoped: ScenarioStepGoal = { ...goal };
  if (equals === undefined) delete scoped.equals; else scoped.equals = equals;
  if (changedBy === undefined) delete scoped.changedBy; else scoped.changedBy = changedBy;

  return { scoped, deferred };
}

/**
 * True when a goal still asserts something once scoped — any state goal, any
 * DOM goal, or the tutorial step. A goal carrying only `note` asserts nothing
 * and needs no `checkGoal` round trip.
 */
export function goalAssertsAnything(goal: ScenarioStepGoal): boolean {
  return goal.increased !== undefined
    || goal.decreased !== undefined
    || goal.equals !== undefined
    || goal.changedBy !== undefined
    || goal.usable !== undefined
    || goal.blocked !== undefined
    || goal.tutorialStep !== undefined;
}
