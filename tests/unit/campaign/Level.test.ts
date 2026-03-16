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

  it('all 3 levels are defined with increasing difficulty modifiers', () => {
    const levels = getAllLevels();
    expect(levels).toHaveLength(3);

    // Event frequency should increase or stay same across tiers
    expect(levels[1]!.eventFreqMultiplier).toBeGreaterThanOrEqual(levels[0]!.eventFreqMultiplier);
    expect(levels[2]!.eventFreqMultiplier).toBeGreaterThan(levels[1]!.eventFreqMultiplier);

    // Score decay should increase across tiers
    expect(levels[1]!.scoreDecayRate).toBeGreaterThan(levels[0]!.scoreDecayRate);
    expect(levels[2]!.scoreDecayRate).toBeGreaterThan(levels[1]!.scoreDecayRate);

    // Difficulty tier
    expect(levels[0]!.difficultyTier).toBe(1);
    expect(levels[1]!.difficultyTier).toBe(2);
    expect(levels[2]!.difficultyTier).toBe(3);
  });

  it('level 1 unlock threshold < level 2 < level 3', () => {
    const levels = getAllLevels();
    expect(levels[0]!.unlockThreshold).toBeLessThan(levels[1]!.unlockThreshold);
    expect(levels[1]!.unlockThreshold).toBeLessThan(levels[2]!.unlockThreshold);
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
});
