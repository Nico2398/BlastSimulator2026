import { describe, it, expect } from 'vitest';
import { Random } from '../../../../src/core/math/Random.js';
import { lerp, listHas, pickWeighted } from '../../../../src/audio/director/scalar.js';

describe('scalar helpers', () => {
  it('lerps between two values', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it('picks by weight and honours the odds over many draws', () => {
    const random = new Random(5);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 2000; i++) {
      const pick = pickWeighted(random, [['a', 1], ['b', 3]] as const);
      if (pick) counts[pick]++;
    }
    expect(counts.b / counts.a).toBeGreaterThan(2.4);
    expect(counts.b / counts.a).toBeLessThan(3.8);
  });

  it('never picks a zero-weight entry and returns null for an empty or all-zero table', () => {
    const random = new Random(1);
    for (let i = 0; i < 200; i++) expect(pickWeighted(random, [['x', 0], ['y', 2]] as const)).toBe('y');
    expect(pickWeighted(random, [])).toBeNull();
    expect(pickWeighted(random, [['x', 0]] as const)).toBeNull();
  });

  it('lists membership of plain strings', () => {
    expect(listHas(['a', 'b'], 'b')).toBe(true);
    expect(listHas(['a', 'b'], 'c')).toBe(false);
  });
});
