// BlastSimulator2026 — Weather effects on mining operations
// Rain fills drill holes based on rock porosity. Flooded holes affect explosive reliability.

import type { DrillHole } from '../mining/DrillPlan.js';
import type { HoleCharge } from '../mining/ChargePlan.js';
import { getExplosive } from '../world/ExplosiveCatalog.js';
import { rainIntensity, type WeatherState } from './WeatherCycle.js';

// ── Hole flooding ──

export interface HoleFloodState {
  /** Water level in meters (0 = dry, up to hole depth). */
  waterLevel: number;
  /** Whether tubing is installed. */
  hasTubing: boolean;
}

/**
 * Calculate hole flooding from rain.
 * Water accumulation per tick = rainIntensity × porosity × accumulationRate.
 * Tubing prevents flooding entirely.
 */
export function updateHoleFlooding(
  hole: DrillHole,
  floodState: HoleFloodState,
  weather: WeatherState,
  rockPorosity: number,
): HoleFloodState {
  if (floodState.hasTubing) {
    return floodState; // Tubing prevents flooding
  }

  const rain = rainIntensity(weather);
  if (rain <= 0) {
    // Slow evaporation in dry weather
    // Real evaporation: ~2-5mm/day in arid climates. Scaled for game ticks.
    const evapRate = 0.05;
    return {
      ...floodState,
      waterLevel: Math.max(0, floodState.waterLevel - evapRate),
    };
  }

  // Accumulation rate: rain intensity × porosity × base rate
  // Higher porosity means water seeps in faster from surrounding rock
  const accumulationRate = 0.3; // meters per tick at full rain + full porosity
  const waterIncrease = rain * rockPorosity * accumulationRate;
  return {
    ...floodState,
    waterLevel: Math.min(hole.depth, floodState.waterLevel + waterIncrease),
  };
}

/**
 * Check if a hole is considered "flooded" (>30% full).
 * Per BLAST_SYSTEM.md: flooded hole + water-sensitive explosive → 10% energy.
 */
export function isHoleFlooded(floodState: HoleFloodState, holeDepth: number): boolean {
  return floodState.waterLevel > holeDepth * 0.3;
}

/**
 * Check if a charge will fail due to flooding.
 * Water-sensitive explosive in a flooded hole without tubing → charge failure.
 */
export function willChargeFail(
  charge: HoleCharge,
  floodState: HoleFloodState,
  holeDepth: number,
): boolean {
  if (floodState.hasTubing) return false;
  if (!isHoleFlooded(floodState, holeDepth)) return false;

  const explosive = getExplosive(charge.explosiveId);
  if (!explosive) return false;

  return explosive.waterSensitive;
}
