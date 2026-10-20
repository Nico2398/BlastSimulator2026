// BlastSimulator2026 — Spiral ramp proposal (#1940)
// Pure planner: proposes a stack of straight legs that spirals down a pit wall.
// Reads terrain only through the narrow SpiralSurface seam; no GameState.

import type { RampWidth } from '../config/balance.js';
import type { RampLeg } from './RampPath.js';

export type SpiralDir = 'cw' | 'ccw';

export interface SpiralRequest {
  fromX: number;
  fromZ: number;
  /** Total vertical drop to reach, in meters. */
  depth: number;
  gradeDegrees: number;
  width: RampWidth;
  dir: SpiralDir;
}

/** Terrain seam: surface height and pit-membership queries. */
export interface SpiralSurface {
  heightAt(x: number, z: number): number;
  contains(x: number, z: number): boolean;
}

export interface RampSpiralProposal {
  originX: number;
  originZ: number;
  legs: RampLeg[];
  totalLength: number;
  cost: number;
  laps: number;
  gradeDegrees: number;
  depth: number;
}

export type RampSpiralResult =
  | { success: true; proposal: RampSpiralProposal }
  | { success: false; reasonKey: string; params?: Record<string, string | number> };

export function proposeRampSpiral(_req: SpiralRequest, _surface: SpiralSurface): RampSpiralResult {
  // TODO: implement
  return { success: false, reasonKey: 'not_implemented' };
}
