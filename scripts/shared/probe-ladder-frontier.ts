/** Pure decisions for the probe ladder's frontier play (#2322): the mechanics the grades G1 to G3 open. Narrow inputs, no session or game state. */

import { PROSPECTION_POSITION_ERROR_M, TRAVEL_VEHICLE_UNLOCK_GRADE } from '../../src/core/config/balance.js';

/** Depth (m) of the first bench: ores of G1 start below it. */
export const LADDER_BENCH_FLOOR_M = 5;

/** Whether a second bench below the first one stands: from grade 1, a pit deeper than the first bench. */
export function secondBenchReached(input: { grade: number; deepestPitM: number }): boolean {
  return input.grade >= 1 && input.deepestPitM > LADDER_BENCH_FLOOR_M;
}

export type FrontierSurveyMethod = 'prospection' | 'meteorite_detector';

/** Readings the meteorite detector takes before the crater is estimated. */
export const LADDER_DETECTOR_READINGS = 2;

/** The survey method the ladder runs at a grade; null while no frontier survey is open. */
export function frontierSurveyMethod(grade: number): FrontierSurveyMethod | null {
  if (grade < 2) return null;
  return grade === 2 ? 'prospection' : 'meteorite_detector';
}

/** How many surveys of `method` the ladder takes. */
export function frontierSurveysWanted(method: FrontierSurveyMethod): number {
  return method === 'prospection' ? 1 : LADDER_DETECTOR_READINGS;
}

interface FrontierSurveyInput {
  method: FrontierSurveyMethod | null;
  /** Surveys of that method already completed. */
  completed: number;
  /** One of that method is queued and not yet done. */
  pending: boolean;
  cash: number;
  cost: number;
  reserve: number;
}

/** Whether the ladder orders its next frontier survey now. */
export function decideFrontierSurvey(input: FrontierSurveyInput): 'order' | 'skip' {
  const { method, completed, pending, cash, cost, reserve } = input;
  if (method === null || pending || completed >= frontierSurveysWanted(method)) return 'skip';
  return cash - cost >= reserve ? 'order' : 'skip';
}

/** Metres between the detector's two reading spots. */
export const LADDER_DETECTOR_SPOT_SEPARATION_M = 120;

/** Spot of the second reading: the base moved perpendicular to the first reading's bearing, so the two cones cross. */
export function detectorSecondSpot(base: { x: number; z: number }, bearing: number): { x: number; z: number } {
  const side = (sign: 1 | -1) => ({
    x: Math.round(base.x - sign * Math.sin(bearing) * LADDER_DETECTOR_SPOT_SEPARATION_M),
    z: Math.round(base.z + sign * Math.cos(bearing) * LADDER_DETECTOR_SPOT_SEPARATION_M),
  });
  const first = side(1);
  return first.x < 0 || first.z < 0 ? side(-1) : first;
}

/** One detector reading with the spot it was taken from. */
export interface DetectorFix {
  origin: { x: number; z: number };
  bearing: number;
  halfAngle: number;
  minDistance: number;
  maxDistance: number;
}

/** Where the crater probably lies, from the readings taken; null without any. */
export function craterEstimate(fixes: readonly DetectorFix[]): { x: number; z: number } | null {
  const a = fixes[0];
  if (!a) return null;
  const mid = (a.minDistance + a.maxDistance) / 2;
  const alongFirst = {
    x: Math.round(a.origin.x + Math.cos(a.bearing) * mid),
    z: Math.round(a.origin.z + Math.sin(a.bearing) * mid),
  };
  const b = fixes[1];
  if (!b) return alongFirst;
  const dax = Math.cos(a.bearing), daz = Math.sin(a.bearing);
  const dbx = Math.cos(b.bearing), dbz = Math.sin(b.bearing);
  const cross = dax * dbz - daz * dbx;
  if (Math.abs(cross) < 1e-6) return alongFirst;
  const ox = b.origin.x - a.origin.x, oz = b.origin.z - a.origin.z;
  const ta = (ox * dbz - oz * dbx) / cross;
  const tb = (ox * daz - oz * dax) / cross;
  if (ta < 0 || tb < 0) return alongFirst;
  return { x: Math.round(a.origin.x + dax * ta), z: Math.round(a.origin.z + daz * ta) };
}

export interface IslandPoint {
  x: number;
  z: number;
  oreId: string;
  radius: number;
}

/** The nearest prospected island no expedition shot at yet; null when none is left. */
export function nextIsland(
  islands: readonly IslandPoint[],
  from: { x: number; z: number },
  shotAt: readonly { x: number; z: number }[],
): IslandPoint | null {
  let best: IslandPoint | null = null;
  let bestDistance = Infinity;
  for (const island of islands) {
    const reach = island.radius + PROSPECTION_POSITION_ERROR_M;
    if (shotAt.some(p => Math.hypot(p.x - island.x, p.z - island.z) <= reach)) continue;
    const d = Math.hypot(island.x - from.x, island.z - from.z);
    if (d < bestDistance) { best = island; bestDistance = d; }
  }
  return best;
}

/** Pattern corner that centres a `span`-wide pattern on `target`. */
export function expeditionOrigin(target: { x: number; z: number }, span: number): { x: number; z: number } {
  return { x: Math.floor(target.x - span / 2), z: Math.floor(target.z - span / 2) };
}

interface FrontierBuyInput {
  grade: number;
  shuttles: number;
  cash: number;
  cost: number;
  reserve: number;
}

/** Whether the ladder buys its shuttle now: once, from the grade that unlocks it. */
export function decideShuttle(input: FrontierBuyInput): 'buy' | 'skip' {
  const { grade, shuttles, cash, cost, reserve } = input;
  return grade >= TRAVEL_VEHICLE_UNLOCK_GRADE && shuttles === 0 && cash - cost >= reserve ? 'buy' : 'skip';
}

interface ExpeditionInput {
  hasTarget: boolean;
  shuttles: number;
  cash: number;
  cost: number;
  reserve: number;
  /** An expedition shot is already ordered or armed. */
  inFlight: boolean;
}

/** Whether the ladder orders an expedition shot now. */
export function decideExpedition(input: ExpeditionInput): 'go' | 'wait' {
  const { hasTarget, shuttles, cash, cost, reserve, inFlight } = input;
  return hasTarget && shuttles >= 1 && !inFlight && cash - cost >= reserve ? 'go' : 'wait';
}
