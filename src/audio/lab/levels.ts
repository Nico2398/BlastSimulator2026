// BlastSimulator2026 — Level helpers
// Decibel conversion with a floor, so silence is a number JSON can carry.

import { LAB_STATS_CONFIG } from '../../core/config/audio/lab.js';

/** 20 log10 of an amplitude, floored. */
export function amplitudeToDb(amplitude: number): number {
  return powerToDb(amplitude * amplitude);
}

/** 10 log10 of a power, floored. */
export function powerToDb(power: number): number {
  if (!(power > 0)) return LAB_STATS_CONFIG.floorDb;
  return Math.max(10 * Math.log10(power), LAB_STATS_CONFIG.floorDb);
}

/** Round for the report: a tenth of a dB is more than anyone hears. */
export function roundDb(db: number): number {
  return Math.round(db * 10) / 10;
}
