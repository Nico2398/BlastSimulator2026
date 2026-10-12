// BlastSimulator2026 — Offline mix render
// Drives the real AudioManager and AudioEngine on a fake offline context that
// pauses where asked and ends sources when their time has passed, to prove how
// events are booked: on time, on the scenario's clock, with voices freed between.

import { describe, expect, it } from 'vitest';
import { renderMix, type OfflineContext } from '../../../../src/audio/lab/offlineMix.js';
import type { MixScenario } from '../../../../src/audio/lab/mixTypes.js';
import { TimelineBuilder } from '../../../../src/audio/lab/timeline.js';
import { LAB_RENDER_CONFIG } from '../../../../src/core/config/audio/lab.js';
import type { FakeSource } from '../../../helpers/audioFakes.js';
import { FAKE_IMPULSE, FAKE_RECIPES, FakeOfflineContext } from './fakeOffline.js';

const SAMPLE_FRAMES = 48000;

function scenario(build: (b: TimelineBuilder) => void, durationS = 4): MixScenario {
  const builder = new TimelineBuilder();
  build(builder);
  return { name: 'ui-tour', title: 'test', durationS, listener: LAB_RENDER_CONFIG.listener, events: builder.build() };
}

async function render(s: MixScenario, extra: { fetchBytes?: () => Promise<ArrayBuffer>; onProgress?: (m: string) => void } = {}) {
  let context: FakeOfflineContext | null = null;
  const result = await renderMix(s, {
    createContext: (_channels, length) => {
      context = new FakeOfflineContext(length);
      return context as unknown as OfflineContext;
    },
    fetchBytes: extra.fetchBytes ?? (async () => new ArrayBuffer(SAMPLE_FRAMES)),
    recipes: FAKE_RECIPES,
    renderImpulse: FAKE_IMPULSE,
    nextTask: () => Promise.resolve(),
    wallClock: () => 0,
    ...(extra.onProgress ? { onProgress: extra.onProgress } : {}),
  });
  if (!context) throw new Error('no context was created');
  return { result, context: context as FakeOfflineContext };
}

/** Start times of the one-shot sources (loops excluded), in the order they were created. */
function oneShotStarts(context: FakeOfflineContext): number[] {
  return context.sources().filter((s: FakeSource) => !s.loop).map(s => s.starts[0]?.when ?? -1);
}

describe('renderMix', () => {
  it('returns the context output as planar stereo PCM at the lab rate', async () => {
    const { result, context } = await render(scenario(b => b.play(0.5, 'ui_click'), 2));
    expect(result.name).toBe('ui-tour');
    expect(result.sampleRate).toBe(LAB_RENDER_CONFIG.sampleRate);
    expect(result.channels).toHaveLength(2);
    expect(result.channels[0]).toHaveLength(2 * LAB_RENDER_CONFIG.sampleRate);
    expect(result.channels[0]?.[100]).toBeCloseTo(0.1, 5);
    expect(result.channels[1]?.[100]).toBeCloseTo(-0.1, 5);
    expect(context.renderedTo).toBe(2);
  });

  it('books every one-shot with a sample-accurate start on the audio clock', async () => {
    const times = [0, 0.07, 0.31, 0.78, 1.234, 2.5];
    const sounds = ['ui_open', 'ui_back', 'ui_close', 'ui_tab', 'ui_select', 'ui_confirm'] as const;
    const { context } = await render(scenario(b => times.forEach((t, i) => b.play(t, sounds[i] ?? 'ui_open')), 4));
    const starts = oneShotStarts(context).sort((a, b) => a - b);
    expect(starts).toHaveLength(times.length);
    starts.forEach((start, i) => expect(start).toBeCloseTo(times[i] ?? -1, 6));
  });

  it('pauses on the schedule step, resumes every pause and never pauses twice at one time', async () => {
    const { context } = await render(scenario(b => b.play(0.35, 'ui_click').play(0.36, 'ui_open').play(2.2, 'ui_back'), 4));
    expect(context.pausedAt.length).toBe(2);
    expect(new Set(context.pausedAt).size).toBe(context.pausedAt.length);
    expect(context.resumeCalls.length).toBeGreaterThanOrEqual(context.pausedAt.length);
    for (const at of context.pausedAt) expect(at).toBeLessThanOrEqual(2.2 + 1e-9);
  });

  it('rates cooldowns on scenario time, not on the wall clock', async () => {
    // ui_click has a 25 ms cooldown. The wall clock is frozen, so only scenario time can tell these apart.
    const { result } = await render(scenario(b => b.play(1, 'ui_click').play(1.01, 'ui_click').play(1.2, 'ui_click'), 3));
    expect(result.requested).toBe(3);
    expect(result.dropped).toBe(1);
    expect(result.droppedById).toEqual({ ui_click: 1 });
  });

  it('frees voice slots as sounds end, so later plays are not refused by earlier ones', async () => {
    // ui_click allows 3 at once and each sample lasts 1 s here.
    const burst = (b: TimelineBuilder): void => {
      [0.1, 0.2, 0.3, 0.4].forEach(t => b.play(t, 'ui_click'));
      b.play(2.5, 'ui_click');
    };
    const { result } = await render(scenario(burst, 4));
    expect(result.droppedById).toEqual({ ui_click: 1 });
    expect(result.dropped).toBe(1);
    expect(result.peakVoices).toBe(3);
  });

  it('starts a bed when a loop event arrives and ducks buses without error', async () => {
    const { result, context } = await render(scenario(b => b.loop(0, 'amb_wind', 0.5).duck(1, 'ambient', -12, 1, 1).loop(2.5, 'amb_rain_heavy', 1, 1), 4));
    const beds = context.sources().filter(s => s.loop);
    expect(beds).toHaveLength(2);
    expect(result.requested).toBe(0);
    expect(result.failedAssets).toEqual([]);
  });

  it('ignores events that start at or after the end of the render', async () => {
    const { result } = await render(scenario(b => b.play(1, 'ui_click').play(3, 'ui_open').play(9, 'ui_back'), 3));
    expect(result.requested).toBe(1);
  });

  it('reports assets the offline engine could not load', async () => {
    const { result } = await render(scenario(b => b.play(0.5, 'ui_click'), 2), { fetchBytes: async () => { throw new Error('HTTP 404'); } });
    expect(result.failedAssets.length).toBeGreaterThan(10);
    expect(result.failedAssets[0]).toContain('HTTP 404');
    expect(result.dropped).toBe(1);
  });

  it('reports progress and the render time', async () => {
    const messages: string[] = [];
    const { result } = await render(scenario(b => b.play(0.5, 'ui_click'), 2), { onProgress: m => messages.push(m) });
    expect(messages).toEqual(['ui-tour: loading assets', 'ui-tour: rendering 2.0 s']);
    expect(result.renderMs).toBe(0);
  });
});
