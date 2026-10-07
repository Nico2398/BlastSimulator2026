// BlastSimulator2026 — Weather effects on mining operations
// Rain fills drill holes; water persists per hole until it seeps away. Tubing makes a hole watertight.

import {
  GROUND_WETNESS_DECAY_RATE,
  GROUND_WETNESS_RISE_RATE,
  HOLE_FADE_POROSITY_SLOWDOWN,
  HOLE_RAIN_FILL_RATE,
  HOLE_SEEP_RATE,
  HOLE_WATER_FADE_RATE,
  HOLE_WET_THRESHOLD,
} from '../config/balance.js';

/** Per-hole water state. */
export interface HoleWater {
  /** Water level as a fraction of hole depth (0 = dry, 1 = full). */
  level: number;
  /** Rock porosity at the hole (0..1); porous rock fades water slower. */
  porosity: number;
}

/** One tick of water change in a hole. Tubed holes are watertight: water neither enters nor leaves. */
export function advanceHoleWater(
  hw: HoleWater,
  rain: number,
  groundWetness: number,
  tubed: boolean,
): HoleWater {
  if (tubed) return hw;
  let level = hw.level;
  level += rain * HOLE_RAIN_FILL_RATE;
  level += groundWetness * hw.porosity * HOLE_SEEP_RATE;
  if (rain <= 0) level -= HOLE_WATER_FADE_RATE * (1 - hw.porosity * HOLE_FADE_POROSITY_SLOWDOWN);
  return { ...hw, level: Math.min(1, Math.max(0, level)) };
}

/** One tick of ground wetness change: rises with rain, decays when dry. */
export function advanceGroundWetness(wetness: number, rain: number): number {
  const next = rain > 0
    ? wetness + rain * GROUND_WETNESS_RISE_RATE
    : wetness - GROUND_WETNESS_DECAY_RATE;
  return Math.min(1, Math.max(0, next));
}

/** True when a water level (fraction of depth) is past HOLE_WET_THRESHOLD. */
export function isHoleFlooded(level: number): boolean {
  return level > HOLE_WET_THRESHOLD;
}
