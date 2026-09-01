// TaskFillEasing — unit tests (#906)
// Pure per-tick fill-fraction easing for TaskProgressBar. Mirrors the test
// style of MovementInterpolation.test.ts, but for a single scalar fraction
// instead of an (x, z) position, and with a backward-snap rule position
// tweens don't have (a task fraction can legitimately go DOWN — task
// changed/re-dispatched — where a position tween's "teleport" case is a huge
// jump in either direction).

import { describe, it, expect } from 'vitest';
import {
  createFillTween,
  stepFillTween,
  FILL_SNAP_BACKWARD_EPSILON,
} from '../../../src/renderer/TaskFillEasing.js';
import { MOVE_TWEEN_DURATION_S } from '../../../src/renderer/MovementInterpolation.js';

describe('TaskFillEasing', () => {
  describe('createFillTween', () => {
    it('returns a tween with prevFraction === targetFraction === initialFraction and elapsedS === 0', () => {
      const tween = createFillTween(0.3);
      expect(tween.prevFraction).toBe(0.3);
      expect(tween.targetFraction).toBe(0.3);
      expect(tween.elapsedS).toBe(0);
    });

    it('boundary: works at 0', () => {
      const tween = createFillTween(0);
      expect(tween.prevFraction).toBe(0);
      expect(tween.targetFraction).toBe(0);
      expect(tween.elapsedS).toBe(0);
    });
  });

  describe('stepFillTween', () => {
    it('forward retarget: with 0 < dt < MOVE_TWEEN_DURATION_S, returns a value strictly between renderFraction and targetFraction', () => {
      const tween = createFillTween(0.2);
      const renderFraction = 0.2;
      const targetFraction = 0.6;
      const dt = MOVE_TWEEN_DURATION_S / 2;

      const result = stepFillTween(tween, renderFraction, targetFraction, dt);

      expect(result).toBeGreaterThan(renderFraction);
      expect(result).toBeLessThan(targetFraction);
    });

    it('no motion when dt === 0: returns renderFraction unchanged', () => {
      const tween = createFillTween(0.2);
      const renderFraction = 0.2;
      const targetFraction = 0.6;

      const result = stepFillTween(tween, renderFraction, targetFraction, 0);

      expect(result).toBe(renderFraction);
    });

    it('convergence: dt >= MOVE_TWEEN_DURATION_S converges exactly to targetFraction, never overshoots', () => {
      const tween = createFillTween(0.1);
      const renderFraction = 0.1;
      const targetFraction = 0.75;

      const result = stepFillTween(tween, renderFraction, targetFraction, MOVE_TWEEN_DURATION_S);

      expect(result).toBe(targetFraction);
    });

    it('convergence: accumulating several small steps totalling >= MOVE_TWEEN_DURATION_S converges exactly to targetFraction without overshoot past target or past 1', () => {
      const tween = createFillTween(0);
      let renderFraction = 0;
      const targetFraction = 1;
      const dt = 0.05;
      const steps = Math.ceil(MOVE_TWEEN_DURATION_S / dt) + 5;

      for (let i = 0; i < steps; i++) {
        renderFraction = stepFillTween(tween, renderFraction, targetFraction, dt);
        expect(renderFraction).toBeLessThanOrEqual(targetFraction + 1e-9);
        expect(renderFraction).toBeLessThanOrEqual(1 + 1e-9);
      }

      expect(renderFraction).toBe(targetFraction);
    });

    it('backward retarget (task changed): a target lower than renderFraction by more than FILL_SNAP_BACKWARD_EPSILON returns targetFraction immediately, regardless of dt', () => {
      const targetFraction = 0.1;

      const tweenTinyDt = createFillTween(0.9);
      const resultTinyDt = stepFillTween(tweenTinyDt, 0.9, targetFraction, 0.001);
      expect(resultTinyDt).toBe(targetFraction);

      const tweenLargeDt = createFillTween(0.9);
      const resultLargeDt = stepFillTween(tweenLargeDt, 0.9, targetFraction, 5);
      expect(resultLargeDt).toBe(targetFraction);

      const tweenZeroDt = createFillTween(0.9);
      const resultZeroDt = stepFillTween(tweenZeroDt, 0.9, targetFraction, 0);
      expect(resultZeroDt).toBe(targetFraction);
    });

    it('a backward retarget within FILL_SNAP_BACKWARD_EPSILON of the current render fraction does not snap (floating-point noise around an unchanged target)', () => {
      const tween = createFillTween(0.5);
      const renderFraction = 0.5;
      // Just inside the epsilon band below renderFraction — should be treated
      // as "no meaningful change", not a task-changed snap.
      const targetFraction = renderFraction - FILL_SNAP_BACKWARD_EPSILON / 2;

      const result = stepFillTween(tween, renderFraction, targetFraction, MOVE_TWEEN_DURATION_S / 2);

      // Not a hard snap straight to the (barely lower) target from a single
      // small step's worth of forward-style easing math; effectively unchanged.
      expect(result).toBeCloseTo(renderFraction, 5);
    });

    it('a forward jump larger than one tick eases forward rather than snapping (only backward jumps snap)', () => {
      const tween = createFillTween(0.2);
      const renderFraction = 0.2;
      const targetFraction = 0.6; // catch-up at high time scale
      const dt = MOVE_TWEEN_DURATION_S / 4;

      const result = stepFillTween(tween, renderFraction, targetFraction, dt);

      expect(result).toBeGreaterThan(renderFraction);
      expect(result).toBeLessThan(targetFraction);
    });
  });
});
