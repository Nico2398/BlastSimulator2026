// BlastSimulator2026 — Union grievance: refusals build toward a strike (#1890)

import { describe, it, expect } from 'vitest';
import {
  unionStance, applyUnionDecision, strikePressure, strikeDue,
} from '../../../src/core/events/UnionGrievance.js';
import {
  UNION_GRIEVANCE_PER_REFUSAL, UNION_GRIEVANCE_EASE_PER_MET, UNION_GRIEVANCE_STRIKE_THRESHOLD,
  UNION_GRIEVANCE_MAX, UNION_GRIEVANCE_AFTER_STRIKE, UNION_STRIKE_MIN_MEMBERS,
} from '../../../src/core/config/balance.js';

const union = { category: 'union' as const };
const refusal = { scoreDelta: { wellBeing: -6 } };
const met = { scoreDelta: { wellBeing: 10 } };

describe('unionStance', () => {
  it('negative well-being delta is a refusal', () => {
    expect(unionStance(refusal)).toBe('refused');
  });
  it('positive well-being delta is a met demand', () => {
    expect(unionStance(met)).toBe('met');
  });
  it('zero well-being delta is neutral', () => {
    expect(unionStance({ scoreDelta: { wellBeing: 0 } })).toBe('neutral');
  });
  it('no score delta is neutral', () => {
    expect(unionStance({})).toBe('neutral');
  });
  it('a delta touching only other scores is neutral', () => {
    expect(unionStance({ scoreDelta: { safety: 5 } })).toBe('neutral');
  });
});

describe('applyUnionDecision', () => {
  it('a refusal raises grievance by UNION_GRIEVANCE_PER_REFUSAL', () => {
    const s = { unionGrievance: 0 };
    applyUnionDecision(s, union, refusal);
    expect(s.unionGrievance).toBe(UNION_GRIEVANCE_PER_REFUSAL);
  });
  it('refusals stack', () => {
    const s = { unionGrievance: 0 };
    applyUnionDecision(s, union, refusal);
    applyUnionDecision(s, union, refusal);
    expect(s.unionGrievance).toBe(2 * UNION_GRIEVANCE_PER_REFUSAL);
  });
  it('a met demand eases grievance by UNION_GRIEVANCE_EASE_PER_MET', () => {
    const s = { unionGrievance: 40 };
    applyUnionDecision(s, union, met);
    expect(s.unionGrievance).toBe(40 - UNION_GRIEVANCE_EASE_PER_MET);
  });
  it('easing never goes below zero', () => {
    const s = { unionGrievance: 3 };
    applyUnionDecision(s, union, met);
    expect(s.unionGrievance).toBe(0);
  });
  it('raising never exceeds UNION_GRIEVANCE_MAX', () => {
    const s = { unionGrievance: UNION_GRIEVANCE_MAX - 1 };
    applyUnionDecision(s, union, refusal);
    expect(s.unionGrievance).toBe(UNION_GRIEVANCE_MAX);
  });
  it('a neutral outcome leaves grievance unchanged', () => {
    const s = { unionGrievance: 30 };
    applyUnionDecision(s, union, {});
    expect(s.unionGrievance).toBe(30);
  });
  it('a non-union category is a no-op even when it refuses', () => {
    const s = { unionGrievance: 30 };
    applyUnionDecision(s, { category: 'lawsuit' }, refusal);
    applyUnionDecision(s, { category: 'politics' }, met);
    expect(s.unionGrievance).toBe(30);
  });
  it("a 'strike'-tagged event resets grievance to UNION_GRIEVANCE_AFTER_STRIKE", () => {
    const s = { unionGrievance: UNION_GRIEVANCE_MAX };
    applyUnionDecision(s, { category: 'union', tags: ['strike'] }, refusal);
    expect(s.unionGrievance).toBe(UNION_GRIEVANCE_AFTER_STRIKE);
  });
  it("a 'strike'-tagged event resets grievance even when the demand is met", () => {
    const s = { unionGrievance: UNION_GRIEVANCE_STRIKE_THRESHOLD };
    applyUnionDecision(s, { category: 'union', tags: ['strike'] }, met);
    expect(s.unionGrievance).toBe(UNION_GRIEVANCE_AFTER_STRIKE);
  });
});

describe('strikePressure', () => {
  it('undefined grievance is 0', () => {
    expect(strikePressure(undefined)).toBe(0);
  });
  it('zero grievance is 0', () => {
    expect(strikePressure(0)).toBe(0);
  });
  it('half the threshold is 0.5', () => {
    expect(strikePressure(UNION_GRIEVANCE_STRIKE_THRESHOLD / 2)).toBeCloseTo(0.5);
  });
  it('the threshold is 1', () => {
    expect(strikePressure(UNION_GRIEVANCE_STRIKE_THRESHOLD)).toBe(1);
  });
  it('clamps at 1 above the threshold', () => {
    expect(strikePressure(UNION_GRIEVANCE_MAX)).toBe(1);
  });
  it('clamps at 0 for negative grievance', () => {
    expect(strikePressure(-10)).toBe(0);
  });
});

describe('strikeDue', () => {
  it('is false below the threshold', () => {
    expect(strikeDue(UNION_GRIEVANCE_STRIKE_THRESHOLD - 1, 5)).toBe(false);
  });
  it('is true at the threshold with members', () => {
    expect(strikeDue(UNION_GRIEVANCE_STRIKE_THRESHOLD, UNION_STRIKE_MIN_MEMBERS)).toBe(true);
  });
  it('is false with too few members however high grievance is', () => {
    expect(strikeDue(UNION_GRIEVANCE_MAX, UNION_STRIKE_MIN_MEMBERS - 1)).toBe(false);
  });
  it('is false for undefined grievance', () => {
    expect(strikeDue(undefined, 5)).toBe(false);
  });
  it('is false for undefined members', () => {
    expect(strikeDue(UNION_GRIEVANCE_MAX, undefined)).toBe(false);
  });
});
