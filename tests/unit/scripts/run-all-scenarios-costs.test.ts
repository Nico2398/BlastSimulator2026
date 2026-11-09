// BlastSimulator2026 — run-all-scenarios-costs.ts
//
// Interaction shards balance on measured seconds per scenario, read from a
// committed table, with a new scenario falling back to its static estimate.
// These pin the table's parsing and fallback, the `Timing:` line the batch
// prints and the refresh reads back, and — on the committed table itself —
// that it covers the definitions on disk and actually balances the shards.

import { describe, it, expect, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  INTERACTION_SECONDS_PATH,
  SECONDS_PER_COST_UNIT,
  interactionCostSeconds,
  loadScenarioSeconds,
  parseScenarioSeconds,
  parseTimingLines,
  refreshScenarioSeconds,
  timingLine,
} from '../../../scripts/run-all-scenarios-costs.js';
import { selectShard } from '../../../scripts/run-all-scenarios-cli.js';

const DEFS = resolve(import.meta.dirname, '../../../scripts/scenario-defs');

describe('run-all-scenarios-costs.ts', () => {
  describe('parseScenarioSeconds', () => {
    it('keeps finite, non-negative seconds and drops anything else', () => {
      const table = parseScenarioSeconds(JSON.stringify({ a: 12.5, b: 0, c: -1, d: 'x', e: null }));
      expect([...table]).toEqual([['a', 12.5], ['b', 0]]);
    });

    it('refuses a table that is not an object', () => {
      expect(() => parseScenarioSeconds('[1, 2]')).toThrow(/JSON object/);
    });
  });

  describe('loadScenarioSeconds', () => {
    it('falls back to an empty table, and says so, when the file cannot be read', () => {
      const warn = vi.fn();
      expect(loadScenarioSeconds('/nonexistent/interaction-seconds.json', warn).size).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('static estimate'));
    });
  });

  describe('interactionCostSeconds', () => {
    it('uses the measured seconds when the table has the scenario', () => {
      expect(interactionCostSeconds('slow', 10, new Map([['slow', 337.4]]))).toBe(337.4);
    });

    it('converts the static estimate at the measured rate for a scenario the table lacks', () => {
      expect(interactionCostSeconds('new-scenario', 100, new Map())).toBeCloseTo(100 * SECONDS_PER_COST_UNIT);
    });
  });

  describe('timing lines', () => {
    it('reads back what the batch prints, with or without a CI timestamp prefix', () => {
      const log = [
        timingLine('level1-lose-ecology', 337.44),
        `2026-11-09T07:31:18.1234567Z ${timingLine('tutorial-real-clock', 161.4)}`,
        '  Progress: 2/26 (2 passed, 0 failed) [498.8s]',
        '  Timing: not a line 3s',
      ].join('\n');
      expect([...parseTimingLines(log)]).toEqual([['level1-lose-ecology', 337.4], ['tutorial-real-clock', 161.4]]);
    });
  });

  describe('refreshScenarioSeconds', () => {
    it('replaces timed entries, keeps untimed ones, drops deleted definitions, and sorts', () => {
      const current = new Map([['b', 10], ['a', 5], ['gone', 3]]);
      const timed = new Map([['b', 12], ['c', 7]]);
      expect([...refreshScenarioSeconds(current, timed, ['a', 'b', 'c'])]).toEqual([['a', 5], ['b', 12], ['c', 7]]);
    });
  });

  describe('the committed table', () => {
    const table = loadScenarioSeconds(INTERACTION_SECONDS_PATH, () => { throw new Error('the committed table must parse'); });
    const names = readdirSync(DEFS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

    it('names only scenario definitions that exist', () => {
      expect([...table.keys()].filter((name) => !names.includes(name))).toEqual([]);
    });

    it('splits ten shards within 5% of the ideal on its own seconds', () => {
      const costOf = (name: string): number => table.get(name) ?? 0;
      const loads = Array.from({ length: 10 }, (_, i) =>
        selectShard(names, { index: i + 1, total: 10 }, costOf).reduce((sum, name) => sum + costOf(name), 0));
      const ideal = loads.reduce((a, b) => a + b, 0) / 10;
      expect(Math.max(...loads)).toBeLessThan(ideal * 1.05);
    });
  });
});
