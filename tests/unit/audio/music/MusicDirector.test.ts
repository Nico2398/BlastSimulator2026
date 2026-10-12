// BlastSimulator2026 — MusicDirector unit tests
// The director sees a recording player, never an AudioContext.

import { describe, it, expect } from 'vitest';
import { MUSIC_CONFIG } from '../../../../src/core/config/audio/music.js';
import type { MusicTrack } from '../../../../src/audio/music/MusicCatalog.js';
import { createMusicDirector, MusicDirector } from '../../../../src/audio/music/MusicDirector.js';
import type { MusicOutput, MusicPlayback } from '../../../../src/audio/music/MusicPlayer.js';
import type { MusicContext } from '../../../../src/audio/music/resolveMusicTrack.js';
import { FakeMusicOutput, recordingFactory } from './fakes.js';

const menu: MusicTrack = { id: 'menu', file: 'menu', scope: { kind: 'menu' } };
const desert: MusicTrack = { id: 'desert', file: 'desert', scope: { kind: 'biome', biomeId: 'desert_badlands' } };
const alpine: MusicTrack = { id: 'alpine', file: 'alpine', scope: { kind: 'biome', biomeId: 'alpine_granite' } };
const tutorial: MusicTrack = { id: 'tutorial', file: 'tutorial', scope: { kind: 'level', levelId: 'tutorial_pit' } };

class RecordingPlayer implements MusicPlayback {
  readonly set: Array<MusicTrack | null> = [];
  ticks = 0;
  unlocks = 0;
  disposes = 0;
  setTrack(track: MusicTrack | null): void { this.set.push(track); }
  unlock(): void { this.unlocks++; }
  tick(): void { this.ticks++; }
  dispose(): void { this.disposes++; }
}

function make(tracks: readonly MusicTrack[]) {
  const player = new RecordingPlayer();
  const output = new FakeMusicOutput();
  const director = new MusicDirector({ player, output, tracks, config: MUSIC_CONFIG });
  return { player, output, director };
}

const ctx = (screen: MusicContext['screen'], biomeId: string | null = null, levelId: string | null = null): MusicContext =>
  ({ screen, biomeId, levelId });

describe('with an empty catalog', () => {
  it('does nothing at all', () => {
    const { player, output, director } = make([]);
    director.update(ctx('menu'));
    director.update(ctx('game', 'desert_badlands'));
    director.duck();
    expect(player.set).toEqual([]);
    expect(player.ticks).toBe(0);
    expect(output.ducks).toEqual([]);
  });

  it('builds no element and no node when created for real with the shipped catalog', () => {
    const output = new FakeMusicOutput();
    const factory = recordingFactory();
    const director = createMusicDirector(output as unknown as MusicOutput, { createElement: factory.create });
    director.update(ctx('menu'));
    director.update(ctx('game', 'desert_badlands', 'tutorial_pit'));
    director.unlock();
    director.duck(-6, 1, 1);
    director.dispose();
    expect(factory.elements).toHaveLength(0);
    expect(output.context!.sources).toHaveLength(0);
    expect(output.context!.gains).toHaveLength(0);
    expect(output.ducks).toEqual([]);
  });
});

describe('update', () => {
  it('asks the player for a track only when screen, biome or level changes', () => {
    const { player, director } = make([menu, desert, alpine, tutorial]);
    for (let i = 0; i < 100; i++) director.update(ctx('menu'));
    expect(player.set).toEqual([menu]);
    for (let i = 0; i < 100; i++) director.update(ctx('game', 'desert_badlands'));
    expect(player.set).toEqual([menu, desert]);
    director.update(ctx('game', 'alpine_granite'));
    expect(player.set).toEqual([menu, desert, alpine]);
    director.update(ctx('game', 'alpine_granite', 'tutorial_pit'));
    expect(player.set).toEqual([menu, desert, alpine, tutorial]);
    expect(player.ticks).toBe(202);
  });

  it('keeps the music through loading and level end, and resumes the choice after', () => {
    const { player, director } = make([menu, desert]);
    director.update(ctx('menu'));
    director.update(ctx('loading', 'desert_badlands'));
    director.update(ctx('game', 'desert_badlands'));
    director.update(ctx('level_end', 'desert_badlands'));
    director.update(ctx('game', 'desert_badlands'));
    director.update(ctx('menu'));
    expect(player.set).toEqual([menu, desert, menu]);
  });

  it('applies the first context even when it is a keep', () => {
    const { player, director } = make([menu]);
    director.update(ctx('loading'));
    director.update(ctx('menu'));
    expect(player.set).toEqual([menu]);
  });

  it('asks for silence when nothing fits the game', () => {
    const { player, director } = make([menu]);
    director.update(ctx('menu'));
    director.update(ctx('game', 'desert_badlands'));
    expect(player.set).toEqual([menu, null]);
  });
});

describe('unlock, duck and dispose', () => {
  it('forwards unlock and dispose to the player', () => {
    const { player, director } = make([menu]);
    director.unlock();
    director.dispose();
    expect(player.unlocks).toBe(1);
    expect(player.disposes).toBe(1);
  });

  it('ducks the music bus with the configured defaults', () => {
    const { output, director } = make([menu]);
    director.duck();
    expect(output.ducks).toEqual([{ bus: 'music', ...MUSIC_CONFIG.duck }]);
  });

  it('ducks with the amounts the caller gives', () => {
    const { output, director } = make([menu]);
    director.duck(-9, 0.2, 3);
    expect(output.ducks).toEqual([{ bus: 'music', amountDb: -9, holdS: 0.2, releaseS: 3 }]);
  });
});

describe('failures stay inside the director', () => {
  class ThrowingPlayer extends RecordingPlayer {
    override setTrack(track: MusicTrack | null): void { super.setTrack(track); throw new Error('player down'); }
    override tick(): void { throw new Error('player down'); }
  }

  it('update never throws, whatever the player does, and does not retry a track it already asked for', () => {
    const player = new ThrowingPlayer();
    const director = new MusicDirector({ player, output: new FakeMusicOutput(), tracks: [menu, desert], config: MUSIC_CONFIG });
    expect(() => director.update(ctx('menu'))).not.toThrow();
    expect(() => director.update(ctx('menu'))).not.toThrow();
    expect(() => director.update(ctx('game', 'desert_badlands'))).not.toThrow();
    expect(player.set).toEqual([menu, desert]);
  });

  it('duck never throws when the audio graph does', () => {
    const output = new FakeMusicOutput();
    output.duck = () => { throw new Error('graph down'); };
    const director = new MusicDirector({ player: new RecordingPlayer(), output, tracks: [menu], config: MUSIC_CONFIG });
    expect(() => director.duck()).not.toThrow();
  });
});

describe('createMusicDirector', () => {
  it('wires a real player: menu starts a stream, the game crossfades to the biome track', () => {
    const output = new FakeMusicOutput();
    const factory = recordingFactory();
    const director = createMusicDirector(output as unknown as MusicOutput, {
      tracks: [menu, desert], createElement: factory.create, clock: () => 0,
    });
    director.update(ctx('menu'));
    expect(factory.elements.map(e => e.url)).toEqual(['/audio/music/menu.mp3']);
    director.update(ctx('game', 'desert_badlands'));
    expect(factory.elements.map(e => e.url)).toEqual(['/audio/music/menu.mp3', '/audio/music/desert.mp3']);
    director.duck();
    expect(output.ducks).toHaveLength(1);
    director.dispose();
    expect(factory.elements.every(e => !e.attributes.has('src'))).toBe(true);
  });
});
