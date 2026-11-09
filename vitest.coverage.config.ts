// Coverage run config — the same suite as vitest.config.ts, minus two
// directories and one playthrough that cost far more under v8 instrumentation
// than they return in coverage signal:
//
//   tests/unit/benchmarks/ — asserts wall-clock durations. Instrumentation
//     inflates them, so these fail for a reason that has nothing to do with
//     the code under test (a TerrainMesh rebuild budgeted at 2000ms measured
//     2702ms under coverage).
//   tests/unit/lint/       — static rules about scenario JSON and repo
//     hygiene, not about src/ behaviour, so they add nothing to the
//     measurement. (Until the replay lint was retired this directory also
//     drove every scenario through the console — 2486s of a 2880s run under
//     instrumentation; `npm run scenarios` owns that replay now.)
//   shareholder-summit-competent — an ~8,000-tick scripted playthrough. Under
//     instrumentation it ran ~40 min, and its hottest Pathfinding branches pass
//     2^31 hits: v8's int32 block counters wrap negative and istanbul reports
//     them as uncovered, so the run LOWERED Pathfinding.ts's branch figure from
//     the mid 90s to 84-88% (#1949).
//
// All of them still run, unexcluded, in the ordinary `npm run test` suite that
// the `logic` channel uses. In CI they run uninstrumented beside each coverage
// shard (vitest.coverage-excluded.config.ts reads the list below, so the two
// halves cannot drift apart). This config only shapes the coverage measurement.

import { defineConfig, mergeConfig, configDefaults } from 'vitest/config';
import base from './vitest.config.js';

/**
 * Test files the coverage measurement leaves out, each for the reason above.
 * Spelled as test-file patterns, not directories: vitest.coverage-excluded.config.ts
 * runs them as its include, where `tests/unit/lint/**` would also pick up the
 * fixtures and the JSON baseline beside the tests and run them as test files.
 */
export const COVERAGE_EXCLUDED_TESTS: readonly string[] = [
  'tests/unit/benchmarks/**/*.test.ts',
  'tests/unit/lint/**/*.test.ts',
  'tests/integration/full-level/shareholder-summit-competent.integration.test.ts',
];

export default mergeConfig(base, defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...COVERAGE_EXCLUDED_TESTS],
  },
}));
