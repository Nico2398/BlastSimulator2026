// BlastSimulator2026 — Heading math for entities that face where they go
// Every model faces +X at rest; the renderer turns its root Group around Y
// toward the direction of travel. Pure functions, shared by CharacterMesh
// and VehicleMesh.

/** Yaw (radians, Y-up) that points a +X-facing model along (dx, dz). */
export function headingFromDelta(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/** Step `current` toward `target` by at most `maxStep` radians along the shorter arc. */
export function turnToward(current: number, target: number, maxStep: number): number {
  let delta = target - current;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}
