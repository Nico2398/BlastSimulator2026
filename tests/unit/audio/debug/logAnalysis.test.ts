// BlastSimulator2026 — Play log analysis tests

import { describe, it, expect } from 'vitest';
import { cueKey, countCue, countCues, formatCueTable, isInterfaceCue, missingCues, repeatedCues } from '../../../../src/audio/debug/logAnalysis.js';
import type { PlayRecord } from '../../../../src/audio/debug/playLog.js';
import { COMMAND_CUES } from '../../../../src/audio/ui/commandCueTable.js';

const play = (id: string, extra: Partial<PlayRecord> = {}): PlayRecord => ({ atMs: 0, kind: 'play', id, ...extra });
const level = (id: string): PlayRecord => ({ atMs: 0, kind: 'level', id, level: 1 });

describe('cueKey / countCue', () => {
  it('names a record by kind and id', () => {
    expect(cueKey(play('hire'))).toBe('play:hire');
    expect(cueKey(level('amb_wind'))).toBe('level:amb_wind');
  });

  it('counts exactly the matching records', () => {
    const log = [play('hire'), level('hire'), play('hire'), play('fire')];
    expect(countCue(log, 'play:hire')).toBe(2);
    expect(countCue(log, 'play:nothing')).toBe(0);
  });
});

describe('isInterfaceCue', () => {
  it('is true for ui_ cues and for every cue a command can play', () => {
    expect(isInterfaceCue(play('ui_click'))).toBe(true);
    expect(isInterfaceCue(play('hire'))).toBe(true);
    expect(isInterfaceCue(play('order_queued'))).toBe(true);
    expect(isInterfaceCue(play('vehicle_start'))).toBe(true); // the second cue of `vehicle upgrade`
    const everyRuleCue = Object.values(COMMAND_CUES).map(verb => verb.otherwise?.cue).filter((id): id is NonNullable<typeof id> => id !== undefined);
    expect(everyRuleCue.length).toBeGreaterThan(0);
    for (const id of everyRuleCue) expect(isInterfaceCue(play(id))).toBe(true);
  });

  it('is false for world cues, beds and ducks', () => {
    expect(isInterfaceCue(play('blast_boom'))).toBe(false);
    expect(isInterfaceCue(level('ui_click'))).toBe(false);
    expect(isInterfaceCue({ atMs: 0, kind: 'duck', id: 'ambient' })).toBe(false);
  });
});

describe('missingCues', () => {
  it('lists the expectations nothing satisfies, in order', () => {
    const log = [play('hire'), level('amb_wind')];
    expect(missingCues(log, ['play:hire', 'play:fire', 'level:amb_wind', 'duck:ambient'])).toEqual(['play:fire', 'duck:ambient']);
  });

  it('is empty when everything was seen or nothing was expected', () => {
    expect(missingCues([play('hire')], ['play:hire'])).toEqual([]);
    expect(missingCues([], [])).toEqual([]);
  });
});

describe('repeatedCues', () => {
  it('reports plays that happened more than once', () => {
    expect(repeatedCues([play('ui_click'), play('ui_click'), play('ui_open')])).toEqual([['play:ui_click', 2]]);
  });

  it('skips ignored keys and never counts beds or levels', () => {
    const log = [play('ui_hover'), play('ui_hover'), level('amb_wind'), level('amb_wind')];
    expect(repeatedCues(log, new Set(['play:ui_hover']))).toEqual([]);
    expect(repeatedCues(log)).toEqual([['play:ui_hover', 2]]);
  });
});

describe('countCues / formatCueTable', () => {
  it('counts per key, most frequent first, with dropped plays tallied', () => {
    const log = [play('b'), play('a'), play('a', { dropped: true }), level('a')];
    expect(countCues(log)).toEqual([
      { key: 'play:a', count: 2, dropped: 1 },
      { key: 'level:a', count: 1, dropped: 0 },
      { key: 'play:b', count: 1, dropped: 0 },
    ]);
  });

  it('prints an aligned table and marks drops', () => {
    const table = formatCueTable(countCues([play('hire'), play('hire', { dropped: true }), level('amb_wind')]));
    expect(table.split('\n')).toEqual([
      'cue             count',
      '--------------  -----',
      'play:hire           2  1 dropped',
      'level:amb_wind      1',
    ]);
  });

  it('says so when nothing was requested', () => {
    expect(formatCueTable([])).toBe('(no sound requests)');
  });
});
