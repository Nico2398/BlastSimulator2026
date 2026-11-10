/**
 * BlastSimulator2026 — Test shards balanced by measured duration
 *
 * vitest 1.6 shards by sorting test files on a sha1 of their path and cutting
 * the list into equal file counts, then runs each shard's files biggest-on-disk
 * first. Both choices ignore what a file costs, and this suite's cost is
 * concentrated: 30 of its ~1,000 files hold 64% of the test time, and the
 * heaviest alone — tests/integration/sandbox-starter-deposit-2116.integration.test.ts,
 * 194 s of 1,551 s measured locally — is only the 408th largest file, so it
 * started a good way into its shard. CI's three hash shards ran 8 / 11.5 / 15 min.
 * The hash split of the same files into five would put 207 / 368 / 188 / 519 /
 * 269 s of test time on the shards (the heaviest 1.67x the mean); this one puts
 * 310 s on each.
 *
 * Every CI shard of a run must agree on the split or a file runs twice or never,
 * so the split is computed only from what every shard has identically: the test
 * files vitest found in the checkout and the committed weight table
 * (tests/shard-weights.json). It balances the files of this run together with
 * every other file the table names, so the coverage-measured run and the
 * uninstrumented run beside it (vitest.coverage-excluded.config.ts) share the
 * load instead of both stacking their heaviest file on shard 1. A stale table
 * only unbalances the shards: a file it does not know weighs the table's median.
 * An unreadable table falls back to vitest's own hash split, with a warning.
 *
 * Refresh the table from CI's JUnit artifacts (or from any vitest JSON report):
 *   gh run download <run-id> --pattern 'test-results-*' --dir <dir>
 *   npx tsx scripts/shard-weights.ts <dir>/test-results-1/*.xml <dir>/test-results-2/*.xml ...
 *
 * @module test-shard-sequencer
 */

import { readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { BaseSequencer, type WorkspaceSpec } from 'vitest/node';

/** The committed weight table, relative to the root. */
export const SHARD_WEIGHTS_FILE = 'tests/shard-weights.json';

/** The table's shape: test file (root-relative, `/`-separated) to milliseconds. */
export interface ShardWeightsTable {
  $comment?: string;
  milliseconds: Record<string, number>;
}

/** Parses the weight table, refusing anything but non-negative integer milliseconds. */
export function parseShardWeights(text: string): Map<string, number> | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return `not JSON (${(error as Error).message})`;
  }
  const table = (value as Partial<ShardWeightsTable> | null)?.milliseconds;
  if (typeof table !== 'object' || table === null || Array.isArray(table)) return 'no `milliseconds` object';
  const weights = new Map<string, number>();
  for (const [file, ms] of Object.entries(table)) {
    if (!Number.isInteger(ms) || ms < 0) return `${file}: weight must be a non-negative integer, got ${String(ms)}`;
    weights.set(file, ms);
  }
  return weights;
}

/** The weight of a file the table does not name: the table's median. */
export function unknownFileWeight(weights: ReadonlyMap<string, number>): number {
  const sorted = [...weights.values()].sort((a, b) => a - b);
  if (sorted.length === 0) return 1;
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
}

/**
 * Longest-processing-time-first assignment of `files` to `count` shards: every
 * file of `files` and of the table, heaviest first (ties by path), each to the
 * shard with the least weight so far (ties to the lowest shard). Returns the
 * 1-based shard of each file in `files`. Deterministic: same inputs, same split.
 */
export function assignShards(
  files: readonly string[],
  weights: ReadonlyMap<string, number>,
  count: number,
): Map<string, number> {
  const fallback = unknownFileWeight(weights);
  const all = new Set<string>([...weights.keys(), ...files]);
  const ordered = [...all]
    .map((file) => ({ file, weight: weights.get(file) ?? fallback }))
    .sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const loads = new Array<number>(count).fill(0);
  const wanted = new Set(files);
  const shardOf = new Map<string, number>();
  for (const { file, weight } of ordered) {
    let lightest = 0;
    for (let shard = 1; shard < count; shard++) {
      if ((loads[shard] ?? 0) < (loads[lightest] ?? 0)) lightest = shard;
    }
    loads[lightest] = (loads[lightest] ?? 0) + weight;
    if (wanted.has(file)) shardOf.set(file, lightest + 1);
  }
  return shardOf;
}

/** Heaviest first, so a shard's longest file never starts last; ties by path. */
export function heaviestFirst<T>(
  items: readonly T[],
  fileOf: (item: T) => string,
  weights: ReadonlyMap<string, number>,
): T[] {
  const fallback = unknownFileWeight(weights);
  const weight = (item: T): number => weights.get(fileOf(item)) ?? fallback;
  return [...items].sort((a, b) => {
    const fileA = fileOf(a);
    const fileB = fileOf(b);
    return weight(b) - weight(a) || (fileA < fileB ? -1 : fileA > fileB ? 1 : 0);
  });
}

/** vitest sequencer applying `assignShards` and `heaviestFirst` with the committed table. */
export class WeightedShardSequencer extends BaseSequencer {
  private weights: Map<string, number> | null | undefined;

  private table(): Map<string, number> | null {
    if (this.weights === undefined) {
      const path = join(this.ctx.config.root, SHARD_WEIGHTS_FILE);
      let parsed: Map<string, number> | string;
      try {
        parsed = parseShardWeights(readFileSync(path, 'utf8'));
      } catch (error) {
        parsed = (error as Error).message;
      }
      if (typeof parsed === 'string') {
        this.ctx.logger.warn(`${SHARD_WEIGHTS_FILE} unusable (${parsed}); falling back to vitest's hash split.`);
        this.weights = null;
      } else {
        this.weights = parsed;
      }
    }
    return this.weights;
  }

  private key(spec: WorkspaceSpec): string {
    return relative(this.ctx.config.root, spec[1]).split(sep).join('/');
  }

  override async shard(files: WorkspaceSpec[]): Promise<WorkspaceSpec[]> {
    const weights = this.table();
    const shard = this.ctx.config.shard;
    if (weights === null || !shard) return super.shard(files);
    const shardOf = assignShards(files.map((spec) => this.key(spec)), weights, shard.count);
    return files.filter((spec) => shardOf.get(this.key(spec)) === shard.index);
  }

  override async sort(files: WorkspaceSpec[]): Promise<WorkspaceSpec[]> {
    const weights = this.table();
    if (weights === null) return super.sort(files);
    return heaviestFirst(files, (spec) => this.key(spec), weights);
  }
}
