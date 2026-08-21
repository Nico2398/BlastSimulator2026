/**
 * BlastSimulator2026 — Scenario Trace Diagnostic (issue #674)
 *
 * Diagnostic tooling for pinning down where a scenario's command-mode run
 * and interaction-mode run diverge. Not a scenario fix itself — this is the
 * trace/compare machinery the diagnostic phase uses to find the first
 * divergent step before any fix is written.
 *
 * Two independent comparisons live here, because #674's two root causes were
 * each only visible to one of them:
 *
 *   `compareTraces`         — what command each mode actually issued per step.
 *                             Caught level2-playthrough-win's step 64, which
 *                             declared `tick 45` and clicked its way to
 *                             `tick 6`.
 *   `compareStateSnapshots` — what the game state read back as per step.
 *                             Caught tutorial-playthrough's step 37, where
 *                             both modes issued a command but interaction
 *                             mode's click resolved onto the wrong vehicle,
 *                             so the divergence only ever showed up in state.
 *
 * @module shared/scenario-trace
 */

import { appendFileSync } from 'fs';

/**
 * One recorded command outcome from a single scenario run, in either mode.
 * Written incrementally as a run progresses so a crashed run still leaves
 * a partial trace behind.
 *
 * Command mode contributes exactly one entry per step (its declared
 * `command`). Interaction mode contributes one per `command` action plus one
 * per internal `tick 1` a `waitUntil` loops — so a step driven by real clicks
 * contributes none at all, which is expected and not a divergence.
 */
export interface ScenarioTraceEntry {
  stepIndex: number;
  mode: 'command' | 'interaction';
  command: string;
  success: boolean;
  tickCountAfter: number | null;
}

/** Why {@link compareTraces} called a step divergent. */
export type TraceDivergenceReason =
  /** Both modes issued one command for this step, and the strings differ. */
  | 'command'
  /** Same command, opposite outcomes — one console accepted it, the other refused. */
  | 'success'
  /** The step's commands agree but the two modes are on different absolute ticks. */
  | 'tickCount'
  /** Interaction mode's trace stops before this step: its run ended early. */
  | 'missing';

/**
 * The first scenario step at which a command-mode trace and an
 * interaction-mode trace of the same scenario disagree. `null` from
 * {@link compareTraces} means no step disagreed.
 */
export interface TraceDivergence {
  stepIndex: number;
  reason: TraceDivergenceReason;
  command: ScenarioTraceEntry | null;
  interaction: ScenarioTraceEntry | null;
}

/** One step's game-state dump from a single run, keyed by the step it followed. */
export interface ScenarioStateSnapshot {
  stepIndex: number;
  state: Record<string, unknown> | null;
}

/** The first step whose state dumps differ, and which fields differ there. */
export interface StateDivergence {
  stepIndex: number;
  fields: Array<{ field: string; command: unknown; interaction: unknown }>;
}

/**
 * State-dump fields that differ between the two modes by construction and
 * say nothing about the simulation diverging: interaction mode runs a real
 * browser with a weather system and a live HUD time control, command mode
 * does not, and `muckPile` carries float fragment positions the renderer
 * settles independently of the engine.
 */
export const MODE_INCIDENTAL_STATE_FIELDS: readonly string[] = [
  'weather', 'timeScale', 'isPaused', 'time', 'muckPile', 'lastCommandOutput',
];

/**
 * Appends one JSONL line for `entry` to the file at `path`, creating it if it
 * does not exist. Synchronous, matching this project's other CLI scripts
 * (`command-runner.ts`, `scenario-utils.ts` — `writeFileSync`/`mkdirSync`
 * throughout, no async fs anywhere in `scripts/shared/`).
 */
export function writeTraceEntry(path: string, entry: ScenarioTraceEntry): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

/**
 * Normalizes a command string for comparison: trims leading/trailing
 * whitespace and collapses any internal run of whitespace to a single space.
 * A step's declared `command` and the actual string a UI click resolves to
 * can differ only in incidental spacing without that being the divergence
 * this tool exists to find.
 */
function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

/** Groups a trace by the scenario step each entry belongs to. */
function byStep(trace: ScenarioTraceEntry[]): Map<number, ScenarioTraceEntry[]> {
  const grouped = new Map<number, ScenarioTraceEntry[]>();
  for (const entry of trace) {
    const bucket = grouped.get(entry.stepIndex);
    if (bucket === undefined) grouped.set(entry.stepIndex, [entry]);
    else bucket.push(entry);
  }
  return grouped;
}

/**
 * Pure comparison, no I/O — walks the command trace step by step and returns
 * the first step the interaction trace disagrees on, or `null`.
 *
 * Aligned by `stepIndex`, never by array position: the two traces have
 * different shapes on purpose (a click-driven step contributes no
 * interaction entry, a `waitUntil` step contributes one per internal tick),
 * so a positional walk reports a divergence at the first click-driven step of
 * every scenario and buries the real one.
 *
 * A step interaction mode contributed no entry for is skipped — there is no
 * command to compare, and its state is `compareStateSnapshots`'s business.
 * A step past the end of the interaction trace is reported as `'missing'`,
 * which is how a run that stopped early surfaces.
 */
export function compareTraces(
  commandTrace: ScenarioTraceEntry[],
  interactionTrace: ScenarioTraceEntry[],
): TraceDivergence | null {
  if (interactionTrace.length === 0) return null;

  const interactionByStep = byStep(interactionTrace);
  const lastInteractionStep = Math.max(...interactionTrace.map(e => e.stepIndex));

  for (const command of [...commandTrace].sort((a, b) => a.stepIndex - b.stepIndex)) {
    const entries = interactionByStep.get(command.stepIndex);

    if (entries === undefined || entries.length === 0) {
      if (command.stepIndex > lastInteractionStep) {
        return { stepIndex: command.stepIndex, reason: 'missing', command, interaction: null };
      }
      continue;
    }

    const only = entries.length === 1 ? entries[0]! : null;
    if (only !== null && normalizeCommand(only.command) !== normalizeCommand(command.command)) {
      return { stepIndex: command.stepIndex, reason: 'command', command, interaction: only };
    }
    if (only !== null && only.success !== command.success) {
      return { stepIndex: command.stepIndex, reason: 'success', command, interaction: only };
    }

    const last = entries[entries.length - 1]!;
    if (last.tickCountAfter !== command.tickCountAfter) {
      return { stepIndex: command.stepIndex, reason: 'tickCount', command, interaction: last };
    }
  }

  return null;
}

/**
 * Pure comparison, no I/O — the first step whose two state dumps disagree on
 * any field, ignoring `ignoredFields` (default
 * {@link MODE_INCIDENTAL_STATE_FIELDS}). A step either mode has no dump for
 * is skipped rather than reported: a missing dump is the runner's own
 * failure to report, not a simulation divergence.
 */
export function compareStateSnapshots(
  commandSnapshots: ScenarioStateSnapshot[],
  interactionSnapshots: ScenarioStateSnapshot[],
  ignoredFields: readonly string[] = MODE_INCIDENTAL_STATE_FIELDS,
): StateDivergence | null {
  const ignored = new Set(ignoredFields);
  const interactionByStep = new Map(interactionSnapshots.map(s => [s.stepIndex, s.state]));

  for (const snapshot of [...commandSnapshots].sort((a, b) => a.stepIndex - b.stepIndex)) {
    const interaction = interactionByStep.get(snapshot.stepIndex);
    if (snapshot.state === null || interaction === undefined || interaction === null) continue;

    const fields: StateDivergence['fields'] = [];
    for (const field of Object.keys(snapshot.state)) {
      if (ignored.has(field)) continue;
      const a = snapshot.state[field];
      const b = interaction[field];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        fields.push({ field, command: a, interaction: b });
      }
    }
    if (fields.length > 0) return { stepIndex: snapshot.stepIndex, fields };
  }

  return null;
}
