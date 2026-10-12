// BlastSimulator2026 — Verdict, report table, command line, voice probe

import { describe, expect, it } from 'vitest';
import { CHECK_USAGE, parseCheckArgs } from '../../../../src/audio/lab/checkArgs.js';
import { evaluateReport, expectedAssetCount, savableMixes } from '../../../../src/audio/lab/checks.js';
import { formatEnvelope, formatMixTable } from '../../../../src/audio/lab/formatReport.js';
import { emptyReport, type MixReport, type SoundLabReport } from '../../../../src/audio/lab/labReport.js';
import type { PcmStats } from '../../../../src/audio/lab/pcmStats.js';
import { LAB_CHECK_LIMITS } from '../../../../src/core/config/audio/lab.js';
import { probeVoices } from '../../../../src/audio/lab/voiceProbe.js';

const goodStats: PcmStats = {
  sampleRate: 48000, channels: 2, durationS: 30, nonFiniteCount: 0, peakDbfs: -3, clipCount: 0, clipperDrive: 0, dcOffset: 0,
  rmsDbfs: -30, gatedRmsDbfs: -24, crestFactorDb: 21, integratedLufs: -26, shortTermMaxLufs: -22, monoLossDb: 0.5,
  envelopeDbfs: [-40, -30, -20, -10, -60],
};

const LOADED = { name: 'ui_click_1', kind: 'sample', durationS: 0.1, peakDbfs: -1 } as const;

function mix(overrides: Partial<MixReport> = {}, stats: Partial<PcmStats> = {}): MixReport {
  return {
    name: 'blast', title: 'Blast', scenarioDurationS: 30, stats: { ...goodStats, ...stats }, requested: 50, dropped: 0,
    droppedById: {}, peakVoices: 12, failedAssets: [], renderMs: 900, ...overrides,
  };
}

function healthy(mixes: MixReport[] = [mix()]): SoundLabReport {
  return {
    ...emptyReport(), done: true, contextState: 'running', contextClockAdvanced: true, sampleRate: 48000, ready: true, livePlayOk: true,
    expected: { samples: 1, recipes: 0 }, loaded: [LOADED, LOADED], mixes,
  };
}

describe('evaluateReport', () => {
  it('passes a healthy report with no problems and no warnings', () => {
    expect(evaluateReport(healthy())).toEqual({ problems: [], warnings: [] });
  });

  it('fails on any asset that failed to load', () => {
    const verdict = evaluateReport({ ...healthy(), failed: ['sample:x (HTTP 404)', 'recipe:thunder (boom)'] });
    expect(verdict.problems).toEqual(['asset failed: sample:x (HTTP 404)', 'asset failed: recipe:thunder (boom)']);
  });

  it('fails when fewer assets loaded than the preload plan expects, without a failure being reported', () => {
    const report = { ...healthy(), expected: { samples: 80, recipes: 11 } };
    expect(expectedAssetCount(report)).toBe(92);
    expect(evaluateReport(report).problems).toEqual(['only 2 of 92 assets loaded (an asset neither loaded nor reported as failed)']);
    expect(evaluateReport({ ...report, loaded: Array.from({ length: 92 }, () => LOADED) }).problems).toEqual([]);
  });

  it('fails when nothing loaded, the engine is not ready or a live play returned no voice', () => {
    const problems = evaluateReport({ ...healthy(), loaded: [], ready: false, livePlayOk: false }).problems.join('\n');
    expect(problems).toContain('no asset loaded');
    expect(problems).toContain('never became ready');
    expect(problems).toContain('returned no voice');
  });

  it('reports the context state when it is not running, and a running context whose clock is stuck', () => {
    expect(evaluateReport({ ...healthy(), contextState: 'suspended' }).problems).toEqual(['live AudioContext is "suspended", not "running"']);
    expect(evaluateReport({ ...healthy(), contextClockAdvanced: false }).problems).toEqual(['live AudioContext is running but its clock never advanced']);
  });

  it('fails a mix with NaN, a hot peak or silence', () => {
    expect(evaluateReport(healthy([mix({}, { nonFiniteCount: 3 })])).problems[0]).toContain('3 NaN');
    expect(evaluateReport(healthy([mix({}, { peakDbfs: -0.05 })])).problems[0]).toContain('peak -0.05 dBFS');
    expect(evaluateReport(healthy([mix({}, { gatedRmsDbfs: -70 })])).problems[0]).toContain('silent');
  });

  it('fails a mix that drives the safety clipper too hard, warns earlier, and accepts the exact bounds', () => {
    const { warnClipperDrive, maxClipperDrive } = LAB_CHECK_LIMITS;
    const hard = evaluateReport(healthy([mix({}, { clipperDrive: maxClipperDrive * 1.5 })]));
    expect(hard.problems).toHaveLength(1);
    expect(hard.problems[0]).toContain('above the safety clipper');
    expect(hard.warnings).toEqual([]);
    const warm = evaluateReport(healthy([mix({}, { clipperDrive: (warnClipperDrive + maxClipperDrive) / 2 })]));
    expect(warm.problems).toEqual([]);
    expect(warm.warnings).toHaveLength(1);
    expect(evaluateReport(healthy([mix({}, { clipperDrive: warnClipperDrive })]))).toEqual({ problems: [], warnings: [] });
    expect(evaluateReport(healthy([mix({}, { clipperDrive: maxClipperDrive })])).problems).toEqual([]);
  });

  it('keeps the drive bounds ordered and above what the three lab mixes measured when they were set', () => {
    // measured 2026-10 (maxBoostDb 3): ui-tour 0.00002, blast 0.00085, busy-mine 0.000002
    expect(LAB_CHECK_LIMITS.warnClipperDrive).toBeGreaterThan(0.00085);
    expect(LAB_CHECK_LIMITS.maxClipperDrive).toBeGreaterThan(LAB_CHECK_LIMITS.warnClipperDrive);
  });

  it('accepts a peak exactly at the limit and an RMS exactly at the floor', () => {
    expect(evaluateReport(healthy([mix({}, { peakDbfs: -0.1, gatedRmsDbfs: -60 })])).problems).toEqual([]);
  });

  it('fails a mix whose offline engine could not load assets, and a render that threw', () => {
    expect(evaluateReport(healthy([mix({ failedAssets: ['sample:a (x)'] })])).problems[0]).toContain('sample:a (x)');
    const verdict = evaluateReport({ ...healthy([]), mixFailures: [{ name: 'blast', error: 'out of memory' }] });
    expect(verdict.problems).toEqual(['blast: render failed: out of memory']);
  });

  it('fails when no mix was rendered at all and passes page errors on', () => {
    expect(evaluateReport(healthy([])).problems).toEqual(['no mix was rendered']);
    expect(evaluateReport({ ...healthy(), errors: ['TypeError: x'] }).problems).toEqual(['TypeError: x']);
  });

  it('only warns about clipping, DC, mono loss and dropped one-shots', () => {
    const verdict = evaluateReport(healthy([mix({ dropped: 4 }, { clipCount: 2, dcOffset: 0.02, monoLossDb: 9 })]));
    expect(verdict.problems).toEqual([]);
    expect(verdict.warnings).toHaveLength(4);
    expect(verdict.warnings.join('\n')).toContain('4 of 50 one-shots dropped');
  });
});

describe('savableMixes', () => {
  const report = (...names: string[]): SoundLabReport => healthy(names.map(name => mix({ name: name as MixReport['name'] })));

  it('keeps known scenario names that were asked for', () => {
    expect(savableMixes(report('blast', 'ui-tour'), ['blast', 'ui-tour']).map(m => m.name)).toEqual(['blast', 'ui-tour']);
    expect(savableMixes(report('blast', 'ui-tour'), ['blast']).map(m => m.name)).toEqual(['blast']);
  });

  it('drops names that could escape the output directory or that are not scenarios', () => {
    const hostile = report('../../etc/cron.d/x', 'blast/../../x', '/abs', '', 'busy-mine');
    expect(savableMixes(hostile, ['blast', 'ui-tour', 'busy-mine']).map(m => m.name)).toEqual(['busy-mine']);
  });
});

describe('formatMixTable', () => {
  it('prints a header, a rule and one aligned row per mix', () => {
    const lines = formatMixTable([mix(), mix({ name: 'ui-tour', dropped: 2 }, { peakDbfs: -12.5 })]).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^mix\s+length\s+peak dBFS/);
    expect(lines[1]).toMatch(/^-+ +-+/);
    expect(lines[2]).toMatch(/^blast\s+30\.0 s\s+-3\.0/);
    expect(lines[0]).toContain('drive %');
    expect(lines[3]).toContain('2/50');
    expect(new Set(lines.map(l => l.length)).size).toBe(1);
  });

  it('prints just the header for no mixes', () => {
    expect(formatMixTable([]).split('\n')).toHaveLength(2);
  });
});

describe('formatEnvelope', () => {
  it('draws one character per second, louder as taller', () => {
    const line = formatEnvelope(mix());
    expect(line).toHaveLength(5);
    expect(line[0]).not.toBe(line[3]);
    expect(line[4]).toBe(' ');
  });
});

describe('parseCheckArgs', () => {
  const parse = (...args: string[]) => parseCheckArgs(args);

  it('defaults to every scenario, no fixed directory (the caller makes a fresh one), port 5173 and a long timeout', () => {
    expect(parse()).toEqual({ kind: 'options', options: { scenarios: ['ui-tour', 'blast', 'busy-mine'], outDir: undefined, port: 5173, timeoutS: 900 } });
  });

  it('reads scenarios (repeated or comma separated), directory, port and timeout', () => {
    const parsed = parse('--scenario', 'blast,ui-tour', '--scenario', 'blast', '--out', '/x', '--port', '5200', '--timeout', '60');
    expect(parsed).toEqual({ kind: 'options', options: { scenarios: ['blast', 'ui-tour'], outDir: '/x', port: 5200, timeoutS: 60 } });
  });

  it('answers help', () => {
    expect(parse('--help')).toEqual({ kind: 'help' });
    expect(parse('-h')).toEqual({ kind: 'help' });
    expect(CHECK_USAGE).toContain('--scenario');
  });

  it.each([
    [['--scenario'], '--scenario needs a name'],
    [['--scenario', '--out'], '--scenario needs a name'],
    [['--scenario', 'nope'], 'unknown scenario "nope"'],
    [['--out'], '--out needs a directory'],
    [['--port', 'x'], '--port needs a positive number'],
    [['--timeout', '0'], '--timeout needs a positive number'],
    [['--timeout'], '--timeout needs a positive number'],
    [['--wat'], 'unknown argument "--wat"'],
  ])('rejects %j', (args, message) => {
    const parsed = parse(...args);
    expect(parsed.kind).toBe('error');
    if (parsed.kind === 'error') expect(parsed.message).toContain(message);
  });
});

describe('probeVoices', () => {
  /** A source with the event-target methods the probe uses. */
  function fakeSource() {
    const listeners: Array<() => void> = [];
    return {
      start: (..._args: unknown[]) => undefined,
      addEventListener: (_type: string, listener: () => void) => { listeners.push(listener); },
      end: () => { for (const l of listeners) l(); },
    };
  }

  it('counts sources from start to ended and remembers the peak', () => {
    const sources: ReturnType<typeof fakeSource>[] = [];
    const context = { createBufferSource: () => { const s = fakeSource(); sources.push(s); return s as unknown as AudioBufferSourceNode; } };
    const probe = probeVoices(context);
    const a = context.createBufferSource();
    const b = context.createBufferSource();
    expect(probe.active()).toBe(0);
    a.start(1);
    b.start(2, 0.5);
    expect(probe.active()).toBe(2);
    sources[0]?.end();
    expect(probe.active()).toBe(1);
    expect(probe.peak()).toBe(2);
    sources[1]?.end();
    expect(probe.active()).toBe(0);
    expect(probe.peak()).toBe(2);
  });

  it('counts a source once even if start is called again', () => {
    const context = { createBufferSource: () => fakeSource() as unknown as AudioBufferSourceNode };
    const probe = probeVoices(context);
    const source = context.createBufferSource();
    source.start(0);
    source.start(0);
    expect(probe.active()).toBe(1);
  });
});
