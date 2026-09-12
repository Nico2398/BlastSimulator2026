// BlastSimulator2026 — Movement Interpolation (#520)
// Pure per-tick position easing shared by CharacterMesh and VehicleMesh, so
// employees/vehicles glide between GameState position updates instead of
// snapping. No THREE import — mirrors the pure-logic-out-of-mesh-class
// pattern in VehicleWaitingQueue.ts.

import { BASE_TICK_MS } from '../core/config/balance.js';
import { linearstep } from '../core/math/Linearstep.js';

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
// (prevX,prevZ) to (targetX,targetZ). Linear interpolation (shared with
// core/math/Linearstep.ts), which already clamps to exactly 0/1 at/beyond
// the [0,durationS] bounds, so no separate early-return is needed. Constant
// rate by default (#948) — an eased curve is only for an effect that names
// why it needs one.
export function computeInterpolatedPosition(
  prevX: number, prevZ: number,
  targetX: number, targetZ: number,
  elapsedS: number, durationS: number,
): { x: number; z: number } {
  const ease = linearstep(0, durationS, elapsedS);
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

// Composes stepTween() with a caller-supplied terrain height sampler so an
// entity's rendered Y follows the same eased (x, z) as its X/Z glide (#1038),
// instead of snapping to the target cell's height once per sync. `heightAt`
// is sampled at the EASED (x, z) this call returns, never at (targetX,
// targetZ) — that is the whole point of this function over calling
// stepTween() and a height sampler separately.
export function stepTweenWithHeight(
  tween: MovementTween,
  renderX: number, renderZ: number,
  targetX: number, targetZ: number,
  dt: number,
  heightAt: (x: number, z: number) => number,
): { x: number; y: number; z: number } {
  const eased = stepTween(tween, renderX, renderZ, targetX, targetZ, dt);
  return { x: eased.x, y: heightAt(eased.x, eased.z), z: eased.z };
}

// Shared by CharacterMesh.update() and VehicleMesh.update() (#1038): steps
// `tween` toward (targetX, targetZ) and writes the eased result straight
// into `position` (a THREE.Vector3 or any {x,y,z} — mutated in place, same
// as both call sites did inline before this was extracted). With `heightAt`
// given, y follows the same eased (x, z) via stepTweenWithHeight(); without
// it, y is left untouched, exactly as the two inlined branches did. Returns
// the eased (x, z) so the caller can still derive a delta for its own
// gait/motion animation.
export function applyEasedPosition(
  position: { x: number; y: number; z: number },
  tween: MovementTween,
  fromX: number, fromZ: number,
  targetX: number, targetZ: number,
  dt: number,
  heightAt?: (x: number, z: number) => number,
): { x: number; z: number } {
  if (heightAt) {
    const eased = stepTweenWithHeight(tween, fromX, fromZ, targetX, targetZ, dt, heightAt);
    position.x = eased.x;
    position.y = eased.y;
    position.z = eased.z;
    return { x: eased.x, z: eased.z };
  }
  const eased = stepTween(tween, fromX, fromZ, targetX, targetZ, dt);
  position.x = eased.x;
  position.z = eased.z;
  return { x: eased.x, z: eased.z };
}
