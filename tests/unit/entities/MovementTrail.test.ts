// MovementTrail — unit tests (#1199)

import { describe, it, expect } from 'vitest';
import {
  appendToTrail, isSameTrailPoint, openMovementTrail, MOVEMENT_TRAIL_MAX_POINTS,
} from '../../../src/core/entities/MovementTrail.js';

describe('MovementTrail', () => {
  it('openMovementTrail anchors a fresh, unrelocated trail at the given position', () => {
    expect(openMovementTrail(3, 4)).toEqual({ points: [{ x: 3, z: 4 }], relocated: false });
  });

  it('appendToTrail extends a trail walked on from its own tail', () => {
    const trail = openMovementTrail(0, 0);
    appendToTrail(trail, 0, 0, [{ x: 1, z: 0 }, { x: 1, z: 1 }]);
    appendToTrail(trail, 1, 1, [{ x: 1, z: 2 }]);
    expect(trail).toEqual({ points: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 1, z: 2 }], relocated: false });
  });

  it('appendToTrail skips a hop repeating the trail tail', () => {
    const trail = openMovementTrail(0, 0);
    appendToTrail(trail, 0, 0, [{ x: 1, z: 0 }, { x: 1, z: 0 }]);
    expect(trail.points).toEqual([{ x: 0, z: 0 }, { x: 1, z: 0 }]);
  });

  it('appendToTrail flags a relocation and restarts at the walk start when that start is not the tail', () => {
    const trail = openMovementTrail(0, 0);
    appendToTrail(trail, 5, 5, [{ x: 6, z: 5 }]);
    expect(trail).toEqual({ points: [{ x: 5, z: 5 }, { x: 6, z: 5 }], relocated: true });
  });

  it('appendToTrail drops the oldest points past MOVEMENT_TRAIL_MAX_POINTS', () => {
    const trail = openMovementTrail(0, 0);
    const hops = Array.from({ length: MOVEMENT_TRAIL_MAX_POINTS + 10 }, (_, i) => ({ x: i + 1, z: 0 }));
    appendToTrail(trail, 0, 0, hops);
    expect(trail.points).toHaveLength(MOVEMENT_TRAIL_MAX_POINTS);
    expect(trail.points[trail.points.length - 1]).toEqual({ x: MOVEMENT_TRAIL_MAX_POINTS + 10, z: 0 });
  });

  it('isSameTrailPoint tolerates float noise but not a real offset', () => {
    expect(isSameTrailPoint({ x: 1, z: 2 }, 1 + 1e-9, 2)).toBe(true);
    expect(isSameTrailPoint({ x: 1, z: 2 }, 1.01, 2)).toBe(false);
  });
});
