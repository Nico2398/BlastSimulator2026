// BlastSimulator2026 — MusicPlayer unit tests
// Fake context, fake elements, fake clock: no browser, no real time.

import { afterEach, describe, it, expect, vi } from 'vitest';
import type { AudioManager } from '../../../../src/audio/AudioManager.js';
import { MUSIC_CONFIG } from '../../../../src/core/config/audio/music.js';
import type { MusicTrack } from '../../../../src/audio/music/MusicCatalog.js';
import { MusicPlayer, type MusicOutput } from '../../../../src/audio/music/MusicPlayer.js';
import { fadeLevelAt } from '../../../../src/audio/music/fadeCurve.js';
import { FakeMusicOutput, FakeElement, recordingFactory, type FakeGainNode } from './fakes.js';

const menu: MusicTrack = { id: 'menu', file: 'menu_theme', scope: { kind: 'menu' } };
const desert: MusicTrack = { id: 'desert', file: 'desert', scope: { kind: 'biome', biomeId: 'desert_badlands' }, gainDb: -6 };
const alpine: MusicTrack = { id: 'alpine', file: 'alpine', scope: { kind: 'biome', biomeId: 'alpine_granite' } };
const stinger: MusicTrack = { id: 'stinger', file: 'stinger', scope: { kind: 'game' }, loop: false };

function make(config = MUSIC_CONFIG) {
  const output = new FakeMusicOutput();
  const factory = recordingFactory();
  const clock = { t: 0 };
  const player = new MusicPlayer(output as unknown as MusicOutput, { createElement: factory.create, clock: () => clock.t, config });
  const ctx = output.context!;
  /** Gain node a given element's source feeds. */
  const gainOf = (element: FakeElement): FakeGainNode => ctx.sources.find(s => s.element === element)!.outputs[0] as FakeGainNode;
  return { output, factory, clock, player, ctx, gainOf };
}

// Compile-time contract: the audio manager can be handed to the player as is.
export const managerIsAMusicOutput = (manager: AudioManager): MusicOutput => manager;

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('starting a track', () => {
  it('streams the file into the music bus through its own gain', () => {
    const { player, factory, output, ctx, gainOf } = make();
    player.setTrack(menu);
    const el = factory.elements[0]!;
    expect(factory.elements).toHaveLength(1);
    expect(el.url).toBe('/audio/music/menu_theme.mp3');
    expect(el.loop).toBe(true);
    expect(el.preload).toBe('auto');
    expect(el.playCalls).toBe(1);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.outputs).toEqual([gainOf(el)]);
    expect(gainOf(el).outputs).toEqual([output.bus]);
  });

  it('fades in from silence over the fade-in time to the track level', () => {
    const { player, factory, gainOf, clock } = make();
    clock.t = 4;
    player.setTrack(desert);
    const gain = gainOf(factory.elements[0]!).gain;
    expect(gain.value).toBe(0);
    expect(gain.cancels).toEqual([4]);
    expect(gain.sets).toEqual([{ value: 0, time: 4 }]);
    const curve = gain.curves[0]!;
    expect(curve.start).toBe(4);
    expect(curve.duration).toBe(MUSIC_CONFIG.fadeInS);
    expect(curve.values).toHaveLength(MUSIC_CONFIG.curvePoints);
    expect(curve.values[0]).toBeCloseTo(0, 6);
    expect(curve.values[curve.values.length - 1]).toBeCloseTo(10 ** (-6 / 20), 5);
  });

  it('honours loop: false', () => {
    const { player, factory } = make();
    player.setTrack(stinger);
    expect(factory.elements[0]!.loop).toBe(false);
  });

  it('leaves the playing track alone when it is selected again', () => {
    const { player, factory } = make();
    player.setTrack(menu);
    player.setTrack(menu);
    expect(factory.elements).toHaveLength(1);
    expect(factory.elements[0]!.playCalls).toBe(1);
  });

  it('takes the fade clock from the audio context by default', () => {
    const output = new FakeMusicOutput();
    output.context!.currentTime = 7;
    const factory = recordingFactory();
    const player = new MusicPlayer(output as unknown as MusicOutput, { createElement: factory.create });
    player.setTrack(menu);
    expect(output.context!.gains[0]!.gain.curves[0]!.start).toBe(7);
  });

  it('builds a real Audio element by default', () => {
    const made: string[] = [];
    vi.stubGlobal('Audio', class {
      loop = false; preload = ''; paused = true;
      constructor(url: string) { made.push(url); }
      play(): Promise<void> { return Promise.resolve(); }
      pause(): void { /* noop */ }
      removeAttribute(): void { /* noop */ }
      load(): void { /* noop */ }
    });
    const output = new FakeMusicOutput();
    const player = new MusicPlayer(output as unknown as MusicOutput);
    player.setTrack(menu);
    expect(made).toEqual(['/audio/music/menu_theme.mp3']);
  });
});

describe('without Web Audio', () => {
  it('is a no-op and never builds an element', () => {
    const output = new FakeMusicOutput(null);
    const factory = recordingFactory();
    const player = new MusicPlayer(output as unknown as MusicOutput, { createElement: factory.create });
    player.setTrack(menu);
    player.setTrack(null);
    player.unlock();
    player.tick();
    player.dispose();
    expect(factory.elements).toHaveLength(0);
  });
});

describe('crossfading', () => {
  it('fades the old track out and the new one in over the crossfade time, then frees the old element', () => {
    const { player, factory, gainOf, clock } = make();
    player.setTrack(menu);
    clock.t = 10;
    player.setTrack(desert);
    const [a, b] = factory.elements as [FakeElement, FakeElement];
    const out = gainOf(a).gain.curves[1]!;
    const into = gainOf(b).gain.curves[0]!;
    expect(out).toMatchObject({ start: 10, duration: MUSIC_CONFIG.crossfadeS });
    expect(into).toMatchObject({ start: 10, duration: MUSIC_CONFIG.crossfadeS });
    expect(out.values[out.values.length - 1]).toBeCloseTo(0, 6);
    // Equal power at every sample: the two curves keep the sum of squares near the target power.
    const target = 10 ** (-6 / 20);
    for (let i = 0; i < out.values.length; i++) {
      expect(out.values[i]! ** 2 + (into.values[i]! / target) ** 2).toBeCloseTo(1, 4);
    }

    clock.t = 10 + MUSIC_CONFIG.crossfadeS - 0.01;
    player.tick();
    expect(a.attributes.has('src')).toBe(true);
    clock.t = 10 + MUSIC_CONFIG.crossfadeS;
    player.tick();
    expect(a.paused).toBe(true);
    expect(a.attributes.has('src')).toBe(false);
    expect(a.loadCalls).toBe(1);
    expect(gainOf(a).disconnected).toBe(true);
    expect(b.pauseCalls).toBe(0);
    player.tick();
    expect(a.pauseCalls).toBe(1);
  });

  it('starts a mid-fade switch from the level the fading track has reached', () => {
    const { player, factory, gainOf, clock } = make();
    player.setTrack(menu);
    clock.t = 100;
    player.setTrack(desert);
    clock.t = 101;
    player.setTrack(alpine);
    const [a, b, c] = factory.elements as [FakeElement, FakeElement, FakeElement];
    const reached = fadeLevelAt({ from: 0, to: 10 ** (-6 / 20), startS: 100, durationS: MUSIC_CONFIG.crossfadeS }, 101);
    const sets = gainOf(b).gain.sets;
    expect(sets[sets.length - 1]).toEqual({ value: reached, time: 101 });
    expect(gainOf(b).gain.curves[1]!.values[0]).toBeCloseTo(reached, 6);
    expect(gainOf(c).gain.curves[0]!.start).toBe(101);

    clock.t = 100 + MUSIC_CONFIG.crossfadeS;
    player.tick();
    expect(a.attributes.has('src')).toBe(false);
    expect(b.attributes.has('src')).toBe(true);
    clock.t = 101 + MUSIC_CONFIG.crossfadeS;
    player.tick();
    expect(b.attributes.has('src')).toBe(false);
    expect(c.attributes.has('src')).toBe(true);
  });

  it('fades to silence over the fade-out time when no track applies', () => {
    const { player, factory, gainOf, clock } = make();
    player.setTrack(menu);
    clock.t = 20;
    player.setTrack(null);
    const el = factory.elements[0]!;
    expect(gainOf(el).gain.curves[1]).toMatchObject({ start: 20, duration: MUSIC_CONFIG.fadeOutS });
    expect(factory.elements).toHaveLength(1);
    clock.t = 20 + MUSIC_CONFIG.fadeOutS;
    player.tick();
    expect(el.attributes.has('src')).toBe(false);
  });

  it('can start the same track again after it faded out', () => {
    const { player, factory } = make();
    player.setTrack(menu);
    player.setTrack(null);
    player.setTrack(menu);
    expect(factory.elements).toHaveLength(2);
  });

  it('cuts instantly when the config has no fade', () => {
    const { player, factory, gainOf } = make({ ...MUSIC_CONFIG, crossfadeS: 0 });
    player.setTrack(menu);
    player.setTrack(desert);
    const a = factory.elements[0]!;
    expect(gainOf(a).gain.value).toBe(0);
    expect(gainOf(a).gain.curves).toHaveLength(1);
    player.tick();
    expect(a.attributes.has('src')).toBe(false);
  });

  it('does nothing in tick while no fade is running', () => {
    const { player, factory } = make();
    player.setTrack(menu);
    player.tick();
    expect(factory.elements[0]!.pauseCalls).toBe(0);
  });
});

describe('autoplay unlock', () => {
  it('swallows a refused play() and retries on unlock until it is accepted', async () => {
    const { player, factory } = make();
    factory.refusePlay = true;
    player.setTrack(menu);
    await flush();
    const el = factory.elements[0]!;
    expect(el.playCalls).toBe(1);
    player.unlock();
    expect(el.playCalls).toBe(2);
    await flush();
    player.unlock();
    expect(el.playCalls).toBe(3);
    el.playError = null;
    await flush();
    player.unlock();
    expect(el.playCalls).toBe(4);
    await flush();
    player.unlock();
    expect(el.playCalls).toBe(4);
  });

  it('does not replay a track that started fine', async () => {
    const { player, factory } = make();
    player.setTrack(menu);
    await flush();
    player.unlock();
    expect(factory.elements[0]!.playCalls).toBe(1);
  });

  it('drops a track that never started instead of fading it out', async () => {
    const { player, factory, ctx } = make();
    factory.refusePlay = true;
    player.setTrack(menu);
    await flush();
    factory.refusePlay = false;
    player.setTrack(desert);
    const [a] = factory.elements as [FakeElement];
    expect(a.attributes.has('src')).toBe(false);
    expect(ctx.gains[0]!.gain.curves).toHaveLength(1);
  });

  it('unlock before any track is a no-op', () => {
    const { player, factory } = make();
    player.unlock();
    expect(factory.elements).toHaveLength(0);
  });
});

describe('failures stay local', () => {
  it('survives a source node that cannot be created and can try the next track', () => {
    const { player, factory, ctx } = make();
    ctx.throwOnSource = true;
    expect(() => player.setTrack(menu)).not.toThrow();
    expect(factory.elements[0]!.pauseCalls).toBe(1);
    ctx.throwOnSource = false;
    player.setTrack(desert);
    expect(factory.elements).toHaveLength(2);
    expect(factory.elements[1]!.playCalls).toBe(1);
  });

  it('survives an element factory that throws', () => {
    const output = new FakeMusicOutput();
    const player = new MusicPlayer(output as unknown as MusicOutput, {
      createElement: () => { throw new Error('no Audio'); },
      clock: () => 0,
    });
    expect(() => player.setTrack(menu)).not.toThrow();
    expect(output.context!.sources).toHaveLength(0);
  });
});

describe('dispose', () => {
  it('frees the current and the fading elements and ignores later requests', () => {
    const { player, factory, clock } = make();
    player.setTrack(menu);
    clock.t = 1;
    player.setTrack(desert);
    player.dispose();
    const [a, b] = factory.elements as [FakeElement, FakeElement];
    expect(a.attributes.has('src')).toBe(false);
    expect(b.attributes.has('src')).toBe(false);
    player.setTrack(alpine);
    player.tick();
    expect(factory.elements).toHaveLength(2);
  });

  it('is safe with nothing playing', () => {
    const { player } = make();
    expect(() => { player.dispose(); player.dispose(); }).not.toThrow();
  });
});
