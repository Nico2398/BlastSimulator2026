// BlastSimulator2026 — Sound lab autotest sequence and mix report

import { describe, expect, it } from 'vitest';
import { runAutotest, type AutotestOptions, type LiveAudio } from '../../../../src/audio/lab/autotest.js';
import { emptyReport, type MixReport } from '../../../../src/audio/lab/labReport.js';
import { buildMixReport, renderAndMeasure } from '../../../../src/audio/lab/mixReport.js';
import { buildMixScenario, parseScenarioList } from '../../../../src/audio/lab/mixScenarios.js';
import type { OfflineContext } from '../../../../src/audio/lab/offlineMix.js';
import { LAB_PANEL_CONFIG } from '../../../../src/core/config/audio/lab.js';
import { FAKE_IMPULSE, FAKE_RECIPES, FakeOfflineContext } from './fakeOffline.js';

/** A live engine whose context clock and state the test moves by hand. */
class FakeLive implements LiveAudio {
  state = 'suspended';
  clock = 0;
  isReady = true;
  smoke = true;
  failPreload = false;
  /** State the context takes after resume(), or null to stay as it is. */
  stateAfterResume: string | null = 'running';
  /** Seconds the clock moves each time the test waits (0: a stuck clock). */
  clockPerWait = 0.1;
  readonly calls: string[] = [];

  async preload(onProgress: (done: number, total: number) => void): Promise<void> {
    this.calls.push('preload');
    if (this.failPreload) throw new Error('preload exploded');
    onProgress(1, 2);
    onProgress(2, 2);
  }
  async resume(): Promise<void> {
    this.calls.push('resume');
    if (this.stateAfterResume) this.state = this.stateAfterResume;
  }
  contextState(): string { return this.state; }
  clockS(): number { return this.clock; }
  sampleRate(): number { return 48000; }
  ready(): boolean { return this.isReady; }
  assets() { return { loaded: [{ name: 'a', kind: 'sample' as const, durationS: 1, peakDbfs: -3 }], failed: ['sample:b (boom)'] }; }
  expected() { return { samples: 2, recipes: 1 }; }
  playSmoke(): boolean { return this.smoke; }
}

const measured = (name: MixReport['name']) => ({ report: { name } as unknown as MixReport, wav: new Uint8Array([1, 2, 3]) });

function setup(overrides: Partial<AutotestOptions> = {}) {
  const live = new FakeLive();
  const wavs = new Map<string, Uint8Array>();
  const waits: number[] = [];
  const options: AutotestOptions = {
    live,
    scenarios: ['ui-tour', 'blast'],
    renderMix: async name => measured(name),
    keepWav: (name, wav) => { wavs.set(name, wav); },
    wait: async (ms) => { waits.push(ms); live.clock += live.clockPerWait; },
    ...overrides,
  };
  return { live, wavs, waits, options, report: emptyReport() };
}

describe('runAutotest', () => {
  it('loads, checks the live context, renders every scenario and finishes', async () => {
    const { live, wavs, options, report } = setup();
    await runAutotest(options, report);
    expect(report.done).toBe(true);
    expect(report.progress).toBe('done');
    expect(report.errors).toEqual([]);
    expect(live.calls).toEqual(['preload', 'resume']);
    expect(report.ready).toBe(true);
    expect(report.expected).toEqual({ samples: 2, recipes: 1 });
    expect(report.loaded.map(a => a.name)).toEqual(['a']);
    expect(report.failed).toEqual(['sample:b (boom)']);
    expect(report.contextState).toBe('running');
    expect(report.sampleRate).toBe(48000);
    expect(report.contextClockAdvanced).toBe(true);
    expect(report.livePlayOk).toBe(true);
    expect(report.mixes.map(m => m.name)).toEqual(['ui-tour', 'blast']);
    expect([...wavs.keys()]).toEqual(['ui-tour', 'blast']);
  });

  it('reports a context that never starts, after waiting out the budget, without looking at its clock', async () => {
    const { live, waits, options, report } = setup();
    live.stateAfterResume = null;
    await runAutotest(options, report);
    expect(report.contextState).toBe('suspended');
    expect(report.contextClockAdvanced).toBe(false);
    expect(waits.length).toBeGreaterThanOrEqual(LAB_PANEL_CONFIG.contextWaitMs / LAB_PANEL_CONFIG.contextPollMs);
    expect(report.done).toBe(true);
    expect(report.mixes).toHaveLength(2);
  });

  it('reports a running context whose clock is stuck', async () => {
    const { live, options, report } = setup();
    live.clockPerWait = 0;
    await runAutotest(options, report);
    expect(report.contextState).toBe('running');
    expect(report.contextClockAdvanced).toBe(false);
  });

  it('survives a refused resume', async () => {
    const { live, options, report } = setup();
    live.resume = () => Promise.reject(new Error('NotAllowedError'));
    await runAutotest(options, report);
    expect(report.contextState).toBe('suspended');
    expect(report.errors).toEqual([]);
  });

  it('records a scenario that fails to render and carries on with the next', async () => {
    const { wavs, options, report } = setup({
      renderMix: async (name) => { if (name === 'ui-tour') throw new Error('no OfflineAudioContext'); return measured(name); },
    });
    await runAutotest(options, report);
    expect(report.mixFailures).toEqual([{ name: 'ui-tour', error: 'no OfflineAudioContext' }]);
    expect(report.mixes.map(m => m.name)).toEqual(['blast']);
    expect([...wavs.keys()]).toEqual(['blast']);
  });

  it('records a page-level failure and still finishes', async () => {
    const { live, options, report } = setup();
    live.failPreload = true;
    await runAutotest(options, report);
    expect(report.errors).toEqual(['preload exploded']);
    expect(report.progress).toBe('failed');
    expect(report.done).toBe(true);
  });

  it('reports a smoke play that got no voice, and engine readiness as it is', async () => {
    const { live, options, report } = setup();
    live.smoke = false;
    live.isReady = false;
    await runAutotest(options, report);
    expect(report.livePlayOk).toBe(false);
    expect(report.ready).toBe(false);
  });

  it('keeps progress readable while loading', async () => {
    const seen: string[] = [];
    const { live, options, report } = setup();
    live.preload = async (onProgress) => { onProgress(3, 9); seen.push(report.progress); };
    await runAutotest(options, report);
    expect(seen).toEqual(['loading assets 3/9']);
  });
});

describe('parseScenarioList', () => {
  it('reads names, skips unknown ones and defaults to all', () => {
    expect(parseScenarioList('blast, ui-tour,nope,blast')).toEqual(['blast', 'ui-tour']);
    expect(parseScenarioList(null)).toEqual(['ui-tour', 'blast', 'busy-mine']);
    expect(parseScenarioList('')).toEqual(['ui-tour', 'blast', 'busy-mine']);
    expect(parseScenarioList('nope')).toEqual(['ui-tour', 'blast', 'busy-mine']);
  });
});

describe('renderAndMeasure', () => {
  it('measures the rendered PCM and encodes it as a WAV of the same length', async () => {
    const scenario = { ...buildMixScenario('ui-tour'), durationS: 1, events: [] };
    const { report, wav } = await renderAndMeasure(scenario, {
      createContext: (_c, length) => new FakeOfflineContext(length) as unknown as OfflineContext,
      fetchBytes: async () => new ArrayBuffer(4800),
      recipes: FAKE_RECIPES,
      renderImpulse: FAKE_IMPULSE,
      nextTask: () => Promise.resolve(),
    });
    expect(report.name).toBe('ui-tour');
    expect(report.scenarioDurationS).toBe(1);
    expect(report.stats.sampleRate).toBe(48000);
    // the fake context outputs a constant 0.1 / -0.1 pair: peak -20 dBFS
    expect(report.stats.peakDbfs).toBeCloseTo(-20, 1);
    expect(wav.length).toBe(44 + 48000 * 2 * 2);
  });

  it('builds a report from rendered PCM', () => {
    const scenario = buildMixScenario('blast');
    const channels = [new Float32Array(48000).fill(0.25), new Float32Array(48000).fill(0.25)];
    const report = buildMixReport(scenario, {
      name: 'blast', sampleRate: 48000, channels, requested: 10, dropped: 2, droppedById: { ui_click: 2 }, peakVoices: 4, failedAssets: [], renderMs: 321,
    });
    expect(report).toMatchObject({ name: 'blast', requested: 10, dropped: 2, droppedById: { ui_click: 2 }, peakVoices: 4, renderMs: 321, scenarioDurationS: scenario.durationS });
    expect(report.stats.peakDbfs).toBeCloseTo(-12, 1);
    expect(report.title).toBe(scenario.title);
  });
});
