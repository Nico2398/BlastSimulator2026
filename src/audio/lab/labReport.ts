// BlastSimulator2026 — Lab report shapes
// What `window.__soundLab` carries out of the page: plain JSON, so the check script
// can read it through browser automation and a human can read it in the console.

import type { MixScenarioName } from './mixTypes.js';
import type { PcmStats } from './pcmStats.js';

export interface LoadedAsset {
  /** File basename, recipe id or 'reverb_impulse'. */
  readonly name: string;
  readonly kind: 'sample' | 'recipe' | 'impulse';
  readonly durationS: number;
  readonly peakDbfs: number;
}

/** Everything a load attempt produced: what decoded or rendered, and what did not (with why). */
export interface AssetReport {
  readonly loaded: readonly LoadedAsset[];
  /** `kind:name (reason)` per asset that could not be fetched, decoded or rendered. */
  readonly failed: readonly string[];
}

export interface MixReport {
  readonly name: MixScenarioName;
  readonly title: string;
  readonly scenarioDurationS: number;
  readonly stats: PcmStats;
  /** One-shots the scenario asked for, and how many the player refused. */
  readonly requested: number;
  readonly dropped: number;
  readonly droppedById: Readonly<Record<string, number>>;
  /** Most sounds playing at once (scheduled voices included). */
  readonly peakVoices: number;
  /** Assets the offline engine itself could not load; empty when all is well. */
  readonly failedAssets: readonly string[];
  readonly renderMs: number;
}

/** A scenario that could not be rendered at all. */
interface MixFailure {
  readonly name: MixScenarioName;
  readonly error: string;
}

export interface SoundLabReport {
  done: boolean;
  /** One line of human-readable progress. */
  progress: string;
  /** State of the live (real-time) context at the end of the load. */
  contextState: string;
  /** The live context's clock moved while we waited: audio is really being consumed. */
  contextClockAdvanced: boolean;
  sampleRate: number;
  /** The live engine finished its first loading tier. */
  ready: boolean;
  /** Whether a real one-shot played on the live engine returned a voice. */
  livePlayOk: boolean;
  expected: { samples: number; recipes: number };
  loaded: readonly LoadedAsset[];
  failed: readonly string[];
  mixes: readonly MixReport[];
  mixFailures: readonly MixFailure[];
  /** Page-level problems (an exception while testing, for example). */
  errors: readonly string[];
}

export function emptyReport(): SoundLabReport {
  return {
    done: false,
    progress: 'starting',
    contextState: 'unknown',
    contextClockAdvanced: false,
    sampleRate: 0,
    ready: false,
    livePlayOk: false,
    expected: { samples: 0, recipes: 0 },
    loaded: [],
    failed: [],
    mixes: [],
    mixFailures: [],
    errors: [],
  };
}
