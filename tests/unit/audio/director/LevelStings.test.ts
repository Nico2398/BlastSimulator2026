import { describe, it, expect } from 'vitest';
import { LevelStings } from '../../../../src/audio/director/LevelStings.js';
import { LEVEL_END_CONFIG } from '../../../../src/core/config/audio/game.js';
import { makeHarness } from './helpers.js';

describe('LevelStings', () => {
  it('plays the win sting once and steps the ambience aside', () => {
    const h = makeHarness();
    const stings = new LevelStings(h.env);
    stings.play('win');
    stings.play('win');
    stings.play('lose');
    expect(h.player.ids).toEqual(['level_win']);
    expect(h.player.ducks).toEqual([{ bus: 'ambient', ...LEVEL_END_CONFIG.duck }]);
  });

  it('plays the lose sting for a loss', () => {
    const h = makeHarness();
    new LevelStings(h.env).play('lose');
    expect(h.player.ids).toEqual(['level_lose']);
  });

  it('plays again for the next level after a reset', () => {
    const h = makeHarness();
    const stings = new LevelStings(h.env);
    stings.play('win');
    stings.reset();
    stings.play('lose');
    expect(h.player.ids).toEqual(['level_win', 'level_lose']);
  });
});
