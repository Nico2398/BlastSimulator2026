/**
 * BlastSimulator2026 — What one interaction-mode scenario costs, for shard balancing
 *
 * CI runs the interaction-mode suite in `SCENARIO_INTERACTION_SHARDS` shards,
 * and the slowest shard is that job's wall clock. `selectShard` balances them
 * on a cost per scenario. The static proxy (`estimateScenarioCost`) counts
 * actions, blast steps and waits, and cannot see what a definition does not
 * spell out: a `tick 150` counts as one action, a `waitUntil` as five whatever
 * its `maxTicks`, a tutorial's real-time guide clock as one. On CI run
 * 42579175214 the ten shards carried equal static cost (1735–1739 units) and
 * took 254–708 s: Pearson 0.57 between static cost and seconds. Balanced on
 * those measured seconds, the same 246 scenarios split 447–449 s per shard.
 *
 * So a scenario's interaction cost is its measured seconds from the committed
 * table `run-all-scenarios-interaction-seconds.json`, and only a scenario the
 * table does not hold yet — a new one — falls back to its static estimate,
 * converted to seconds at the suite's measured rate. A stale entry only costs
 * balance: nothing here decides which scenarios run.
 *
 * Refreshing the table: every interaction-mode batch prints a `Timing:` line
 * per scenario (`timingLine`), marked FAILED for a scenario that failed. Save
 * the logs of a CI run's interaction shards (`gh run view <run id> --log >
 * ci.log`, or each job's raw log) and run
 *   npx tsx scripts/run-all-scenarios-costs.ts --refresh <log>...
 * which rewrites the table from them — measured entries of passed scenarios
 * replaced, scenarios the logs did not cover or that failed kept, entries for
 * deleted definitions dropped.
 *
 * @module run-all-scenarios-costs
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/** The committed table of measured interaction-mode seconds per scenario. */
export const INTERACTION_SECONDS_PATH = resolve(import.meta.dirname, 'run-all-scenarios-interaction-seconds.json');

/**
 * Seconds per static cost unit across the whole interaction suite on CI run
 * 42579175214: 4480.5 s for 17362.8 units. Puts a new scenario's static
 * estimate on the same scale as the measured ones.
 */
export const SECONDS_PER_COST_UNIT = 0.258;

/** Measured seconds by scenario name. */
export type ScenarioSeconds = ReadonlyMap<string, number>;

/** The table from its JSON text; an entry that is not a finite, non-negative number is dropped. */
export function parseScenarioSeconds(text: string): Map<string, number> {
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('expected a JSON object of scenario seconds');
  const table = new Map<string, number>();
  for (const [name, seconds] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) table.set(name, seconds);
  }
  return table;
}

/**
 * The committed table, or an empty one — with a warning — when it is missing
 * or unreadable: every scenario then costs its static estimate, which is
 * today's balance, never a scenario left out.
 */
export function loadScenarioSeconds(path: string = INTERACTION_SECONDS_PATH, warn: (message: string) => void = console.warn): ScenarioSeconds {
  try {
    return parseScenarioSeconds(readFileSync(path, 'utf8'));
  } catch (error) {
    warn(`Interaction shard balance: no measured seconds (${error instanceof Error ? error.message : String(error)}); every scenario costs its static estimate.`);
    return new Map();
  }
}

/** A scenario's interaction cost in seconds: measured when the table has it, its static estimate converted otherwise. */
export function interactionCostSeconds(name: string, staticCost: number, measured: ScenarioSeconds): number {
  return measured.get(name) ?? staticCost * SECONDS_PER_COST_UNIT;
}

/**
 * The line an interaction batch prints after each scenario; `parseTimingLines`
 * reads it back. A failed scenario's line says so: the time it took to fail is
 * not what it costs, and a refresh skips it.
 */
export function timingLine(name: string, seconds: number, failed = false): string {
  return `  Timing: ${name} ${seconds.toFixed(1)}s${failed ? ' FAILED' : ''}`;
}

// Anywhere on the line: a raw job log prefixes a timestamp, `gh run view --log`
// a job name, a step name and a timestamp.
const TIMING = /(?:^|\s)Timing: (\S+) (\d+(?:\.\d+)?)s( FAILED)?\s*$/;

/** Every passed scenario's `Timing:` line in a log, by scenario name; the last wins. */
export function parseTimingLines(log: string): Map<string, number> {
  const timings = new Map<string, number>();
  for (const line of log.split('\n')) {
    const match = TIMING.exec(line.trimEnd());
    if (match && match[3] === undefined) timings.set(match[1]!, Number(match[2]));
  }
  return timings;
}

/**
 * The refreshed table: `current` with every scenario the logs timed replaced,
 * restricted to `existing` definitions, sorted by name.
 */
export function refreshScenarioSeconds(current: ScenarioSeconds, timed: ScenarioSeconds, existing: readonly string[]): Map<string, number> {
  const known = new Set(existing);
  const merged = new Map([...current, ...timed].filter(([name]) => known.has(name)));
  return new Map([...merged].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function main(argv: readonly string[]): number {
  if (argv[0] !== '--refresh' || argv.length < 2) {
    console.error('usage: npx tsx scripts/run-all-scenarios-costs.ts --refresh <interaction-shard log>...');
    return 4;
  }
  const timed = new Map<string, number>();
  for (const path of argv.slice(1)) {
    if (!existsSync(path)) {
      console.error(`No such log: ${path}`);
      return 1;
    }
    for (const [name, seconds] of parseTimingLines(readFileSync(path, 'utf8'))) timed.set(name, seconds);
  }
  if (timed.size === 0) {
    console.error('No `Timing:` lines in the given logs — nothing to refresh from.');
    return 1;
  }
  const existing = readdirSync(resolve(import.meta.dirname, 'scenario-defs')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  const current = loadScenarioSeconds();
  const next = refreshScenarioSeconds(current, timed, existing);
  writeFileSync(INTERACTION_SECONDS_PATH, `${JSON.stringify(Object.fromEntries(next), null, 2)}\n`);
  const untimed = existing.filter((name) => !timed.has(name));
  console.log(`Refreshed ${timed.size} scenario(s); ${next.size} in the table; ${untimed.length} definition(s) not in these logs kept their previous entry or the static estimate.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
