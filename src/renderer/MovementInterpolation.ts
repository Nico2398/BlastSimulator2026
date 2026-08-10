// BlastSimulator2026 — Movement Interpolation (#520)
// Pure per-tick position easing shared by CharacterMesh and VehicleMesh, so
// employees/vehicles glide between GameState position updates instead of
// snapping. No THREE import — mirrors the pure-logic-out-of-mesh-class
// pattern in VehicleWaitingQueue.ts.

import { BASE_TICK_MS } from '../core/config/balance.js';

export interface MovementTween {
  prevX: number;
  prevZ: number;
  targetX: number;
  targetZ: number;
  elapsedS: number;
}

// Real seconds a mesh takes to ease from one GameState position update to the next.
export const MOVE_TWEEN_DURATION_S = BASE_TICK_MS / 1000;

// Position deltas at/above this many world units are treated as a hard reposition
// (not gradual per-tick movement) and snap instead of easing.
export const MOVE_TELEPORT_DISTANCE = 60;

export function createTween(x: number, z: number): MovementTween {
  return { prevX: x, prevZ: z, targetX: x, targetZ: z, elapsedS: 0 };
}

// Pure: eased position at `elapsedS` into a `durationS`-long tween from
// (prevX,prevZ) to (targetX,targetZ). Smoothstep easing, clamped.
export function computeInterpolatedPosition(
  prevX: number, prevZ: number,
  targetX: number, targetZ: number,
  elapsedS: number, durationS: number,
): { x: number; z: number } {
  if (elapsedS <= 0) return { x: prevX, z: prevZ };
  if (elapsedS >= durationS) return { x: targetX, z: targetZ };

  const t = elapsedS / durationS;
  const ease = t * t * (3 - 2 * t); // smoothstep
  return {
    x: prevX + (targetX - prevX) * ease,
    z: prevZ + (targetZ - prevZ) * ease,
  };
}

// Stateful per-frame step: advances `tween` by `dt` real seconds (mutates it)
// and returns the eased render position. Restarts the tween from
// (renderX,renderZ) whenever (targetX,targetZ) differs from the tween's
// stored target. Snaps immediately when the new target is
// >= MOVE_TELEPORT_DISTANCE away from (renderX,renderZ).
export function stepTween(
  tween: MovementTween,
  renderX: number, renderZ: number,
  targetX: number, targetZ: number,
  dt: number,
): { x: number; z: number } {
  // Target moved since the last step (new tick's position, a mid-glide
  // retarget, etc.) — restart from the entity's actual current rendered
  // position, not the tween's stale prev, or the mesh pops.
  if (targetX !== tween.targetX || targetZ !== tween.targetZ) {
    tween.prevX = renderX;
    tween.prevZ = renderZ;
    tween.targetX = targetX;
    tween.targetZ = targetZ;
    tween.elapsedS = 0;
  }

  // Hard reposition (zone-clear, training enrolment, etc.) — no gradual
  // movement to glide through, so snap and mark the tween fully converged.
  if (Math.hypot(targetX - renderX, targetZ - renderZ) >= MOVE_TELEPORT_DISTANCE) {
    tween.prevX = targetX;
    tween.prevZ = targetZ;
    tween.targetX = targetX;
    tween.targetZ = targetZ;
    tween.elapsedS = MOVE_TWEEN_DURATION_S;
    return { x: targetX, z: targetZ };
  }

  tween.elapsedS += dt;
  return computeInterpolatedPosition(
    tween.prevX, tween.prevZ, tween.targetX, tween.targetZ,
    tween.elapsedS, MOVE_TWEEN_DURATION_S,
  );
}
