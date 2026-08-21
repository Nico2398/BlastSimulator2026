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

import { appendFileSync } from 'fs';

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

/** Whether two trace entries at the same index count as agreeing. */
function entriesMatch(a: ScenarioTraceEntry, b: ScenarioTraceEntry): boolean {
  return normalizeCommand(a.command) === normalizeCommand(b.command)
    && a.tickCountAfter === b.tickCountAfter;
}

/**
 * Pure comparison, no I/O — walks both traces in parallel by index and
 * returns the first point they disagree, or `null` when they agree at every
 * shared index and have equal length. One side running out first (a strict
 * prefix of the other, including empty vs. non-empty) is itself a divergence,
 * reported at the shorter array's own length with that side's entry as `null`.
 */
export function compareTraces(
  commandTrace: ScenarioTraceEntry[],
  interactionTrace: ScenarioTraceEntry[],
): TraceDivergence | null {
  const maxLen = Math.max(commandTrace.length, interactionTrace.length);

  for (let i = 0; i < maxLen; i++) {
    const command = i < commandTrace.length ? commandTrace[i]! : null;
    const interaction = i < interactionTrace.length ? interactionTrace[i]! : null;

    if (command === null || interaction === null || !entriesMatch(command, interaction)) {
      return { firstDivergentIndex: i, command, interaction };
    }
  }

  return null;
}
