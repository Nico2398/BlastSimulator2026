// BlastSimulator2026 — deriveMusicContext unit tests

import { describe, it, expect } from 'vitest';
import { deriveMusicContext, type MusicScreenFlags } from '../../../../src/audio/music/musicContext.js';

const flags = (over: Partial<MusicScreenFlags> = {}): MusicScreenFlags => ({
  menuVisible: false, loadingVisible: false, levelEndVisible: false, mineType: 'desert_badlands', activeLevelId: 'tutorial_pit', ...over,
});

describe('deriveMusicContext', () => {
  it('is the game when no overlay is up, carrying biome and level', () => {
    expect(deriveMusicContext(flags())).toEqual({ screen: 'game', biomeId: 'desert_badlands', levelId: 'tutorial_pit' });
  });

  it('is the menu when a full-screen menu is up', () => {
    expect(deriveMusicContext(flags({ menuVisible: true })).screen).toBe('menu');
  });

  it('is the level end over the game', () => {
    expect(deriveMusicContext(flags({ levelEndVisible: true })).screen).toBe('level_end');
  });

  it('is loading over every other overlay', () => {
    expect(deriveMusicContext(flags({ loadingVisible: true, menuVisible: true, levelEndVisible: true })).screen).toBe('loading');
  });

  it('puts the level end over the menu', () => {
    expect(deriveMusicContext(flags({ levelEndVisible: true, menuVisible: true })).screen).toBe('level_end');
  });

  it('maps absent state to null ids', () => {
    expect(deriveMusicContext(flags({ mineType: undefined, activeLevelId: undefined }))).toEqual({ screen: 'game', biomeId: null, levelId: null });
    expect(deriveMusicContext(flags({ mineType: null, activeLevelId: null }))).toEqual({ screen: 'game', biomeId: null, levelId: null });
  });
});
