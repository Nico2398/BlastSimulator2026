// BlastSimulator2026 — Dry run of the three mix scenarios in Node
// The real scenarios, the real catalog, the real synth recipes and the real
// AudioManager/AudioEngine on a fake offline context (sample files are not decoded:
// each becomes a constant-level clip as long as its size suggests). It proves the plumbing end to end short of a browser: every recipe
// renders clean, every scenario books through the engine, and the report numbers
// that `sounds:check` will read are sane. What it cannot say: how it sounds.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMixScenario } from '../../../../src/audio/lab/mixScenarios.js';
import { MIX_SCENARIO_NAMES } from '../../../../src/audio/lab/mixTypes.js';
import { renderMix, type OfflineContext } from '../../../../src/audio/lab/offlineMix.js';
import { SYNTH_RECIPES } from '../../../../src/audio/synth/recipes.js';
import { FakeOfflineContext } from './fakeOffline.js';

const SFX_DIR = join(import.meta.dirname, '../../../../public/audio/sfx');
const ASSUMED_BITRATE = 128000;
const FAKE_SAMPLE_RATE = 48000;

/**
 * Stand-in bytes for a sample file: the fake decoder makes one frame per byte, so the
 * length is the file's estimated playing time (size at an assumed bitrate) in frames.
 * Only the lengths matter here, because they decide how long a voice is busy.
 */
async function sampleBytes(url: string): Promise<ArrayBuffer> {
  const file = join(SFX_DIR, url.split('/').pop() ?? '');
  const seconds = (readFileSync(file).length * 8) / ASSUMED_BITRATE;
  return new ArrayBuffer(Math.max(1, Math.round(seconds * FAKE_SAMPLE_RATE)));
}

describe.each(MIX_SCENARIO_NAMES)('dry run of %s', (name) => {
  it('books through the real engine with real recipes and loses nothing but the odd cooldown', async () => {
    const scenario = buildMixScenario(name);
    const result = await renderMix(scenario, {
      createContext: (_channels, length) => new FakeOfflineContext(length) as unknown as OfflineContext,
      fetchBytes: sampleBytes,
      nextTask: () => Promise.resolve(),
    });
    const plays = scenario.events.filter(e => e.kind === 'play').length;
    expect(result.failedAssets).toEqual([]);
    expect(result.requested).toBe(plays);
    // the lab scenarios are written to be playable: at most a few percent refused
    expect(result.dropped / result.requested).toBeLessThan(0.1);
    expect(result.peakVoices).toBeGreaterThan(1);
    expect(result.peakVoices).toBeLessThanOrEqual(32);
    expect(result.channels).toHaveLength(2);
  }, 60000);
});

describe('the real recipes', () => {
  it('are all in the table the lab wraps', () => {
    expect(Object.keys(SYNTH_RECIPES).sort()).toEqual([
      'blast_beep', 'blast_cancel', 'blast_snap', 'blast_sub', 'blast_tail', 'machinery_bed', 'rain_heavy_bed', 'rain_light_bed', 'siren_loop', 'thunder', 'wind_bed',
    ]);
  });
});
