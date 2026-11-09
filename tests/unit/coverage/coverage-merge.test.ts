// BlastSimulator2026 — The sharded coverage gate, end to end (scripts/coverage-merge.ts)
//
// CI's `coverage` job no longer runs the suite: it judges vitest.config.ts's
// thresholds over the raw V8 coverage the five test shards uploaded. That gate is
// only worth having if (1) sharding loses nothing — the same test files measured
// in one shard or in two merge to the same per-file figures — (2) a threshold
// that does not hold fails it, and (3) a shard set it cannot trust fails it too,
// rather than passing on part of the suite. Each is proven here against real
// shard runs of vitest.coverage-shard.config.ts on three small test files, the
// measurement narrowed to src/core/math/** so the run takes seconds.
//
// The wide measurement this reduces was taken once, by hand, on 127 test files:
// merged shards equalled one unsharded dump on every file and metric (664 files),
// where the istanbul-level merge it replaced was off by up to 39 points
// (scripts/lib/coverage-shards.ts).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseMergeArgs } from '../../../scripts/coverage-merge';
import { shardDumpFileName } from '../../../scripts/lib/coverage-shards';

const ROOT = join(import.meta.dirname, '../../..');
const VITEST = join(ROOT, 'node_modules/vitest/vitest.mjs');
const TSX = join(ROOT, 'node_modules/tsx/dist/cli.mjs');
const FIXTURE_CONFIG = 'tests/unit/coverage/fixtures/vitest.merge-fixture.config.ts';
const TESTS = ['tests/unit/math/Random.test.ts', 'tests/unit/math/Vec3.test.ts', 'tests/unit/math/Hash.test.ts'];
/** Generous: CI runners are several times slower than a laptop, and this test must not flake on that. */
const SETUP_TIMEOUT = 300_000;

let work: string;

function shardRun(index: number, count: number, reports: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [
    VITEST, 'run', '--no-cache', '--config', 'vitest.coverage-shard.config.ts', `--shard=${index}/${count}`,
    '--coverage.include=src/core/math/**', `--coverage.reportsDirectory=${reports}`, ...TESTS,
  ], { cwd: ROOT, encoding: 'utf8' });
}

/** vitest's own coverage run over the same files: the v8 provider, converting in-process. */
function singleRun(reports: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [
    VITEST, 'run', '--no-cache', '--config', 'vitest.coverage-shard.config.ts', '--coverage.provider=v8',
    '--coverage.include=src/core/math/**', `--coverage.reportsDirectory=${reports}`, ...TESTS,
  ], { cwd: ROOT, encoding: 'utf8' });
}

function merge(dir: string, shards: number, statements: number, reports: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [
    TSX, 'scripts/coverage-merge.ts', '--dir', dir, '--shards', String(shards), '--config', FIXTURE_CONFIG,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, COVERAGE_FIXTURE_REPORTS: reports, COVERAGE_FIXTURE_STATEMENTS: String(statements) },
  });
}

/** Per-file statements/branches/functions/lines hit maps, keyed by file. */
function figures(reports: string): Record<string, unknown> {
  const map = JSON.parse(readFileSync(join(reports, 'coverage-final.json'), 'utf8')) as Record<string, { s: unknown; b: unknown; f: unknown }>;
  return Object.fromEntries(Object.entries(map).map(([file, data]) => [file, { s: data.s, b: data.b, f: data.f }]));
}

/** Collects one shard run's dump into the directory the merge reads, as CI's download does. */
function collect(reports: string, index: number, count: number, into: string): void {
  copyFileSync(join(reports, shardDumpFileName({ index, count })), join(into, shardDumpFileName({ index, count })));
}

describe('scripts/coverage-merge.ts over real shard dumps', () => {
  const runs: Record<string, SpawnSyncReturns<string>> = {};

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'coverage-merge-'));
    const one = join(work, 'one-shard');
    const two = join(work, 'two-shards');
    mkdirSync(one);
    mkdirSync(two);
    runs.single = singleRun(join(work, 'single'));
    runs.shard1of1 = shardRun(1, 1, join(work, 'r-1-1'));
    collect(join(work, 'r-1-1'), 1, 1, one);
    for (const index of [1, 2]) {
      runs[`shard${index}of2`] = shardRun(index, 2, join(work, `r-${index}-2`));
      collect(join(work, `r-${index}-2`), index, 2, two);
    }
    runs.mergeOne = merge(one, 1, 0, join(work, 'merged-one'));
    runs.mergeTwo = merge(two, 2, 0, join(work, 'merged-two'));
    runs.mergeTwoStrict = merge(two, 2, 101, join(work, 'merged-strict'));
  }, SETUP_TIMEOUT);

  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('runs every shard to completion', () => {
    for (const key of ['single', 'shard1of1', 'shard1of2', 'shard2of2']) {
      expect(runs[key]?.status, `${key}: ${runs[key]?.stderr ?? ''}`).toBe(0);
    }
  });

  it('passes the gate when every threshold holds', () => {
    expect(runs.mergeOne?.status, runs.mergeOne?.stderr).toBe(0);
    expect(runs.mergeTwo?.status, runs.mergeTwo?.stderr).toBe(0);
    expect(runs.mergeTwo?.stdout).toContain('Coverage thresholds met: 2 shard(s) merged');
  });

  it('measures exactly the same per-file hits from two shards as from one', () => {
    const fromOne = figures(join(work, 'merged-one'));
    expect(Object.keys(fromOne).length).toBeGreaterThan(3);
    expect(figures(join(work, 'merged-two'))).toEqual(fromOne);
  });

  // Guards what the shard-count comparison above cannot see: a fault shared by
  // every merge, such as mapping V8 offsets without vite-node's wrapper.
  it('measures what vitest\'s own in-process coverage run measures on the same files', () => {
    expect(figures(join(work, 'merged-two'))).toEqual(figures(join(work, 'single')));
  });

  it('adds the measured files no test loaded, at zero', () => {
    const fromTwo = figures(join(work, 'merged-two')) as Record<string, { s: Record<string, number> }>;
    const fraction = Object.entries(fromTwo).find(([file]) => file.endsWith('src/core/math/Fraction.ts'));
    expect(fraction).toBeDefined();
    expect(Object.values(fraction?.[1].s ?? { x: 1 }).every((hits) => hits === 0)).toBe(true);
  });

  it('fails with exit code 1, naming the file, when a threshold does not hold', () => {
    expect(runs.mergeTwoStrict?.status).toBe(1);
    expect(runs.mergeTwoStrict?.stderr).toMatch(/Coverage for statements \([\d.]+%\) does not meet global threshold \(101%\) for src\/core\/math\//);
  });

  it('fails closed with exit code 2 when a shard is missing', () => {
    const missing = merge(join(work, 'two-shards'), 3, 0, join(work, 'merged-missing'));
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('coverage-shard-1-of-3.json');
  });

  it('fails closed with exit code 2 on a corrupt shard', () => {
    const corrupt = join(work, 'corrupt');
    mkdirSync(corrupt);
    collect(join(work, 'r-1-2'), 1, 2, corrupt);
    writeFileSync(join(corrupt, shardDumpFileName({ index: 2, count: 2 })), '{"format":');
    const merged = merge(corrupt, 2, 0, join(work, 'merged-corrupt'));
    expect(merged.status).toBe(2);
    expect(merged.stderr).toContain('coverage-shard-2-of-2.json: not JSON');
  });

  it('fails closed with exit code 2 when the shards do not split the suite between them', () => {
    // Shard 1's dump twice, the second relabelled 2/2: its files ran twice and
    // shard 2's never — what two shards reading different splits would upload.
    const misSplit = join(work, 'mis-split');
    mkdirSync(misSplit);
    collect(join(work, 'r-1-2'), 1, 2, misSplit);
    const dump = JSON.parse(readFileSync(join(work, 'r-1-2', shardDumpFileName({ index: 1, count: 2 })), 'utf8')) as { shard: { index: number } };
    dump.shard.index = 2;
    writeFileSync(join(misSplit, shardDumpFileName({ index: 2, count: 2 })), JSON.stringify(dump));
    const merged = merge(misSplit, 2, 0, join(work, 'merged-mis-split'));
    expect(merged.status).toBe(2);
    expect(merged.stderr).toContain('the shards do not split one suite');
    expect(merged.stderr).toMatch(/ran in shard 1 and shard 2/);
    expect(merged.stderr).toMatch(/is in no shard's coverage/);
  });
});

describe('parseMergeArgs', () => {
  it('reads the directory, the shard count and the config', () => {
    expect(parseMergeArgs(['--dir', 'coverage/shards', '--shards', '5', '--config', 'x.ts']))
      .toEqual({ dir: 'coverage/shards', shards: 5, config: 'x.ts' });
  });

  it('defaults the config to the coverage run\'s', () => {
    expect(parseMergeArgs(['--shards', '5', '--dir', 'd'])).toEqual({ dir: 'd', shards: 5, config: 'vitest.coverage.config.ts' });
  });

  it.each([
    ['no shard count', ['--dir', 'd']],
    ['no directory', ['--shards', '5']],
    ['a zero shard count', ['--dir', 'd', '--shards', '0']],
    ['a non-numeric shard count', ['--dir', 'd', '--shards', 'five']],
    ['an unknown flag', ['--dir', 'd', '--shards', '5', '--force', 'yes']],
  ])('refuses %s', (_, argv) => {
    expect(typeof parseMergeArgs(argv)).toBe('string');
  });
});
