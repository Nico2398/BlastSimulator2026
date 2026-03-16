import { describe, it, expect } from 'vitest';
import {
  createLevelStats,
  snapshotStats,
  recordBlastResult,
  updateDepth,
  calculateStarRating,
} from '../../../src/core/campaign/SuccessTracker.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import type { Vec3 } from '../../../src/core/math/Vec3.js';
import { addIncome, addExpense } from '../../../src/core/economy/Finance.js';

const zeroVec: Vec3 = { x: 0, y: 0, z: 0 };

function makeFragment(overrides: Partial<FragmentData> = {}): FragmentData {
  return {
    id: 1,
    position: zeroVec,
    volume: 10,
    mass: 25,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: zeroVec,
    isProjection: false,
    ...overrides,
  };
}

describe('Success tracker (7.8)', () => {
  it('wealth tracker accumulates over time within a level', () => {
    const state = createGame({ seed: 1 });
    const stats = createLevelStats();

    addIncome(state.finances, 100000, 'sales', 'test', 0);
    addExpense(state.finances, 20000, 'equipment', 'test', 0);
    snapshotStats(stats, state);

    expect(stats.totalWealth).toBe(80000);

    // More income
    addIncome(state.finances, 50000, 'sales', 'test2', 1);
    snapshotStats(stats, state);
    expect(stats.totalWealth).toBe(130000);
  });

  it('depth tracker updates correctly', () => {
    const stats = createLevelStats();
    const surfaceY = 30;

    updateDepth(stats, 25, surfaceY); // depth = 5
    expect(stats.maxDepthReached).toBe(5);

    updateDepth(stats, 10, surfaceY); // depth = 20
    expect(stats.maxDepthReached).toBe(20);

    updateDepth(stats, 15, surfaceY); // depth = 15 — not a new record
    expect(stats.maxDepthReached).toBe(20);
  });

  it('ore extraction tracker counts unique types', () => {
    const stats = createLevelStats();

    recordBlastResult(stats, [
      makeFragment({ oreDensities: { treranium: 0.5, glorite: 0.2 } }),
      makeFragment({ oreDensities: { treranium: 0.1 } }), // duplicate
    ]);

    expect(stats.uniqueOresExtracted.size).toBe(2);
    expect(stats.uniqueOresExtracted.has('treranium')).toBe(true);
    expect(stats.uniqueOresExtracted.has('glorite')).toBe(true);
  });

  it('ore with 0 density is not counted as extracted', () => {
    const stats = createLevelStats();
    recordBlastResult(stats, [
      makeFragment({ oreDensities: { treranium: 0.0, glorite: 0.5 } }),
    ]);
    expect(stats.uniqueOresExtracted.has('treranium')).toBe(false);
    expect(stats.uniqueOresExtracted.has('glorite')).toBe(true);
  });

  it('total volume blasted accumulates across calls', () => {
    const stats = createLevelStats();
    recordBlastResult(stats, [makeFragment({ volume: 10 }), makeFragment({ volume: 20 })]);
    recordBlastResult(stats, [makeFragment({ volume: 5 })]);
    expect(stats.totalVolumeBlasted).toBe(35);
  });

  it('blasts performed tracked via snapshotStats from damage state', () => {
    const state = createGame({ seed: 1 });
    const stats = createLevelStats();

    state.damage.blastCount = 4;
    snapshotStats(stats, state);
    expect(stats.blastsPerformed).toBe(4);
  });

  it('star rating: 3 stars = high profit, zero casualties, good ecology', () => {
    const stats = createLevelStats();
    stats.totalWealth = 100000;
    stats.casualties = 0;
    stats.bestEcology = 70;

    const rating = calculateStarRating(stats, 80000);
    expect(rating.stars).toBe(3);
    expect(rating.details.profitPass).toBe(true);
    expect(rating.details.safetyPass).toBe(true);
    expect(rating.details.ecologyPass).toBe(true);
  });

  it('star rating: 2 stars = profit + safety but poor ecology', () => {
    const stats = createLevelStats();
    stats.totalWealth = 100000;
    stats.casualties = 0;
    stats.bestEcology = 30; // below 60

    const rating = calculateStarRating(stats, 80000);
    expect(rating.stars).toBe(2);
    expect(rating.details.profitPass).toBe(true);
    expect(rating.details.safetyPass).toBe(true);
    expect(rating.details.ecologyPass).toBe(false);
  });

  it('star rating: 1 star minimum even with no criteria met', () => {
    const stats = createLevelStats();
    stats.totalWealth = 0;
    stats.casualties = 5;
    stats.bestEcology = 0;

    const rating = calculateStarRating(stats, 80000);
    expect(rating.stars).toBe(1);
  });

  it('star rating: 1 star with exactly 1 criterion met', () => {
    const stats = createLevelStats();
    stats.totalWealth = 0;
    stats.casualties = 0; // safety pass
    stats.bestEcology = 0;

    const rating = calculateStarRating(stats, 80000);
    expect(rating.stars).toBe(1);
    expect(rating.details.safetyPass).toBe(true);
  });
});
