// BlastSimulator2026 — resolveMusicTrack unit tests

import { describe, it, expect } from 'vitest';
import type { MusicTrack } from '../../../../src/audio/music/MusicCatalog.js';
import { MUSIC_KEEP, resolveMusicTrack, type MusicContext } from '../../../../src/audio/music/resolveMusicTrack.js';

const menu: MusicTrack = { id: 'menu', file: 'menu', scope: { kind: 'menu' } };
const game: MusicTrack = { id: 'game', file: 'game', scope: { kind: 'game' } };
const desert: MusicTrack = { id: 'desert', file: 'desert', scope: { kind: 'biome', biomeId: 'desert_badlands' } };
const alpine: MusicTrack = { id: 'alpine', file: 'alpine', scope: { kind: 'biome', biomeId: 'alpine_granite' } };
const tutorial: MusicTrack = { id: 'tutorial', file: 'tutorial', scope: { kind: 'level', levelId: 'tutorial_pit' } };
const ALL = [menu, game, desert, alpine, tutorial];

const ctx = (screen: MusicContext['screen'], biomeId: string | null = null, levelId: string | null = null): MusicContext =>
  ({ screen, biomeId, levelId });

describe('resolveMusicTrack', () => {
  const cases: Array<[string, MusicContext, readonly MusicTrack[], MusicTrack | null | typeof MUSIC_KEEP]> = [
    ['menu screen picks the menu track', ctx('menu', 'desert_badlands', 'tutorial_pit'), ALL, menu],
    ['menu without a menu track is silence', ctx('menu'), [game, desert], null],
    ['loading keeps the music', ctx('loading', 'desert_badlands'), ALL, MUSIC_KEEP],
    ['level end keeps the music', ctx('level_end', 'desert_badlands', 'tutorial_pit'), ALL, MUSIC_KEEP],
    ['loading keeps even with an empty catalog', ctx('loading'), [], MUSIC_KEEP],
    ['a level track beats biome and game', ctx('game', 'desert_badlands', 'tutorial_pit'), ALL, tutorial],
    ['a biome track beats the generic one', ctx('game', 'alpine_granite', 'other_level'), ALL, alpine],
    ['an unknown level falls to the biome track', ctx('game', 'desert_badlands', 'no_such_level'), ALL, desert],
    ['a null level falls to the biome track', ctx('game', 'desert_badlands'), ALL, desert],
    ['an unknown biome falls to the generic track', ctx('game', 'no_such_biome', 'no_such_level'), ALL, game],
    ['no biome and no level falls to the generic track', ctx('game'), ALL, game],
    ['no matching track at all is silence', ctx('game', 'alpine_granite'), [menu, desert], null],
    ['an empty catalog is silence in a game', ctx('game', 'desert_badlands', 'tutorial_pit'), [], null],
    ['an empty catalog is silence in the menu', ctx('menu'), [], null],
  ];

  it.each(cases)('%s', (_name, context, tracks, expected) => {
    expect(resolveMusicTrack(context, tracks)).toBe(expected);
  });

  it('prefers the first of several tracks for one scope', () => {
    const second: MusicTrack = { id: 'menu2', file: 'menu2', scope: { kind: 'menu' } };
    expect(resolveMusicTrack(ctx('menu'), [second, menu])).toBe(second);
  });

  it('does not let a level id match a biome track or the reverse', () => {
    expect(resolveMusicTrack(ctx('game', 'tutorial_pit', 'desert_badlands'), [desert, tutorial])).toBeNull();
  });
});
