// BlastSimulator2026 — scenario-trace unit tests (issue #674)
//
// scenario-trace.ts is the diagnostic machinery a scenario-trace-comparison
// CLI (compare-scenario-traces.ts) uses to pin down where a scenario's
// command-mode run and its interaction-mode run first disagree.
// `compareTraces` is pure (no I/O) and `writeTraceEntry` is the append-only
// JSONL sink both live runs write to as they progress.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  compareTraces,
  writeTraceEntry,
  type ScenarioTraceEntry,
} from '../../../../scripts/shared/scenario-trace.js';

const entry = (over: Partial<ScenarioTraceEntry> = {}): ScenarioTraceEntry => ({
  stepIndex: 0,
  mode: 'command',
  command: 'tick 1',
  success: true,
  tickCountAfter: 1,
  ...over,
});

describe('compareTraces', () => {
  it('returns null for two identical traces', () => {
    const commandTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 0, mode: 'command', command: 'new_game seed:42', tickCountAfter: 0 }),
      entry({ stepIndex: 1, mode: 'command', command: 'tick 1', tickCountAfter: 1 }),
      entry({ stepIndex: 2, mode: 'command', command: 'tick 1', tickCountAfter: 2 }),
    ];
    const interactionTrace: ScenarioTraceEntry[] = commandTrace.map(e => ({ ...e, mode: 'interaction' }));

    expect(compareTraces(commandTrace, interactionTrace)).toBeNull();
  });

  it('reports the first index where the command string differs', () => {
    const commandEntry = entry({ stepIndex: 2, mode: 'command', command: 'blast', tickCountAfter: 5 });
    const interactionEntry = entry({ stepIndex: 2, mode: 'interaction', command: 'blast_confirm', tickCountAfter: 5 });

    const commandTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 0, mode: 'command', command: 'new_game seed:1', tickCountAfter: 0 }),
      entry({ stepIndex: 1, mode: 'command', command: 'tick 1', tickCountAfter: 1 }),
      commandEntry,
    ];
    const interactionTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 0, mode: 'interaction', command: 'new_game seed:1', tickCountAfter: 0 }),
      entry({ stepIndex: 1, mode: 'interaction', command: 'tick 1', tickCountAfter: 1 }),
      interactionEntry,
    ];

    expect(compareTraces(commandTrace, interactionTrace)).toEqual({
      firstDivergentIndex: 2,
      command: commandEntry,
      interaction: interactionEntry,
    });
  });

  it('reports a divergence when tickCountAfter differs but the command string matches', () => {
    const commandEntry = entry({ stepIndex: 1, mode: 'command', command: 'tick 10', tickCountAfter: 11 });
    const interactionEntry = entry({ stepIndex: 1, mode: 'interaction', command: 'tick 10', tickCountAfter: 10 });

    const commandTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 0, mode: 'command', command: 'new_game seed:1', tickCountAfter: 0 }),
      commandEntry,
    ];
    const interactionTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 0, mode: 'interaction', command: 'new_game seed:1', tickCountAfter: 0 }),
      interactionEntry,
    ];

    expect(compareTraces(commandTrace, interactionTrace)).toEqual({
      firstDivergentIndex: 1,
      command: commandEntry,
      interaction: interactionEntry,
    });
  });

  it('returns null for two empty arrays', () => {
    expect(compareTraces([], [])).toBeNull();
  });

  it('reports a divergence at the length of the shorter trace when it is a strict prefix', () => {
    const commandTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 0, mode: 'command', command: 'new_game seed:7', tickCountAfter: 0 }),
      entry({ stepIndex: 1, mode: 'command', command: 'tick 1', tickCountAfter: 1 }),
      entry({ stepIndex: 2, mode: 'command', command: 'tick 1', tickCountAfter: 2 }),
      entry({ stepIndex: 3, mode: 'command', command: 'blast', tickCountAfter: 3 }),
      entry({ stepIndex: 4, mode: 'command', command: 'tick 1', tickCountAfter: 4 }),
    ];
    // interaction trace ends early -- only the first 3 entries exist, and
    // they match the command trace's first 3 entries exactly.
    const interactionTrace: ScenarioTraceEntry[] = commandTrace
      .slice(0, 3)
      .map(e => ({ ...e, mode: 'interaction' as const }));

    expect(compareTraces(commandTrace, interactionTrace)).toEqual({
      firstDivergentIndex: 3,
      command: commandTrace[3],
      interaction: null,
    });
  });

  it('treats commands as matching after normalizing internal whitespace runs to a single space', () => {
    const commandEntry = entry({ stepIndex: 0, mode: 'command', command: 'tick  1', tickCountAfter: 1 });
    const interactionEntry = entry({ stepIndex: 0, mode: 'interaction', command: 'tick 1', tickCountAfter: 1 });

    expect(compareTraces([commandEntry], [interactionEntry])).toBeNull();
  });

  it('treats commands as matching after trimming leading/trailing whitespace', () => {
    const commandEntry = entry({ stepIndex: 0, mode: 'command', command: '  tick 1  ', tickCountAfter: 1 });
    const interactionEntry = entry({ stepIndex: 0, mode: 'interaction', command: 'tick 1', tickCountAfter: 1 });

    expect(compareTraces([commandEntry], [interactionEntry])).toBeNull();
  });

  it('treats two null tickCountAfter values as equal', () => {
    const commandEntry = entry({ stepIndex: 0, mode: 'command', command: 'wait_for_event', tickCountAfter: null });
    const interactionEntry = entry({ stepIndex: 0, mode: 'interaction', command: 'wait_for_event', tickCountAfter: null });

    expect(compareTraces([commandEntry], [interactionEntry])).toBeNull();
  });

  it('reports a divergence when one tickCountAfter is null and the other is not', () => {
    const commandEntry = entry({ stepIndex: 0, mode: 'command', command: 'wait_for_event', tickCountAfter: null });
    const interactionEntry = entry({ stepIndex: 0, mode: 'interaction', command: 'wait_for_event', tickCountAfter: 3 });

    expect(compareTraces([commandEntry], [interactionEntry])).toEqual({
      firstDivergentIndex: 0,
      command: commandEntry,
      interaction: interactionEntry,
    });
  });

  it('diverges at index 0 when the command trace is non-empty and the interaction trace is empty', () => {
    const commandEntry = entry({ stepIndex: 0, mode: 'command', command: 'new_game seed:1', tickCountAfter: 0 });

    expect(compareTraces([commandEntry], [])).toEqual({
      firstDivergentIndex: 0,
      command: commandEntry,
      interaction: null,
    });
  });

  it('diverges at index 0 when the interaction trace is non-empty and the command trace is empty', () => {
    const interactionEntry = entry({ stepIndex: 0, mode: 'interaction', command: 'new_game seed:1', tickCountAfter: 0 });

    expect(compareTraces([], [interactionEntry])).toEqual({
      firstDivergentIndex: 0,
      command: null,
      interaction: interactionEntry,
    });
  });
});

describe('writeTraceEntry', () => {
  let dir: string;

  afterEach(() => {
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the file and appends one JSON line per call, in order', () => {
    dir = mkdtempSync(join(tmpdir(), 'scenario-trace-'));
    const path = join(dir, 'trace.jsonl');

    const first = entry({ stepIndex: 0, mode: 'command', command: 'new_game seed:1', tickCountAfter: 0 });
    const second = entry({ stepIndex: 1, mode: 'command', command: 'tick 1', success: false, tickCountAfter: null });

    expect(existsSync(path)).toBe(false);

    writeTraceEntry(path, first);
    writeTraceEntry(path, second);

    const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(first);
    expect(JSON.parse(lines[1])).toEqual(second);
  });
});
