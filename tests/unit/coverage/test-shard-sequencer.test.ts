// BlastSimulator2026 — Duration-balanced CI test shards (scripts/lib/test-shard-sequencer.ts)
//
// Every CI shard computes the split on its own, so the one property that must
// never break is that the shards partition the files: each file on exactly one
// shard, whatever the table says. Balance is the point of the module but only a
// matter of speed; a table that cannot be read falls back to vitest's hash split.

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Vitest, WorkspaceProject, WorkspaceSpec } from 'vitest/node';
import {
  SHARD_WEIGHTS_FILE,
  WeightedShardSequencer,
  assignShards,
  heaviestFirst,
  parseShardWeights,
  unknownFileWeight,
} from '../../../scripts/lib/test-shard-sequencer';
import { durationsFromJUnit, durationsFromVitestJson, weightTable } from '../../../scripts/shard-weights';

const ROOT = join(import.meta.dirname, '../../..');

function shardsOf(files: readonly string[], weights: ReadonlyMap<string, number>, count: number): string[][] {
  const assigned = assignShards(files, weights, count);
  return Array.from({ length: count }, (_, i) => files.filter((file) => assigned.get(file) === i + 1));
}

describe('parseShardWeights', () => {
  it('reads integer milliseconds per test file', () => {
    expect(parseShardWeights('{"milliseconds":{"tests/a.test.ts":12,"tests/b.test.ts":0}}'))
      .toEqual(new Map([['tests/a.test.ts', 12], ['tests/b.test.ts', 0]]));
  });

  it.each([
    ['not JSON', '{'],
    ['no milliseconds object', '{"seconds":{}}'],
    ['an array', '{"milliseconds":[]}'],
    ['a negative weight', '{"milliseconds":{"a":-1}}'],
    ['a fractional weight', '{"milliseconds":{"a":1.5}}'],
  ])('refuses %s', (_, text) => {
    expect(typeof parseShardWeights(text)).toBe('string');
  });

  it('accepts the committed table, which CI would otherwise silently stop using', () => {
    const weights = parseShardWeights(readFileSync(join(ROOT, SHARD_WEIGHTS_FILE), 'utf8'));
    expect(weights).toBeInstanceOf(Map);
    expect((weights as Map<string, number>).size).toBeGreaterThan(500);
  });
});

describe('unknownFileWeight', () => {
  it('is the median of the table', () => {
    expect(unknownFileWeight(new Map([['a', 1], ['b', 5], ['c', 100]]))).toBe(5);
  });

  it('is 1 for an empty table', () => {
    expect(unknownFileWeight(new Map())).toBe(1);
  });
});

describe('assignShards', () => {
  const weights = new Map([['a', 100], ['b', 60], ['c', 50], ['d', 40], ['e', 10]]);
  const files = ['a', 'b', 'c', 'd', 'e'];

  it('puts every file on exactly one shard', () => {
    const shards = shardsOf(files, weights, 3);
    expect(shards.flat().sort()).toEqual(files);
  });

  it('balances by weight, heaviest first, ties to the lowest shard', () => {
    // a=100 -> 1; b=60 -> 2; c=50 -> 3; d=40 -> 3 (50 < 60); e=10 -> 2 (60 < 90).
    expect(shardsOf(files, weights, 3)).toEqual([['a'], ['b', 'e'], ['c', 'd']]);
  });

  it('is deterministic whatever order the files come in', () => {
    expect(assignShards([...files].reverse(), weights, 3)).toEqual(assignShards(files, weights, 3));
  });

  it('weighs a file the table does not know at the median', () => {
    const shards = shardsOf([...files, 'new'], weights, 2);
    expect(shards.flat().sort()).toEqual([...files, 'new'].sort());
  });

  it('leaves room for the table\'s other files, so two runs beside each other share the load', () => {
    // Only 'e' runs here, but 'a' (another run's file) already loads shard 1.
    expect(assignShards(['e'], weights, 2).get('e')).toBe(2);
  });

  it('puts everything on shard 1 of 1', () => {
    expect(shardsOf(files, weights, 1)).toEqual([files]);
  });

  // vitest's hash split put 1.67x the mean on one of five shards of this table.
  it('balances the real suite to within a tenth of the mean, or its heaviest file', () => {
    const table = parseShardWeights(readFileSync(join(ROOT, SHARD_WEIGHTS_FILE), 'utf8')) as Map<string, number>;
    const all = [...table.keys()];
    const sums = shardsOf(all, table, 5).map((shard) => shard.reduce((sum, file) => sum + (table.get(file) ?? 0), 0));
    const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
    expect(Math.max(...sums)).toBeLessThanOrEqual(Math.max(mean * 1.1, ...table.values()));
  });
});

describe('heaviestFirst', () => {
  it('orders by weight descending, then by path', () => {
    const weights = new Map([['b', 5], ['a', 5], ['c', 9]]);
    expect(heaviestFirst(['a', 'b', 'c', 'unknown'], (file) => file, weights)).toEqual(['c', 'a', 'b', 'unknown']);
  });

  it('leaves an empty list empty', () => {
    expect(heaviestFirst([], (file: string) => file, new Map())).toEqual([]);
  });
});

/** A vitest context as far as the sequencer reads one. */
function context(root: string, shard: { index: number; count: number } | undefined, warn = vi.fn()): Vitest {
  return { config: { root, shard }, logger: { warn } } as unknown as Vitest;
}

const PROJECT = {} as WorkspaceProject;
const spec = (root: string, file: string): WorkspaceSpec => [PROJECT, join(root, file)];

describe('WeightedShardSequencer', () => {
  it('splits a run so its shards partition the files', async () => {
    const files = ['tests/unit/math/Random.test.ts', 'tests/unit/math/Vec3.test.ts', 'tests/brand-new.test.ts']
      .map((file) => spec(ROOT, file));
    const picked: string[] = [];
    for (let index = 1; index <= 5; index++) {
      const shard = await new WeightedShardSequencer(context(ROOT, { index, count: 5 })).shard(files);
      picked.push(...shard.map(([, file]) => file));
    }
    expect(picked.sort()).toEqual(files.map(([, file]) => file).sort());
  });

  it('sorts the heaviest file first', async () => {
    const files = ['tests/unit/math/Vec3.test.ts', 'tests/unit/math/Random.test.ts'].map((file) => spec(ROOT, file));
    const sorted = await new WeightedShardSequencer(context(ROOT, undefined)).sort(files);
    expect(sorted.map(([, file]) => file)).toEqual([join(ROOT, 'tests/unit/math/Random.test.ts'), join(ROOT, 'tests/unit/math/Vec3.test.ts')]);
  });

  it('falls back to vitest\'s hash split, with a warning, when the table is unusable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shard-weights-'));
    try {
      mkdirSync(join(root, 'tests'));
      writeFileSync(join(root, SHARD_WEIGHTS_FILE), '{ not json');
      const files = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'].map((file) => spec(root, file));
      const warn = vi.fn();
      const picked: string[] = [];
      for (let index = 1; index <= 2; index++) {
        const shard = await new WeightedShardSequencer(context(root, { index, count: 2 }, warn)).shard(files);
        picked.push(...shard.map(([, file]) => file));
      }
      expect(picked.sort()).toEqual(files.map(([, file]) => file).sort());
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('falling back'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('scripts/shard-weights.ts reads test reports', () => {
  it('takes each JUnit testsuite as one file, in milliseconds', () => {
    const xml = [
      '<testsuites>',
      '<testsuite name="tests/unit/a.test.ts" timestamp="x" tests="2" time="1.234">',
      '<testcase name="t" time="1"/></testsuite>',
      '<testsuite name="tests/unit/b&amp;c.test.ts" time="0.0004"></testsuite>',
      '<testsuite name="no time"></testsuite>',
      '</testsuites>',
    ].join('\n');
    expect(durationsFromJUnit(xml, '/repo')).toEqual(new Map([['tests/unit/a.test.ts', 1234], ['tests/unit/b&c.test.ts', 0]]));
  });

  it('takes a vitest JSON report\'s end minus start, root-relative', () => {
    const report = JSON.stringify({
      testResults: [
        { name: '/repo/tests/unit/a.test.ts', startTime: 1000, endTime: 1500 },
        { name: '/repo/tests/unit/b.test.ts', startTime: 'x' },
      ],
    });
    expect(durationsFromVitestJson(report, '/repo')).toEqual(new Map([['tests/unit/a.test.ts', 500]]));
  });

  it('writes the table with sorted keys and a comment saying what it is for', () => {
    const table = weightTable(new Map([['tests/b.test.ts', 2], ['tests/a.test.ts', 1]]));
    expect(Object.keys(table.milliseconds)).toEqual(['tests/a.test.ts', 'tests/b.test.ts']);
    expect(table.$comment).toContain('scripts/lib/test-shard-sequencer.ts');
  });
});
