/**
 * BlastSimulator2026 — Scenario Trace Diagnostic (issue #674)
 *
 * Diagnostic tooling for pinning down where a scenario's command-mode run
 * and interaction-mode run diverge. Not the scenario-file fix itself — this
 * is the trace/compare machinery the diagnostic phase uses to find the
 * first divergent step before any fix is written.
 *
 * @module shared/scenario-trace
 */

/**
 * One recorded step outcome from a single scenario run, in either mode.
 * Written incrementally as a run progresses so a crashed run still leaves
 * a partial trace behind.
 */
export interface ScenarioTraceEntry {
  stepIndex: number;
  mode: 'command' | 'interaction';
  command: string;
  success: boolean;
  tickCountAfter: number | null;
}

/**
 * The first point at which a command-mode trace and an interaction-mode
 * trace of the same scenario disagree. `null` from {@link compareTraces}
 * means the two traces agree at every compared index.
 */
export interface TraceDivergence {
  firstDivergentIndex: number;
  command: ScenarioTraceEntry | null;
  interaction: ScenarioTraceEntry | null;
}

// TODO: implement
export function writeTraceEntry(_path: string, _entry: ScenarioTraceEntry): void {
  throw new Error('not implemented');
}

// TODO: implement
export function compareTraces(
  _commandTrace: ScenarioTraceEntry[],
  _interactionTrace: ScenarioTraceEntry[],
): TraceDivergence | null {
  throw new Error('not implemented');
}
