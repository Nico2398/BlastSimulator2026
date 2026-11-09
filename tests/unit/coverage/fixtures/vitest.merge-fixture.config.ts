// The coverage gate's config, narrowed for tests/unit/coverage/coverage-merge.test.ts:
// vitest.config.ts's coverage measurement cut down to src/core/math/** and
// one per-file statements threshold the test sets through the environment, so it
// can watch scripts/coverage-merge.ts pass and fail on the same shard dumps.

import { join } from 'path';
import { defineConfig } from 'vitest/config';
import base from '../../../../vitest.config.js';

const ROOT = join(import.meta.dirname, '../../../..');

export default defineConfig({
  root: ROOT,
  test: {
    include: [],
    coverage: {
      provider: 'v8',
      include: ['src/core/math/**'],
      exclude: base.test?.coverage?.exclude ?? [],
      reporter: ['json', 'text-summary'],
      reportsDirectory: process.env.COVERAGE_FIXTURE_REPORTS ?? 'coverage/merge-fixture',
      thresholds: {
        perFile: true,
        statements: Number(process.env.COVERAGE_FIXTURE_STATEMENTS ?? '0'),
      },
    },
  },
});
