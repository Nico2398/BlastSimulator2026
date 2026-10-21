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
// CI's test job and the `logic` channel use. This config only shapes the coverage
// measurement.

import { defineConfig, mergeConfig, configDefaults } from 'vitest/config';
import base from './vitest.config.js';

export default mergeConfig(base, defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      'tests/unit/benchmarks/**',
      'tests/unit/lint/**',
      'tests/integration/full-level/shareholder-summit-competent.integration.test.ts',
    ],
  },
}));
