/**
 * CLI argument parsing and shard-splitting for the batch scenario runner
 * (`scripts/run-all-scenarios.ts`).
 */

import type { ScenarioDef } from './shared/scenario-types.js';

const DEV_SERVER_PORT = 5173;

export interface ShardSpec {
  index: number;
  total: number;
}

export interface ParsedArgs {
  mode: string;
  scenarios: string[];
  port: number;
  shard?: ShardSpec;
  reportDrift: boolean;
}

export function parseShardArg(raw: string): ShardSpec {
  const m = /^(\d+)\/(\d+)$/.exec(raw);
  if (!m) throw new Error(`--shard must be "i/N" (1-indexed), got "${raw}"`);
  const index = parseInt(m[1]!, 10);
  const total = parseInt(m[2]!, 10);
  if (total < 1 || index < 1 || index > total) {
    throw new Error(`--shard "${raw}" out of range: index must be 1..${total}`);
  }
  return { index, total };
}

export function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let mode = 'command';
  let port = DEV_SERVER_PORT;
  let shard: ShardSpec | undefined;
  let reportDrift = false;
  const scenarios: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      mode = args[i + 1]!;
      i++;
    } else if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--shard' && args[i + 1]) {
      shard = parseShardArg(args[i + 1]!);
      i++;
    } else if (args[i] === '--report-drift') {
      reportDrift = true;
    } else if (args[i]) {
      scenarios.push(args[i]!);
    }
  }

  return { mode, scenarios, port, ...(shard ? { shard } : {}), reportDrift };
}

/** What one interaction action costs on average, the unit `estimateScenarioCost` counts in. */
const ACTION_COST = 1;
/**
 * A `blast` step in action-equivalents: its report-close click waits out the
 * fragment-collapse playback (3–15 s of wall clock) before it can land.
 */
const BLAST_STEP_COST = 10;
/** A `waitUntil` action: hundreds of in-page ticks, ~1–3 s. */
const WAIT_UNTIL_COST = 4;
/** One second of a fixed `wait` action. */
const WAIT_SECOND_COST = 3;

/**
 * Static cost proxy for one scenario, for `selectShard`'s balancing.
 *
 * Interaction mode: interaction actions, plus what the actions that block on
 * the game rather than on the DOM cost beyond their count — a blast step's
 * report waits out the collapse playback, a `waitUntil` runs hundreds of
 * ticks, a fixed `wait` sleeps for its duration. Command mode: the number
 * of steps. Neither needs measured durations that go stale as the suite
 * changes. The weights were chosen against CI run 34855681700's measured
 * per-scenario durations (13.1 s mean, 110 s max): balancing on the action
 * count alone put 311 s on one shard of ten against an ideal 185 s, these
 * weights 227 s, and no static proxy does much better across 10–14 shards —
 * the remaining gap is a handful of scenarios whose cost is not in their
 * definition at all.
 */
export function estimateScenarioCost(def: Pick<ScenarioDef, 'steps'>, mode: string): number {
  if (mode !== 'interaction') return def.steps.length;
  let cost = 0;
  for (const step of def.steps) {
    if (step.command.split(' ')[0] === 'blast') cost += BLAST_STEP_COST;
    for (const action of step.interaction ?? []) {
      cost += ACTION_COST;
      if (action.type === 'waitUntil') cost += WAIT_UNTIL_COST;
      if (action.type === 'wait') cost += WAIT_SECOND_COST * action.durationMs / 1000;
    }
  }
  return cost;
}

/**
 * Split `names` into `total` shards by cost, longest first: names sorted by
 * descending cost (ascending name on a tie) each go to the shard carrying
 * the least cost so far (lowest index on a tie). Every shard job derives the
 * same assignment from the same inputs, so the shards' union is exactly
 * `names`, each once, and a name stays on its shard from run to run as long
 * as the costs do. With no `costOf` every name costs 1, and the assignment
 * is the index-modulo round-robin this replaced.
 *
 * Why cost-aware: scenario cost varies ~20x in interaction mode (5 s to
 * 110 s per scenario in CI), so round-robin over the alphabetical list — which
 * clusters the `level*-playthrough-*` files — left one shard at 512 s against
 * another's 245 s in the same run.
 */
export function selectShard(
  names: string[],
  shard: ShardSpec,
  costOf: (name: string) => number = () => 1,
): string[] {
  const byCost = [...names].sort((a, b) => costOf(b) - costOf(a) || (a < b ? -1 : a > b ? 1 : 0));
  const loads = new Array<number>(shard.total).fill(0);
  const assigned = new Set<string>();
  for (const name of byCost) {
    let target = 0;
    for (let i = 1; i < shard.total; i++) {
      if (loads[i]! < loads[target]!) target = i;
    }
    loads[target] = loads[target]! + costOf(name);
    if (target === shard.index - 1) assigned.add(name);
  }
  return names.filter(name => assigned.has(name));
}
