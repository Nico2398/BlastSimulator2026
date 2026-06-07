import { describe, it, expect } from 'vitest';
import {
  vec3, add, sub, scale, normalize, distance, squaredDistance,
  dot, cross, length, lerp, clamp, equals,
} from '../../../src/core/math/Vec3.js';

describe('Vec3 — basic operations', () => {
  it('add combines two vectors', () => {
    expect(add(vec3(1, 2, 3), vec3(4, 5, 6))).toEqual(vec3(5, 7, 9));
  });

  it('sub subtracts two vectors', () => {
    expect(sub(vec3(5, 7, 9), vec3(4, 5, 6))).toEqual(vec3(1, 2, 3));
  });

  it('scale multiplies by a scalar', () => {
    expect(scale(vec3(1, 2, 3), 2)).toEqual(vec3(2, 4, 6));
  });

  it('dot product is correct', () => {
    expect(dot(vec3(1, 0, 0), vec3(0, 1, 0))).toBe(0);
    expect(dot(vec3(1, 2, 3), vec3(4, 5, 6))).toBe(32);
  });

  it('cross product is correct', () => {
    expect(cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual(vec3(0, 0, 1));
  });
});

describe('Vec3 — length and normalize', () => {
  it('length of (3, 4, 0) is 5', () => {
    expect(length(vec3(3, 4, 0))).toBeCloseTo(5);
  });

  it('length of zero vector is 0', () => {
    expect(length(vec3(0, 0, 0))).toBe(0);
  });

  it('normalize produces unit length', () => {
    const n = normalize(vec3(3, 4, 0));
    expect(length(n)).toBeCloseTo(1);
    expect(n.x).toBeCloseTo(0.6);
    expect(n.y).toBeCloseTo(0.8);
  });

  it('normalize zero vector returns zero vector', () => {
    expect(normalize(vec3(0, 0, 0))).toEqual(vec3(0, 0, 0));
  });
});

describe('Vec3 — distance', () => {
  it('distance between same point is 0', () => {
    expect(distance(vec3(1, 2, 3), vec3(1, 2, 3))).toBe(0);
  });

  it('distance between (0,0,0) and (3,4,0) is 5', () => {
    expect(distance(vec3(0, 0, 0), vec3(3, 4, 0))).toBeCloseTo(5);
  });
});

describe('Vec3 — squaredDistance', () => {
  it('squaredDistance between same point is 0', () => {
    expect(squaredDistance(vec3(1, 2, 3), vec3(1, 2, 3))).toBe(0);
  });

  it('squaredDistance between (0,0,0) and (3,4,0) is 25', () => {
    // 3² + 4² + 0² = 9 + 16 + 0 = 25 (no sqrt)
    expect(squaredDistance(vec3(0, 0, 0), vec3(3, 4, 0))).toBe(25);
  });

  it('squaredDistance matches distance² for arbitrary points', () => {
    const a = vec3(2, 3, 4);
    const b = vec3(5, 7, 9);
    const expected = distance(a, b) ** 2;
    expect(squaredDistance(a, b)).toBeCloseTo(expected, 10);
  });

  it('squaredDistance is symmetric', () => {
    const a = vec3(1, 5, 9);
    const b = vec3(4, 2, 7);
    expect(squaredDistance(a, b)).toBe(squaredDistance(b, a));
  });

  it('squaredDistance is non-negative', () => {
    expect(squaredDistance(vec3(-10, -10, -10), vec3(10, 10, 10))).toBeGreaterThanOrEqual(0);
  });
});

describe('Vec3 — lerp', () => {
  it('lerp at t=0 returns a', () => {
    expect(lerp(vec3(0, 0, 0), vec3(10, 10, 10), 0)).toEqual(vec3(0, 0, 0));
  });

  it('lerp at t=1 returns b', () => {
    expect(lerp(vec3(0, 0, 0), vec3(10, 10, 10), 1)).toEqual(vec3(10, 10, 10));
  });

  it('lerp at t=0.5 returns midpoint', () => {
    expect(lerp(vec3(0, 0, 0), vec3(10, 10, 10), 0.5)).toEqual(vec3(5, 5, 5));
  });
});

describe('Vec3 — clamp', () => {
  it('clamps each component within min/max', () => {
    const result = clamp(vec3(-5, 15, 7), vec3(0, 0, 0), vec3(10, 10, 10));
    expect(result).toEqual(vec3(0, 10, 7));
  });
});
