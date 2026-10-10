// MovementTrail — unit tests (#1199)

import { describe, it, expect } from 'vitest';
import {
  appendHostTransition, appendToTrail, isSameTrailPoint, openMovementTrail, MOVEMENT_TRAIL_MAX_POINTS,
} from '../../../src/core/entities/MovementTrail.js';

describe('MovementTrail', () => {
  it('openMovementTrail anchors a fresh, unrelocated trail at the given position', () => {
    expect(openMovementTrail(3, 4)).toEqual({ points: [{ x: 3, z: 4 }], relocated: false, hostMarkers: [] });
  });

  it('appendToTrail extends a trail walked on from its own tail', () => {
    const trail = openMovementTrail(0, 0);
    appendToTrail(trail, 0, 0, [{ x: 1, z: 0 }, { x: 1, z: 1 }]);
    appendToTrail(trail, 1, 1, [{ x: 1, z: 2 }]);
    expect(trail).toEqual({ points: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 1, z: 2 }], relocated: false, hostMarkers: [] });
  });

  it('appendToTrail skips a hop repeating the trail tail', () => {
    const trail = openMovementTrail(0, 0);
    appendToTrail(trail, 0, 0, [{ x: 1, z: 0 }, { x: 1, z: 0 }]);
    expect(trail.points).toEqual([{ x: 0, z: 0 }, { x: 1, z: 0 }]);
  });

  it('appendToTrail flags a relocation and restarts at the walk start when that start is not the tail', () => {
    const trail = openMovementTrail(0, 0);
    appendToTrail(trail, 5, 5, [{ x: 6, z: 5 }]);
    expect(trail).toEqual({ points: [{ x: 5, z: 5 }, { x: 6, z: 5 }], relocated: true, hostMarkers: [] });
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

  describe('host transitions (#1588)', () => {
    it('openMovementTrail starts with no host markers', () => {
      expect(openMovementTrail(0, 0).hostMarkers).toEqual([]);
    });

    it('appendHostTransition appends the point and marks it with the host position', () => {
      const trail = openMovementTrail(0, 0);
      appendToTrail(trail, 0, 0, [{ x: 1, z: 0 }]);
      appendHostTransition(trail, 2, 0, 'board', 'vehicle', 2.5, 0.25);
      expect(trail.points).toEqual([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]);
      expect(trail.hostMarkers).toEqual([
        { pointIndex: 2, event: 'board', hostKind: 'vehicle', hostX: 2.5, hostZ: 0.25 },
      ]);
      expect(trail.relocated).toBe(false);
    });

    it('appendHostTransition at the current tail adds no duplicate point but still marks it', () => {
      const trail = openMovementTrail(3, 3);
      appendHostTransition(trail, 3, 3, 'enter', 'building', 4, 4);
      expect(trail.points).toEqual([{ x: 3, z: 3 }]);
      expect(trail.hostMarkers).toEqual([
        { pointIndex: 0, event: 'enter', hostKind: 'building', hostX: 4, hostZ: 4 },
      ]);
    });

    it('records several transitions in order and never flags a relocation', () => {
      const trail = openMovementTrail(0, 0);
      appendHostTransition(trail, 0, 0, 'leave', 'building', 1, 1);
      appendToTrail(trail, 0, 0, [{ x: 1, z: 0 }]);
      appendHostTransition(trail, 1, 0, 'board', 'vehicle', 1, 0);
      appendHostTransition(trail, 5, 5, 'alight', 'vehicle', 5, 6);
      expect(trail.hostMarkers.map(m => [m.event, m.pointIndex])).toEqual([['leave', 0], ['board', 1], ['alight', 2]]);
      expect(trail.relocated).toBe(false);
    });

    it('a walk continuing from a host-transition point is not a relocation', () => {
      const trail = openMovementTrail(0, 0);
      appendHostTransition(trail, 4, 4, 'alight', 'vehicle', 4.5, 4.5);
      appendToTrail(trail, 4, 4, [{ x: 5, z: 4 }]);
      expect(trail.relocated).toBe(false);
      expect(trail.hostMarkers).toHaveLength(1);
    });

    it('overflow past MOVEMENT_TRAIL_MAX_POINTS shifts marker indices and drops those pushed off the front', () => {
      const trail = openMovementTrail(0, 0);
      appendHostTransition(trail, 0, 0, 'leave', 'building', 0, 0);
      appendToTrail(trail, 0, 0, [{ x: 1, z: 0 }]);
      appendHostTransition(trail, 1, 0, 'board', 'vehicle', 1, 0);
      const hops = Array.from({ length: MOVEMENT_TRAIL_MAX_POINTS - 2 }, (_, i) => ({ x: i + 2, z: 0 }));
      appendToTrail(trail, 1, 0, hops); // points now MAX; no overflow yet
      expect(trail.hostMarkers.map(m => m.pointIndex)).toEqual([0, 1]);
      appendToTrail(trail, MOVEMENT_TRAIL_MAX_POINTS - 1, 0, [{ x: 1000, z: 0 }]); // overflow by 1
      expect(trail.points).toHaveLength(MOVEMENT_TRAIL_MAX_POINTS);
      expect(trail.hostMarkers).toEqual([
        { pointIndex: 0, event: 'board', hostKind: 'vehicle', hostX: 1, hostZ: 0 },
      ]);
      expect(trail.points[0]).toEqual({ x: 1, z: 0 });
    });

    it('a true relocation clears the markers along with the old points', () => {
      const trail = openMovementTrail(0, 0);
      appendHostTransition(trail, 1, 0, 'board', 'vehicle', 1, 0);
      appendToTrail(trail, 9, 9, [{ x: 10, z: 9 }]);
      expect(trail.relocated).toBe(true);
      expect(trail.hostMarkers).toEqual([]);
    });

    it('a fresh openMovementTrail resets markers per batch', () => {
      const trail = openMovementTrail(0, 0);
      appendHostTransition(trail, 1, 0, 'enter', 'building', 1, 1);
      expect(openMovementTrail(1, 0).hostMarkers).toEqual([]);
    });
  });
});
