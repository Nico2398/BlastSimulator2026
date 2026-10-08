import { describe, it, expect } from 'vitest';
import {
  MAFIA_UNLOCK_THRESHOLD,
  BRIBERY_FAILURE_FINE_FRACTION,
  BRIBERY_FAILURE_NUISANCE_HIT,
  BRIBERY_FAILURE_CORRUPTION_DELTA,
  BRIBE_CORRUPTION_DELTA,
  CORRUPTION_MAX,
} from '../../../src/core/config/balance.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  createCorruptionState,
  attemptCorruption,
  applyCorruptionDelta,
  getCorruptionLevel,
  isMafiaUnlocked,
  getSuccessRate,
  MAFIA_THRESHOLD,
  TARGET_COSTS,
  bribeFailureFine,
  applyBribeFailure,
} from '../../../src/core/economy/Corruption.js';

describe('Corruption system', () => {
  it('corruption attempt deducts cost', () => {
    const state = createCorruptionState();
    const result = attemptCorruption(state, 'inspector', 1, new Random(42));
    expect(result.cost).toBe(8100);
  });

  it('successful corruption removes the original problem', () => {
    // Find a seed that succeeds
    for (let seed = 0; seed < 100; seed++) {
      const state = createCorruptionState();
      const result = attemptCorruption(state, 'judge', 1, new Random(seed));
      if (result.success) {
        expect(result.scandalTriggered).toBe(false);
        expect(getCorruptionLevel(state)).toBe(BRIBE_CORRUPTION_DELTA.judge);
        expect(result.protection).toBeDefined();
        expect(state.protections).toHaveLength(1);
        return;
      }
    }
    expect.unreachable('No successful corruption in 100 seeds');
  });

  it('failed corruption triggers a scandal event', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = createCorruptionState();
      const result = attemptCorruption(state, 'judge', 1, new Random(seed));
      if (!result.success) {
        expect(result.scandalTriggered).toBe(true);
        return;
      }
    }
    expect.unreachable('No failed corruption in 100 seeds');
  });

  it('corruption history accumulates and increases failure probability', () => {
    const state = createCorruptionState();
    const initialRate = getSuccessRate(state);

    // Make several attempts
    for (let i = 0; i < 5; i++) {
      attemptCorruption(state, 'inspector', i, new Random(i));
    }

    const laterRate = getSuccessRate(state);
    expect(laterRate).toBeLessThan(initialRate);
    expect(state.attempts.length).toBe(5);
  });

  it('a successful bribe that crosses the threshold unlocks mafia events', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = createCorruptionState();
      state.level = MAFIA_THRESHOLD - 1;
      const result = attemptCorruption(state, 'inspector', 1, new Random(seed));
      if (result.success) {
        expect(result.mafiaJustUnlocked).toBe(true);
        expect(isMafiaUnlocked(state)).toBe(true);
        expect(getCorruptionLevel(state)).toBe(MAFIA_THRESHOLD - 1 + BRIBE_CORRUPTION_DELTA.inspector);
        return;
      }
    }
    expect.unreachable('No successful corruption in 100 seeds');
  });

  it('a single inspector bribe alone stays below the mafia threshold', () => {
    const state = createCorruptionState();
    attemptCorruption(state, 'inspector', 1, new Random(1));
    expect(isMafiaUnlocked(state)).toBe(false);
  });

  it('a failed bribe grants no protection and does not raise the level by the old flat +1', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = createCorruptionState();
      const result = attemptCorruption(state, 'judge', 1, new Random(seed));
      if (!result.success) {
        expect(result.protection).toBeUndefined();
        expect(state.protections).toHaveLength(0);
        expect(getCorruptionLevel(state)).toBe(0);
        return;
      }
    }
    expect.unreachable('No failed corruption in 100 seeds');
  });

  it('a failed re-bribe does not extend an existing protection', () => {
    for (let seed = 0; seed < 100; seed++) {
      const probe = createCorruptionState();
      if (attemptCorruption(probe, 'judge', 1, new Random(seed)).success) continue;
      const state = createCorruptionState();
      state.protections.push({ target: 'judge', expiresAtTick: 40, dismissalsLeft: 1 });
      const result = attemptCorruption(state, 'judge', 1, new Random(seed));
      expect(result.success).toBe(false);
      expect(state.protections).toEqual([{ target: 'judge', expiresAtTick: 40, dismissalsLeft: 1 }]);
      return;
    }
    expect.unreachable('No failed corruption in 100 seeds');
  });

  it('a successful witness bribe reports an exposure reduction and no timed protection', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = createCorruptionState();
      const result = attemptCorruption(state, 'witness', 1, new Random(seed));
      if (result.success) {
        expect(result.exposureReduction).toBeGreaterThan(0);
        expect(state.protections).toHaveLength(0);
        expect(getCorruptionLevel(state)).toBe(BRIBE_CORRUPTION_DELTA.witness);
        return;
      }
    }
    expect.unreachable('No successful corruption in 100 seeds');
  });

  it('a successful bribe raises the level by that target\'s configured delta', () => {
    for (const target of ['judge', 'politician', 'union_leader', 'inspector', 'witness'] as const) {
      for (let seed = 0; seed < 100; seed++) {
        const state = createCorruptionState();
        if (attemptCorruption(state, target, 1, new Random(seed)).success) {
          expect(state.level).toBe(BRIBE_CORRUPTION_DELTA[target]);
          break;
        }
      }
    }
  });
});

// ── customCost sanitization (#519) ──
//
// `customCost` is caller-supplied (console `corrupt` command's `cost:` arg).
// `cost = customCost ?? TARGET_COSTS[target]` only rejects null/undefined —
// a negative number or NaN both pass straight through, letting a negative
// cost invert `state.cash -= result.cost` into a cash increase and a NaN
// cost poison state.cash for the rest of the session. The fix mirrors
// Logistics.ts's `consumeStoredOre` validation: only accept customCost when
// `Number.isFinite(customCost) && customCost >= 0`.
describe('Corruption system — customCost sanitization (#519)', () => {
  it('falls back to TARGET_COSTS[target] for a negative customCost', () => {
    const state = createCorruptionState();
    const result = attemptCorruption(state, 'inspector', 1, new Random(42), -5000);
    expect(result.cost).toBe(TARGET_COSTS.inspector);
  });

  it('falls back to TARGET_COSTS[target] for a NaN customCost', () => {
    const state = createCorruptionState();
    const result = attemptCorruption(state, 'inspector', 1, new Random(42), NaN);
    expect(result.cost).toBe(TARGET_COSTS.inspector);
  });

  it('accepts customCost of 0 as a valid override (boundary)', () => {
    const state = createCorruptionState();
    const result = attemptCorruption(state, 'inspector', 1, new Random(42), 0);
    expect(result.cost).toBe(0);
  });
});

// ── applyCorruptionDelta (#1406) ──
describe('applyCorruptionDelta (#1406)', () => {
  it('positive delta raises level by that amount', () => {
    const state = createCorruptionState();
    applyCorruptionDelta(state, 1);
    expect(state.level).toBe(1);
    applyCorruptionDelta(state, 1);
    expect(state.level).toBe(2);
    expect(state.mafiaUnlocked).toBe(false);
  });

  it('returns mafiaJustUnlocked false below threshold', () => {
    const state = createCorruptionState();
    const r = applyCorruptionDelta(state, MAFIA_UNLOCK_THRESHOLD - 1);
    expect(r.mafiaJustUnlocked).toBe(false);
    expect(state.mafiaUnlocked).toBe(false);
  });

  it('landing exactly on the threshold unlocks mafia', () => {
    const state = createCorruptionState();
    const r = applyCorruptionDelta(state, MAFIA_UNLOCK_THRESHOLD);
    expect(state.level).toBe(MAFIA_UNLOCK_THRESHOLD);
    expect(r.mafiaJustUnlocked).toBe(true);
    expect(state.mafiaUnlocked).toBe(true);
    expect(isMafiaUnlocked(state)).toBe(true);
  });

  it('crossing the threshold incrementally unlocks mafia', () => {
    const state = createCorruptionState();
    state.level = MAFIA_UNLOCK_THRESHOLD - 1;
    const r = applyCorruptionDelta(state, 1);
    expect(r.mafiaJustUnlocked).toBe(true);
    expect(state.mafiaUnlocked).toBe(true);
  });

  it('single jump well past the threshold unlocks mafia', () => {
    const state = createCorruptionState();
    const r = applyCorruptionDelta(state, MAFIA_UNLOCK_THRESHOLD + 5);
    expect(state.level).toBe(MAFIA_UNLOCK_THRESHOLD + 5);
    expect(r.mafiaJustUnlocked).toBe(true);
    expect(state.mafiaUnlocked).toBe(true);
  });

  it('later call once unlocked returns mafiaJustUnlocked false', () => {
    const state = createCorruptionState();
    applyCorruptionDelta(state, MAFIA_UNLOCK_THRESHOLD + 5);
    const r = applyCorruptionDelta(state, 2);
    expect(r.mafiaJustUnlocked).toBe(false);
    expect(state.level).toBe(MAFIA_UNLOCK_THRESHOLD + 7);
    expect(state.mafiaUnlocked).toBe(true);
  });

  it('negative delta lowers the level', () => {
    const state = createCorruptionState();
    state.level = 10;
    applyCorruptionDelta(state, -4);
    expect(state.level).toBe(6);
  });

  it('delta -25 from level 2 floors at 0', () => {
    const state = createCorruptionState();
    state.level = 2;
    applyCorruptionDelta(state, -25);
    expect(state.level).toBe(0);
  });

  it('negative delta at level 0 stays 0', () => {
    const state = createCorruptionState();
    const r = applyCorruptionDelta(state, -3);
    expect(state.level).toBe(0);
    expect(r.mafiaJustUnlocked).toBe(false);
  });

  it('delta 0 leaves state unchanged', () => {
    const state = createCorruptionState();
    state.level = 2;
    const r = applyCorruptionDelta(state, 0);
    expect(state.level).toBe(2);
    expect(state.mafiaUnlocked).toBe(false);
    expect(r.mafiaJustUnlocked).toBe(false);
  });

  it('NaN delta leaves state unchanged', () => {
    const state = createCorruptionState();
    state.level = 2;
    const r = applyCorruptionDelta(state, NaN);
    expect(state.level).toBe(2);
    expect(Number.isNaN(state.level)).toBe(false);
    expect(state.mafiaUnlocked).toBe(false);
    expect(r.mafiaJustUnlocked).toBe(false);
  });

  it('Infinity delta is a no-op', () => {
    const state = createCorruptionState();
    state.level = 2;
    const r = applyCorruptionDelta(state, Infinity);
    expect(state.level).toBe(2);
    expect(state.mafiaUnlocked).toBe(false);
    expect(r.mafiaJustUnlocked).toBe(false);
  });

  it('mafiaUnlocked latches after level drops below threshold', () => {
    const state = createCorruptionState();
    applyCorruptionDelta(state, MAFIA_UNLOCK_THRESHOLD + 5);
    applyCorruptionDelta(state, -(MAFIA_UNLOCK_THRESHOLD + 25));
    expect(state.level).toBe(0);
    expect(state.mafiaUnlocked).toBe(true);
    const r = applyCorruptionDelta(state, MAFIA_UNLOCK_THRESHOLD);
    expect(r.mafiaJustUnlocked).toBe(false);
  });

  it('clamps at CORRUPTION_MAX (99 + 20 -> 100)', () => {
    const state = createCorruptionState();
    state.level = 99;
    applyCorruptionDelta(state, 20);
    expect(CORRUPTION_MAX).toBe(100);
    expect(state.level).toBe(CORRUPTION_MAX);
  });

  it('exactly reaching CORRUPTION_MAX is allowed and a further delta stays there', () => {
    const state = createCorruptionState();
    applyCorruptionDelta(state, CORRUPTION_MAX);
    expect(state.level).toBe(CORRUPTION_MAX);
    applyCorruptionDelta(state, 1);
    expect(state.level).toBe(CORRUPTION_MAX);
  });

  it('floors at 0 (3 - 10 -> 0)', () => {
    const state = createCorruptionState();
    state.level = 3;
    applyCorruptionDelta(state, -10);
    expect(state.level).toBe(0);
  });

  it('a clamped jump past the max still unlocks the mafia', () => {
    const state = createCorruptionState();
    const r = applyCorruptionDelta(state, 500);
    expect(state.level).toBe(CORRUPTION_MAX);
    expect(r.mafiaJustUnlocked).toBe(true);
  });

  it('does not touch attempts history', () => {
    const state = createCorruptionState();
    applyCorruptionDelta(state, 5);
    expect(state.attempts).toHaveLength(0);
    expect(state.protections).toHaveLength(0);
  });
});


describe('Bribe failure consequences (#1411)', () => {
  it('fine is the configured fraction of cost, rounded', () => {
    expect(bribeFailureFine(8000)).toBe(Math.round(8000 * BRIBERY_FAILURE_FINE_FRACTION));
    expect(bribeFailureFine(8001)).toBe(Math.round(8001 * BRIBERY_FAILURE_FINE_FRACTION));
    expect(bribeFailureFine(8000)).toBeGreaterThan(0);
  });

  it('fine is 0 for zero, negative and non-finite cost', () => {
    expect(bribeFailureFine(0)).toBe(0);
    expect(bribeFailureFine(-100)).toBe(0);
    expect(bribeFailureFine(NaN)).toBe(0);
    expect(bribeFailureFine(Infinity)).toBe(0);
  });

  it('applyBribeFailure lowers nuisance score by the configured hit', () => {
    const corruption = createCorruptionState();
    const scores = createScoreState();
    scores.nuisance = 50;
    applyBribeFailure(corruption, scores, 8000);
    expect(scores.nuisance).toBe(50 - BRIBERY_FAILURE_NUISANCE_HIT);
  });

  it('applyBribeFailure clamps nuisance at 0', () => {
    const scores = createScoreState();
    scores.nuisance = 3;
    applyBribeFailure(createCorruptionState(), scores, 8000);
    expect(scores.nuisance).toBe(0);
  });

  it('applyBribeFailure raises the corruption level by the configured delta', () => {
    const corruption = createCorruptionState();
    applyBribeFailure(corruption, createScoreState(), 8000);
    expect(getCorruptionLevel(corruption)).toBe(BRIBERY_FAILURE_CORRUPTION_DELTA);
  });

  it('applyBribeFailure can latch the mafia unlock through the corruption delta', () => {
    const corruption = createCorruptionState();
    corruption.level = MAFIA_THRESHOLD - 1;
    applyBribeFailure(corruption, createScoreState(), 8000);
    expect(isMafiaUnlocked(corruption)).toBe(true);
  });

  it('applyBribeFailure returns the fine for the given cost', () => {
    const { fine } = applyBribeFailure(createCorruptionState(), createScoreState(), 12000);
    expect(fine).toBe(bribeFailureFine(12000));
    expect(fine).toBeGreaterThan(0);
  });

  it('applyBribeFailure with zero cost fines nothing', () => {
    const { fine } = applyBribeFailure(createCorruptionState(), createScoreState(), 0);
    expect(fine).toBe(0);
  });
});
