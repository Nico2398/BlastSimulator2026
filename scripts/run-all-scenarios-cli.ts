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

/**
 * Static cost proxy for one scenario, for `selectShard`'s balancing.
 *
 * Interaction mode: the number of interaction actions (clicks, waits,
 * reads). Command mode: the number of steps. Neither needs measured
 * durations that go stale as the suite changes; replayed over CI's own
 * per-scenario interaction durations (10 shards, 13–14 Sep 2026), balancing
 * on the action count landed within 1% of balancing on the measured
 * durations themselves (correlation 0.84 between the two).
 */
export function estimateScenarioCost(def: Pick<ScenarioDef, 'steps'>, mode: string): number {
  if (mode !== 'interaction') return def.steps.length;
  let actions = 0;
  for (const step of def.steps) actions += step.interaction?.length ?? 0;
  return actions;
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
 * Why cost-aware: scenario cost varies ~15x in interaction mode (12 s to
 * 160 s per scenario in CI), so round-robin over the alphabetical list — which
 * clusters the `level*-playthrough-*` files — left one shard at 512 s against
 * another's 245 s in the same run. Balanced on `estimateScenarioCost`, the
 * slowest shard of that run would have finished at 378 s against an ideal
 * 368 s.
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
