// BlastSimulator2026 — Ramp path geometry (#1939)
// Pure geometry leaf for multi-leg ramps: a path of straight legs from an origin.
// Imports types only; no state, no voxel access.

import type { RampWidth } from '../config/balance.js';

export type RampDirection = 'north' | 'south' | 'east' | 'west';

/** Unit tile step of each direction. */
export const RAMP_DIR_OFFSETS: Record<RampDirection, { dx: number; dz: number }> = {
  north: { dx: 0, dz: -1 },
  south: { dx: 0, dz: 1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 },
};

/** Inclusive tile rectangle a ramp's corridor covers. */
export interface RampFootprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** One straight run of a ramp path. */
export interface RampLeg {
  direction: RampDirection;
  length: number;
}

/** Where a ramp path starts and the legs it follows. */
export interface RampPathSpec {
  originX: number;
  originZ: number;
  legs: readonly RampLeg[];
}

/** One tile of a ramp corridor. */
export interface RampPathCell {
  x: number;
  z: number;
  /** Index along the centreline this cell belongs to. */
  step: number;
  /** Signed offset from the centreline across the corridor width. */
  lateral: number;
  legIndex: number;
}

export type LegsFromWaypointsResult =
  | { success: true; originX: number; originZ: number; legs: RampLeg[] }
  | { success: false; reasonKey: string; params?: Record<string, string | number> };

export interface RampPathFault {
  key: 'mining.build_ramp.leg_too_short' | 'mining.build_ramp.legs_cross';
  params: Record<string, string | number>;
}

/** Convert clicked waypoints into an origin and axis-aligned legs. */
export function legsFromWaypoints(
  _waypoints: readonly { x: number; z: number }[],
): LegsFromWaypointsResult {
  return undefined as unknown as LegsFromWaypointsResult; // TODO: implement
}

/** Legs of `def`: its own `legs`, else one leg from direction/length. */
export function rampLegsOf(
  _def: { direction: RampDirection; length: number; legs?: readonly RampLeg[] },
): RampLeg[] {
  return undefined as unknown as RampLeg[]; // TODO: implement
}

export function rampTotalLength(_legs: readonly RampLeg[]): number {
  return undefined as unknown as number; // TODO: implement
}

/** Centreline tiles of the path, in order. */
export function rampCenterline(_path: RampPathSpec): { x: number; z: number; legIndex: number }[] {
  return undefined as unknown as { x: number; z: number; legIndex: number }[]; // TODO: implement
}

/** Every distinct corridor tile at `width`. */
export function rampPathCells(_path: RampPathSpec, _width: RampWidth): RampPathCell[] {
  return undefined as unknown as RampPathCell[]; // TODO: implement
}

/** Per-leg inclusive rectangles covering the corridor. */
export function rampFootprintRects(_path: RampPathSpec, _width: RampWidth): RampFootprint[] {
  return undefined as unknown as RampFootprint[]; // TODO: implement
}

/** Single rectangle bounding the whole corridor. */
export function rampBoundingFootprint(_path: RampPathSpec, _width: RampWidth): RampFootprint {
  return undefined as unknown as RampFootprint; // TODO: implement
}

/** Origin plus one waypoint per leg end. */
export function rampWaypoints(_path: RampPathSpec): { x: number; z: number }[] {
  return undefined as unknown as { x: number; z: number }[]; // TODO: implement
}

/** First reason the path is invalid (short leg, self-crossing), or null. */
export function findRampPathFault(_path: RampPathSpec, _width: RampWidth): RampPathFault | null {
  return undefined as unknown as RampPathFault | null; // TODO: implement
}

/** First cell for which `isOccupied(x, z)` holds, or null. */
export function firstOccupiedPathTile(
  _cells: readonly RampPathCell[],
  _isOccupied: (x: number, z: number) => boolean,
): RampPathCell | null {
  return undefined as unknown as RampPathCell | null; // TODO: implement
}
