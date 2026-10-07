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
import { STAR_ECOLOGY_MIN } from '../../../src/core/config/balance.js';
import { serializeLevelStats, deserializeLevelStats } from '../../../src/core/campaign/SuccessTracker.js';

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
    halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
    shapeSeed: 1,
    origin: zeroVec,
    ...overrides,
  };
}

describe('Success tracker totalWealth is operating profit (#1363)', () => {
  it('a fine lowers totalWealth, a vehicle purchase does not', () => {
    const state = createGame({ seed: 1 });
    const stats = createLevelStats();
    addIncome(state.finances, 10000, 'contracts', 'c', 0);
    addExpense(state.finances, 50000, 'equipment', 'vehicle', 0);
    addExpense(state.finances, 2000, 'fines', 'fine', 0);
    snapshotStats(stats, state);
    expect(stats.totalWealth).toBe(8000);
  });

  it('refund income is not counted', () => {
    const state = createGame({ seed: 1 });
    const stats = createLevelStats();
    addIncome(state.finances, 5000, 'refund', 'r', 0);
    snapshotStats(stats, state);
    expect(stats.totalWealth).toBe(0);
  });
});

describe('Success tracker (7.8)', () => {
  it('wealth tracker accumulates over time within a level', () => {
    const state = createGame({ seed: 1 });
    const stats = createLevelStats();

    addIncome(state.finances, 100000, 'sales', 'test', 0);
    addExpense(state.finances, 20000, 'equipment', 'test', 0);
    snapshotStats(stats, state);

    // Operating profit (#1363): the 'equipment' purchase is capital outlay, not counted.
    expect(stats.totalWealth).toBe(100000);

    // More income
    addIncome(state.finances, 50000, 'sales', 'test2', 1);
    snapshotStats(stats, state);
    expect(stats.totalWealth).toBe(150000);
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
    stats.finalEcology = 70;

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
    stats.finalEcology = 30; // below 60

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
    stats.finalEcology = 0;

    const rating = calculateStarRating(stats, 80000);
    expect(rating.stars).toBe(1);
  });

  it('star rating: 1 star with exactly 1 criterion met', () => {
    const stats = createLevelStats();
    stats.totalWealth = 0;
    stats.casualties = 0; // safety pass
    stats.finalEcology = 0;

    const rating = calculateStarRating(stats, 80000);
    expect(rating.stars).toBe(1);
    expect(rating.details.safetyPass).toBe(true);
  });

  // ── #1311: single star rating, ecology judged at the END of the run ──

  describe('star rating (#1311)', () => {
    function rate(over: Partial<ReturnType<typeof createLevelStats>>, target = 80000) {
      const stats = createLevelStats();
      Object.assign(stats, over);
      return calculateStarRating(stats, target);
    }

    it('STAR_ECOLOGY_MIN is 60', () => {
      expect(STAR_ECOLOGY_MIN).toBe(60);
    });

    it('ecology star uses finalEcology, not the bestEcology peak (peak 80, end 50)', () => {
      const r = rate({ totalWealth: 100000, casualties: 0, bestEcology: 80, finalEcology: 50 });
      expect(r.details.ecologyPass).toBe(false);
      expect(r.stars).toBe(2);
    });

    it('a high final ecology passes even when the recorded peak is lower', () => {
      const r = rate({ totalWealth: 100000, casualties: 0, bestEcology: 10, finalEcology: 75 });
      expect(r.details.ecologyPass).toBe(true);
      expect(r.stars).toBe(3);
    });

    it('ecology boundary: 59 fails, 60 passes', () => {
      expect(rate({ finalEcology: 59 }).details.ecologyPass).toBe(false);
      expect(rate({ finalEcology: STAR_ECOLOGY_MIN }).details.ecologyPass).toBe(true);
    });

    it('profit criterion alone gives 1 star', () => {
      const r = rate({ totalWealth: 80000, casualties: 2, finalEcology: 0 });
      expect(r.details).toEqual({ profitPass: true, safetyPass: false, ecologyPass: false });
      expect(r.stars).toBe(1);
    });

    it('profit + ecology gives 2 stars when someone died', () => {
      const r = rate({ totalWealth: 80000, casualties: 1, finalEcology: 70 });
      expect(r.details.safetyPass).toBe(false);
      expect(r.stars).toBe(2);
    });

    it('safety + ecology gives 2 stars when profit is short', () => {
      const r = rate({ totalWealth: 79999, casualties: 0, finalEcology: 70 });
      expect(r.details.profitPass).toBe(false);
      expect(r.stars).toBe(2);
    });

    it('a death removes the safety star', () => {
      const clean = rate({ totalWealth: 100000, casualties: 0, finalEcology: 70 });
      const dead = rate({ totalWealth: 100000, casualties: 1, finalEcology: 70 });
      expect(clean.stars).toBe(3);
      expect(dead.stars).toBe(2);
    });

    it('clamps to a minimum of 1 star with no criterion met', () => {
      const r = rate({ totalWealth: 0, casualties: 4, finalEcology: 0, bestEcology: 90 });
      expect(r.stars).toBe(1);
    });

    it('snapshotStats overwrites finalEcology with the current score, including drops', () => {
      const state = createGame({ seed: 1 });
      const stats = createLevelStats();
      state.scores.ecology = 80;
      snapshotStats(stats, state);
      expect(stats.finalEcology).toBe(80);
      expect(stats.bestEcology).toBe(80);

      state.scores.ecology = 50;
      snapshotStats(stats, state);
      expect(stats.finalEcology).toBe(50);
      expect(stats.bestEcology).toBe(80);
    });

    it('createLevelStats starts finalEcology at 0', () => {
      expect(createLevelStats().finalEcology).toBe(0);
    });

    it('finalEcology survives a serialize/deserialize round trip', () => {
      const stats = createLevelStats();
      stats.finalEcology = 42;
      const raw = JSON.parse(JSON.stringify(serializeLevelStats(stats))) as Record<string, unknown>;
      expect(deserializeLevelStats(raw).finalEcology).toBe(42);
    });

    it('deserialize of an old save without finalEcology yields 0', () => {
      expect(deserializeLevelStats({ totalWealth: 5, bestEcology: 90 }).finalEcology).toBe(0);
    });
  });
});
