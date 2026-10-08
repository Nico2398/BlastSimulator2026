import { describe, it, expect } from 'vitest';
import { revoltCause } from '../../../src/core/scores/RevoltCause.js';
import type { ShiftMode } from '../../../src/core/entities/SitePolicy.js';

describe('revoltCause', () => {
  it('continuous with housing -> no_rest_policy', () => {
    expect(revoltCause('continuous', true)).toBe('no_rest_policy');
  });

  it('no-rest policy takes precedence over missing housing', () => {
    expect(revoltCause('continuous', false)).toBe('no_rest_policy');
  });

  it('shift_8h without active housing -> no_housing', () => {
    expect(revoltCause('shift_8h', false)).toBe('no_housing');
  });

  it('shift_12h without active housing -> no_housing', () => {
    expect(revoltCause('shift_12h', false)).toBe('no_housing');
  });

  it('shift_8h with housing -> morale_drain', () => {
    expect(revoltCause('shift_8h', true)).toBe('morale_drain');
  });

  it('shift_12h with housing -> morale_drain', () => {
    expect(revoltCause('shift_12h', true)).toBe('morale_drain');
  });

  it('covers every shift mode x housing combination', () => {
    const modes: ShiftMode[] = ['shift_8h', 'shift_12h', 'continuous'];
    for (const m of modes) {
      for (const housing of [true, false]) {
        const expected = m === 'continuous'
          ? 'no_rest_policy'
          : housing ? 'morale_drain' : 'no_housing';
        expect(revoltCause(m, housing)).toBe(expected);
      }
    }
  });
});
