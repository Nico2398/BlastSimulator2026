/** Pure decisions for the probe ladder's frontier play (#2322): the mechanics the grades G1 to G3 open. Narrow inputs, no session or game state. */

import { TRAVEL_VEHICLE_UNLOCK_GRADE } from '../../src/core/config/balance.js';

/** Depth (m) of the first bench: ores of G1 start below it. */
export const LADDER_BENCH_FLOOR_M = 5;

/** Whether a second bench below the first one stands: from grade 1, a pit deeper than the first bench. */
export function secondBenchReached(input: { grade: number; deepestPitM: number }): boolean {
  void input;
  void LADDER_BENCH_FLOOR_M;
  throw new Error('not implemented');
}

export type FrontierSurveyMethod = 'prospection' | 'meteorite_detector';

/** Readings the meteorite detector takes before the crater is estimated. */
export const LADDER_DETECTOR_READINGS = 2;

/** The survey method the ladder runs at a grade; null while no frontier survey is open. */
export function frontierSurveyMethod(grade: number): FrontierSurveyMethod | null {
  void grade;
  throw new Error('not implemented');
}

/** How many surveys of `method` the ladder takes. */
export function frontierSurveysWanted(method: FrontierSurveyMethod): number {
  void method;
  throw new Error('not implemented');
}

export interface FrontierSurveyInput {
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
  void input;
  throw new Error('not implemented');
}

/** Metres between the detector's two reading spots. */
export const LADDER_DETECTOR_SPOT_SEPARATION_M = 120;

/** Spot of the second reading: the base moved perpendicular to the first reading's bearing, so the two cones cross. */
export function detectorSecondSpot(base: { x: number; z: number }, bearing: number): { x: number; z: number } {
  void base;
  void bearing;
  throw new Error('not implemented');
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
  void fixes;
  throw new Error('not implemented');
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
  void islands;
  void from;
  void shotAt;
  throw new Error('not implemented');
}

/** Pattern corner that centres a `span`-wide pattern on `target`. */
export function expeditionOrigin(target: { x: number; z: number }, span: number): { x: number; z: number } {
  void target;
  void span;
  throw new Error('not implemented');
}

export interface FrontierBuyInput {
  grade: number;
  shuttles: number;
  cash: number;
  cost: number;
  reserve: number;
}

/** Whether the ladder buys its shuttle now: once, from the grade that unlocks it. */
export function decideShuttle(input: FrontierBuyInput): 'buy' | 'skip' {
  void input;
  void TRAVEL_VEHICLE_UNLOCK_GRADE;
  throw new Error('not implemented');
}

export interface ExpeditionInput {
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
  void input;
  throw new Error('not implemented');
}
