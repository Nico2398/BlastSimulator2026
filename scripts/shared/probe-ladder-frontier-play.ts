/** The ladder's frontier play (#2322), the session side: surveys, the shuttle and the expedition target. The decisions live in probe-ladder-frontier.ts. */

import { HIRING_COSTS, SURVEY_COSTS } from '../../src/core/config/balance.js';
import { getVehicleDefByTier } from '../../src/core/entities/Vehicle.js';
import type { GameState } from '../../src/core/state/GameState.js';
import {
  LADDER_DETECTOR_READINGS, craterEstimate, decideFrontierSurvey, decideShuttle, detectorSecondSpot, frontierSurveyMethod,
  nextIsland, type DetectorFix, type FrontierSurveyMethod,
} from './probe-ladder-frontier.js';
import type { ProbeSession } from './probe-strategies.js';

/** Ticks before a refused survey or purchase is tried again. */
const FRONTIER_RETRY_TICKS = 200;
/** Metres around an estimated crater within which a shot counts as having tried it. */
const CRATER_SHOT_TOLERANCE_M = 30;

/** What the frontier play remembers across decision intervals. */
export interface FrontierMemory {
  /** Targets an expedition shot was ordered at, whether or not it fired. */
  shotAt: Array<{ x: number; z: number }>;
  /** The expedition shot in flight: the length `origins` had when it was ordered. */
  expedition: { originsLen: number } | null;
  /** Tick before which no survey or purchase is tried. */
  retryAfter: number;
}

export function newFrontierMemory(): FrontierMemory {
  return { shotAt: [], expedition: null, retryAfter: 0 };
}

const surveysOf = (state: GameState, method: FrontierSurveyMethod) => state.surveyResults.filter(r => r.method === method);

/** The base centre: where a survey with no spot is taken from. */
function baseCentre(state: GameState): { x: number; z: number } {
  const world = state.world;
  return world ? { x: Math.floor(world.baseSizeX / 2), z: Math.floor(world.baseSizeZ / 2) } : { x: 0, z: 0 };
}

export const shuttleCount = (state: GameState): number => state.vehicles.vehicles.filter(v => v.type === 'travel_vehicle').length;

/** Detector readings taken so far, each with the spot it came from. */
function detectorFixes(state: GameState): DetectorFix[] {
  return surveysOf(state, 'meteorite_detector').flatMap(r => (r.reading
    ? [{ origin: { x: r.centerX, z: r.centerZ }, ...r.reading }] : []));
}

/** Where the next expedition shoots: an island prospected at G2, from G3 the crater the readings estimate; null when none is left. */
export function expeditionTarget(state: GameState, f: FrontierMemory): { x: number; z: number } | null {
  const from = baseCentre(state);
  const grade = state.grade?.grade ?? 0;
  if (grade >= 3) {
    const crater = detectorFixes(state).length >= LADDER_DETECTOR_READINGS ? craterEstimate(detectorFixes(state)) : null;
    if (crater && !f.shotAt.some(p => Math.hypot(p.x - crater.x, p.z - crater.z) <= CRATER_SHOT_TOLERANCE_M)) return crater;
  }
  const islands = surveysOf(state, 'prospection').flatMap(r => r.islands ?? []);
  const island = nextIsland(islands, from, f.shotAt);
  return island ? { x: island.x, z: island.z } : null;
}

/** Order the grade's survey and the shuttle when cash allows; one command per call at most, refusals cool down. */
export function playFrontier(s: ProbeSession, f: FrontierMemory, reserve: number): void {
  const { state } = s;
  if (state.tickCount < f.retryAfter) return;
  const grade = state.grade?.grade ?? 0;
  const method = frontierSurveyMethod(grade);
  const done = method === null ? [] : surveysOf(state, method);
  const hasSurveyor = state.employees.employees.some(e => e.alive && e.role === 'surveyor');
  const surveyCost = method === null ? 0 : SURVEY_COSTS[method] + (hasSurveyor ? 0 : HIRING_COSTS.surveyor);
  const survey = decideFrontierSurvey({
    method, completed: done.length, cash: state.cash, cost: surveyCost, reserve,
    pending: method !== null && state.pendingActions.some(a => a.type === 'survey' && a.payload['method'] === method),
  });
  if (survey === 'order' && method !== null) {
    if (!hasSurveyor && !s.run('employee hire role:surveyor').success) { f.retryAfter = state.tickCount + FRONTIER_RETRY_TICKS; return; }
    const first = detectorFixes(state)[0];
    const spot = method === 'meteorite_detector' && first ? detectorSecondSpot(baseCentre(state), first.bearing) : null;
    if (!s.run(`survey ${method}${spot ? ` x:${spot.x} z:${spot.z}` : ''}`).success) f.retryAfter = state.tickCount + FRONTIER_RETRY_TICKS;
    return;
  }
  const cost = getVehicleDefByTier('travel_vehicle', 1).purchaseCost;
  if (decideShuttle({ grade, shuttles: shuttleCount(state), cash: state.cash, cost, reserve }) === 'buy'
    && !s.run('vehicle buy travel_vehicle').success) f.retryAfter = state.tickCount + FRONTIER_RETRY_TICKS;
}
