// Heading — yaw math for +X-facing models

import { describe, it, expect } from 'vitest';
import { headingFromDelta, turnToward } from '../../../src/renderer/Heading.js';

describe('headingFromDelta', () => {
  it('is 0 when moving along +X (the model rest direction)', () => {
    expect(headingFromDelta(1, 0)).toBeCloseTo(0);
  });

  it('turns a +X-facing model toward +Z with a negative yaw and toward -Z with a positive one', () => {
    expect(headingFromDelta(0, 1)).toBeCloseTo(-Math.PI / 2);
    expect(headingFromDelta(0, -1)).toBeCloseTo(Math.PI / 2);
  });
});

describe('turnToward', () => {
  it('reaches the target when it lies within one step', () => {
    expect(turnToward(0, 0.2, 0.5)).toBeCloseTo(0.2);
  });

  it('advances by exactly the step when the target is further away', () => {
    expect(turnToward(0, 2, 0.5)).toBeCloseTo(0.5);
    expect(turnToward(0, -2, 0.5)).toBeCloseTo(-0.5);
  });

  it('takes the shorter arc across the ±π seam', () => {
    // From just below +π toward just above -π: the short way is forward past +π.
    const next = turnToward(Math.PI - 0.1, -Math.PI + 0.1, 0.05);
    expect(next).toBeCloseTo(Math.PI - 0.05);
  });
});
