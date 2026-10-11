// Steps — resumable computations run in one go or a slice at a time (#1603)

import { describe, it, expect } from 'vitest';
import { drain, advance, type Steps } from '../../../src/core/engine/Steps.js';

/** Sums 1..n, yielding after each addition, and logs every slice it ran. */
function* sum(n: number, log: number[]): Steps<number> {
  let total = 0;
  for (let i = 1; i <= n; i++) {
    total += i;
    log.push(i);
    yield;
  }
  return total;
}

describe('drain', () => {
  it('runs every slice and returns the result', () => {
    const log: number[] = [];
    expect(drain(sum(4, log))).toBe(10);
    expect(log).toEqual([1, 2, 3, 4]);
  });

  it('returns at once for a computation that never yields', () => {
    function* immediate(): Steps<string> { return 'done'; }
    expect(drain(immediate())).toBe('done');
  });
});

describe('advance', () => {
  it('stops as soon as the budget is spent, and resumes where it stopped', () => {
    const log: number[] = [];
    const steps = sum(5, log);
    let calls = 0;
    const twoSteps = () => ++calls % 2 === 0;

    expect(advance(steps, twoSteps).done).toBe(false);
    expect(log).toEqual([1, 2]);
    expect(advance(steps, twoSteps).done).toBe(false);
    expect(log).toEqual([1, 2, 3, 4]);
    const last = advance(steps, () => false);
    expect(last).toEqual({ done: true, value: 15 });
  });

  it('takes at least one step even with no budget at all', () => {
    const log: number[] = [];
    const steps = sum(3, log);
    advance(steps, () => true);
    expect(log).toEqual([1]);
  });

  it('gives the same result in slices as in one go', () => {
    const sliced = sum(50, []);
    let result: IteratorResult<void, number>;
    do result = advance(sliced, () => true); while (result.done !== true);
    expect(result.value).toBe(drain(sum(50, [])));
  });
});
