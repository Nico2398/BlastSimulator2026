/**
 * CLI argument parsing and shard-splitting for the batch scenario runner
 * (`scripts/run-all-scenarios.ts`).
 *
 * Stub only — signatures match the current inline implementation in
 * `run-all-scenarios.ts` (issue #824). Real logic moves in at implementation
 * time.
 */

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

// TODO: implement — move body from run-all-scenarios.ts's parseShardArg (#824)
export function parseShardArg(_raw: string): ShardSpec {
  throw new Error('not implemented');
}

// TODO: implement — move body from run-all-scenarios.ts's parseArgs (#824)
export function parseArgs(): ParsedArgs {
  throw new Error('not implemented');
}

// TODO: implement — move body from run-all-scenarios.ts's selectShard (#824)
export function selectShard(_names: string[], _shard: ShardSpec): string[] {
  throw new Error('not implemented');
}
