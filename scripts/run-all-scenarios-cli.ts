/**
 * CLI argument parsing and shard-splitting for the batch scenario runner
 * (`scripts/run-all-scenarios.ts`).
 */

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
 * Split `names` into `total` shards by index modulo, not a contiguous slice —
 * scenario cost varies roughly 6x (13s to 80s+ in interaction mode), and the
 * alphabetical sort clusters same-prefix scenarios (the `level*-playthrough-*`
 * files) together, so a contiguous chunk would load some shards far more than
 * others. Round-robin spreads that variance evenly without needing per-scenario
 * cost data to balance against.
 */
export function selectShard(names: string[], shard: ShardSpec): string[] {
  return names.filter((_, i) => i % shard.total === shard.index - 1);
}
