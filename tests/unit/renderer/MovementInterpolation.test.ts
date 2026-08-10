// MovementInterpolation — unit tests (#520)
// Pure per-tick position easing shared by CharacterMesh and VehicleMesh.

import { describe, it, expect } from 'vitest';
import {
  createTween,
  computeInterpolatedPosition,
  stepTween,
  MOVE_TWEEN_DURATION_S,
  MOVE_TELEPORT_DISTANCE,
} from '../../../src/renderer/MovementInterpolation.js';

describe('MovementInterpolation', () => {
  describe('createTween', () => {
    it('returns a tween with prev === target === (x,z) and elapsedS === 0', () => {
      const tween = createTween(3, 7);
      expect(tween.prevX).toBe(3);
      expect(tween.prevZ).toBe(7);
      expect(tween.targetX).toBe(3);
      expect(tween.targetZ).toBe(7);
      expect(tween.elapsedS).toBe(0);
    });

    it('boundary: works at the origin (0,0)', () => {
      const tween = createTween(0, 0);
      expect(tween.prevX).toBe(0);
      expect(tween.prevZ).toBe(0);
      expect(tween.targetX).toBe(0);
      expect(tween.targetZ).toBe(0);
      expect(tween.elapsedS).toBe(0);
    });
  });

  describe('computeInterpolatedPosition', () => {
    const durationS = 1;

    it('returns exactly the prev position at elapsedS <= 0', () => {
      const pos = computeInterpolatedPosition(0, 0, 10, 10, 0, durationS);
      expect(pos.x).toBe(0);
      expect(pos.z).toBe(0);

      const posNeg = computeInterpolatedPosition(0, 0, 10, 10, -0.5, durationS);
      expect(posNeg.x).toBe(0);
      expect(posNeg.z).toBe(0);
    });

    it('returns exactly the target position at elapsedS >= durationS', () => {
      const pos = computeInterpolatedPosition(0, 0, 10, 10, durationS, durationS);
      expect(pos.x).toBe(10);
      expect(pos.z).toBe(10);

      const posOver = computeInterpolatedPosition(0, 0, 10, 10, durationS * 5, durationS);
      expect(posOver.x).toBe(10);
      expect(posOver.z).toBe(10);
    });

    it('returns a point strictly between prev and target at the halfway point (not clamped to either endpoint)', () => {
      const pos = computeInterpolatedPosition(0, 0, 10, 20, durationS / 2, durationS);
      expect(pos.x).toBeGreaterThan(0);
      expect(pos.x).toBeLessThan(10);
      expect(pos.z).toBeGreaterThan(0);
      expect(pos.z).toBeLessThan(20);
    });

    it('is monotonic — increasing elapsedS never moves the result away from target', () => {
      const targetX = 10, targetZ = -30;
      let prevDist = Infinity;
      for (let e = 0; e <= durationS; e += durationS / 20) {
        const pos = computeInterpolatedPosition(0, 0, targetX, targetZ, e, durationS);
        const dist = Math.hypot(targetX - pos.x, targetZ - pos.z);
        expect(dist).toBeLessThanOrEqual(prevDist + 1e-9);
        prevDist = dist;
      }
    });
  });

  describe('stepTween', () => {
    it('converges toward the target across several small-dt frames, passing through an intermediate point, without overshoot', () => {
      const tween = createTween(0, 0);
      let renderX = 0, renderZ = 0;
      const targetX = 10, targetZ = 10; // well below MOVE_TELEPORT_DISTANCE
      const dt = 0.05;
      const steps = Math.ceil(MOVE_TWEEN_DURATION_S / dt) + 5;

      let sawIntermediate = false;
      for (let i = 0; i < steps; i++) {
        const pos = stepTween(tween, renderX, renderZ, targetX, targetZ, dt);
        // No overshoot at any point during the glide.
        expect(pos.x).toBeLessThanOrEqual(targetX + 1e-9);
        expect(pos.z).toBeLessThanOrEqual(targetZ + 1e-9);
        if (pos.x > 0 && pos.x < targetX && pos.z > 0 && pos.z < targetZ) {
          sawIntermediate = true;
        }
        renderX = pos.x;
        renderZ = pos.z;
      }

      expect(sawIntermediate).toBe(true);
      // Enough cumulative real time has passed to fully converge.
      expect(renderX).toBeCloseTo(targetX);
      expect(renderZ).toBeCloseTo(targetZ);
    });

    it('does not jump straight to the target in a single frame', () => {
      const tween = createTween(0, 0);
      const pos = stepTween(tween, 0, 0, 10, 10, 0.05);
      expect(pos.x).toBeGreaterThan(0);
      expect(pos.x).toBeLessThan(10);
      expect(pos.z).toBeGreaterThan(0);
      expect(pos.z).toBeLessThan(10);
    });

    it('continues progressing across repeated calls with an unchanged target (does not reset elapsedS)', () => {
      const tween = createTween(0, 0);
      let renderX = 0, renderZ = 0;
      const targetX = 10, targetZ = 0;
      const dt = 0.05;
      const steps = Math.ceil(MOVE_TWEEN_DURATION_S / dt) + 5; // enough cumulative real time to fully converge

      for (let i = 0; i < steps; i++) {
        const pos = stepTween(tween, renderX, renderZ, targetX, targetZ, dt);
        renderX = pos.x;
        renderZ = pos.z;
      }

      // If elapsedS were reset to 0 on every call, renderX could never pass
      // computeInterpolatedPosition(0,0,10,0,dt,duration) — it would stall
      // partway forever, regardless of how many calls are made.
      expect(renderX).toBeCloseTo(targetX);
    });

    it('does not pop when the target changes mid-tween — the next position stays close to the current render position', () => {
      const tween = createTween(0, 0);
      const dt = 0.05;

      // Glide partway toward the first target.
      const pos1 = stepTween(tween, 0, 0, 10, 10, dt);
      const renderX = pos1.x, renderZ = pos1.z;

      // Retarget completely before convergence.
      const pos2 = stepTween(tween, renderX, renderZ, -20, 40, dt);

      const jump = Math.hypot(pos2.x - renderX, pos2.z - renderZ);
      // One small dt step of gliding should cover only a small fraction of
      // the (now much larger) remaining distance, not pop toward it.
      expect(jump).toBeLessThan(2);
    });

    it('snaps immediately to the target when it is >= MOVE_TELEPORT_DISTANCE away, regardless of dt', () => {
      const targetX = MOVE_TELEPORT_DISTANCE, targetZ = 0;

      const tweenZeroDt = createTween(0, 0);
      const posZeroDt = stepTween(tweenZeroDt, 0, 0, targetX, targetZ, 0);
      expect(posZeroDt.x).toBe(targetX);
      expect(posZeroDt.z).toBe(targetZ);

      const tweenLargeDt = createTween(0, 0);
      const posLargeDt = stepTween(tweenLargeDt, 0, 0, targetX, targetZ, 5);
      expect(posLargeDt.x).toBe(targetX);
      expect(posLargeDt.z).toBe(targetZ);
    });

    it('with dt === 0, returns a position consistent with no time advancing (still approaching, not jumping)', () => {
      const tween = createTween(0, 0);
      const pos = stepTween(tween, 0, 0, 10, 10, 0);
      // A tween restarted from (0,0) with elapsedS still at 0 after a
      // zero-length step must read back the render position, not the target.
      expect(pos.x).toBe(0);
      expect(pos.z).toBe(0);
    });
  });
});
