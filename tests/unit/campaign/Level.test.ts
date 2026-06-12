import { describe, it, expect } from 'vitest';
import { getLevel, getAllLevels } from '../../../src/core/campaign/Level.js';

describe('Level definition system (7.1)', () => {
  it('getLevel("dusty_hollow") returns valid level data with all required fields', () => {
    const level = getLevel('dusty_hollow');
    expect(level).toBeDefined();
    expect(level!.id).toBe('dusty_hollow');
    expect(level!.nameKey).toBe('level.dusty_hollow.name');
    expect(level!.descKey).toBe('level.dusty_hollow.desc');
    expect(level!.mineType).toBe('desert');
    expect(level!.terrainSeed).toBeGreaterThan(0);
    expect(level!.gridX).toBeGreaterThan(0);
    expect(level!.gridY).toBeGreaterThan(0);
    expect(level!.gridZ).toBeGreaterThan(0);
    expect(level!.startingCash).toBeGreaterThan(0);
    expect(level!.availableExplosives.length).toBeGreaterThan(0);
    expect(level!.unlockThreshold).toBeGreaterThan(0);
    expect(typeof level!.eventFreqMultiplier).toBe('number');
    expect(typeof level!.contractPriceMultiplier).toBe('number');
    expect(typeof level!.scoreDecayRate).toBe('number');
    expect(typeof level!.mixedRockHardness).toBe('boolean');
    expect(level!.difficultyTier).toBe(1);
  });

  it('all 4 levels are defined with progressive difficulty', () => {
    const levels = getAllLevels();
    expect(levels).toHaveLength(4);

    // Event frequency should increase or stay same across tiers
    expect(levels[0]!.eventFreqMultiplier).toBe(0);
    expect(levels[1]!.eventFreqMultiplier).toBeGreaterThanOrEqual(levels[0]!.eventFreqMultiplier);
    expect(levels[2]!.eventFreqMultiplier).toBeGreaterThan(levels[1]!.eventFreqMultiplier);
    expect(levels[3]!.eventFreqMultiplier).toBeGreaterThan(levels[2]!.eventFreqMultiplier);

    // Score decay should increase across tiers
    expect(levels[1]!.scoreDecayRate).toBeGreaterThan(levels[0]!.scoreDecayRate);
    expect(levels[2]!.scoreDecayRate).toBeGreaterThan(levels[1]!.scoreDecayRate);
    expect(levels[3]!.scoreDecayRate).toBeGreaterThan(levels[2]!.scoreDecayRate);

    // Difficulty tier
    expect(levels[0]!.difficultyTier).toBe(0);
    expect(levels[1]!.difficultyTier).toBe(1);
    expect(levels[2]!.difficultyTier).toBe(2);
    expect(levels[3]!.difficultyTier).toBe(3);
  });

  it('level unlock thresholds increase with difficulty', () => {
    const levels = getAllLevels();
    expect(levels[0]!.unlockThreshold).toBeLessThan(levels[1]!.unlockThreshold);
    expect(levels[1]!.unlockThreshold).toBeLessThan(levels[2]!.unlockThreshold);
    expect(levels[2]!.unlockThreshold).toBeLessThan(levels[3]!.unlockThreshold);
  });

  it('level 3 includes all explosive types, level 1 only starter explosives', () => {
    const level1 = getLevel('dusty_hollow')!;
    const level3 = getLevel('treranium_depths')!;

    // Level 1 should only have starter explosives
    expect(level1.availableExplosives).not.toContain('dynatomics');
    expect(level1.availableExplosives).not.toContain('obliviax');

    // Level 3 should have all explosives including endgame
    expect(level3.availableExplosives).toContain('pop_rock');
    expect(level3.availableExplosives).toContain('dynatomics');
    expect(level3.availableExplosives.length).toBeGreaterThan(level1.availableExplosives.length);
  });

  it('level 3 has mixed rock hardness enabled', () => {
    const level3 = getLevel('treranium_depths')!;
    expect(level3.mixedRockHardness).toBe(true);
  });

  it('level 1 has mixed rock hardness disabled', () => {
    const level1 = getLevel('dusty_hollow')!;
    expect(level1.mixedRockHardness).toBe(false);
  });

  it('getLevel returns undefined for unknown id', () => {
    expect(getLevel('nonexistent_mine')).toBeUndefined();
  });

  it('getLevel("tutorial_pit") returns valid level data with all required fields', () => {
    const level = getLevel('tutorial_pit');
    expect(level).toBeDefined();
    expect(level!.id).toBe('tutorial_pit');
    expect(level!.nameKey).toBe('level.tutorial_pit.name');
    expect(level!.descKey).toBe('level.tutorial_pit.desc');
    expect(level!.mineType).toBe('desert');
    expect(level!.terrainSeed).toBe(42);
    expect(level!.gridX).toBe(24);
    expect(level!.gridY).toBe(12);
    expect(level!.gridZ).toBe(24);
    expect(level!.startingCash).toBe(20000);
    expect(level!.availableExplosives).toContain('pop_rock');
    expect(level!.availableExplosives).toContain('boomite');
    expect(level!.unlockThreshold).toBe(5000);
    expect(level!.eventFreqMultiplier).toBe(0);
    expect(level!.contractPriceMultiplier).toBe(1.5);
    expect(level!.scoreDecayRate).toBe(0.01);
    expect(level!.mixedRockHardness).toBe(false);
    expect(level!.difficultyTier).toBe(0);
  });

  it('getAllLevels()[0] is tutorial_pit', () => {
    const all = getAllLevels();
    expect(all[0]!.id).toBe('tutorial_pit');
    expect(all[0]!.difficultyTier).toBe(0);
  });

  it('tutorial_pit has zero event frequency multiplier', () => {
    expect(getLevel('tutorial_pit')!.eventFreqMultiplier).toBe(0);
  });

  it('tutorial_pit only has basic explosives', () => {
    const level = getLevel('tutorial_pit')!;
    expect(level.availableExplosives).toContain('pop_rock');
    expect(level.availableExplosives).toContain('boomite');
    expect(level.availableExplosives).not.toContain('krackle');
    expect(level.availableExplosives).not.toContain('big_bada_boom');
    expect(level.availableExplosives).not.toContain('shatternite');
    expect(level.availableExplosives).not.toContain('rumblox');
    expect(level.availableExplosives).not.toContain('obliviax');
    expect(level.availableExplosives).not.toContain('dynatomics');
  });
});
