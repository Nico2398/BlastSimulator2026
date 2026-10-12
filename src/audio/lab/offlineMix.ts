// BlastSimulator2026 — Offline mix render
// Plays a mix scenario through the real audio graph (the game's AudioManager buses,
// limiter, reverb and ducking, and its AudioEngine with the real assets and
// recipes) on an OfflineAudioContext, faster than real time, and returns the stereo
// PCM that would have reached the speakers.
//
// Scheduling. The engine counts a scheduled voice as busy from the moment `play` is
// called, and rates cooldowns on its millisecond clock. So the render does not book
// the whole scenario up front: it pauses the context on a short grid (see
// `planDispatch`), books the sounds that start before the next pause with a
// sample-accurate `delayS`, and resumes. At each pause the context's `ended` events
// have been delivered, so voices that finished have freed their slots, exactly as
// in play. The engine's clock (`now`) is injected: while the scenario is being
// scheduled it reads the scenario time of the event being dispatched, so cooldowns
// behave as they would at that moment of a real game; during preload it is the wall
// clock, so the synth rendering still yields to the page.

import { Random } from '../../core/math/Random.js';
import { LAB_RENDER_CONFIG } from '../../core/config/audio/lab.js';
import { AudioEngine } from '../AudioEngine.js';
import { AudioManager } from '../AudioManager.js';
import type { ByteSource } from '../engine/SampleBank.js';
import { SYNTH_RECIPES, renderReverbIr } from '../synth/recipes.js';
import type { RenderedAudio, SynthRecipe } from '../synth/types.js';
import type { SynthRecipeId } from '../SoundCatalog.js';
import { AssetProbe } from './assetProbe.js';
import { dispatchMixEvent, DispatchTally } from './mixDispatch.js';
import type { MixScenario } from './mixTypes.js';
import { planDispatch } from './timeline.js';
import { probeVoices } from './voiceProbe.js';

/** The slice of OfflineAudioContext the render drives, so a test can stand in for it. */
export type OfflineContext = AudioContext & {
  startRendering(): Promise<AudioBuffer>;
  suspend(suspendTime: number): Promise<void>;
};

export interface OfflineMixDeps {
  /** A fresh stereo offline context of `length` frames. */
  readonly createContext: (channels: number, length: number, sampleRate: number) => OfflineContext;
  /** Where sample bytes come from (cache it across renders: it is called once per file per render). */
  readonly fetchBytes: ByteSource;
  readonly recipes?: Readonly<Record<SynthRecipeId, SynthRecipe>>;
  readonly renderImpulse?: () => RenderedAudio;
  /** Wall-clock milliseconds; injectable for tests. */
  readonly wallClock?: () => number;
  /** Wait for the event loop (lets `ended` events land); injectable for tests. */
  readonly nextTask?: () => Promise<void>;
  readonly onProgress?: (message: string) => void;
}

export interface RenderedMix {
  readonly name: MixScenario['name'];
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
  readonly requested: number;
  readonly dropped: number;
  readonly droppedById: Readonly<Record<string, number>>;
  readonly peakVoices: number;
  readonly failedAssets: readonly string[];
  readonly renderMs: number;
}

const nextMacrotask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

export async function renderMix(scenario: MixScenario, deps: OfflineMixDeps): Promise<RenderedMix> {
  const cfg = LAB_RENDER_CONFIG;
  const wallClock = deps.wallClock ?? (() => performance.now());
  const nextTask = deps.nextTask ?? nextMacrotask;
  const startedMs = wallClock();
  const frames = Math.ceil(scenario.durationS * cfg.sampleRate);
  const context = deps.createContext(cfg.channels, frames, cfg.sampleRate);
  const voices = probeVoices(context);
  const probe = new AssetProbe();

  // The engine's clock: scenario time while events are being booked, the wall clock before.
  let scheduling = false;
  let scenarioMs = 0;
  const manager = new AudioManager({ createContext: () => context, document: null });
  const engine = new AudioEngine(manager, {
    random: new Random(cfg.seed),
    fetchBytes: probe.wrapFetch(deps.fetchBytes),
    decode: probe.wrapDecode(bytes => context.decodeAudioData(bytes)),
    recipes: probe.wrapRecipes(deps.recipes ?? SYNTH_RECIPES),
    renderImpulse: probe.wrapImpulse(deps.renderImpulse ?? renderReverbIr),
    now: () => (scheduling ? scenarioMs : wallClock()),
    yieldToEventLoop: nextTask,
  });

  deps.onProgress?.(`${scenario.name}: loading assets`);
  await engine.preload();
  engine.setListener(scenario.listener);

  const tally = new DispatchTally();
  const book = (events: MixScenario['events']): void => {
    for (const event of events) {
      scenarioMs = event.t * 1000;
      tally.record(dispatchMixEvent(engine, event, event.t - context.currentTime));
    }
  };

  const batches = planDispatch(scenario.events, {
    stepS: cfg.scheduleStepS,
    quantumS: cfg.renderQuantumFrames / cfg.sampleRate,
    durationS: scenario.durationS,
  });
  scheduling = true;
  const first = batches[0];
  const pauses = batches.filter(batch => batch.atS > 0);
  if (first && first.atS <= 0) book(first.events);
  const booked = pauses.map(batch => context.suspend(batch.atS).then(async () => {
    try {
      await nextTask();
      book(batch.events);
    } finally {
      void context.resume();
    }
  }));

  deps.onProgress?.(`${scenario.name}: rendering ${scenario.durationS.toFixed(1)} s`);
  const rendered = await context.startRendering();
  await Promise.all(booked);
  // Only the engine is disposed: AudioManager.dispose closes its context, and an
  // OfflineAudioContext has no close(). The finished context is simply let go.
  engine.dispose();

  return {
    name: scenario.name,
    sampleRate: rendered.sampleRate,
    channels: Array.from({ length: rendered.numberOfChannels }, (_, index) => Float32Array.from(rendered.getChannelData(index))),
    requested: tally.requested,
    dropped: tally.dropped,
    droppedById: tally.droppedByIdRecord(),
    peakVoices: voices.peak(),
    failedAssets: probe.report().failed,
    renderMs: Math.round(wallClock() - startedMs),
  };
}
