// BlastSimulator2026 — AudioEngine facade tests
// Real AudioManager, SampleBank, SynthBank and SoundPlayer on a fake AudioContext;
// bytes, recipes and clocks are injected.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { AudioEngine, type AudioEngineOptions } from '../../../src/audio/AudioEngine.js';
import { AudioManager } from '../../../src/audio/AudioManager.js';
import { NULL_AUDIO_PLAYER } from '../../../src/audio/AudioPlayer.js';
import type { SoundDefinition } from '../../../src/audio/SoundCatalog.js';
import type { RenderedAudio, SynthRecipe } from '../../../src/audio/synth/types.js';
import { SAMPLE_BANK_CONFIG } from '../../../src/core/config/audio/engine.js';
import { Random } from '../../../src/core/math/Random.js';
import { FakeAudioContext, FakeConvolver, asAudioContext } from '../../helpers/audioFakes.js';

const CATALOG = {
  ui_click: { bus: 'ui', source: { kind: 'sample', files: ['click_a', 'click_b'] }, gainDb: 0, priority: 2 },
  blast_boom: { bus: 'effects', source: { kind: 'sample', files: ['boom'] }, gainDb: 0, priority: 4 },
  work_dig: { bus: 'effects', source: { kind: 'sample', files: ['dig'] }, gainDb: 0, priority: 1 },
  thunder: { bus: 'ambient', source: { kind: 'synth', recipe: 'thunder' }, gainDb: 0, priority: 2 },
  amb_wind: { bus: 'ambient', source: { kind: 'synth', recipe: 'wind_bed' }, gainDb: 0, priority: 1, loop: true },
} as const satisfies Record<string, SoundDefinition>;

const tone = (length = 16, channels = 1): RenderedAudio => ({
  sampleRate: 44100,
  channels: Array.from({ length: channels }, () => new Float32Array(length).fill(0.1)),
});
const recipe = (loop = false): SynthRecipe => ({ variants: 2, loop, render: () => tone() });

interface Rig {
  ctx: FakeAudioContext;
  manager: AudioManager;
  engine: AudioEngine;
  fetched: string[];
  readyAtFetch: Map<string, boolean>;
}

function rig(over: Partial<AudioEngineOptions> = {}, fail: string[] = []): Rig {
  const ctx = new FakeAudioContext();
  const manager = new AudioManager({ createContext: () => asAudioContext(ctx), document: null });
  const fetched: string[] = [];
  const readyAtFetch = new Map<string, boolean>();
  let engine!: AudioEngine; // the byte source reads `ready` before the constructor returns
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    fetched.push(url);
    readyAtFetch.set(url, engine.ready);
    await Promise.resolve();
    if (fail.some(name => url.includes(name))) throw new Error('missing');
    return new ArrayBuffer(4);
  };
  engine = new AudioEngine(manager, {
    random: new Random(3),
    catalog: CATALOG,
    fetchBytes,
    recipes: { thunder: recipe(), wind_bed: recipe(true) },
    renderImpulse: () => tone(32, 2),
    sleep: async () => undefined,
    ...over,
  });
  return { ctx, manager, engine, fetched, readyAtFetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AudioEngine without a context', () => {
  it('is a safe no-op and never becomes ready', async () => {
    const manager = new AudioManager({ createContext: () => { throw new Error('none'); } });
    const engine = new AudioEngine(manager, { random: new Random(1), catalog: CATALOG });
    const progress = vi.fn();
    await expect(engine.preload(progress)).resolves.toBeUndefined();
    expect(progress).not.toHaveBeenCalled();
    expect(engine.ready).toBe(false);
    expect(engine.play('ui_click')).toBeNull();
    const bed = engine.loop('amb_wind');
    expect(bed).toBe(NULL_AUDIO_PLAYER.loop('amb_wind'));
    bed.setLevel(1);
    expect(() => {
      engine.duck('ambient', -6, 1, 1);
      engine.setListener({ x: 0, z: 0, rightX: 1, rightZ: 0, viewDistance: 20 });
      engine.dispose();
    }).not.toThrow();
  });
});

describe('AudioEngine preload', () => {
  it('drops sounds until the first tier is decoded', async () => {
    const { engine } = rig();
    expect(engine.ready).toBe(false);
    expect(engine.play('ui_click')).toBeNull();
    await engine.preload();
    expect(engine.ready).toBe(true);
    expect(engine.play('ui_click')).not.toBeNull();
  });

  it('loads interface and blast samples first, other samples next, synth last', async () => {
    const { engine, fetched, readyAtFetch, ctx } = rig();
    await engine.preload();
    expect(fetched.slice(0, 3).sort()).toEqual(['/audio/sfx/boom.mp3', '/audio/sfx/click_a.mp3', '/audio/sfx/click_b.mp3']);
    expect(fetched[3]).toBe('/audio/sfx/dig.mp3');
    expect(readyAtFetch.get('/audio/sfx/click_a.mp3')).toBe(false);
    expect(readyAtFetch.get('/audio/sfx/dig.mp3')).toBe(true);
    expect(ctx.all<FakeConvolver>('convolver')[0]!.buffer).not.toBeNull();
  });

  it('renders the synth sounds so they can play', async () => {
    const { engine } = rig();
    expect(engine.play('thunder')).toBeNull();
    await engine.preload();
    expect(engine.play('thunder')).not.toBeNull();
  });

  it('reports progress up to the total', async () => {
    const { engine } = rig();
    const calls: Array<[number, number]> = [];
    await engine.preload((done, total) => calls.push([done, total]));
    // 3 essential + 1 other samples, 2 recipes, 1 impulse
    expect(calls.at(-1)).toEqual([7, 7]);
    expect(calls.map(c => c[0])).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('is idempotent: the second call is the first call', async () => {
    const { engine, fetched } = rig();
    const first = engine.preload();
    const second = engine.preload();
    expect(second).toBe(first);
    await first;
    expect(fetched).toHaveLength(4);
  });

  it('never rejects, even when every file and recipe fails', async () => {
    const { engine, manager } = rig(
      {
        recipes: { thunder: { variants: 1, loop: false, render: () => { throw new Error('x'); } } },
        renderImpulse: () => { throw new Error('y'); },
      },
      ['click', 'boom', 'dig'],
    );
    await expect(engine.preload()).resolves.toBeUndefined();
    expect(engine.ready).toBe(true);
    expect(engine.play('ui_click')).toBeNull();
    expect(engine.play('thunder')).toBeNull();
    expect(manager.context).not.toBeNull();
  });

  it('plays the samples that did load when others failed', async () => {
    const { engine } = rig({}, ['click_a']);
    await engine.preload();
    expect(engine.play('ui_click')).not.toBeNull();
  });

  it('swallows an unexpected error in the loading pipeline', async () => {
    const { engine, manager } = rig({ renderImpulse: () => tone(8, 2) });
    vi.spyOn(manager, 'setReverbImpulse').mockImplementation(() => { throw new Error('boom'); });
    await expect(engine.preload()).resolves.toBeUndefined();
  });

  it('records an unexpected pipeline error in failedAssets instead of hiding it', async () => {
    const { engine, manager } = rig({ renderImpulse: () => tone(8, 2) });
    vi.spyOn(manager, 'setReverbImpulse').mockImplementation(() => { throw new Error('boom'); });
    expect(engine.failedAssets).toEqual([]);
    await engine.preload();
    expect(engine.failedAssets).toContain('preload');
    expect(engine.preloaded).toBe(true);
  });

  it('retries a failed sample once before recording it, and uses the retry when it succeeds', async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const { engine } = rig({
      sleep: async (ms) => { sleeps.push(ms); },
      fetchBytes: async (url) => {
        if (url.includes('click_a') && ++attempts === 1) throw new Error('flaky');
        return new ArrayBuffer(4);
      },
    });
    await engine.preload();
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([SAMPLE_BANK_CONFIG.retryBackoffMs]);
    expect(engine.failedAssets).toEqual([]);
  });

  it('reads the asset base from the options', async () => {
    const { engine, fetched } = rig({ assetBase: '/cdn/sfx/' });
    await engine.preload();
    expect(fetched.every(u => u.startsWith('/cdn/sfx/'))).toBe(true);
  });

  it('starts a bed that was asked for before its buffer was rendered', async () => {
    const { engine, ctx } = rig();
    const wind = engine.loop('amb_wind');
    wind.setLevel(0.6);
    expect(ctx.sources()).toHaveLength(0);
    await engine.preload();
    expect(ctx.sources().filter(s => s.loop)).toHaveLength(1);
  });

  it('yields to the event loop between render slices', async () => {
    let clock = 0;
    const yields = vi.fn(async () => undefined);
    const { engine } = rig({ now: () => (clock += 100), yieldToEventLoop: yields });
    await engine.preload();
    expect(yields).toHaveBeenCalled();
  });

  it('falls back to a macrotask yield when none is injected', async () => {
    let clock = 0;
    const { engine } = rig({ now: () => (clock += 100) });
    await engine.preload();
    expect(engine.play('thunder')).not.toBeNull();
  });
});

describe('AudioEngine defaults', () => {
  it('fetches over HTTP and decodes with the context', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes('dig')
        ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
        : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
    }));
    const ctx = new FakeAudioContext();
    const manager = new AudioManager({ createContext: () => asAudioContext(ctx), document: null });
    const engine = new AudioEngine(manager, {
      random: new Random(1),
      catalog: CATALOG,
      recipes: {},
      renderImpulse: () => tone(),
    });
    await engine.preload();
    expect(calls).toContain('/audio/sfx/click_a.mp3');
    expect(engine.play('ui_click')).not.toBeNull();
    expect(engine.play('work_dig')).toBeNull();
  });

  it('uses the real catalog by default and survives total load failure', async () => {
    const ctx = new FakeAudioContext();
    const manager = new AudioManager({ createContext: () => asAudioContext(ctx), document: null });
    const engine = new AudioEngine(manager, {
      random: new Random(1),
      fetchBytes: async () => { throw new Error('offline'); },
      sleep: async () => undefined,
      recipes: {},
      renderImpulse: () => { throw new Error('none'); },
    });
    await expect(engine.preload()).resolves.toBeUndefined();
    expect(engine.play('ui_click')).toBeNull();
  });
});

describe('AudioEngine as an AudioPlayer', () => {
  it('forwards ducks, listener and dispose to the player', async () => {
    const { engine, ctx } = rig();
    await engine.preload();
    engine.setListener({ x: 0, z: 0, rightX: 1, rightZ: 0, viewDistance: 30 });
    engine.duck('ambient', -12, 1, 1);
    const handle = engine.play('ui_click')!;
    expect(handle).not.toBeNull();
    engine.dispose();
    expect(ctx.sources().every(s => s.stops.length === 1)).toBe(true);
  });
});
