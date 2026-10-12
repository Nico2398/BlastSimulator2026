import { describe, it, expect } from 'vitest';
import type { Listener } from '../../../../src/audio/AudioPlayer.js';
import { SOUND_CATALOG, type SoundBus, type SoundDefinition, type SynthRecipeId } from '../../../../src/audio/SoundCatalog.js';
import { SoundPlayer, type BufferLibrary, type PlayerMixer } from '../../../../src/audio/engine/SoundPlayer.js';
import { centsToRate, dbToGain } from '../../../../src/audio/engine/units.js';
import { SPATIAL_CONFIG, VOICE_CONFIG } from '../../../../src/core/config/audio/engine.js';
import type { Random } from '../../../../src/core/math/Random.js';
import { Random as SeededRandom } from '../../../../src/core/math/Random.js';
import {
  FakeAudioContext, FakeBiquad, FakeGain, FakePanner, FakeSource, asAudioContext, asNode, fakeBuffer,
} from '../../../helpers/audioFakes.js';

class FakeMixer implements PlayerMixer {
  readonly buses = new Map<SoundBus, FakeGain>();
  readonly reverbs = new Map<SoundBus, FakeGain>();
  readonly ducks: unknown[][] = [];
  constructor(private readonly ctx: FakeAudioContext) {}
  busInput(bus: SoundBus): AudioNode {
    if (!this.buses.has(bus)) this.buses.set(bus, new FakeGain(this.ctx));
    return asNode(this.buses.get(bus)!);
  }
  reverbInput(bus: SoundBus): AudioNode {
    if (!this.reverbs.has(bus)) this.reverbs.set(bus, new FakeGain(this.ctx));
    return asNode(this.reverbs.get(bus)!);
  }
  duck(...args: unknown[]): void { this.ducks.push(args); }
}

/** A Random whose every draw is the same fraction, so jitter extremes are exact. */
function fixedRandom(fraction: number): Random {
  return {
    next: () => fraction,
    nextInt: (min: number, max: number) => Math.min(max, Math.floor(fraction * (max - min + 1)) + min),
    nextFloat: (min: number, max: number) => fraction * (max - min) + min,
  } as unknown as Random;
}

interface Setup {
  ctx: FakeAudioContext;
  mixer: FakeMixer;
  player: SoundPlayer;
  loaded: Map<string, AudioBuffer>;
  rendered: Map<SynthRecipeId, AudioBuffer[]>;
  advance(ms: number): void;
}

const LISTENER: Listener = { x: 0, z: 0, rightX: 1, rightZ: 0, viewDistance: 30 };

function setup(over: Partial<Record<string, SoundDefinition>> = {}, random: Random = new SeededRandom(7), ready = true): Setup {
  const ctx = new FakeAudioContext();
  const mixer = new FakeMixer(ctx);
  const loaded = new Map<string, AudioBuffer>();
  const rendered = new Map<SynthRecipeId, AudioBuffer[]>();
  let clock = 1000;
  const library: BufferLibrary = { sample: n => loaded.get(n), synth: r => rendered.get(r) ?? [] };
  const player = new SoundPlayer({
    context: asAudioContext(ctx),
    mixer,
    library,
    random,
    catalog: { ...SOUND_CATALOG, ...over } as Record<string, SoundDefinition>,
    now: () => clock,
    isReady: () => ready,
  });
  return { ctx, mixer, player, loaded, rendered, advance: ms => { clock += ms; } };
}

const sampleDef = (files: string[], over: Partial<SoundDefinition> = {}): SoundDefinition => ({
  bus: 'effects', source: { kind: 'sample', files }, gainDb: 0, priority: 2, ...over,
});

function loadAll(s: Setup, names: string[], seconds = 0.5): void {
  for (const name of names) s.loaded.set(name, fakeBuffer(seconds));
}

/** The gain node a one-shot source feeds (no spatial stage). */
const gainOf = (source: FakeSource): FakeGain => source.outputs[0] as FakeGain;

describe('SoundPlayer basics', () => {
  it('drops sounds whose assets are not loaded', () => {
    const s = setup();
    expect(s.player.play('ui_click')).toBeNull();
    expect(s.ctx.nodes).toHaveLength(0);
  });

  it('drops unknown ids and loop ids passed to play', () => {
    const s = setup();
    loadAll(s, ['ui_click_1']);
    expect(s.player.play('nope' as never)).toBeNull();
    expect(s.player.play('amb_wind' as never)).toBeNull();
  });

  it('plays a loaded sample non-positionally at the catalog gain through the sound bus', () => {
    const s = setup({ ui_click: sampleDef(['k1'], { bus: 'ui', gainDb: -6 }) });
    loadAll(s, ['k1']);
    s.ctx.currentTime = 2;
    const handle = s.player.play('ui_click');
    expect(handle).not.toBeNull();
    const [source] = s.ctx.sources();
    expect(source!.buffer).toBe(s.loaded.get('k1'));
    expect(source!.playbackRate.value).toBe(1);
    expect(source!.loop).toBe(false);
    expect(source!.starts).toEqual([{ when: 2, offset: undefined }]);
    const gain = gainOf(source!);
    expect(gain.gain.value).toBeCloseTo(dbToGain(-6), 10);
    expect(gain.outputs).toEqual([s.mixer.buses.get('ui')]);
  });

  it('starts delayed sounds on the audio clock', () => {
    const s = setup({ ui_click: sampleDef(['k1']) });
    loadAll(s, ['k1']);
    s.ctx.currentTime = 5;
    s.player.play('ui_click', { delayS: 0.75 });
    s.player.play('ui_click', { delayS: -3, key: 'again' });
    expect(s.ctx.sources().map(n => n.starts[0]!.when)).toEqual([5.75, 5]);
  });

  it('reports ready from its host', () => {
    expect(setup({}, new SeededRandom(1), true).player.ready).toBe(true);
    expect(setup({}, new SeededRandom(1), false).player.ready).toBe(false);
  });

  it('routes a bus override to the other bus', () => {
    const s = setup({ ui_click: sampleDef(['k1'], { bus: 'ui' }) });
    loadAll(s, ['k1']);
    s.player.play('ui_click', { bus: 'ambient' });
    expect(gainOf(s.ctx.sources()[0]!).outputs).toEqual([s.mixer.buses.get('ambient')]);
    expect(s.mixer.buses.has('ui')).toBe(false);
  });

  it('adds the caller gain and pitch to the catalog values', () => {
    const s = setup({ ui_click: sampleDef(['k1'], { gainDb: -6 }) });
    loadAll(s, ['k1']);
    s.player.play('ui_click', { gainDb: 3, pitchCents: 1200 });
    const source = s.ctx.sources()[0]!;
    expect(gainOf(source).gain.value).toBeCloseTo(dbToGain(-3), 10);
    expect(source.playbackRate.value).toBeCloseTo(2, 10);
  });

  it('clamps an extreme pitch shift', () => {
    const s = setup({ ui_click: sampleDef(['k1']) });
    loadAll(s, ['k1']);
    s.player.play('ui_click', { pitchCents: 1e6 });
    expect(s.ctx.sources()[0]!.playbackRate.value).toBeCloseTo(centsToRate(VOICE_CONFIG.maxPitchCents), 10);
  });

  it('forwards ducks to the mixer', () => {
    const s = setup();
    s.player.duck('ambient', -12, 1, 2);
    expect(s.mixer.ducks).toEqual([['ambient', -12, 1, 2]]);
  });
});

describe('SoundPlayer variation', () => {
  it('never plays the same file twice in a row', () => {
    const s = setup({ ui_click: sampleDef(['a', 'b', 'c'], { cooldownMs: 0 }) });
    loadAll(s, ['a', 'b', 'c']);
    const picks: unknown[] = [];
    for (let i = 0; i < 60; i++) {
      s.player.play('ui_click');
      picks.push(s.ctx.sources()[i]!.buffer);
      s.ctx.sources()[i]!.end();
    }
    for (let i = 1; i < picks.length; i++) expect(picks[i] === picks[i - 1]).toBe(false);
    expect(new Set(picks).size).toBe(3);
  });

  it('repeats a single-file sound', () => {
    const s = setup({ ui_click: sampleDef(['only']) });
    loadAll(s, ['only']);
    s.player.play('ui_click');
    s.advance(1);
    s.player.play('ui_click', { key: 'x' });
    expect(s.ctx.sources()).toHaveLength(2);
  });

  it('chooses among the files that are loaded', () => {
    const s = setup({ ui_click: sampleDef(['a', 'missing', 'c']) });
    loadAll(s, ['a', 'c']);
    for (let i = 0; i < 10; i++) s.player.play('ui_click', { key: `k${i}` });
    const buffers = new Set(s.ctx.sources().map(n => n.buffer));
    expect(buffers).toEqual(new Set([s.loaded.get('a'), s.loaded.get('c')]));
  });

  it('cycles the rendered variants of a synth sound', () => {
    const s = setup({ blast_beep: { bus: 'effects', source: { kind: 'synth', recipe: 'blast_beep' }, gainDb: 0, priority: 4 } });
    s.rendered.set('blast_beep', [fakeBuffer(), fakeBuffer()]);
    for (let i = 0; i < 6; i++) s.player.play('blast_beep');
    const sources = s.ctx.sources();
    for (let i = 1; i < sources.length; i++) expect(sources[i]!.buffer === sources[i - 1]!.buffer).toBe(false);
  });

  it('drops a synth sound until its recipe is rendered', () => {
    const s = setup();
    expect(s.player.play('blast_beep')).toBeNull();
  });

  it('keeps pitch and level jitter within the catalog bounds', () => {
    const def = sampleDef(['a'], { pitchJitterCents: 100, gainJitterDb: 4, gainDb: -2 });
    for (const fraction of [0, 0.25, 0.5, 0.999]) {
      const s = setup({ ui_click: def }, fixedRandom(fraction));
      loadAll(s, ['a']);
      s.player.play('ui_click');
      const source = s.ctx.sources()[0]!;
      expect(source.playbackRate.value).toBeGreaterThanOrEqual(centsToRate(-100) - 1e-12);
      expect(source.playbackRate.value).toBeLessThanOrEqual(centsToRate(100) + 1e-12);
      expect(gainOf(source).gain.value).toBeGreaterThanOrEqual(dbToGain(-2 - 4) - 1e-12);
      expect(gainOf(source).gain.value).toBeLessThanOrEqual(dbToGain(-2 + 4) + 1e-12);
    }
  });

  it('reaches both extremes of the jitter range', () => {
    const def = sampleDef(['a'], { pitchJitterCents: 100 });
    const low = setup({ ui_click: def }, fixedRandom(0));
    loadAll(low, ['a']);
    low.player.play('ui_click');
    expect(low.ctx.sources()[0]!.playbackRate.value).toBeCloseTo(centsToRate(-100), 10);
    const high = setup({ ui_click: def }, fixedRandom(1));
    loadAll(high, ['a']);
    high.player.play('ui_click');
    expect(high.ctx.sources()[0]!.playbackRate.value).toBeCloseTo(centsToRate(100), 10);
  });

  it('draws no randomness for a sound with a single file and no jitter', () => {
    let draws = 0;
    const counting = { next: () => { draws++; return 0.5; }, nextInt: () => { draws++; return 0; }, nextFloat: () => { draws++; return 0; } } as unknown as Random;
    const s = setup({ ui_click: sampleDef(['a']) }, counting);
    loadAll(s, ['a']);
    s.player.play('ui_click');
    expect(draws).toBe(0);
  });
});

describe('SoundPlayer rate limiting', () => {
  it('drops a play inside the cooldown, using real time rather than audio time', () => {
    const s = setup({ ui_click: sampleDef(['a'], { cooldownMs: 100 }) });
    loadAll(s, ['a']);
    expect(s.player.play('ui_click')).not.toBeNull();
    s.ctx.currentTime += 10;
    expect(s.player.play('ui_click')).toBeNull();
    s.advance(100);
    expect(s.player.play('ui_click')).not.toBeNull();
  });

  it('plays two keys of the same sound side by side', () => {
    const s = setup({ ui_click: sampleDef(['a'], { cooldownMs: 100, maxVoices: 4 }) });
    loadAll(s, ['a']);
    expect(s.player.play('ui_click', { key: 'truck-1' })).not.toBeNull();
    expect(s.player.play('ui_click', { key: 'truck-2' })).not.toBeNull();
    expect(s.player.play('ui_click', { key: 'truck-1' })).toBeNull();
  });

  it('caps concurrent voices of a sound and reopens the slot when a voice ends', () => {
    const s = setup({ ui_click: sampleDef(['a'], { maxVoices: 2 }) });
    loadAll(s, ['a']);
    expect(s.player.play('ui_click')).not.toBeNull();
    expect(s.player.play('ui_click')).not.toBeNull();
    expect(s.player.play('ui_click')).toBeNull();
    s.ctx.sources()[0]!.end();
    expect(s.player.play('ui_click')).not.toBeNull();
  });

  it('lets a high-priority sound steal the oldest low-priority voice when the global cap is full', () => {
    const s = setup({
      debris_hit: sampleDef(['a'], { priority: 1 }),
      blast_boom: sampleDef(['boom'], { priority: 4 }),
    });
    loadAll(s, ['a', 'boom']);
    for (let i = 0; i < VOICE_CONFIG.globalVoiceCap; i++) expect(s.player.play('debris_hit')).not.toBeNull();
    expect(s.player.play('debris_hit')).toBeNull();
    const boom = s.player.play('blast_boom');
    expect(boom).not.toBeNull();
    const [oldest] = s.ctx.sources();
    expect(oldest!.stops).toHaveLength(1);
    expect(gainOf(oldest!).gain.scheduled.at(-1)).toMatchObject({ type: 'linear', value: 0 });
    // the other debris voices keep playing
    expect(s.ctx.sources()[1]!.stops).toHaveLength(0);
  });
});

describe('SoundPlayer spatial', () => {
  const spatialDef = sampleDef(['a'], { spatial: true, cooldownMs: 0, maxVoices: 8 });

  it('builds lowpass and pan stages for a positional sound with a listener', () => {
    const s = setup({ building_built: spatialDef });
    loadAll(s, ['a']);
    s.player.setListener(LISTENER);
    s.player.play('building_built', { at: { x: 20, z: 5 } });
    const source = s.ctx.sources()[0]!;
    const lowpass = source.outputs[0] as FakeBiquad;
    const pan = lowpass.outputs[0] as FakePanner;
    const gain = pan.outputs[0] as FakeGain;
    expect(lowpass.kind).toBe('biquad');
    expect(lowpass.type).toBe('lowpass');
    expect(lowpass.Q.value).toBe(SPATIAL_CONFIG.lowpassQ);
    expect(lowpass.frequency.value).toBeLessThan(SPATIAL_CONFIG.lowpassMaxHz);
    expect(pan.pan.value).toBeGreaterThan(0.5);
    expect(gain.gain.value).toBeLessThanOrEqual(1);
    expect(gain.outputs).toEqual([s.mixer.buses.get('effects')]);
  });

  it('plays a nearer source louder and pans left sources left', () => {
    const s = setup({ building_built: spatialDef });
    loadAll(s, ['a']);
    s.player.setListener(LISTENER);
    s.player.play('building_built', { at: { x: -10, z: 0 }, key: 'near' });
    s.player.play('building_built', { at: { x: -60, z: 0 }, key: 'far' });
    const [near, far] = s.ctx.sources().map(src => src.outputs[0]!.outputs[0] as FakePanner);
    expect(near!.pan.value).toBeLessThan(0);
    expect((near!.outputs[0] as FakeGain).gain.value).toBeGreaterThan((far!.outputs[0] as FakeGain).gain.value);
  });

  it('drops a culled source before it takes a voice or a cooldown', () => {
    const s = setup({ building_built: { ...spatialDef, cooldownMs: 1000 } });
    loadAll(s, ['a']);
    s.player.setListener(LISTENER);
    expect(s.player.play('building_built', { at: { x: 5000, z: 0 } })).toBeNull();
    expect(s.ctx.nodes).toHaveLength(0);
    expect(s.player.play('building_built', { at: { x: 5, z: 0 } })).not.toBeNull();
  });

  it('plays flat when there is no listener, no position, or the sound is not spatial', () => {
    const s = setup({ building_built: spatialDef, ui_click: sampleDef(['a'], { cooldownMs: 0 }) });
    loadAll(s, ['a']);
    s.player.play('building_built', { at: { x: 5000, z: 0 }, key: '1' });
    s.player.setListener(LISTENER);
    s.player.play('building_built', { key: '2' });
    s.player.play('ui_click', { at: { x: 5, z: 0 } });
    expect(s.ctx.all('biquad')).toHaveLength(0);
    expect(s.ctx.all('panner')).toHaveLength(0);
    expect(s.ctx.sources()).toHaveLength(3);
    for (const source of s.ctx.sources()) expect(gainOf(source).gain.value).toBe(1);
  });
});

describe('SoundPlayer reverb send', () => {
  it('adds a send into the reverb bus of the sound bus when reverbSend > 0', () => {
    const s = setup({ building_demolished: sampleDef(['a'], { reverbSend: 0.4, bus: 'effects' }) });
    loadAll(s, ['a']);
    s.player.play('building_demolished');
    const gain = gainOf(s.ctx.sources()[0]!);
    const send = gain.outputs.find(n => n !== s.mixer.buses.get('effects')) as FakeGain;
    expect(send.gain.value).toBe(0.4);
    expect(send.outputs).toEqual([s.mixer.reverbs.get('effects')]);
  });

  it('adds no send for a dry sound', () => {
    const s = setup({ ui_click: sampleDef(['a']) });
    loadAll(s, ['a']);
    s.player.play('ui_click');
    expect(gainOf(s.ctx.sources()[0]!).outputs).toHaveLength(1);
    expect(s.mixer.reverbs.size).toBe(0);
  });
});

describe('SoundPlayer stopping', () => {
  it('stop fades to silence over the default fade, then stops the source', () => {
    const s = setup({ ui_click: sampleDef(['a']) });
    loadAll(s, ['a']);
    s.ctx.currentTime = 3;
    const handle = s.player.play('ui_click')!;
    handle.stop();
    const source = s.ctx.sources()[0]!;
    const events = gainOf(source).gain.events;
    expect(events.map(e => e.type).slice(-3)).toEqual(['cancel', 'set', 'linear']);
    expect(events.at(-1)).toMatchObject({ value: 0, time: 3 + VOICE_CONFIG.defaultStopFadeS });
    expect(source.stops).toEqual([3 + VOICE_CONFIG.defaultStopFadeS + VOICE_CONFIG.stopMarginS]);
  });

  it('honours a custom fade and ignores a second stop', () => {
    const s = setup({ ui_click: sampleDef(['a']) });
    loadAll(s, ['a']);
    const handle = s.player.play('ui_click')!;
    handle.stop(0.5);
    handle.stop(0.5);
    const source = s.ctx.sources()[0]!;
    expect(source.stops).toHaveLength(1);
    expect(gainOf(source).gain.events.at(-1)).toMatchObject({ value: 0, time: 0.5 });
  });

  it('frees the voice slot at once on stop, and again safely when the source ends', () => {
    const s = setup({ ui_click: sampleDef(['a'], { maxVoices: 1 }) });
    loadAll(s, ['a']);
    const handle = s.player.play('ui_click')!;
    expect(s.player.play('ui_click')).toBeNull();
    handle.stop();
    expect(s.player.play('ui_click')).not.toBeNull();
    s.ctx.sources()[0]!.end();
    s.ctx.sources()[0]!.end();
    expect(s.player.play('ui_click')).toBeNull();
  });

  it('disconnects a voice when its source ends', () => {
    const s = setup({ ui_click: sampleDef(['a']) });
    loadAll(s, ['a']);
    s.player.play('ui_click');
    s.ctx.sources()[0]!.end();
    for (const node of s.ctx.nodes) expect(node.disconnected).toBe(true);
  });

  it('survives a stop() that the source rejects', () => {
    const s = setup({ ui_click: sampleDef(['a']) });
    loadAll(s, ['a']);
    const handle = s.player.play('ui_click')!;
    s.ctx.sources()[0]!.stop = () => { throw new Error('InvalidStateError'); };
    expect(() => handle.stop()).not.toThrow();
  });

  it('stops a voice whose fade is NaN or Infinity as if it had no fade, with finite automation', () => {
    const s = setup({ ui_click: sampleDef(['a'], { maxVoices: 3, cooldownMs: 0 }) });
    loadAll(s, ['a']);
    s.ctx.currentTime = 3;
    for (const fade of [Number.NaN, Infinity, -Infinity, -2]) {
      s.player.play('ui_click')!.stop(fade);
    }
    for (const source of s.ctx.sources()) {
      expect(source.stops).toEqual([3 + VOICE_CONFIG.stopMarginS]);
      for (const event of gainOf(source).gain.events) {
        expect(Number.isFinite(event.time)).toBe(true);
        expect(Number.isFinite(event.value)).toBe(true);
      }
    }
  });

  it('returns null and frees the slot when the graph cannot be built', () => {
    const s = setup({ ui_click: sampleDef(['a'], { maxVoices: 1 }) });
    loadAll(s, ['a']);
    s.ctx.failNodeCreation = true;
    expect(s.player.play('ui_click')).toBeNull();
    s.ctx.failNodeCreation = false;
    expect(s.player.play('ui_click')).not.toBeNull();
  });

  it('dispose stops every playing voice', () => {
    const s = setup({ ui_click: sampleDef(['a'], { maxVoices: 3, cooldownMs: 0 }) });
    loadAll(s, ['a']);
    s.player.play('ui_click');
    s.player.play('ui_click');
    s.player.dispose();
    for (const source of s.ctx.sources()) expect(source.stops).toHaveLength(1);
  });
});

describe('SoundPlayer loops', () => {
  const bed = (): Partial<Record<string, SoundDefinition>> => ({
    amb_wind: { bus: 'ambient', source: { kind: 'synth', recipe: 'wind_bed' }, gainDb: -6, priority: 1, loop: true },
  });

  it('plays nothing until the level first rises above zero', () => {
    const s = setup(bed());
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    const handle = s.player.loop('amb_wind');
    expect(s.ctx.sources()).toHaveLength(0);
    handle.setLevel(0);
    expect(s.ctx.sources()).toHaveLength(0);
  });

  it('returns the same handle for the same bed', () => {
    const s = setup(bed());
    expect(s.player.loop('amb_wind')).toBe(s.player.loop('amb_wind'));
  });

  it('starts a looping source on the ambient bus and ramps its level', () => {
    const s = setup(bed());
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    s.ctx.currentTime = 10;
    s.player.loop('amb_wind').setLevel(0.5, 2);
    const [source] = s.ctx.sources();
    expect(source!.loop).toBe(true);
    expect(source!.starts).toHaveLength(1);
    expect(source!.starts[0]!.when).toBe(10);
    expect(source!.starts[0]!.offset).toBeGreaterThanOrEqual(0);
    expect(source!.starts[0]!.offset).toBeLessThan(4);
    const gain = gainOf(source!);
    expect(gain.outputs).toEqual([s.mixer.buses.get('ambient')]);
    expect(gain.gain.value).toBe(0);
    expect(gain.gain.events.at(-1)).toMatchObject({ type: 'linear', time: 12 });
    expect(gain.gain.events.at(-1)!.value).toBeCloseTo(0.5 * dbToGain(-6), 10);
  });

  it('reuses the running voice for level changes', () => {
    const s = setup(bed());
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    const handle = s.player.loop('amb_wind');
    handle.setLevel(0.2);
    handle.setLevel(0.8, 1);
    handle.setLevel(1.7, 1);
    expect(s.ctx.sources()).toHaveLength(1);
    expect(gainOf(s.ctx.sources()[0]!).gain.events.at(-1)!.value).toBeCloseTo(dbToGain(-6), 10);
  });

  it('fades out and releases the voice at level zero, and restarts on the next rise', () => {
    const s = setup(bed());
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    s.ctx.currentTime = 1;
    const handle = s.player.loop('amb_wind');
    handle.setLevel(1);
    handle.setLevel(0, 3);
    const first = s.ctx.sources()[0]!;
    expect(first.stops).toEqual([1 + 3 + VOICE_CONFIG.stopMarginS]);
    expect(gainOf(first).gain.events.at(-1)).toMatchObject({ type: 'linear', value: 0, time: 4 });
    handle.setLevel(0.5);
    expect(s.ctx.sources()).toHaveLength(2);
    first.end();
    expect(s.ctx.sources()[1]!.disconnected).toBe(false);
  });

  it('never fades out faster than the minimum', () => {
    const s = setup(bed());
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    const handle = s.player.loop('amb_wind');
    handle.setLevel(1);
    handle.setLevel(0, 0);
    expect(gainOf(s.ctx.sources()[0]!).gain.events.at(-1)!.time).toBe(VOICE_CONFIG.minLoopRampS);
  });

  it('stop() is a fade to zero', () => {
    const s = setup(bed());
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    const handle = s.player.loop('amb_wind');
    handle.setLevel(1);
    handle.stop(1);
    expect(s.ctx.sources()[0]!.stops).toHaveLength(1);
    handle.stop();
  });

  it('starts at the requested level when given options', () => {
    const s = setup(bed());
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    s.player.loop('amb_wind', { level: 0.3, rampS: 1 });
    expect(s.ctx.sources()).toHaveLength(1);
    s.player.loop('amb_wind');
    expect(s.ctx.sources()).toHaveLength(1);
  });

  it('waits for the buffer, then starts when loops are refreshed', () => {
    const s = setup(bed());
    const handle = s.player.loop('amb_wind');
    handle.setLevel(0.7);
    expect(s.ctx.sources()).toHaveLength(0);
    s.player.refreshLoops();
    expect(s.ctx.sources()).toHaveLength(0);
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    s.player.refreshLoops();
    expect(s.ctx.sources()).toHaveLength(1);
    s.player.refreshLoops();
    expect(s.ctx.sources()).toHaveLength(1);
  });

  it('hands back an inert handle for ids that are not loops', () => {
    const s = setup();
    const handle = s.player.loop('ui_click' as never);
    handle.setLevel(1);
    handle.stop();
    expect(s.ctx.sources()).toHaveLength(0);
  });

  it('ignores a non-finite level', () => {
    const s = setup(bed());
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    const handle = s.player.loop('amb_wind');
    handle.setLevel(Number.NaN);
    expect(s.ctx.sources()).toHaveLength(0);
  });

  it('loses its voice to a higher-priority sound and restarts when a slot frees up', () => {
    const s = setup({
      ...bed(),
      debris_hit: sampleDef(['a'], { priority: 1 }),
      blast_boom: sampleDef(['boom'], { priority: 4 }),
    });
    loadAll(s, ['a', 'boom']);
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    const handle = s.player.loop('amb_wind');
    handle.setLevel(1);
    for (let i = 0; i < VOICE_CONFIG.globalVoiceCap - 1; i++) s.player.play('debris_hit');
    s.player.play('blast_boom');
    const wind = s.ctx.sources()[0]!;
    expect(wind.stops).toHaveLength(1);

    handle.setLevel(0.9);
    expect(s.ctx.sources().filter(n => n.loop)).toHaveLength(1);

    s.ctx.sources()[1]!.end();
    handle.setLevel(0.9);
    expect(s.ctx.sources().filter(n => n.loop)).toHaveLength(2);
  });

  /** A bed stolen at the voice cap: 31 debris voices plus a blast sound fill the cap and evict the oldest, lowest-priority voice. */
  function stealBed(s: Setup): { wind: FakeSource } {
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    loadAll(s, ['a', 'boom']);
    s.player.loop('amb_wind').setLevel(0.8);
    for (let i = 0; i < VOICE_CONFIG.globalVoiceCap - 1; i++) s.player.play('debris_hit');
    s.player.play('blast_boom');
    const wind = s.ctx.sources()[0]!;
    expect(wind.stops).toHaveLength(1);
    return { wind };
  }

  const crowded = (): Partial<Record<string, SoundDefinition>> => ({
    ...bed(),
    debris_hit: sampleDef(['a'], { priority: 1 }),
    blast_boom: sampleDef(['boom'], { priority: 4 }),
  });

  it('bed stolen then restored without a setLevel call', () => {
    const s = setup(crowded());
    s.player.setListener(LISTENER);
    stealBed(s);
    s.ctx.sources()[1]!.end();
    expect(s.ctx.sources().filter(n => n.loop)).toHaveLength(1);

    s.advance(VOICE_CONFIG.loopRearmIntervalMs);
    s.player.setListener(LISTENER);

    const loops = s.ctx.sources().filter(n => n.loop);
    expect(loops).toHaveLength(2);
    expect(gainOf(loops[1]!).gain.events.at(-1)!.value).toBeCloseTo(0.8 * dbToGain(-6), 10);
  });

  it('re-arms lost beds at most once per interval of real time', () => {
    const s = setup(crowded());
    s.player.setListener(LISTENER);
    stealBed(s);
    s.ctx.sources()[1]!.end();

    s.advance(VOICE_CONFIG.loopRearmIntervalMs - 1);
    s.player.setListener(LISTENER);
    expect(s.ctx.sources().filter(n => n.loop)).toHaveLength(1);

    s.advance(1);
    s.player.setListener(LISTENER);
    expect(s.ctx.sources().filter(n => n.loop)).toHaveLength(2);
  });

  it('keeps trying while the cap is still full, and starts the bed once a slot frees up', () => {
    const s = setup(crowded());
    s.player.setListener(LISTENER);
    stealBed(s);

    s.advance(VOICE_CONFIG.loopRearmIntervalMs);
    s.player.setListener(LISTENER);
    expect(s.ctx.sources().filter(n => n.loop)).toHaveLength(1);

    s.ctx.sources()[1]!.end();
    s.advance(VOICE_CONFIG.loopRearmIntervalMs);
    s.player.setListener(LISTENER);
    expect(s.ctx.sources().filter(n => n.loop)).toHaveLength(2);
  });

  it('does not restart a bed whose level is zero', () => {
    const s = setup(crowded());
    s.player.setListener(LISTENER);
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    const handle = s.player.loop('amb_wind');
    handle.setLevel(1);
    handle.setLevel(0);
    s.advance(VOICE_CONFIG.loopRearmIntervalMs);
    s.player.setListener(LISTENER);
    expect(s.ctx.sources().filter(n => n.loop)).toHaveLength(1);
  });

  it('every catalog loop outranks the one-shots that fill the cap, so a newcomer takes a work sound, not the bed', () => {
    for (const [id, def] of Object.entries(SOUND_CATALOG)) {
      if ('loop' in def && def.loop) expect(def.priority, id).toBeGreaterThanOrEqual(3);
    }
    const s = setup({
      debris_hit: sampleDef(['a'], { priority: 1 }),
      ui_click: sampleDef(['c'], { priority: 2 }),
    });
    loadAll(s, ['a', 'c']);
    s.rendered.set('wind_bed', [fakeBuffer(4)]);
    s.player.loop('amb_wind').setLevel(1);
    for (let i = 0; i < VOICE_CONFIG.globalVoiceCap - 1; i++) s.player.play('debris_hit');
    expect(s.player.play('ui_click')).not.toBeNull();
    const [wind, firstDebris] = s.ctx.sources();
    expect(wind!.stops).toHaveLength(0);
    expect(firstDebris!.stops).toHaveLength(1);
  });
});
