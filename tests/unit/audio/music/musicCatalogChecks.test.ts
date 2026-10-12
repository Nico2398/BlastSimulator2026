// BlastSimulator2026 — the music catalogue rules, proven on bad fixtures
// MUSIC_TRACKS is empty today, so MusicCatalog.test.ts alone could never fail: these cases show each rule can.

import { describe, it, expect } from 'vitest';
import { musicTrackProblems, type MusicCatalogContext } from '../../../helpers/musicCatalogChecks.js';
import type { MusicTrack } from '../../../../src/audio/music/MusicCatalog.js';

const context: MusicCatalogContext = {
  biomeIds: new Set(['desert_badlands']),
  levelIds: new Set(['dusty_hollow']),
  fileExists: file => file === 'menu_theme' || file === 'desert_theme',
};

const menu: MusicTrack = { id: 'menu', file: 'menu_theme', scope: { kind: 'menu' } };
const desert: MusicTrack = { id: 'desert', file: 'desert_theme', scope: { kind: 'biome', biomeId: 'desert_badlands' } };

describe('musicTrackProblems', () => {
  it('accepts an empty catalogue and a valid one', () => {
    expect(musicTrackProblems([], context)).toEqual([]);
    expect(musicTrackProblems([menu, desert], context)).toEqual([]);
  });

  it('rejects a duplicate id', () => {
    expect(musicTrackProblems([menu, { ...desert, id: 'menu' }], context)).toEqual(['menu: duplicate id']);
  });

  it('rejects an empty id', () => {
    expect(musicTrackProblems([{ ...menu, id: '' }], context)).toContain('a track has an empty id');
  });

  it('rejects a file that is not a bare basename', () => {
    const problems = musicTrackProblems([{ ...menu, file: '../menu_theme.mp3' }], context);
    expect(problems).toEqual(['menu: file "../menu_theme.mp3" is not a bare basename']);
  });

  it('rejects a file that is not in the folder', () => {
    expect(musicTrackProblems([{ ...menu, file: 'nowhere' }], context)).toEqual(['menu: nowhere.mp3 is missing from public/audio/music']);
  });

  it('rejects an unknown biome and an unknown level, and accepts known ones', () => {
    const badBiome: MusicTrack = { id: 'b', file: 'menu_theme', scope: { kind: 'biome', biomeId: 'moon' } };
    const badLevel: MusicTrack = { id: 'l', file: 'menu_theme', scope: { kind: 'level', levelId: 'nope' } };
    const goodLevel: MusicTrack = { id: 'g', file: 'menu_theme', scope: { kind: 'level', levelId: 'dusty_hollow' } };
    expect(musicTrackProblems([badBiome, badLevel, goodLevel], context)).toEqual(['b: unknown biome "moon"', 'l: unknown level "nope"']);
  });

  it('reports every problem of a track, not only the first', () => {
    const track: MusicTrack = { id: 'x', file: 'nowhere', scope: { kind: 'biome', biomeId: 'moon' } };
    expect(musicTrackProblems([track], context)).toHaveLength(2);
  });
});
