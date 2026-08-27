/**
 * BlastSimulator2026 — Shared Scenario Utilities
 *
 * Common functions used by scenario-test.ts, command-runner.ts,
 * and run-all-scenarios.ts to avoid code duplication.
 *
 * @module shared/scenario-utils
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import type { InteractionStepAction, ScenarioDef, ScenarioStepDef } from './scenario-types.js';
import { WAIT_FOR_TUTORIAL_STEP_DEFAULT_TIMEOUT_MS } from './scenario-types.js';

export const SCENARIO_DIR = resolve(import.meta.dirname ?? process.cwd(), '..', 'scenario-defs');

/**
 * File names (without extension) of every scenario definition on disk,
 * sorted. Reads the directory directly rather than a hand-maintained name
 * list — issue #515's role lint must cover every scenario file that exists,
 * not only the subset a test file's own constant happens to enumerate.
 */
export function scenarioFiles(dir: string = SCENARIO_DIR): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();
}

/**
 * Format a zero-padded step index (e.g., 0 → "00", 12 → "12").
 */
export function formatStepIndex(i: number): string {
  return String(i).padStart(2, '0');
}

/**
 * Extract a filesystem-safe slug from a command string.
 * Takes the first token and strips non-alphanumeric characters.
 */
export function formatCommandSlug(command: string): string {
  return command.split(/\s+/)[0]!.replace(/[^a-z0-9_-]/gi, '');
}

/**
 * Report entry generated from scenario step results.
 */
export interface ReportEntry {
  step: number;
  command: string;
  output: string;
  error?: string;
  warning?: string;
  holes: number;
  charged: number;
  sequenced: number;
  screenshot?: string;
}

/**
 * Minimal step result needed for report building.
 */
export interface ReportableStep {
  step: number;
  command: string;
  commandOutput: string;
  error?: string;
  warning?: string;
  gameState: { holeCount?: number; chargedCount?: number; sequencedCount?: number } | null;
  screenshotPath?: string;
}

const MAX_REPORT_OUTPUT = 2000;

/**
 * Build a report array from step results, truncating large commandOutput
 * strings to avoid V8 string length limits in JSON.stringify.
 * Full output is preserved in per-step state JSON files.
 */
export function buildScenarioReport(results: ReportableStep[]): ReportEntry[] {
  return results.map(r => ({
    step: r.step,
    command: r.command,
    output: r.commandOutput.length > MAX_REPORT_OUTPUT
      ? r.commandOutput.slice(0, MAX_REPORT_OUTPUT) + `... [truncated, ${r.commandOutput.length} chars total]`
      : r.commandOutput,
    ...(r.error !== undefined ? { error: r.error } : {}),
    ...(r.warning !== undefined ? { warning: r.warning } : {}),
    holes: r.gameState?.holeCount ?? 0,
    charged: r.gameState?.chargedCount ?? 0,
    sequenced: r.gameState?.sequencedCount ?? 0,
    ...(r.screenshotPath !== undefined ? { screenshot: r.screenshotPath } : {}),
  }));
}

/**
 * Load a scenario definition from disk.
 * Returns the full ScenarioDef including steps and optional shots.
 */
export function loadScenarioDef(name: string, dir?: string): ScenarioDef {
  const scenarioDir = dir ?? SCENARIO_DIR;
  const defPath = resolve(scenarioDir, `${name}.json`);
  if (!existsSync(defPath)) {
    throw new Error(`Scenario not found: ${defPath}`);
  }
  return JSON.parse(readFileSync(defPath, 'utf-8')) as ScenarioDef;
}

/**
 * Violation entry shared by the structural lints under tests/unit/lint/ —
 * every lint walks the same file/step traversal and reports the same three
 * fields; individual lints add their own extra fields on top via generics.
 */
export interface ScenarioViolation {
  file: string;
  stepIndex: number;
  command: string;
}

/**
 * Shared traversal: walk every scenario file's every step (optionally
 * restricted to `scenarioNames`), collecting the ones for which
 * `isViolation` returns true.
 */
export function collectScenarioViolations(
  isViolation: (step: ScenarioStepDef) => boolean,
  scenarioNames: string[] = scenarioFiles(SCENARIO_DIR),
): ScenarioViolation[] {
  const violations: ScenarioViolation[] = [];
  for (const file of scenarioNames) {
    const scenario = loadScenarioDef(file, SCENARIO_DIR);
    scenario.steps.forEach((rawStep, stepIndex) => {
      const step = rawStep as ScenarioStepDef;
      if (isViolation(step)) {
        violations.push({ file, stepIndex, command: step.command });
      }
    });
  }
  return violations;
}

/**
 * Format a list of scenario violations for a test failure message, one line
 * per violation. `describeExtra` lets a caller append lint-specific detail
 * beyond the shared file/stepIndex/command fields.
 */
export function formatScenarioViolations<V extends ScenarioViolation>(
  violations: V[],
  describeExtra?: (v: V) => string,
): string {
  return violations
    .map((v) => `  ${v.file}.json step[${v.stepIndex}] ("${v.command}")${describeExtra ? describeExtra(v) : ''}`)
    .join('\n');
}

/**
 * Safety margin added on top of the slowest inner `timeoutMs` below, so the
 * outer race (setTimeout vs. the inner action's own deadline check) cannot
 * land close enough for scheduling jitter to flip which one fires first.
 */
export const TIMEOUT_MARGIN_MS = 5000;

/**
 * Per-frame cost of screenshot/frame capture under software rasterization
 * (no GPU), documented in `.claude/CLAUDE.md`. Used by `effectiveStepTimeoutMs`
 * to raise a step's effective floor when `--screenshots` is active, so a step
 * with a low declared `timeout` doesn't false-timeout purely from capture
 * overhead the runners themselves impose.
 */
export const SOFTWARE_RASTER_FRAME_COST_MS = 6000;

/**
 * Effective inner deadline when an action's own `timeoutMs` is absent. Must
 * match what each executor actually applies — `waitUntil` has none (the
 * field is required); `resolveEventIfPending` defaults to 30000
 * (interaction-executor.ts); `clickIfPresent` to 0 (a bare settle, not a
 * wait); `awaitUsable`/`zoomOut`/`focusTile`/`clickEntity` share
 * `DEFAULT_TIMEOUT_MS` = 6000 (interaction-driver.ts). `waitForTutorialStep`
 * is handled separately below via the shared
 * `WAIT_FOR_TUTORIAL_STEP_DEFAULT_TIMEOUT_MS` constant, since its own inner
 * deadline field is named `timeout`, not `timeoutMs`.
 */
const DEFAULT_INNER_TIMEOUT_MS: Partial<Record<InteractionStepAction['type'], number>> = {
  resolveEventIfPending: 30000,
  clickIfPresent: 0,
  awaitUsable: 6000,
  zoomOut: 6000,
  focusTile: 6000,
  clickEntity: 6000,
};

/**
 * Capture-cost floor (ms) for interaction-mode `--screenshots`: the base
 * step-end capture plus every inline `screenshot` action plus the scenario's
 * own `shots` count plus `step.frames`, each at `SOFTWARE_RASTER_FRAME_COST_MS`
 * under software rasterization (#725). Exported so
 * `tests/unit/scenario-defs-validation/interaction-actions.test.ts`'s #725
 * regression check calls the real formula instead of reimplementing it by
 * hand, which would otherwise silently drift out of sync with this file.
 */
export function captureCostFloorMs(step: ScenarioStepDef, shotsCount: number): number {
  const screenshotActionCount = (step.interaction ?? []).filter(a => a.type === 'screenshot').length;
  return (1 + screenshotActionCount + shotsCount + (step.frames ?? 0)) * SOFTWARE_RASTER_FRAME_COST_MS;
}

/**
 * A step's own outer `timeout` (seconds) and an inner action's `timeoutMs`
 * (ms) are raced independently by `scenario-interaction-runner.ts` /
 * `run-all-scenarios.ts` / `bench-scenarios.ts`, each against a fresh
 * `setTimeout`. When the declared outer value is lower than the slowest
 * inner deadline, the outer race always wins regardless of what the inner
 * action was actually waiting on, producing a generic
 * `Step N timed out after 60000ms` instead of that action's own, far more
 * useful error — the exact bug PR #616 fixed by hand across 53 files, 12 of
 * which it missed. Deriving the effective value here instead of trusting
 * each step's own declared `timeout` closes the class rather than the
 * instances: a new step with a large `timeoutMs` and no `timeout` of its own
 * is correct by construction, not by remembering to raise a second number to
 * match the first.
 *
 * `tests/unit/scenario-defs-validation/interaction-actions.test.ts`'s own outer/inner
 * regression check stays alongside this as a second, independent guard — this derives the
 * value the runners actually race against; that test catches a scenario
 * file whose *declared* `timeout` reads as misleadingly low to a human
 * editing it, even though the runners themselves no longer act on it alone.
 *
 * @param capture When provided with `enabled: true`, the returned deadline is
 * also raised to cover interaction-mode `--screenshots` capture cost — base
 * capture plus inline `screenshot` actions plus `capture.shotsCount` plus
 * `step.frames`, at `SOFTWARE_RASTER_FRAME_COST_MS` per unit, via
 * `captureCostFloorMs` (#725). Omitted or `enabled: false` leaves the return
 * value unchanged from the pre-#725 behavior.
 */
/**
 * Resolves a step's `repeat` field to a concrete iteration count:
 * absent -> 1; a positive integer -> itself. Throws an Error naming the step
 * (step.description ?? step.command) and the offending value for anything
 * else (0, negative, non-integer, NaN) - both runners call this once, before
 * running any iteration, so an invalid `repeat` fails the step immediately.
 */
export function resolveRepeatCount(step: ScenarioStepDef): number {
  const { repeat } = step;
  if (repeat === undefined) return 1;
  if (Number.isInteger(repeat) && repeat >= 1) return repeat;
  const label = step.description ?? step.command;
  throw new Error(`Invalid repeat value ${repeat} on step "${label}": must be a positive integer`);
}

/**
 * Runs `executeOnce` `step.repeat` times in immediate succession (issue
 * #696), returning the LAST iteration's result — the one both
 * `scenario-interaction-runner.ts` and `run-all-scenarios.ts` write to their
 * step report/state-dump. Shared because both independently reimplemented
 * the identical resolve-count / reject-waitUntil-combination /
 * loop-and-keep-last shape.
 *
 * `hasWaitUntil` is passed in by the caller rather than computed here (via
 * `findWaitUntilAction`, `scripts/shared/command-runner.ts`) because
 * importing that function into this file would import command-runner.ts,
 * which itself imports this file for `resolveRepeatCount` — a circular
 * import. Both call sites already import `findWaitUntilAction` for their own
 * step-level checks, so passing the boolean through costs them nothing
 * extra.
 */
export async function runRepeatedInteraction<T>(
  step: ScenarioStepDef,
  stepIndex: number,
  hasWaitUntil: boolean,
  executeOnce: () => Promise<T>,
): Promise<T> {
  const repeatCount = resolveRepeatCount(step);
  if (repeatCount > 1 && hasWaitUntil) {
    throw new Error(`repeat and waitUntil cannot combine on the same step (step ${stepIndex}, "${step.command}")`);
  }
  let last: T | undefined;
  for (let rep = 0; rep < repeatCount; rep++) {
    last = await executeOnce();
  }
  return last!;
}

export function effectiveStepTimeoutMs(
  step: ScenarioStepDef,
  defaultOuterSeconds: number,
  capture?: { enabled: boolean; shotsCount: number },
): number {
  const declaredMs = (step.timeout ?? defaultOuterSeconds) * 1000;

  let maxInnerMs = 0;
  for (const action of step.interaction ?? []) {
    // `awaitUsable`/`resolveEventIfPending`/`clickIfPresent`/`waitUntil`
    // declare a real `timeoutMs` field to read when present; `zoomOut`/
    // `focusTile`/`clickEntity` share the same real inner deadline
    // (interaction-driver.ts's DEFAULT_TIMEOUT_MS) but have no such field on
    // their own type, so `explicit` stays undefined for them and the table
    // below is the only source. An action with neither — no field and no
    // table entry — has no timeoutMs concept and is skipped.
    const explicit = 'timeoutMs' in action ? action.timeoutMs : undefined;
    const fallback = DEFAULT_INNER_TIMEOUT_MS[action.type];
    if (action.type === 'waitForTutorialStep') {
      // Own inner deadline field is named `timeout`, not `timeoutMs`
      // (interaction-executor.ts's `action.timeout ?? WAIT_FOR_TUTORIAL_STEP_DEFAULT_TIMEOUT_MS`)
      // — recognized separately from the `timeoutMs`/table branches above,
      // sharing that same constant so the two stay in lockstep.
      maxInnerMs = Math.max(maxInnerMs, action.timeout ?? WAIT_FOR_TUTORIAL_STEP_DEFAULT_TIMEOUT_MS);
      continue;
    }
    if (explicit === undefined && fallback === undefined) continue;
    maxInnerMs = Math.max(maxInnerMs, explicit ?? fallback ?? 0);
  }

  const base = maxInnerMs === 0 ? declaredMs : Math.max(declaredMs, maxInnerMs + TIMEOUT_MARGIN_MS);

  if (!capture?.enabled) return base;

  return Math.max(base, captureCostFloorMs(step, capture.shotsCount));
}
