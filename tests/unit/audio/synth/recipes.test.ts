// BlastSimulator2026 — synth recipes: contract, levels, determinism, loop seams

import { describe, expect, it } from 'vitest';
import { SOUND_CATALOG, type SynthRecipeId } from '../../../../src/audio/SoundCatalog.js';
import { SYNTH_RECIPES } from '../../../../src/audio/synth/recipes.js';
import { dcOffset, gatedRmsDb, truePeakDb } from '../../../../src/audio/synth/loudness.js';
import { MACHINERY_CONFIG, RAIN_HEAVY_CONFIG, RAIN_LIGHT_CONFIG, SIREN_CONFIG, SYNTH_LEVELS, WIND_CONFIG } from '../../../../src/core/config/audio/synth.js';
import { maxLineProminenceDb, renderCached, sameSamples, sortedSteps, windowOf } from './helpers.js';

const EXPECTED_IDS: Record<SynthRecipeId, true> = {
  blast_snap: true,
  blast_sub: true,
  blast_tail: true,
  blast_beep: true,
  blast_cancel: true,
  siren_loop: true,
  thunder: true,
  wind_bed: true,
  rain_light_bed: true,
  rain_heavy_bed: true,
  machinery_bed: true,
};
const IDS = Object.keys(EXPECTED_IDS) as SynthRecipeId[];
const CASES = IDS.flatMap((id) => Array.from({ length: SYNTH_RECIPES[id].variants }, (_, variant) => ({ id, variant, label: `${id}#${variant}` })));
const LOOPS = CASES.filter(({ id }) => SYNTH_RECIPES[id].loop);
const ONE_SHOTS = CASES.filter(({ id }) => !SYNTH_RECIPES[id].loop);
/** Sounds whose character is a steady or gliding tone; every other recipe must read as noise-like. */
const TONAL: readonly SynthRecipeId[] = ['blast_beep', 'blast_cancel', 'siren_loop', 'blast_sub'];
/** Sharp-transient noise: its crest factor is too high to reach the reference RMS under the true-peak ceiling, so it lands below it. */
const PEAK_LIMITED: readonly SynthRecipeId[] = ['blast_snap'];
const PEAK_LIMITED_MAX_SHORTFALL_DB = 4;

describe('recipe table', () => {
  it('covers every SynthRecipeId and nothing else', () => {
    expect(Object.keys(SYNTH_RECIPES).sort()).toEqual(IDS.slice().sort());
  });

  it('declares the planned variant counts', () => {
    const counts = Object.fromEntries(IDS.map((id) => [id, SYNTH_RECIPES[id].variants]));
    expect(counts).toEqual({
      blast_snap: 2,
      blast_sub: 2,
      blast_tail: 2,
      blast_beep: 1,
      blast_cancel: 1,
      siren_loop: 1,
      thunder: 3,
      wind_bed: 1,
      rain_light_bed: 1,
      rain_heavy_bed: 1,
      machinery_bed: 1,
    });
  });

  it('agrees with the sound catalog about which recipes loop', () => {
    for (const [name, def] of Object.entries(SOUND_CATALOG)) {
      if (def.source.kind !== 'synth') continue;
      const recipe = SYNTH_RECIPES[def.source.recipe];
      expect(recipe, `${name} -> ${def.source.recipe}`).toBeDefined();
      expect(recipe.loop, name).toBe(Boolean((def as { loop?: true }).loop));
    }
  });

  it('wraps out-of-range variant indices instead of failing', () => {
    expect(sameSamples(SYNTH_RECIPES.thunder.render(3), renderCached('thunder', 0))).toBe(true);
    expect(sameSamples(SYNTH_RECIPES.blast_sub.render(-1), renderCached('blast_sub', 1))).toBe(true);
  });
});

describe('blast_snap catalog entry', () => {
  it('is a spatial, never-dropped synth shot on the effects bus with three voices and a reverb send', () => {
    const entry = SOUND_CATALOG.blast_snap;
    expect(entry.bus).toBe('effects');
    expect(entry.source).toEqual({ kind: 'synth', recipe: 'blast_snap' });
    expect(entry.maxVoices).toBe(3);
    expect(entry.priority).toBe(4);
    expect(entry.spatial).toBe(true);
    expect(entry.reverbSend).toBeGreaterThan(0);
    expect(entry.reverbSend).toBeLessThanOrEqual(0.4);
    expect('loop' in entry).toBe(false);
  });

  it('keeps every catalog trim within +6 dB', () => {
    for (const [name, def] of Object.entries(SOUND_CATALOG)) expect(def.gainDb, name).toBeLessThanOrEqual(6);
  });
});

describe.each(CASES)('$label', ({ id, variant }) => {
  const audio = renderCached(id, variant);
  const loop = SYNTH_RECIPES[id].loop;

  it('is deterministic: rendering twice gives identical samples', () => {
    expect(sameSamples(SYNTH_RECIPES[id].render(variant), audio)).toBe(true);
  });

  it('is finite, planar and consistently shaped', () => {
    expect(audio.sampleRate).toBeGreaterThanOrEqual(11025);
    expect(audio.sampleRate).toBeLessThanOrEqual(48000);
    expect(audio.channels.length).toBeGreaterThanOrEqual(1);
    const length = audio.channels[0]?.length ?? 0;
    expect(length).toBeGreaterThan(audio.sampleRate * 0.1);
    for (const channel of audio.channels) {
      expect(channel.length).toBe(length);
      expect(channel.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it('sits at the reference level with true peak under the ceiling and no DC', () => {
    const target = loop ? SYNTH_LEVELS.loopDb : SYNTH_LEVELS.oneShotDb;
    const shortfall = target - gatedRmsDb(audio.channels, audio.sampleRate);
    if (PEAK_LIMITED.includes(id)) {
      expect(shortfall).toBeGreaterThanOrEqual(-0.25);
      expect(shortfall).toBeLessThan(PEAK_LIMITED_MAX_SHORTFALL_DB);
    } else {
      expect(Math.abs(shortfall)).toBeLessThan(0.25);
    }
    expect(truePeakDb(audio.channels)).toBeLessThanOrEqual(SYNTH_LEVELS.peakCeilingDb + 1e-3);
    expect(Math.abs(dcOffset(audio.channels))).toBeLessThan(1e-3);
  });
});

describe.each(CASES.filter(({ id }) => !TONAL.includes(id)))('$label tonality', ({ id, variant }) => {
  const audio = renderCached(id, variant);

  it('has no steady tone or hum in its middle half second', () => {
    const mid = (audio.channels[0] as Float32Array).length / audio.sampleRate / 2;
    const window = windowOf(audio, Math.max(0, mid - 0.25), mid + 0.25);
    expect(maxLineProminenceDb(window, audio.sampleRate, 60, Math.min(6000, audio.sampleRate * 0.4), 10)).toBeLessThan(16);
  });
});

describe.each(ONE_SHOTS)('$label one-shot edges', ({ id, variant }) => {
  const audio = renderCached(id, variant);

  it('starts and ends at silence', () => {
    for (const channel of audio.channels) {
      expect(Math.abs(channel[0] as number)).toBeLessThan(1e-3);
      expect(Math.abs(channel[channel.length - 1] as number)).toBeLessThan(1e-3);
    }
  });
});

describe.each(LOOPS)('$label loop seam', ({ id, variant }) => {
  const audio = renderCached(id, variant);

  it('wraps no harder than a typical adjacent-sample step, per channel', () => {
    for (const channel of audio.channels) {
      const steps = sortedSteps(channel);
      const typical = steps[Math.floor(steps.length * 0.99)] as number;
      const wrap = Math.abs((channel[0] as number) - (channel[channel.length - 1] as number));
      expect(wrap).toBeLessThanOrEqual(typical);
    }
  });
});

describe('variants', () => {
  it.each(IDS.filter((id) => SYNTH_RECIPES[id].variants > 1))('%s variants differ from each other', (id) => {
    const variants = SYNTH_RECIPES[id].variants;
    for (let a = 0; a < variants; a++) {
      for (let b = a + 1; b < variants; b++) expect(sameSamples(renderCached(id, a), renderCached(id, b))).toBe(false);
    }
  });

  it('thunder arrangements differ in length', () => {
    const lengths = [0, 1, 2].map((v) => (renderCached('thunder', v).channels[0] as Float32Array).length);
    expect(new Set(lengths).size).toBe(3);
  });

  it('stereo recipes use decorrelated channels', () => {
    const correlation = (a: Float32Array, b: Float32Array): number => {
      let cross = 0;
      let powerA = 0;
      let powerB = 0;
      for (let i = 0; i < a.length; i++) {
        cross += (a[i] as number) * (b[i] as number);
        powerA += (a[i] as number) ** 2;
        powerB += (b[i] as number) ** 2;
      }
      return cross / Math.sqrt(powerA * powerB);
    };
    for (const { id, variant } of CASES.filter(({ id: recipe, variant: v }) => renderCached(recipe, v).channels.length === 2)) {
      const { channels } = renderCached(id, variant);
      expect(Math.abs(correlation(channels[0] as Float32Array, channels[1] as Float32Array)), `${id}#${variant}`).toBeLessThan(0.5);
    }
  });
});

describe('loop modulators', () => {
  const whole = (value: number): boolean => Number.isInteger(value);

  it('wind, rain and siren modulate in whole cycles per loop', () => {
    expect(WIND_CONFIG.bands.every((b) => whole(b.gustCycles) && whole(b.driftCycles))).toBe(true);
    expect(whole(WIND_CONFIG.swellCycles)).toBe(true);
    expect(whole(RAIN_LIGHT_CONFIG.swellCycles) && whole(RAIN_HEAVY_CONFIG.swellCycles)).toBe(true);
    expect(whole(SIREN_CONFIG.vibratoCycles)).toBe(true);
  });

  it('machinery holds a whole number of firings per layer, near 22-26 Hz', () => {
    for (const layer of MACHINERY_CONFIG.layers) {
      expect(whole(layer.firings)).toBe(true);
      expect(whole(layer.driftCycles)).toBe(true);
      const rate = layer.firings / MACHINERY_CONFIG.durationSec;
      expect(rate).toBeGreaterThanOrEqual(22);
      expect(rate).toBeLessThanOrEqual(26);
    }
    expect(new Set(MACHINERY_CONFIG.layers.map((l) => l.firings)).size).toBe(MACHINERY_CONFIG.layers.length);
  });
});
