// BlastSimulator2026 — Movement Interpolation (skeleton, #520)
// Pure per-tick position easing shared by CharacterMesh and VehicleMesh, so
// employees/vehicles glide between GameState position updates instead of
// snapping. No THREE import — mirrors the pure-logic-out-of-mesh-class
// pattern in VehicleWaitingQueue.ts.
// TODO: implement (skeleton phase — stubs only).

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

export function createTween(_x: number, _z: number): MovementTween {
  // TODO: implement
  throw new Error('not implemented');
}

// Pure: eased position at `elapsedS` into a `durationS`-long tween from
// (prevX,prevZ) to (targetX,targetZ). Smoothstep easing, clamped.
export function computeInterpolatedPosition(
  _prevX: number, _prevZ: number,
  _targetX: number, _targetZ: number,
  _elapsedS: number, _durationS: number,
): { x: number; z: number } {
  // TODO: implement
  throw new Error('not implemented');
}

// Stateful per-frame step: advances `tween` by `dt` real seconds (mutates it)
// and returns the eased render position. Restarts the tween from
// (renderX,renderZ) whenever (targetX,targetZ) differs from the tween's
// stored target. Snaps immediately when the new target is
// >= MOVE_TELEPORT_DISTANCE away from (renderX,renderZ).
export function stepTween(
  _tween: MovementTween,
  _renderX: number, _renderZ: number,
  _targetX: number, _targetZ: number,
  _dt: number,
): { x: number; z: number } {
  // TODO: implement
  throw new Error('not implemented');
}
