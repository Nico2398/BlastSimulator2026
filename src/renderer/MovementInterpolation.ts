// BlastSimulator2026 — Movement Interpolation (#520)
// Pure per-tick position easing shared by CharacterMesh and VehicleMesh, so
// employees/vehicles glide between GameState position updates instead of
// snapping. No THREE import — mirrors the pure-logic-out-of-mesh-class
// pattern in VehicleWaitingQueue.ts.

import { BASE_TICK_MS } from '../core/config/balance.js';
import { linearstep } from '../core/math/Linearstep.js';
import { isSameTrailPoint, type MovementTrail, type TrailPoint } from '../core/entities/MovementTrail.js';

export interface MovementTween {
  prevX: number;
  prevZ: number;
  targetX: number;
  targetZ: number;
  elapsedS: number;
  /**
   * The route being followed from (prevX, prevZ) to (targetX, targetZ) when
   * the simulation reported one (#1199) — the entity turns where it turned.
   * Null for a plain straight glide.
   */
  path: TrailPoint[] | null;
}

// Real seconds a mesh takes to ease from one GameState position update to the next.
export const MOVE_TWEEN_DURATION_S = BASE_TICK_MS / 1000;

// Position deltas at/above this many world units are treated as a hard reposition
// (not gradual per-tick movement) and snap instead of easing.
export const MOVE_TELEPORT_DISTANCE = 60;

export function createTween(x: number, z: number): MovementTween {
  return { prevX: x, prevZ: z, targetX: x, targetZ: z, elapsedS: 0, path: null };
}

// Pure: the point `fraction` (0..1, clamped) of the way along the polyline
// `points` by arc length (#1199), so a constant pace carries the entity
// round each turn instead of across the chord between the ends.
export function pointAlongTrail(points: readonly TrailPoint[], fraction: number): { x: number; z: number } {
  const first = points[0];
  if (!first) return { x: 0, z: 0 };
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  }
  const last = points[points.length - 1]!;
  if (total === 0) return { x: last.x, z: last.z };
  let remaining = Math.min(1, Math.max(0, fraction)) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= len && len > 0) {
      const t = remaining / len;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= len;
  }
  return { x: last.x, z: last.z };
}

// Whether `trail` is a walk ending at (targetX, targetZ) with no relocation
// in it — the only case a mesh follows it rather than snapping (#1199). A
// trail with no hop at all walked nowhere: a target that moved anyway was
// relocated before the batch opened.
function isWalkTo(trail: MovementTrail, targetX: number, targetZ: number): boolean {
  const tail = trail.points[trail.points.length - 1];
  return !trail.relocated && trail.points.length >= 2 && !!tail && isSameTrailPoint(tail, targetX, targetZ);
}

function snapTween(tween: MovementTween, x: number, z: number): { x: number; z: number } {
  tween.prevX = x;
  tween.prevZ = z;
  tween.targetX = x;
  tween.targetZ = z;
  tween.elapsedS = MOVE_TWEEN_DURATION_S;
  tween.path = null;
  return { x, z };
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
// stored target. Given the simulation's walk `trail` for that move (#1199),
// the restarted tween follows it hop by hop; a trail showing the move was a
// relocation, not a walk, snaps. Without a trail it glides the straight
// chord, and still snaps when the new target is >= MOVE_TELEPORT_DISTANCE
// away from (renderX,renderZ).
export function stepTween(
  tween: MovementTween,
  renderX: number, renderZ: number,
  targetX: number, targetZ: number,
  dt: number,
  trail?: MovementTrail,
): { x: number; z: number } {
  // Target moved since the last step (new tick's position, a mid-glide
  // retarget, etc.) — restart from the entity's actual current rendered
  // position, not the tween's stale prev, or the mesh pops.
  if (targetX !== tween.targetX || targetZ !== tween.targetZ) {
    if (trail && !isWalkTo(trail, targetX, targetZ)) return snapTween(tween, targetX, targetZ);
    tween.prevX = renderX;
    tween.prevZ = renderZ;
    tween.targetX = targetX;
    tween.targetZ = targetZ;
    tween.elapsedS = 0;
    // The trail's first point is where the batch began — the previous
    // target the mesh was heading for — so the glide starts from where the
    // mesh really is and then takes every recorded hop.
    tween.path = trail ? [{ x: renderX, z: renderZ }, ...trail.points.slice(1)] : null;
  }

  // Hard reposition (zone-clear, training enrolment, etc.) — no gradual
  // movement to glide through, so snap and mark the tween fully converged.
  // A recorded walk is exempt: however far a fast vehicle drove, it drove.
  if (!tween.path && Math.hypot(targetX - renderX, targetZ - renderZ) >= MOVE_TELEPORT_DISTANCE) {
    return snapTween(tween, targetX, targetZ);
  }

  tween.elapsedS += dt;
  if (tween.path) {
    return pointAlongTrail(tween.path, linearstep(0, MOVE_TWEEN_DURATION_S, tween.elapsedS));
  }
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
  trail?: MovementTrail,
): { x: number; y: number; z: number } {
  const eased = stepTween(tween, renderX, renderZ, targetX, targetZ, dt, trail);
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
  trail?: MovementTrail,
): { x: number; z: number } {
  if (heightAt) {
    const eased = stepTweenWithHeight(tween, fromX, fromZ, targetX, targetZ, dt, heightAt, trail);
    position.x = eased.x;
    position.y = eased.y;
    position.z = eased.z;
    return { x: eased.x, z: eased.z };
  }
  const eased = stepTween(tween, fromX, fromZ, targetX, targetZ, dt, trail);
  position.x = eased.x;
  position.z = eased.z;
  return { x: eased.x, z: eased.z };
}
