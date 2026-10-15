import { describe, it, expect } from 'vitest';
import { computeCrewFatigueStrain } from '../../../src/core/entities/EmployeeNeeds.js';

type Member = { alive: boolean; injured: boolean; fatigue: number };
const m = (fatigue: number, o: Partial<Member> = {}): Member => ({ alive: true, injured: false, fatigue, ...o });

describe('computeCrewFatigueStrain (#1692)', () => {
  it('is 0 for an empty crew', () => {
    expect(computeCrewFatigueStrain([])).toBe(0);
  });

  it('is 0 when every member is dead', () => {
    expect(computeCrewFatigueStrain([m(0, { alive: false }), m(10, { alive: false })])).toBe(0);
  });

  it('is 0 when everyone is rested (fatigue >= 50)', () => {
    expect(computeCrewFatigueStrain([m(50), m(85), m(100)])).toBe(0);
  });

  it('is 1 when everyone is at fatigue 0', () => {
    expect(computeCrewFatigueStrain([m(0), m(0), m(0)])).toBe(1);
  });

  it('comfort line is 50 (#1778): 50 -> 0, 25 -> 0.5, 0 -> 1', () => {
    expect(computeCrewFatigueStrain([m(50)])).toBe(0);
    expect(computeCrewFatigueStrain([m(25)])).toBeCloseTo(0.5, 10);
    expect(computeCrewFatigueStrain([m(0)])).toBe(1);
  });

  it('fatigue left by the default rest cycle (60-70) carries no strain (#1778)', () => {
    expect(computeCrewFatigueStrain([m(60), m(65), m(70)])).toBe(0);
  });

  it('ignores dead members', () => {
    expect(computeCrewFatigueStrain([m(100), m(0, { alive: false })])).toBe(0);
  });

  it('ignores injured members', () => {
    expect(computeCrewFatigueStrain([m(100), m(0, { injured: true })])).toBe(0);
  });

  it('averages over the remaining crew (one exhausted of two = 0.5)', () => {
    expect(computeCrewFatigueStrain([m(0), m(100)])).toBeCloseTo(0.5, 10);
  });

  it('is strictly between 0 and 1 for partial fatigue', () => {
    const v = computeCrewFatigueStrain([m(35)]);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it('is monotonic: lower fatigue never reduces strain', () => {
    let prev = -1;
    for (let f = 100; f >= 0; f -= 5) {
      const v = computeCrewFatigueStrain([m(f), m(100)]);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
