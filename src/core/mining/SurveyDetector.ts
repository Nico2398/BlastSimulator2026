// BlastSimulator2026 — Meteorite detector (#2291): a bearing toward the crater and a distance band, never its centre.

import { t } from '../i18n/I18n.js';
import type { Random } from '../math/Random.js';
import {
  DETECTOR_BAND_ROUND_M,
  DETECTOR_BAND_WIDTH_M,
  DETECTOR_HALF_ANGLE_SKILL1_DEG,
  DETECTOR_HALF_ANGLE_TOP_DEG,
  PROSPECTION_TOP_SKILL,
} from '../config/balance.js';
import { clamp } from './SurveyEstimateMath.js';

/** One reading: where the crater lies, as a cone (bearing ± halfAngle) clipped to a distance band. */
export interface DetectorReading {
  /** Radians, `atan2(dz, dx)` from the reading's origin. */
  bearing: number;
  /** Radians: the angular error bound; the true bearing lies within it. */
  halfAngle: number;
  minDistance: number;
  maxDistance: number;
}

/** Share of the band below the true distance: kept inside (0, 1) so the centre is never at an edge. */
const BAND_OFFSET_MIN = 0.2;
const BAND_OFFSET_MAX = 0.8;
const DEG_TO_RAD = Math.PI / 180;

/** Angular error bound (radians) at a skill level: widest at skill 1, narrowest at the top skill. */
export function detectorHalfAngle(skillLevel: number): number {
  const t = clamp((skillLevel - 1) / (PROSPECTION_TOP_SKILL - 1), 0, 1);
  const deg = DETECTOR_HALF_ANGLE_SKILL1_DEG + (DETECTOR_HALF_ANGLE_TOP_DEG - DETECTOR_HALF_ANGLE_SKILL1_DEG) * t;
  return deg * DEG_TO_RAD;
}

/** Take a reading toward the crater from `origin`; null when the world has no crater. Seeded. */
export function readMeteoriteDetector(
  crater: { x: number; z: number } | null,
  origin: { x: number; z: number },
  skillLevel: number,
  rng: Random,
): DetectorReading | null {
  if (!crater) return null;
  const dx = crater.x - origin.x;
  const dz = crater.z - origin.z;
  const halfAngle = detectorHalfAngle(skillLevel);
  const bearing = Math.atan2(dz, dx) + (rng.next() * 2 - 1) * halfAngle;
  const below = rng.nextFloat(BAND_OFFSET_MIN, BAND_OFFSET_MAX) * DETECTOR_BAND_WIDTH_M;
  const rawMin = Math.hypot(dx, dz) - below;
  const minDistance = Math.max(0, Math.floor(rawMin / DETECTOR_BAND_ROUND_M) * DETECTOR_BAND_ROUND_M);
  return { bearing, halfAngle, minDistance, maxDistance: minDistance + DETECTOR_BAND_WIDTH_M };
}

/** One reading as text: bearing in degrees (0-360, from +x toward +z), its spread, and the distance band. */
export function detectorReadingText(reading: DetectorReading): string {
  const deg = (reading.bearing / DEG_TO_RAD + 360) % 360;
  return t('ui.survey.reading_row', {
    bearing: Math.round(deg),
    spread: Math.round(reading.halfAngle / DEG_TO_RAD),
    min: reading.minDistance,
    max: reading.maxDistance,
  });
}
