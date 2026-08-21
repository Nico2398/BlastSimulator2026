// BlastSimulator2026 — scenario-trace unit tests (issue #674)
//
// scenario-trace.ts is the diagnostic machinery the scenario-trace-comparison
// CLI (compare-scenario-traces.ts) uses to pin down where a scenario's
// command-mode run and its interaction-mode run first disagree.
// `compareTraces` and `compareStateSnapshots` are pure (no I/O) and
// `writeTraceEntry` is the append-only JSONL sink both live runs write to as
// they progress.
//
// The two comparisons are aligned by scenario step, never by array position:
// interaction mode contributes no trace entry for a step driven by real
// clicks and one per internal tick for a `waitUntil` step, so a positional
// walk would report a divergence at the first click-driven step of every
// scenario and bury the real one.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  compareTraces,
  compareStateSnapshots,
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
      entry({ stepIndex: 0, command: 'new_game seed:42', tickCountAfter: 0 }),
      entry({ stepIndex: 1, command: 'tick 1', tickCountAfter: 1 }),
      entry({ stepIndex: 2, command: 'tick 1', tickCountAfter: 2 }),
    ];
    const interactionTrace: ScenarioTraceEntry[] = commandTrace.map(e => ({ ...e, mode: 'interaction' as const }));

    expect(compareTraces(commandTrace, interactionTrace)).toBeNull();
  });

  it('reports the first step whose command string differs', () => {
    // level2-playthrough-win step 64's own shape: a step that declared
    // `tick 45` and whose interaction array ran `tick 6`.
    const commandEntry = entry({ stepIndex: 2, command: 'tick 45', tickCountAfter: 45 });
    const interactionEntry = entry({ stepIndex: 2, mode: 'interaction', command: 'tick 6', tickCountAfter: 6 });

    const commandTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 0, command: 'new_game seed:1', tickCountAfter: 0 }),
      commandEntry,
    ];
    const interactionTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 0, mode: 'interaction', command: 'new_game seed:1', tickCountAfter: 0 }),
      interactionEntry,
    ];

    expect(compareTraces(commandTrace, interactionTrace)).toEqual({
      stepIndex: 2,
      reason: 'command',
      command: commandEntry,
      interaction: interactionEntry,
    });
  });

  it('reports a divergence when the same command succeeded in one mode and was refused in the other', () => {
    const commandEntry = entry({ stepIndex: 1, command: 'vehicle driver 3 5', success: true, tickCountAfter: 4 });
    const interactionEntry = entry({ stepIndex: 1, mode: 'interaction', command: 'vehicle driver 3 5', success: false, tickCountAfter: 4 });

    expect(compareTraces([commandEntry], [interactionEntry])).toEqual({
      stepIndex: 1,
      reason: 'success',
      command: commandEntry,
      interaction: interactionEntry,
    });
  });

  it('reports a divergence when tickCountAfter differs but the command string matches', () => {
    const commandEntry = entry({ stepIndex: 1, command: 'tick 10', tickCountAfter: 11 });
    const interactionEntry = entry({ stepIndex: 1, mode: 'interaction', command: 'tick 10', tickCountAfter: 10 });

    expect(compareTraces([commandEntry], [interactionEntry])).toEqual({
      stepIndex: 1,
      reason: 'tickCount',
      command: commandEntry,
      interaction: interactionEntry,
    });
  });

  it('skips a step interaction mode contributed no entry for — a click-driven step has no command to compare', () => {
    const commandTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 0, command: 'new_game seed:1', tickCountAfter: 0 }),
      // step 1 is `employee hire role:surveyor`, driven by real clicks
      entry({ stepIndex: 1, command: 'employee hire role:surveyor', tickCountAfter: 0 }),
      entry({ stepIndex: 2, command: 'tick 1', tickCountAfter: 1 }),
    ];
    const interactionTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 0, mode: 'interaction', command: 'new_game seed:1', tickCountAfter: 0 }),
      entry({ stepIndex: 2, mode: 'interaction', command: 'tick 1', tickCountAfter: 1 }),
    ];

    expect(compareTraces(commandTrace, interactionTrace)).toBeNull();
  });

  it('compares the last of several interaction entries for one step — a waitUntil loops tick 1 internally', () => {
    const commandEntry = entry({ stepIndex: 1, command: 'wait_until field:holeCount equals:2', tickCountAfter: 3 });
    const interactionTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 1, mode: 'interaction', command: 'tick 1', tickCountAfter: 1 }),
      entry({ stepIndex: 1, mode: 'interaction', command: 'tick 1', tickCountAfter: 2 }),
      entry({ stepIndex: 1, mode: 'interaction', command: 'tick 1', tickCountAfter: 3 }),
    ];

    expect(compareTraces([commandEntry], interactionTrace)).toBeNull();
  });

  it('reports the step where the interaction trace stops as missing', () => {
    const commandTrace: ScenarioTraceEntry[] = [
      entry({ stepIndex: 0, command: 'new_game seed:7', tickCountAfter: 0 }),
      entry({ stepIndex: 1, command: 'tick 1', tickCountAfter: 1 }),
      entry({ stepIndex: 2, command: 'blast', tickCountAfter: 1 }),
    ];
    const interactionTrace: ScenarioTraceEntry[] = commandTrace
      .slice(0, 2)
      .map(e => ({ ...e, mode: 'interaction' as const }));

    expect(compareTraces(commandTrace, interactionTrace)).toEqual({
      stepIndex: 2,
      reason: 'missing',
      command: commandTrace[2],
      interaction: null,
    });
  });

  it('returns null for two empty arrays', () => {
    expect(compareTraces([], [])).toBeNull();
  });

  it('returns null when the interaction trace is empty — every step was click-driven, nothing is comparable', () => {
    expect(compareTraces([entry({ stepIndex: 0, command: 'new_game seed:1', tickCountAfter: 0 })], [])).toBeNull();
  });

  it('treats commands as matching after normalizing internal whitespace runs to a single space', () => {
    const commandEntry = entry({ stepIndex: 0, command: 'tick  1', tickCountAfter: 1 });
    const interactionEntry = entry({ stepIndex: 0, mode: 'interaction', command: 'tick 1', tickCountAfter: 1 });

    expect(compareTraces([commandEntry], [interactionEntry])).toBeNull();
  });

  it('treats commands as matching after trimming leading/trailing whitespace', () => {
    const commandEntry = entry({ stepIndex: 0, command: '  tick 1  ', tickCountAfter: 1 });
    const interactionEntry = entry({ stepIndex: 0, mode: 'interaction', command: 'tick 1', tickCountAfter: 1 });

    expect(compareTraces([commandEntry], [interactionEntry])).toBeNull();
  });

  it('treats two null tickCountAfter values as equal', () => {
    const commandEntry = entry({ stepIndex: 0, command: 'wait_for_event', tickCountAfter: null });
    const interactionEntry = entry({ stepIndex: 0, mode: 'interaction', command: 'wait_for_event', tickCountAfter: null });

    expect(compareTraces([commandEntry], [interactionEntry])).toBeNull();
  });

  it('reports a divergence when one tickCountAfter is null and the other is not', () => {
    const commandEntry = entry({ stepIndex: 0, command: 'wait_for_event', tickCountAfter: null });
    const interactionEntry = entry({ stepIndex: 0, mode: 'interaction', command: 'wait_for_event', tickCountAfter: 3 });

    expect(compareTraces([commandEntry], [interactionEntry])).toEqual({
      stepIndex: 0,
      reason: 'tickCount',
      command: commandEntry,
      interaction: interactionEntry,
    });
  });
});

describe('compareStateSnapshots', () => {
  it('returns null when every compared step reads back the same state', () => {
    const command = [
      { stepIndex: 0, state: { tickCount: 0, cash: 100 } },
      { stepIndex: 1, state: { tickCount: 1, cash: 90 } },
    ];
    const interaction = [
      { stepIndex: 0, state: { tickCount: 0, cash: 100 } },
      { stepIndex: 1, state: { tickCount: 1, cash: 90 } },
    ];

    expect(compareStateSnapshots(command, interaction)).toBeNull();
  });

  it('reports the first step whose state differs, and every field that differs there', () => {
    // tutorial-playthrough step 37's own shape: both modes issued a command,
    // interaction mode's click landed on a different vehicle, and the only
    // visible trace of it was the state read back some steps later.
    const command = [
      { stepIndex: 0, state: { tickCount: 0, cash: 100, minFatigue: 100 } },
      { stepIndex: 1, state: { tickCount: 60, cash: 90, minFatigue: 40 } },
    ];
    const interaction = [
      { stepIndex: 0, state: { tickCount: 0, cash: 100, minFatigue: 100 } },
      { stepIndex: 1, state: { tickCount: 60, cash: 61, minFatigue: 16 } },
    ];

    expect(compareStateSnapshots(command, interaction)).toEqual({
      stepIndex: 1,
      fields: [
        { field: 'cash', command: 90, interaction: 61 },
        { field: 'minFatigue', command: 40, interaction: 16 },
      ],
    });
  });

  it('ignores fields that differ between the two modes by construction', () => {
    const command = [{ stepIndex: 0, state: { tickCount: 0, weather: null, timeScale: 2 } }];
    const interaction = [{ stepIndex: 0, state: { tickCount: 0, weather: 'sunny', timeScale: 8 } }];

    expect(compareStateSnapshots(command, interaction)).toBeNull();
  });

  it('honours a caller-supplied ignore list in place of the default', () => {
    const command = [{ stepIndex: 0, state: { tickCount: 0, cash: 10 } }];
    const interaction = [{ stepIndex: 0, state: { tickCount: 0, cash: 20 } }];

    expect(compareStateSnapshots(command, interaction, ['cash'])).toBeNull();
  });

  it('skips a step either side has no state dump for rather than calling it a divergence', () => {
    const command = [
      { stepIndex: 0, state: null },
      { stepIndex: 1, state: { tickCount: 1 } },
    ];
    const interaction = [{ stepIndex: 1, state: { tickCount: 1 } }];

    expect(compareStateSnapshots(command, interaction)).toBeNull();
  });

  it('returns null for two empty snapshot lists', () => {
    expect(compareStateSnapshots([], [])).toBeNull();
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
