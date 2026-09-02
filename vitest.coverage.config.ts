// Coverage run config — the same suite as vitest.config.ts, minus two
// directories that cost far more under v8 instrumentation than they return in
// coverage signal:
//
//   tests/unit/benchmarks/ — asserts wall-clock durations. Instrumentation
//     inflates them, so these fail for a reason that has nothing to do with
//     the code under test (a TerrainMesh rebuild budgeted at 2000ms measured
//     2702ms under coverage).
//   tests/unit/lint/       — drives all scenario definitions through the
//     console to lint them. Under instrumentation that single directory took
//     2486s of a 2880s run: 86% of the wall clock for rules that are about
//     scenario JSON, not about src/ coverage.
//
// Both still run, unexcluded, in the ordinary `npm run test` suite that CI's
// test job and the `logic` channel use. This config only shapes the coverage
// measurement.

import { defineConfig, mergeConfig, configDefaults } from 'vitest/config';
import base from './vitest.config.js';

export default mergeConfig(base, defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      'tests/unit/benchmarks/**',
      'tests/unit/lint/**',
    ],
  },
}));
