// BlastSimulator2026 — recordBuildingDestruction has one penalty for every building (#2154)

import { describe, it, expect } from 'vitest';
import {
  createScoreState,
  recordBuildingDestruction,
  type ScoreState,
} from '../../../src/core/scores/ScoreManager.js';

/** The old second argument, passed through a cast: the function no longer declares it. */
const withLegacyFlag = recordBuildingDestruction as unknown as (state: ScoreState, flag: boolean) => void;

describe('recordBuildingDestruction (#2154)', () => {
  it('costs safety 15 and ecology 8', () => {
    const s = createScoreState();
    recordBuildingDestruction(s);
    expect(s.safety).toBe(35);
    expect(s.ecology).toBe(42);
  });

  it('leaves well-being and nuisance unchanged', () => {
    const s = createScoreState();
    recordBuildingDestruction(s);
    expect(s.wellBeing).toBe(50);
    expect(s.nuisance).toBe(50);
  });

  it('a second argument of true changes nothing', () => {
    const plain = createScoreState();
    const flagged = createScoreState();
    recordBuildingDestruction(plain);
    withLegacyFlag(flagged, true);
    expect(flagged).toEqual(plain);
    expect(flagged.safety).toBe(35);
    expect(flagged.wellBeing).toBe(50);
  });

  it('a second argument of false changes nothing', () => {
    const plain = createScoreState();
    const flagged = createScoreState();
    recordBuildingDestruction(plain);
    withLegacyFlag(flagged, false);
    expect(flagged).toEqual(plain);
  });

  it('accumulates per destruction', () => {
    const s = createScoreState();
    recordBuildingDestruction(s);
    recordBuildingDestruction(s);
    expect(s.safety).toBe(20);
    expect(s.ecology).toBe(34);
  });

  it('clamps at zero', () => {
    const s = createScoreState();
    s.safety = 10;
    s.ecology = 5;
    recordBuildingDestruction(s);
    expect(s.safety).toBe(0);
    expect(s.ecology).toBe(0);
  });

  it('clamps well-being untouched at zero', () => {
    const s = createScoreState();
    s.wellBeing = 0;
    withLegacyFlag(s, true);
    expect(s.wellBeing).toBe(0);
  });
});
