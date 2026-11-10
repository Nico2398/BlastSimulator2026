// One CI test shard's coverage-measured half: the test files and the coverage
// measurement of vitest.coverage.config.ts, without its thresholds. CI's `test`
// job runs it with `--shard=i/N` on every shard; each writes a shard dump, and
// the `coverage` job judges vitest.config.ts's thresholds once, over all N dumps
// (scripts/coverage-merge.ts). A shard cannot judge a per-file threshold alone:
// a file it never loads reads 0% there.
//
// Why the gate is split: the unsharded coverage job ran the whole suite a second
// time beside the uninstrumented test shards and took 45 min, the longest job of
// every CI run; pipeline runs waited 30-45 min per issue on CI, and #2142, #2143,
// #2148, #2154 and #2199 hit the agent step's timeout. Measuring coverage in the
// test shards themselves runs the suite once.
//
// - The thresholds are removed, not zeroed: the per-glob coverage-debt entries in
//   vitest.config.ts cannot be cleared from the command line.
// - The provider is vitest's v8 provider writing its raw V8 coverage instead of
//   converting it (scripts/lib/coverage-shard-provider.ts): per-shard istanbul
//   reports do not merge into the measurement a single run makes
//   (scripts/lib/coverage-shards.ts says by how much).
// - Shards are balanced by measured duration (scripts/lib/test-shard-sequencer.ts),
//   not by vitest's hash of the path.

import { configDefaults, defineConfig } from 'vitest/config';
import { WeightedShardSequencer } from './scripts/lib/test-shard-sequencer.js';
import { COVERAGE_EXCLUDED_TESTS } from './vitest.coverage.config.js';
import base from './vitest.config.js';

const measured = base.test?.coverage;
if (measured?.provider !== 'v8') {
  throw new Error('vitest.coverage-shard.config.ts wraps the v8 coverage provider of vitest.config.ts');
}
const { thresholds: _appliedByTheCoverageJob, ...measurement } = measured;

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    // vitest.coverage.config.ts's test files; tests/unit/config/ci-test-shards.test.ts
    // pins the two equal.
    exclude: [...configDefaults.exclude, ...COVERAGE_EXCLUDED_TESTS],
    sequence: { sequencer: WeightedShardSequencer },
    coverage: {
      ...measurement,
      enabled: true,
      provider: 'custom',
      customProviderModule: './scripts/lib/coverage-shard-provider.ts',
      reportsDirectory: 'coverage/shards',
      // vitest skips coverage after a failed test by default; a shard's dump is
      // still wanted, so the thresholds are judged in the same CI round.
      reportOnFailure: true,
    },
  },
});
