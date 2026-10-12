import { describe, it, expect } from 'vitest';
import { duckLevelAt, mergeDuck, NO_DUCK, scheduleDuck } from '../../../../src/audio/engine/ducking.js';
import { FakeParam } from '../../../helpers/audioFakes.js';

const TC = 4;
const ATTACK = 0.03;

describe('duck level', () => {
  it('is unity without a duck', () => {
    expect(duckLevelAt(NO_DUCK, 10, TC)).toBe(1);
  });

  it('holds at the level, then climbs back exponentially and arrives at 1', () => {
    const duck = mergeDuck(NO_DUCK, 0, 0.25, 1, 2, ATTACK, TC);
    expect(duckLevelAt(duck, 0.5, TC)).toBe(0.25);
    expect(duckLevelAt(duck, 1, TC)).toBe(0.25);
    const mid = duckLevelAt(duck, 2, TC);
    expect(mid).toBeGreaterThan(0.25);
    expect(mid).toBeLessThan(1);
    // exponential: one time constant (0.5 s) in, 63% of the way back
    expect(duckLevelAt(duck, 1.5, TC)).toBeCloseTo(1 - 0.75 * Math.exp(-1), 6);
    expect(duckLevelAt(duck, 3, TC)).toBe(1);
  });

  it('rises monotonically during the release', () => {
    const duck = mergeDuck(NO_DUCK, 0, 0.1, 0.5, 1.5, ATTACK, TC);
    let previous = 0;
    for (let t = 0.5; t <= 2; t += 0.1) {
      const level = duckLevelAt(duck, t, TC);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});

describe('merging overlapping ducks', () => {
  it('keeps the deeper level while a shallower duck arrives', () => {
    const deep = mergeDuck(NO_DUCK, 0, 0.1, 2, 1, ATTACK, TC);
    const merged = mergeDuck(deep, 0.5, 0.5, 1, 1, ATTACK, TC);
    expect(merged.level).toBe(0.1);
    expect(merged.holdEnd).toBe(2);
  });

  it('takes the deeper level when a deeper duck arrives', () => {
    const shallow = mergeDuck(NO_DUCK, 0, 0.5, 2, 1, ATTACK, TC);
    const merged = mergeDuck(shallow, 0.5, 0.1, 0.5, 1, ATTACK, TC);
    expect(merged.level).toBe(0.1);
    expect(merged.holdEnd).toBe(2);
  });

  it('extends the hold to whichever ends later', () => {
    const first = mergeDuck(NO_DUCK, 0, 0.1, 1, 1, ATTACK, TC);
    const merged = mergeDuck(first, 0.5, 0.3, 3, 1, ATTACK, TC);
    expect(merged.holdEnd).toBe(3.5);
    expect(merged.level).toBe(0.1);
  });

  it('a duck arriving mid-release starts from the level the release has reached', () => {
    const first = mergeDuck(NO_DUCK, 0, 0.2, 1, 2, ATTACK, TC);
    const reached = duckLevelAt(first, 1.5, TC);
    const merged = mergeDuck(first, 1.5, 0.9, 0.5, 1, ATTACK, TC);
    expect(merged.level).toBeCloseTo(Math.min(0.9, reached), 10);
    expect(merged.holdEnd).toBe(2);
    expect(merged.releaseS).toBe(1);
  });

  it('holds at least as long as the attack', () => {
    const merged = mergeDuck(NO_DUCK, 0, 0.5, 0, 1, ATTACK, TC);
    expect(merged.holdEnd).toBe(ATTACK);
  });
});

describe('scheduleDuck', () => {
  it('queues attack, hold and exponential release on the param', () => {
    const p = new FakeParam(1, { currentTime: 0 });
    const state = mergeDuck(NO_DUCK, 1, 0.25, 2, 1, ATTACK, TC);
    scheduleDuck(p as unknown as AudioParam, 1, state, 1, ATTACK, TC);
    expect(p.events).toEqual([
      { type: 'cancel', value: 0, time: 1 },
      { type: 'set', value: 1, time: 1 },
      { type: 'linear', value: 0.25, time: 1 + ATTACK },
      { type: 'set', value: 0.25, time: 3 },
      { type: 'target', value: 1, time: 3, timeConstant: 0.25 },
      { type: 'set', value: 1, time: 4 },
    ]);
  });
});
