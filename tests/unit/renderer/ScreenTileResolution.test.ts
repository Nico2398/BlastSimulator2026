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
  dampedHeight,
  classifyUnresolvedReason,
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

    const project: ProjectToNDC = (x, y, _z) => ({ x, y, z: 0 });
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

    const project: ProjectToNDC = (x, y, _z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = (_ndcX, ndcY) => {
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
    const project: ProjectToNDC = (x, y, _z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = (_ndcX, ndcY) => {
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
    const project: ProjectToNDC = (x, y, _z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = () => {
      calls++;
      return null;
    };

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY);

    expect(result).toEqual({ resolved: false });
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(TILE_RESOLUTION_MAX_ITERATIONS);
    // Regression pin (#1276): a genuine occlusion/miss (raycast never hits
    // anything, so the loop never even sees a repeated height) must never be
    // classified as a grazing-angle cycle — `reason` stays absent.
    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.reason).toBeUndefined();
    }
  });

  it('resolves correctly when the raycast hit lands exactly on the tile\'s lower boundary', () => {
    // Tile (10, 10) spans world coordinates [10, 11) x [10, 11). A hit at
    // exactly (10.0, 10.0) must floor-match this tile (inclusive lower
    // boundary), not the neighbouring tile below/left of it.
    const targetX = 10;
    const targetZ = 10;
    const startY = 5;

    const project: ProjectToNDC = (x, y, _z) => ({ x, y, z: 0 });
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
    const project: ProjectToNDC = (x, y, _z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = () => {
      calls++;
      return { x: 11.0, y: 5, z: 10.5 };
    };

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY);

    expect(result).toEqual({ resolved: false });
    expect(calls).toBeLessThanOrEqual(TILE_RESOLUTION_MAX_ITERATIONS);
  });

  it('breaks a height ping-pong on a stepped surface by damping once a height repeats', () => {
    // Models a genuinely terraced column (a bench edge or pit wall) where
    // direct height replacement oscillates forever: guessing height 0 hits a
    // surface at height 10 (off-tile), and guessing height 10 hits a surface
    // back at height 0 (off-tile) — each guess's raycast reports the OTHER
    // guess's height, so a naive "replace with the latest hit" loop revisits
    // {0, 10, 0, 10, ...} and never spends an iteration at height 5, where
    // the real target tile sits. Only once a height repeats (height 0 seen
    // again at iteration 1) does the loop split the difference and try 5.
    const targetX = 8;
    const targetZ = 8;
    const startY = 0;

    let calls = 0;
    const project: ProjectToNDC = (x, y, _z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = (_ndcX, ndcY) => {
      calls++;
      if (ndcY === 0) return { x: 2, z: 2, y: 10 }; // off-tile, reports the OTHER extreme
      if (ndcY === 10) return { x: 2, z: 2, y: 0 }; // off-tile, reports the first extreme back
      if (ndcY === 5) return { x: 8.5, z: 8.5, y: 5 }; // the damped average — the real target
      return null;
    };

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY);

    // Direct replacement would still be at {resolved: false} after
    // ping-ponging {0, 10, 0, 10, 0} for all 5 iterations; damping finds the
    // target on iteration 2 (heights 0, 10, then 5).
    expect(result).toEqual({
      resolved: true,
      ndc: { x: 8.5, y: 5, z: 0 },
    });
    // Regression pin (#1276): repeatCount=1's damping must stay byte-identical
    // to the old flat 50/50 blend for a period-2 cycle — same iteration count
    // (3 raycasts: guess 0, guess 10, damped guess 5) as before dampedHeight
    // existed, and no `reason` leaks onto a resolved:true outcome.
    expect(calls).toBe(3);
  });

  it('damps a height ping-pong even when the "repeated" height carries realistic float noise (#1254)', () => {
    // Regression for #1254 (building-training-visual scenario step 4, tile
    // (10, 3)): a real ping-pong on a grazing-angle camera never revisits the
    // exact bit-pattern of a prior height guess — raycast/mesh-interpolation
    // noise shifts each "repeat" by a few tenths. Trace modelled on the
    // planner's capture: heights cycle near 31.36 -> 36.0 -> 26.5, and the
    // second visit near 31.36 lands at 31.55 (off by 0.19), not bit-identical.
    //
    // OSCILLATION_EPSILON = 1e-6 is far tighter than that noise, so
    // `seenBefore` never fires here, direct replacement keeps "replacing"
    // instead of damping, and the loop ping-pongs through the whole 5-
    // iteration budget without ever trying the damped midpoint (29.025)
    // where the real target tile sits — it exhausts the budget unresolved.
    //
    // Once OSCILLATION_EPSILON is widened enough to treat 31.55 as a repeat
    // of 31.36 (a real fix widens it to 0.25), the loop damps to
    // (26.5 + 31.55) / 2 = 29.025 on iteration 2 and immediately raycasts the
    // real target tile there.
    const targetX = 10;
    const targetZ = 3;
    const startY = 31.36;

    const near = (a: number, b: number, eps = 0.001) => Math.abs(a - b) < eps;

    let calls = 0;
    const project: ProjectToNDC = (x, y, _z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = (_ndcX, ndcY) => {
      calls++;
      if (near(ndcY, 31.36)) return { x: 2, z: 2, y: 36.0 }; // off-tile
      if (near(ndcY, 36.0)) return { x: 2, z: 2, y: 26.5 }; // off-tile
      if (near(ndcY, 26.5)) return { x: 2, z: 2, y: 31.55 }; // off-tile, near-repeat of 31.36 (+0.19 noise)
      if (near(ndcY, 31.55)) return { x: 2, z: 2, y: 36.2 }; // off-tile, near-repeat of 36.0 (+0.2 noise)
      if (near(ndcY, 36.2)) return { x: 2, z: 2, y: 26.8 }; // off-tile, near-repeat of 26.5 (+0.3 noise)
      if (near(ndcY, 29.025)) return { x: 10.4, z: 3.6, y: 29.025 }; // damped midpoint -> on target tile
      return null;
    };

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY);

    // Desired (post-fix) behaviour: damping recognises the noisy repeat and
    // resolves via the midpoint guess, on iteration 2 (4 raycasts total).
    // Against today's 1e-6 epsilon this fails — the function instead returns
    // { resolved: false } after exhausting all 5 iterations, so this
    // assertion is red until OSCILLATION_EPSILON widens.
    expect(result).toEqual({
      resolved: true,
      ndc: { x: 10.5, y: 29.025, z: 0 },
    });
    expect(calls).toBe(4);
  });

  it('resolves a period-3 grazing-angle cycle once shrinking relaxation gets it within the tile (#1276)', () => {
    // Target tile (5, 5): centre (5.5, 5.5). A grazing camera angle produces
    // a 3-distinct-height cycle {0, 20, 10} before the loop's FIRST repeat
    // (visiting 0 again) — too many distinct guesses for the flat 50/50
    // blend (repeatCount=1) alone to land on the target within the old
    // 5-iteration budget. This fixture assumes the wired implementation
    // tracks one running repeatCount across every repeat detected in the
    // loop (not per-height), so it shrinks 1/2 -> 1/3 -> 1/4 across
    // successive repeats, per dampedHeight's contract:
    //   iter0 guess 0  -> hit 20 (new)                       -> currentY=20
    //   iter1 guess 20 -> hit 10 (new)                       -> currentY=10
    //   iter2 guess 10 -> hit 0  (REPEAT #1 of height 0)      -> damped (10+0)/2=5
    //   iter3 guess 5  -> hit 20 (REPEAT #2 of height 20)     -> damped 5+(20-5)/3=10
    //   iter4 guess 10 -> hit 0  (REPEAT #3 of height 0)      -> damped 10+(0-10)/4=7.5
    //   iter5 guess 7.5 -> ON-TILE hit, resolved.
    // 6 raycasts total, within the widened maxIterations=8 budget (passed
    // explicitly here rather than assumed from the export's own default,
    // which the implementer may or may not have bumped yet).
    const targetX = 5;
    const targetZ = 5;
    const startY = 0;

    const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

    let calls = 0;
    const project: ProjectToNDC = (x, y, _z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = (_ndcX, ndcY) => {
      calls++;
      if (near(ndcY, 0)) return { x: 2, z: 2, y: 20 }; // off-tile
      if (near(ndcY, 20)) return { x: 2, z: 2, y: 10 }; // off-tile
      if (near(ndcY, 10)) return { x: 2, z: 2, y: 0 }; // off-tile, repeats height 0
      if (near(ndcY, 5)) return { x: 2, z: 2, y: 20 }; // off-tile, repeats height 20
      if (near(ndcY, 7.5)) return { x: 5.5, z: 5.5, y: 7.5 }; // on-tile: shrinking relaxation converged
      return null;
    };

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY, 8);

    expect(result).toEqual({
      resolved: true,
      ndc: { x: 5.5, y: 7.5, z: 0 },
    });
    expect(calls).toBe(6);
  });

  it('reports { resolved: false, reason: "grazing-angle-cycle" } when a period-3+ cycle never lands on the target even with damping (#1276)', () => {
    // Same 3-distinct-height cycle and repeat/damping trace as the previous
    // case, through repeatCount=3 (currentY settles at 7.5) — but here no
    // raycast ever reports an on-tile hit at 7.5 or afterward (a genuinely
    // occluded/terraced column, not merely a slow-to-converge one), so the
    // loop exhausts the full maxIterations=8 budget still unresolved. The
    // first repeat (of height 0) closed only after 3 distinct height
    // guesses (0, 20, 10) — >= GRAZING_CYCLE_MIN_SPAN — so the failure must
    // be classified as a grazing-angle cycle, not a generic occlusion miss.
    const targetX = 5;
    const targetZ = 5;
    const startY = 0;

    const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

    let calls = 0;
    const project: ProjectToNDC = (x, y, _z) => ({ x, y, z: 0 });
    const raycastForTile: RaycastForTile = (_ndcX, ndcY) => {
      calls++;
      if (near(ndcY, 0)) return { x: 2, z: 2, y: 20 }; // off-tile
      if (near(ndcY, 20)) return { x: 2, z: 2, y: 10 }; // off-tile
      if (near(ndcY, 10)) return { x: 2, z: 2, y: 0 }; // off-tile, repeats height 0
      if (near(ndcY, 5)) return { x: 2, z: 2, y: 20 }; // off-tile, repeats height 20
      // No branch ever resolves 7.5 (or anything past it) onto the target
      // tile — every further guess misses entirely (null), unlike the
      // convergent fixture above.
      return null;
    };

    const result = resolveScreenPointForTile(project, raycastForTile, targetX, targetZ, startY, 8);

    expect(result).toEqual({ resolved: false, reason: 'grazing-angle-cycle' });
    expect(calls).toBeLessThanOrEqual(8);
  });
});

describe('dampedHeight', () => {
  it('blends 50/50 toward the hit on the first repeat (repeatCount=1), matching the pre-#1276 flat blend exactly', () => {
    expect(dampedHeight(10, 0, 1)).toBe(5);
    expect(dampedHeight(3, 9, 1)).toBe(6);
  });

  it('shrinks the step to 1/(repeatCount+1) toward the hit on the second repeat (repeatCount=2)', () => {
    // currentY + (hitY - currentY) / 3, i.e. a 1/3 step toward hitY instead
    // of the flat 1/2 step repeatCount=1 uses.
    expect(dampedHeight(5, 20, 2)).toBe(10);
    expect(dampedHeight(1.5, 6, 2)).toBeCloseTo(3, 10);
  });

  it('keeps shrinking for a third repeat (repeatCount=3): 1/(repeatCount+1) = 1/4 toward the hit', () => {
    expect(dampedHeight(10, 0, 3)).toBe(7.5);
  });
});

describe('classifyUnresolvedReason', () => {
  it('returns undefined when no repeat was ever detected (cycleSpanAtFirstRepeat is null)', () => {
    expect(classifyUnresolvedReason(null)).toBeUndefined();
  });

  it('returns undefined for a period-2 cycle (span below GRAZING_CYCLE_MIN_SPAN=3)', () => {
    expect(classifyUnresolvedReason(1)).toBeUndefined();
    expect(classifyUnresolvedReason(2)).toBeUndefined();
  });

  it('returns "grazing-angle-cycle" once the span reaches GRAZING_CYCLE_MIN_SPAN=3 or beyond', () => {
    expect(classifyUnresolvedReason(3)).toBe('grazing-angle-cycle');
    expect(classifyUnresolvedReason(4)).toBe('grazing-angle-cycle');
  });
});
