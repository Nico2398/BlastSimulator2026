import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createCorruptionState,
  attemptCorruption,
  getCorruptionLevel,
  isMafiaUnlocked,
  getSuccessRate,
  MAFIA_THRESHOLD,
} from '../../../src/core/economy/Corruption.js';

describe('Corruption system', () => {
  it('corruption attempt deducts cost', () => {
    const state = createCorruptionState();
    const result = attemptCorruption(state, 'inspector', 1, new Random(42));
    expect(result.cost).toBe(8000);
  });

  it('successful corruption removes the original problem', () => {
    // Find a seed that succeeds
    for (let seed = 0; seed < 100; seed++) {
      const state = createCorruptionState();
      const result = attemptCorruption(state, 'judge', 1, new Random(seed));
      if (result.success) {
        expect(result.scandalTriggered).toBe(false);
        expect(getCorruptionLevel(state)).toBe(1);
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

  it('reaching corruption threshold unlocks mafia events', () => {
    const state = createCorruptionState();
    expect(isMafiaUnlocked(state)).toBe(false);

    // Make enough attempts to reach threshold
    for (let i = 0; i < MAFIA_THRESHOLD; i++) {
      const result = attemptCorruption(state, 'inspector', i, new Random(i));
      if (result.mafiaJustUnlocked) {
        expect(isMafiaUnlocked(state)).toBe(true);
        return;
      }
    }

    // Keep going if needed
    for (let i = MAFIA_THRESHOLD; i < 20; i++) {
      attemptCorruption(state, 'inspector', i, new Random(i));
      if (isMafiaUnlocked(state)) {
        expect(getCorruptionLevel(state)).toBeGreaterThanOrEqual(MAFIA_THRESHOLD);
        return;
      }
    }
    expect.unreachable('Mafia never unlocked');
  });
});
