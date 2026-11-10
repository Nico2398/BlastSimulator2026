// BlastSimulator2026 — CI's test shards and the coverage gate over them
//
// The suite used to run twice per CI run: three uninstrumented `test` shards
// (8 / 11.5 / 15 min) and the whole suite again under coverage in one `coverage`
// job (45 min, the critical path of every run; #2142, #2143, #2148, #2154 and
// #2199 hit the pipeline's agent timeout mostly waiting on programs). Now it runs
// once: each `test` shard measures coverage on its share and the `coverage` job
// judges the thresholds over every shard's dump.
//
// Every joint below fails in silence if it slips — a shard count the merge does
// not expect, an upload path the shard config does not write, a test file
// neither half runs — so each is pinned against the shipped files.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { configDefaults } from 'vitest/config';
import base from '../../../vitest.config.js';
import coverageRun, { COVERAGE_EXCLUDED_TESTS } from '../../../vitest.coverage.config.js';
import coverageShard from '../../../vitest.coverage-shard.config.js';
import coverageExcluded from '../../../vitest.coverage-excluded.config.js';
import { WeightedShardSequencer } from '../../../scripts/lib/test-shard-sequencer';

const ROOT = join(import.meta.dirname, '../../..');
const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');

/** One job's block of ci.yml, from its id to the next job at the same indent. */
function job(id: string): string {
  const start = ci.indexOf(`\n  ${id}:\n`);
  expect(start, `ci.yml declares job ${id}`).toBeGreaterThan(-1);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** The `test` job's matrix shards, as written. */
function matrixShards(): number[] {
  const list = /matrix:\s*\n\s*shard:\s*\[([^\]]*)\]/.exec(job('test'))?.[1];
  expect(list, 'the test job lists its shards literally').toBeDefined();
  return (list ?? '').split(',').map((entry) => Number(entry.trim()));
}

describe('ci.yml test job: the suite once, in coverage shards', () => {
  const test = job('test');

  it('lists its shards 1..N, keeps its display name and shows i/N', () => {
    const shards = matrixShards();
    expect(shards).toEqual(Array.from({ length: shards.length }, (_, i) => i + 1));
    expect(shards.length).toBeGreaterThan(1);
    expect(test).toContain('name: Unit & integration tests (shard ${{ matrix.shard }}/${{ strategy.job-total }})');
    expect(test).toMatch(/fail-fast: false/);
  });

  it('runs its share of the measured files under the shard config, coverage on', () => {
    expect(test).toContain('npx vitest run --config vitest.coverage-shard.config.ts --shard=${{ matrix.shard }}/${{ strategy.job-total }}');
  });

  it('runs its share of the excluded files uninstrumented, even after a red first half', () => {
    const step = test.slice(test.indexOf('- name: Run the coverage-excluded tests'));
    expect(step).toMatch(/^- name: Run the coverage-excluded tests[^\n]*\n\s+if: \$\{\{ !cancelled\(\) \}\}\n\s+run: npx vitest run --config vitest\.coverage-excluded\.config\.ts --shard=\$\{\{ matrix\.shard \}\}\/\$\{\{ strategy\.job-total \}\} --passWithNoTests/);
  });

  it('uploads the dump the shard config writes, failing by name when there is none', () => {
    const step = test.slice(test.indexOf('- name: Upload coverage shard artifact'));
    expect(step).toContain('if: ${{ !cancelled() }}');
    expect(step).toContain('name: coverage-shard-${{ matrix.shard }}');
    expect(step).toContain(`path: ${String(coverageShard.test?.coverage?.reportsDirectory)}/`);
    expect(step).toContain('if-no-files-found: error');
  });

  it('runs no other vitest command anywhere in ci.yml, so nothing runs the suite twice', () => {
    const code = ci.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
    const commands = code.match(/npx vitest run[^\n]*/g) ?? [];
    expect(commands).toHaveLength(2);
    expect(code).not.toMatch(/npm run test\b/);
  });
});

describe('ci.yml coverage job: the thresholds over every shard', () => {
  const coverage = job('coverage');

  it('keeps its name, waits for the shards and still runs when one failed', () => {
    expect(coverage).toContain('name: Coverage thresholds');
    expect(coverage).toMatch(/needs: test\n/);
    expect(coverage).toContain('if: ${{ !cancelled() }}');
  });

  it('downloads every shard\'s artifact into the directory it merges', () => {
    expect(coverage).toContain('pattern: coverage-shard-*');
    expect(coverage).toContain('path: coverage/shards');
    expect(coverage).toContain('merge-multiple: true');
    expect(coverage).toContain('npx tsx scripts/coverage-merge.ts --dir coverage/shards --shards');
  });

  // The one number that must agree across the two jobs. The matrix cannot read
  // a workflow variable, so the agreement is this assertion.
  it('expects exactly as many shards as the test matrix runs', () => {
    const expected = Number(/coverage-merge\.ts --dir \S+ --shards (\d+)/.exec(coverage)?.[1]);
    expect(expected).toBe(matrixShards().length);
  });
});

describe('the shard configs split exactly the suite of `npm run test`', () => {
  it('measures the coverage run\'s test files with its measurement, minus the thresholds', () => {
    expect(coverageShard.test?.include).toEqual(base.test?.include);
    expect(coverageShard.test?.exclude).toEqual(coverageRun.test?.exclude);
    expect(coverageRun.test?.exclude).toEqual([...configDefaults.exclude, ...COVERAGE_EXCLUDED_TESTS]);
    // Read as plain records: vitest types a custom provider's options without
    // `include`, though its provider honours every option the v8 one does.
    const shard = coverageShard.test?.coverage as Record<string, unknown> | undefined;
    const measured = base.test?.coverage as Record<string, unknown> | undefined;
    expect(shard?.include).toEqual(measured?.include);
    expect(shard?.exclude).toEqual(measured?.exclude);
    expect(shard?.all).toEqual(measured?.all);
    expect(shard?.enabled).toBe(true);
    expect(shard?.reportOnFailure, 'a shard with a failing test still hands over its dump').toBe(true);
    expect(shard && 'thresholds' in shard).toBe(false);
  });

  it('collects with the shard provider, whose module exists', () => {
    const shard = coverageShard.test?.coverage;
    expect(shard?.provider).toBe('custom');
    const module = shard && 'customProviderModule' in shard ? shard.customProviderModule : undefined;
    expect(module).toBe('./scripts/lib/coverage-shard-provider.ts');
    expect(existsSync(join(ROOT, String(module)))).toBe(true);
  });

  it('runs exactly the excluded files, uninstrumented, in the other half', () => {
    expect(coverageExcluded.test?.include).toEqual([...COVERAGE_EXCLUDED_TESTS]);
    expect(coverageExcluded.test?.coverage?.enabled).toBe(false);
    const roots = (base.test?.include ?? []).map((pattern) => pattern.slice(0, pattern.indexOf('*')));
    for (const pattern of COVERAGE_EXCLUDED_TESTS) {
      expect(roots.some((root) => pattern.startsWith(root)), `${pattern} lies inside npm run test's include`).toBe(true);
      // As an include, a directory glob also runs the fixtures and JSON beside
      // the tests as test files — it did, for tests/unit/lint/**.
      expect(pattern, 'an excluded pattern names test files only').toMatch(/\.test\.ts$/);
    }
  });

  it('balances both halves with the same duration-weighted sequencer', () => {
    expect(coverageShard.test?.sequence?.sequencer).toBe(WeightedShardSequencer);
    expect(coverageExcluded.test?.sequence?.sequencer).toBe(WeightedShardSequencer);
  });
});
