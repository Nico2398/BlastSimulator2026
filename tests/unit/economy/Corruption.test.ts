import { describe, it, expect } from 'vitest';
import { MAFIA_UNLOCK_THRESHOLD } from '../../../src/core/config/balance.js';
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

  it('single jump well past the threshold (0 -> 5) unlocks mafia', () => {
    const state = createCorruptionState();
    const r = applyCorruptionDelta(state, 5);
    expect(state.level).toBe(5);
    expect(r.mafiaJustUnlocked).toBe(true);
    expect(state.mafiaUnlocked).toBe(true);
  });

  it('later call once unlocked returns mafiaJustUnlocked false', () => {
    const state = createCorruptionState();
    applyCorruptionDelta(state, 5);
    const r = applyCorruptionDelta(state, 2);
    expect(r.mafiaJustUnlocked).toBe(false);
    expect(state.level).toBe(7);
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
    applyCorruptionDelta(state, 5);
    applyCorruptionDelta(state, -25);
    expect(state.level).toBe(0);
    expect(state.mafiaUnlocked).toBe(true);
    const r = applyCorruptionDelta(state, MAFIA_UNLOCK_THRESHOLD);
    expect(r.mafiaJustUnlocked).toBe(false);
  });

  it('does not touch attempts history', () => {
    const state = createCorruptionState();
    applyCorruptionDelta(state, 5);
    expect(state.attempts).toHaveLength(0);
  });
});
