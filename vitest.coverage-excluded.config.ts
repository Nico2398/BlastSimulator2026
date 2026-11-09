// One CI test shard's other half: the test files vitest.coverage.config.ts leaves
// out of the coverage measurement (COVERAGE_EXCLUDED_TESTS, each with its reason
// there), run uninstrumented. CI's `test` job runs it with the same `--shard=i/N`
// as vitest.coverage-shard.config.ts, so over the N shards the two configs run
// every file of `npm run test` exactly once.
//
// Both halves share one duration-balanced split (scripts/lib/test-shard-sequencer.ts),
// so this half's heaviest file — the shareholder-summit playthrough — lands on a
// shard the measured half left light. A shard of three patterns can still be
// empty, so CI passes `--passWithNoTests`.

import { defineConfig } from 'vitest/config';
import { WeightedShardSequencer } from './scripts/lib/test-shard-sequencer.js';
import { COVERAGE_EXCLUDED_TESTS } from './vitest.coverage.config.js';
import base from './vitest.config.js';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [...COVERAGE_EXCLUDED_TESTS],
    sequence: { sequencer: WeightedShardSequencer },
    coverage: { ...base.test?.coverage, enabled: false },
  },
});
