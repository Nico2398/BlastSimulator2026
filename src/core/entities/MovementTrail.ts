// BlastSimulator2026 — MovementTrail (#1199)
// The cells an employee or vehicle actually walked or drove through since a
// tick batch opened, so the renderer can draw the route the simulation took
// (turning where it turned) instead of a straight chord between two rendered
// results. Transient: never saved (SaveLoad.ts drops it), and a run with no
// batch open simply records nothing.

export interface TrailPoint {
  x: number;
  z: number;
}

export interface MovementTrail {
  /**
   * Positions in the order the entity occupied them. `points[0]` is where it
   * stood when the batch opened (or right after a relocation); every later
   * point is the end of one advanced hop.
   */
  points: TrailPoint[];
  /**
   * True once the entity's position changed during the batch by something
   * other than a recorded walk (a placement, a boarding snap, a driverless
   * relocation). The renderer snaps instead of gliding through such a jump.
   */
  relocated: boolean;
}

/** Upper bound on recorded points — a long console batch drops the oldest, never grows unbounded. */
export const MOVEMENT_TRAIL_MAX_POINTS = 256;

/** Whether two positions are the same point for trail purposes. */
export function isSameTrailPoint(a: TrailPoint, bx: number, bz: number): boolean {
  return Math.abs(a.x - bx) < 1e-6 && Math.abs(a.z - bz) < 1e-6;
}

/** A fresh trail anchored at (x, z) — what every entity carries when a batch opens. */
export function openMovementTrail(x: number, z: number): MovementTrail {
  return { points: [{ x, z }], relocated: false };
}

/**
 * Appends one tick's advanced hops to `trail`, walked from (fromX, fromZ).
 * A start that is not the trail's last point means the entity was moved by
 * something other than a walk since it was last recorded: the trail restarts
 * at `from` and is flagged `relocated`. Mutates `trail`.
 */
export function appendToTrail(trail: MovementTrail, fromX: number, fromZ: number, hops: readonly TrailPoint[]): void {
  const tail = trail.points[trail.points.length - 1];
  if (!tail || !isSameTrailPoint(tail, fromX, fromZ)) {
    trail.relocated = true;
    trail.points = [{ x: fromX, z: fromZ }];
  }
  for (const hop of hops) {
    const last = trail.points[trail.points.length - 1]!;
    if (!isSameTrailPoint(last, hop.x, hop.z)) trail.points.push({ x: hop.x, z: hop.z });
  }
  const overflow = trail.points.length - MOVEMENT_TRAIL_MAX_POINTS;
  if (overflow > 0) trail.points.splice(0, overflow);
}
