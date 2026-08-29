// BlastSimulator2026 — run-all-scenarios-cli.ts (#824)
//
// Split of run-all-scenarios.ts's own CLI parsing/shard-splitting into its
// own module. These three functions (parseArgs, parseShardArg, selectShard)
// are pure — no fs, no process.exit, no dynamic import gymnastics needed —
// so they're exercised directly rather than through the entrypoint's own
// process.argv/process.exit harness (see run-all-scenarios-repeat.test.ts
// for that pattern, still needed for the batch loops).
//
// Characterization tests: pin the CURRENT real behavior read from
// run-all-scenarios.ts before the split (issue #824), so they fail red
// against the stub body (`throw new Error('not implemented')`) and pass once
// @implementer moves the real logic into this file unchanged.
//
// DO NOT implement anything here — only add implementation to scripts/.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseArgs, parseShardArg, selectShard } from '../../../scripts/run-all-scenarios-cli.js';

const ORIGINAL_ARGV = process.argv;

describe('run-all-scenarios-cli.ts', () => {
  afterEach(() => {
    process.argv = ORIGINAL_ARGV;
  });

  describe('parseShardArg', () => {
    it('parses a valid "i/N" shard spec into 1-indexed index/total', () => {
      expect(parseShardArg('2/4')).toEqual({ index: 2, total: 4 });
    });

    it('accepts the boundary shard "1/1" (single shard covers everything)', () => {
      expect(parseShardArg('1/1')).toEqual({ index: 1, total: 1 });
    });

    it('accepts the last valid index equal to total ("4/4")', () => {
      expect(parseShardArg('4/4')).toEqual({ index: 4, total: 4 });
    });

    it('throws naming the raw value when the shape is not "i/N"', () => {
      expect(() => parseShardArg('bogus')).toThrow(/--shard must be "i\/N".*bogus/);
    });

    it('throws when index is out of range (index > total)', () => {
      expect(() => parseShardArg('5/4')).toThrow(/out of range/);
    });

    it('throws when index is 0 (not 1-indexed)', () => {
      expect(() => parseShardArg('0/4')).toThrow(/out of range/);
    });

    it('throws when total is 0', () => {
      expect(() => parseShardArg('1/0')).toThrow(/out of range/);
    });
  });

  describe('parseArgs', () => {
    it('defaults to command mode, default port, no shard, no drift report, no scenario filter', () => {
      process.argv = ['node', 'run-all-scenarios.js'];
      expect(parseArgs()).toEqual({
        mode: 'command',
        scenarios: [],
        port: 5173,
        reportDrift: false,
      });
    });

    it('parses --mode interaction', () => {
      process.argv = ['node', 'run-all-scenarios.js', '--mode', 'interaction'];
      expect(parseArgs().mode).toBe('interaction');
    });

    it('parses --port', () => {
      process.argv = ['node', 'run-all-scenarios.js', '--port', '9999'];
      expect(parseArgs().port).toBe(9999);
    });

    it('parses --shard into a ShardSpec', () => {
      process.argv = ['node', 'run-all-scenarios.js', '--shard', '2/3'];
      expect(parseArgs().shard).toEqual({ index: 2, total: 3 });
    });

    it('omits shard entirely (not undefined-valued key) when --shard is absent', () => {
      process.argv = ['node', 'run-all-scenarios.js'];
      expect('shard' in parseArgs()).toBe(false);
    });

    it('parses --report-drift as a boolean flag with no following value', () => {
      process.argv = ['node', 'run-all-scenarios.js', '--report-drift'];
      expect(parseArgs().reportDrift).toBe(true);
    });

    it('collects bare positional args as scenario name filters', () => {
      process.argv = ['node', 'run-all-scenarios.js', 'blast-basic', 'tutorial-playthrough'];
      expect(parseArgs().scenarios).toEqual(['blast-basic', 'tutorial-playthrough']);
    });

    it('parses a full combination of flags plus scenario filters together', () => {
      process.argv = [
        'node', 'run-all-scenarios.js',
        '--mode', 'interaction',
        '--port', '8080',
        '--shard', '1/2',
        '--report-drift',
        'blast-basic',
      ];
      expect(parseArgs()).toEqual({
        mode: 'interaction',
        port: 8080,
        shard: { index: 1, total: 2 },
        reportDrift: true,
        scenarios: ['blast-basic'],
      });
    });
  });

  describe('selectShard', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

    it('round-robins names across shards by index modulo, not a contiguous slice', () => {
      expect(selectShard(names, { index: 1, total: 3 })).toEqual(['a', 'd', 'g']);
      expect(selectShard(names, { index: 2, total: 3 })).toEqual(['b', 'e']);
      expect(selectShard(names, { index: 3, total: 3 })).toEqual(['c', 'f']);
    });

    it('a single shard (1/1) returns every name unchanged', () => {
      expect(selectShard(names, { index: 1, total: 1 })).toEqual(names);
    });

    it('every shard union, in order, reconstitutes the original list with no name lost or duplicated', () => {
      const total = 4;
      const shards = Array.from({ length: total }, (_, i) => selectShard(names, { index: i + 1, total }));
      const seen = new Set<string>();
      for (const shard of shards) {
        for (const name of shard) {
          expect(seen.has(name)).toBe(false);
          seen.add(name);
        }
      }
      expect(seen.size).toBe(names.length);
    });

    it('returns an empty array for an empty input list', () => {
      expect(selectShard([], { index: 1, total: 3 })).toEqual([]);
    });
  });
});
