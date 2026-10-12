// BlastSimulator2026 — Sound lab autotest
// The sequence behind `?autotest=1`: load the live engine, see whether the real-time
// context really runs and plays, then render and measure each mix, filling in the
// report the check script reads. Everything the browser provides comes in through
// small interfaces so the sequence itself is tested in Node.

import { LAB_PANEL_CONFIG } from '../../core/config/audio/lab.js';
import type { AssetReport, SoundLabReport } from './labReport.js';
import type { MeasuredMix } from './mixReport.js';
import type { MixScenarioName } from './mixTypes.js';

/** The live (real-time) engine, as the autotest needs to see it. */
export interface LiveAudio {
  preload(onProgress: (done: number, total: number) => void): Promise<void>;
  /** Ask the browser to start the context; may resolve without it running. */
  resume(): Promise<void>;
  contextState(): string;
  /** The context's own clock (s); it only moves when audio is really being consumed. */
  clockS(): number;
  sampleRate(): number;
  ready(): boolean;
  assets(): AssetReport;
  expected(): { samples: number; recipes: number };
  /** Fire one ordinary one-shot; true when the engine gave it a voice. */
  playSmoke(): boolean;
}

export interface AutotestOptions {
  readonly live: LiveAudio;
  readonly scenarios: readonly MixScenarioName[];
  readonly renderMix: (name: MixScenarioName) => Promise<MeasuredMix>;
  /** Called with each finished mix's WAV. */
  readonly keepWav: (name: MixScenarioName, wav: Uint8Array) => void;
  /** Resolve after about `ms` milliseconds. */
  readonly wait: (ms: number) => Promise<void>;
}

/** Poll `condition` every poll interval until it holds or the budget runs out; true when it held. */
async function waitUntil(condition: () => boolean, wait: AutotestOptions['wait']): Promise<boolean> {
  for (let waited = 0; waited <= LAB_PANEL_CONFIG.contextWaitMs; waited += LAB_PANEL_CONFIG.contextPollMs) {
    if (condition()) return true;
    await wait(LAB_PANEL_CONFIG.contextPollMs);
  }
  return false;
}

async function checkLiveContext(options: AutotestOptions, report: SoundLabReport): Promise<void> {
  const { live, wait } = options;
  await live.resume().catch(() => undefined);
  await waitUntil(() => live.contextState() === 'running', wait);
  report.contextState = live.contextState();
  report.sampleRate = live.sampleRate();
  if (report.contextState !== 'running') return;
  const startedAt = live.clockS();
  report.contextClockAdvanced = await waitUntil(() => live.clockS() > startedAt, wait);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run the whole sequence; `report.done` is set at the end whatever happened. */
export async function runAutotest(options: AutotestOptions, report: SoundLabReport): Promise<void> {
  const { live } = options;
  try {
    report.progress = 'loading assets';
    await live.preload((done, total) => { report.progress = `loading assets ${done}/${total}`; });
    const assets = live.assets();
    report.ready = live.ready();
    report.expected = live.expected();
    report.loaded = assets.loaded;
    report.failed = assets.failed;

    report.progress = 'starting the live context';
    await checkLiveContext(options, report);
    report.livePlayOk = live.playSmoke();

    for (const name of options.scenarios) {
      report.progress = `rendering ${name}`;
      try {
        const measured = await options.renderMix(name);
        options.keepWav(name, measured.wav);
        report.mixes = [...report.mixes, measured.report];
      } catch (error) {
        report.mixFailures = [...report.mixFailures, { name, error: describeError(error) }];
      }
    }
    report.progress = 'done';
  } catch (error) {
    report.errors = [...report.errors, describeError(error)];
    report.progress = 'failed';
  } finally {
    report.done = true;
  }
}
