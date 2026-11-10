/**
 * BlastSimulator2026 — Coverage thresholds over CI's coverage shards
 *
 * CI's `test` job measures coverage in N shards, each writing a shard dump
 * (vitest.coverage-shard.config.ts, scripts/lib/coverage-shards.ts). This script
 * is the `coverage` job's gate: it hands every dump to vitest's own v8 coverage
 * provider, configured as `npm run test:coverage` configures it
 * (vitest.coverage.config.ts), and lets that provider do the rest — fold the raw
 * V8 coverage together, convert it, add every measured file no test loaded at 0%,
 * write the configured reports and check vitest.config.ts's thresholds. Nothing
 * here re-implements a threshold rule, so the gate cannot drift from vitest's.
 *
 * Why: the unsharded coverage job was the longest of every CI run (45 min) and
 * ran the whole suite a second time beside the test shards. Pipeline runs waited
 * 30-45 min per issue on CI; #2142, #2143, #2148, #2154 and #2199 hit the agent
 * step's 270-minute timeout with most of it spent waiting on programs.
 *
 * Usage:
 *   npx tsx scripts/coverage-merge.ts --dir coverage/shards --shards 5 [--config vitest.coverage.config.ts]
 *
 * Exit code: 0 when every threshold holds, 1 when one does not (vitest prints
 * which file and metric), 2 when the shard set itself is unusable — a missing,
 * extra, corrupt or mislabelled dump, or dumps that do not split the measured
 * test files exactly once between them, fail the gate rather than judging part
 * of the suite.
 *
 * @module coverage-merge
 */

import { writeFile } from 'fs/promises';
import { relative, resolve, sep } from 'path';
import { V8CoverageProvider } from '@vitest/coverage-v8/dist/provider.js';
import { createVitest } from 'vitest/node';
import { checkShardPartition, listShardDumps, rebaseShardDump, readShardDump, ShardCoverageInjector } from './lib/coverage-shards.js';

const ROOT = resolve(import.meta.dirname, '..');

/** The coverage run whose measurement and thresholds the merged shards are judged by. */
const COVERAGE_CONFIG = 'vitest.coverage.config.ts';

/** Exit code for a shard set that could not be judged at all. */
const UNUSABLE = 2;

export interface MergeArgs {
  dir: string;
  shards: number;
  config: string;
}

/**
 * Parses `--dir <path> --shards <N> [--config <file>]`. The first two are
 * required, so a typo cannot pick a default shard count.
 */
export function parseMergeArgs(argv: readonly string[]): MergeArgs | string {
  let dir: string | undefined;
  let shards: number | undefined;
  let config = COVERAGE_CONFIG;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--dir' && value !== undefined) {
      dir = value;
    } else if (flag === '--shards' && value !== undefined && /^[1-9]\d*$/.test(value)) {
      shards = Number(value);
    } else if (flag === '--config' && value !== undefined) {
      config = value;
    } else {
      return `unrecognised argument ${[flag, value].filter((part) => part !== undefined).join(' ')}`;
    }
  }
  if (dir === undefined || shards === undefined) {
    return 'usage: coverage-merge --dir <shard dumps> --shards <N> [--config <vitest config>]';
  }
  return { dir, shards, config };
}

function unusable(problem: string): number {
  console.error(`Coverage shards unusable — the thresholds were not judged:\n${problem}`);
  return UNUSABLE;
}

async function main(): Promise<number> {
  const args = parseMergeArgs(process.argv.slice(2));
  if (typeof args === 'string') return unusable(args);
  const listed = listShardDumps(resolve(ROOT, args.dir), args.shards);
  if (!listed.success) return unusable(listed.error);

  // One raw file at a time, in the order the injector registers them: the
  // provider's fold is order-sensitive, and concurrent reads would let I/O
  // timing pick the order (scripts/lib/coverage-shards.ts).
  const ctx = await createVitest('test', {
    config: args.config,
    root: ROOT,
    watch: false,
    coverage: { enabled: true, processingConcurrency: 1 },
  });
  try {
    const provider = new V8CoverageProvider();
    provider.initialize(ctx);
    if (provider.options.processingConcurrency !== 1) {
      return unusable(`the provider would read ${provider.options.processingConcurrency} raw files at once; the canonical fold needs 1`);
    }
    // Keep the reports directory: CI downloads the dumps into coverage/shards,
    // inside it, and they are read after this point. Only the temp directory
    // of raw files is reset.
    await provider.clean(false);
    const injector = new ShardCoverageInjector(provider, ctx.vitenode, (path, text) => writeFile(path, text, 'utf8'));
    for (const [i, path] of listed.data.entries()) {
      const read = readShardDump(path, { index: i + 1, count: args.shards });
      if (!read.success) return unusable(read.error);
      const rebased = rebaseShardDump(read.data, ROOT);
      if (!rebased.success) return unusable(rebased.error);
      const added = await injector.add(rebased.data);
      if (!added.success) return unusable(added.error);
    }
    // Every measured test file in exactly one shard's dump, or nothing is judged.
    const expected = (await ctx.globTestFiles()).map(([, file]) => relative(ROOT, file).split(sep).join('/'));
    const partition = checkShardPartition(injector.testsByShard(), expected);
    if (!partition.success) return unusable(partition.error);
    const testFiles = injector.finish();

    const before = process.exitCode;
    process.exitCode = 0;
    await provider.reportCoverage({ allTestsRun: true });
    const failed = process.exitCode !== 0;
    process.exitCode = before;
    console.log(
      `\nCoverage thresholds ${failed ? 'NOT MET' : 'met'}: ${args.shards} shard(s) merged, `
      + `${testFiles} test file coverage(s), thresholds of ${args.config}.`,
    );
    return failed ? 1 : 0;
  } finally {
    await ctx.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().then((code) => process.exit(code), (error: unknown) => {
    console.error(error);
    process.exit(UNUSABLE);
  });
}
