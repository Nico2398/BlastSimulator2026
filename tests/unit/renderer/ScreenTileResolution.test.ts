// BlastSimulator2026 — ScreenTileResolution unit tests (#1227)
// resolveScreenPointForTile replaces window.__worldToScreen's old
// "accept whichever iteration lands closest in raw distance to the tile
// centre" convergence loop, which never verified the accepted candidate
// actually raycasts back to the target tile. The fix accepts a candidate
// only when raycastForTile's hit floors to (targetX, targetZ) — never a
// best-guess fallback on distance. Pure function tests: project/raycastForTile
// are mocked closures, no Three.js, no DOM.

import { describe, it, expect } from 'vitest';
import {
  resolveScreenPointForTile,
  TILE_RESOLUTION_MAX_ITERATIONS,
  type ProjectToNDC,
  type RaycastForTile,
} from '../../../src/renderer/ScreenTileResolution.js';

describe('resolveScreenPointForTile', () => {
  it('resolves a flat-terrain tile on the very first iteration', () => {
    // Target tile (3, 4): centre (3.5, 4.5). A flat-terrain raycast hits the
    // centre immediately, regardless of NDC input — trivial convergence.
    const targetX = 3;
    const targetZ = 4;
    const startY = 2;

    const project: ProjectToNDC = (x, y, z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = () => ({ x: 3.5, y: 2, z: 4.5 });

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY);

    expect(result).toEqual({
      resolved: true,
      ndc: { x: 3.5, y: 2, z: 0 },
    });
  });

  it('corrects across a bench-boundary step where "accept nearest" would land one tile off', () => {
    // Mirrors nav-cell-types-visual.json's (5,5)-(10,10) drag rect on
    // terraced ground. Target tile (7, 7): centre (7.5, 7.5).
    //
    // Iteration 0 (guess height 0, from startY) raycasts a lower bench and
    // hits (6.9, 7.5) — tile (6, 7), ONE TILE OFF the target — but that hit
    // is only 0.6 away from the tile centre in raw XZ distance.
    //
    // Iteration 1 (guess height 1, taken from iteration 0's hit.y) raycasts
    // the bench's true top and hits (7.05, 7.95) — the CORRECT tile (7, 7)
    // — but that hit sits ~0.636 away from the tile centre, i.e. FARTHER
    // than iteration 0's off-tile hit.
    //
    // The old window.__worldToScreen loop tracked whichever candidate
    // produced the smallest raw distance-to-centre ("accept nearest") and
    // never checked the hit actually landed on the target tile — it would
    // keep iteration 0's off-tile candidate (error 0.6 < 0.636) and never
    // even inspect iteration 1 again once its own error stopped improving.
    // The correct behaviour instead accepts the first candidate whose hit
    // floors to the exact target tile, which is iteration 1.
    const targetX = 7;
    const targetZ = 7;
    const startY = 0;

    const project: ProjectToNDC = (x, y, z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = (ndcX, ndcY) => {
      if (ndcY === 0) {
        // Off-tile hit, small raw distance to centre (0.6).
        return { x: 6.9, y: 1, z: 7.5 };
      }
      if (ndcY === 1) {
        // On-tile hit (floor 7,7), larger raw distance to centre (~0.636).
        return { x: 7.05, y: 1, z: 7.95 };
      }
      return null;
    };

    // Sanity check baked into the fixture itself: iteration 0's raw error is
    // smaller than iteration 1's, so "accept nearest" would reject the
    // correct tile match in favour of the wrong tile — this is what makes
    // the case distinguish the two acceptance strategies.
    const centreDistance = (x: number, z: number) => Math.hypot(x - 7.5, z - 7.5);
    expect(centreDistance(6.9, 7.5)).toBeLessThan(centreDistance(7.05, 7.95));

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY);

    // Correct (tile-match) behaviour: resolves on iteration 1's candidate.
    expect(result).toEqual({
      resolved: true,
      ndc: { x: 7.5, y: 1, z: 0 },
    });
    // Distinguishes from the buggy "accept nearest" behaviour, which would
    // have resolved on iteration 0's candidate instead.
    expect(result).not.toEqual({
      resolved: true,
      ndc: { x: 7.5, y: 0, z: 0 },
    });
  });

  it('reports unresolved, never a best-guess fallback, when every raycast misses the target tile', () => {
    const targetX = 12;
    const targetZ = 9;
    const startY = 3;

    let calls = 0;
    const project: ProjectToNDC = (x, y, z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = (ndcX, ndcY) => {
      calls++;
      // Always hits an adjacent tile, never the target — including a hit
      // whose raw distance to the target tile's centre is arbitrarily small,
      // so a "closest distance" fallback would be tempted to accept it.
      return { x: targetX - 0.01, y: ndcY + 1, z: targetZ + 0.5 };
    };

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY);

    expect(result).toEqual({ resolved: false });
    // Bounded by the iteration budget — never loops forever chasing a match.
    expect(calls).toBeLessThanOrEqual(TILE_RESOLUTION_MAX_ITERATIONS);
    expect(calls).toBeGreaterThan(0);
  });

  it('reports unresolved when every raycast misses the terrain/scene entirely (occluded)', () => {
    const targetX = 20;
    const targetZ = 20;
    const startY = 5;

    let calls = 0;
    const project: ProjectToNDC = (x, y, z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = () => {
      calls++;
      return null;
    };

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY);

    expect(result).toEqual({ resolved: false });
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(TILE_RESOLUTION_MAX_ITERATIONS);
  });

  it('resolves correctly when the raycast hit lands exactly on the tile\'s lower boundary', () => {
    // Tile (10, 10) spans world coordinates [10, 11) x [10, 11). A hit at
    // exactly (10.0, 10.0) must floor-match this tile (inclusive lower
    // boundary), not the neighbouring tile below/left of it.
    const targetX = 10;
    const targetZ = 10;
    const startY = 5;

    const project: ProjectToNDC = (x, y, z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = () => ({ x: 10.0, y: 5, z: 10.0 });

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY);

    expect(result).toEqual({
      resolved: true,
      ndc: { x: 10.5, y: 5, z: 0 },
    });
  });

  it('rejects a hit landing exactly on the tile\'s upper boundary as belonging to the next tile', () => {
    // A hit at exactly (11.0, 10.5) floors to tile (11, 10) — NOT the target
    // tile (10, 10) — even though it sits on that tile's edge.
    const targetX = 10;
    const targetZ = 10;
    const startY = 5;

    let calls = 0;
    const project: ProjectToNDC = (x, y, z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = () => {
      calls++;
      return { x: 11.0, y: 5, z: 10.5 };
    };

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY);

    expect(result).toEqual({ resolved: false });
    expect(calls).toBeLessThanOrEqual(TILE_RESOLUTION_MAX_ITERATIONS);
  });
});
