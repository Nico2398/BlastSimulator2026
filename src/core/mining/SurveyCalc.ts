// BlastSimulator2026 — Survey types and noise-scaled estimation logic

import { VoxelGrid } from '../world/VoxelGrid.js';
import { Random } from '../math/Random.js';

/** The three supported methods for surveying a mining site. */
export type SurveyMethod = 'seismic' | 'core_sample' | 'aerial';

/** Runtime array of every valid SurveyMethod value. */
export const SURVEY_METHODS: SurveyMethod[] = ['seismic', 'core_sample', 'aerial'];

/**
 * The result produced when a survey is completed.
 *
 * `estimates` is a two-level map:  outer key = resource/zone label,
 * inner key = grade/sub-zone label, value = numeric estimate (e.g. proportion).
 *
 * `confidence` must be in [0, 1].
 */
export interface SurveyResult {
  /** Unique survey record identifier. */
  id: number;
  /** Method used to gather data. */
  method: SurveyMethod;
  /** World-space X coordinate of the survey centre. */
  centerX: number;
  /** World-space Z coordinate of the survey centre. */
  centerZ: number;
  /** Simulation tick on which the survey was completed. */
  completedTick: number;
  /** ID of the surveyor entity that performed the survey. */
  surveyorId: number;
  /** Nested numeric estimates keyed by resource then grade. */
  estimates: Record<string, Record<string, number>>;
  /** Confidence in the estimates, clamped to [0, 1]. */
  confidence: number;
}

// ── Method-specific constants ─────────────────────────────────────────────────

/** Baseline noise (std-dev) applied to estimates before skill adjustment. */
const BASE_ERROR: Record<SurveyMethod, number> = {
  seismic: 0.15,
  core_sample: 0.05,
  aerial: 0.25,
};

/** Disc radius (in grid cells) around the survey centre that each method covers. */
const COVERAGE_RADIUS: Record<SurveyMethod, number> = {
  seismic: 20,
  core_sample: 0,
  aerial: 30,
};

/** Error reduction applied per skill level above 1. */
const SKILL_BONUS_PER_LEVEL = 0.12;

/** Number of Y-levels grouped together in a single seismic reading. */
const SEISMIC_GROUP_SIZE = 3;

/** Ore estimate resolution expressed as a step size (rounds to nearest 0.05). */
const ESTIMATE_STEP = 0.05;

/** Parameters required to compute a noisy survey estimate from a VoxelGrid. */
export interface EstimateSurveyParams {
  id: number;
  method: SurveyMethod;
  centerX: number;
  centerZ: number;
  surveyorId: number;
  /** Surveyor skill level 1–5. Higher values reduce noise. */
  skillLevel: number;
  completedTick: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function clamp(val: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, val));
}

/** Round a value to the nearest ESTIMATE_STEP (0.05). */
function roundToEstimateStep(val: number): number {
  return Math.round(val / ESTIMATE_STEP) * ESTIMATE_STEP;
}

/** Scan top→bottom to find the first solid voxel; return y+1, or 0 if all empty. */
function getSurfaceY(grid: VoxelGrid, x: number, z: number): number {
  for (let y = grid.sizeY - 1; y >= 0; y--) {
    const v = grid.getVoxel(x, y, z);
    if (v && v.density > 0) return y + 1;
  }
  return 0;
}

/**
 * Average a specific ore's density over the subset of `yLevels` that contain
 * solid voxels. Returns `undefined` if no solid voxels are found.
 */
function averageSolidOreDensity(
  grid: VoxelGrid,
  x: number,
  z: number,
  yLevels: number[],
  oreId: string,
): number | undefined {
  const solidVals: number[] = [];
  for (const y of yLevels) {
    const v = grid.getVoxel(x, y, z);
    if (v && v.density > 0) solidVals.push(v.oreDensities[oreId] ?? 0);
  }
  return solidVals.length > 0
    ? solidVals.reduce((sum, val) => sum + val, 0) / solidVals.length
    : undefined;
}

/**
 * Seismic density estimate: split `yLevels` into consecutive groups of
 * SEISMIC_GROUP_SIZE, average solid voxels within each group, then average
 * the group averages. Returns `undefined` if no solid voxels are found.
 */
function computeSeismicOreDensity(
  grid: VoxelGrid,
  x: number,
  z: number,
  yLevels: number[],
  oreId: string,
): number | undefined {
  const groupAvgs: number[] = [];
  for (let i = 0; i < yLevels.length; i += SEISMIC_GROUP_SIZE) {
    const avg = averageSolidOreDensity(grid, x, z, yLevels.slice(i, i + SEISMIC_GROUP_SIZE), oreId);
    if (avg !== undefined) groupAvgs.push(avg);
  }
  return groupAvgs.length > 0
    ? groupAvgs.reduce((sum, val) => sum + val, 0) / groupAvgs.length
    : undefined;
}

/**
 * Produce a noisy, skill-scaled SurveyResult from a VoxelGrid.
 *
 * - Confidence = clamp(1 − finalError, 0, 1)  where finalError = BASE_ERROR × (1 − skillBonus).
 * - Coverage is a disc of COVERAGE_RADIUS[method] around (centerX, centerZ).
 * - Seismic: Y values grouped into consecutive triplets; group-average → column-average → add noise.
 * - core_sample / aerial: plain average of sampled solid-voxel densities → add noise.
 * - Values are clamped to [0,1], rounded to nearest 0.05; zero estimates are omitted.
 */
export function estimateSurveyResult(
  grid: VoxelGrid,
  params: EstimateSurveyParams,
  rng: Random,
): SurveyResult {
  const { id, method, centerX, centerZ, surveyorId, skillLevel, completedTick } = params;

  const skillBonus = (skillLevel - 1) * SKILL_BONUS_PER_LEVEL;
  const finalError = BASE_ERROR[method] * (1 - skillBonus);
  const confidence = clamp(1 - finalError, 0, 1);

  const radius = COVERAGE_RADIUS[method];
  const estimates: Record<string, Record<string, number>> = {};

  const xMin = Math.max(0, Math.floor(centerX - radius));
  const xMax = Math.min(grid.sizeX - 1, Math.ceil(centerX + radius));
  const zMin = Math.max(0, Math.floor(centerZ - radius));
  const zMax = Math.min(grid.sizeZ - 1, Math.ceil(centerZ + radius));

  for (let x = xMin; x <= xMax; x++) {
    for (let z = zMin; z <= zMax; z++) {
      if (!grid.isInBounds(x, 0, z)) continue;

      const dx = x - centerX;
      const dz = z - centerZ;
      if (Math.sqrt(dx * dx + dz * dz) > radius) continue;

      // Determine which Y levels to sample
      let yLevels: number[];
      if (method === 'aerial') {
        const surfaceY = getSurfaceY(grid, x, z);
        yLevels = [surfaceY, surfaceY - 1].filter(y => y >= 0 && y < grid.sizeY);
      } else {
        yLevels = [];
        for (let y = 0; y < grid.sizeY; y++) yLevels.push(y);
      }

      // Collect ore IDs present in any solid voxel in the sampled range
      const allOreIds = new Set<string>();
      for (const y of yLevels) {
        const v = grid.getVoxel(x, y, z);
        if (v && v.density > 0) {
          for (const oreId of Object.keys(v.oreDensities)) allOreIds.add(oreId);
        }
      }
      if (allOreIds.size === 0) continue;

      const colEstimates: Record<string, number> = {};

      for (const oreId of allOreIds) {
        const trueDensity = method === 'seismic'
          ? computeSeismicOreDensity(grid, x, z, yLevels, oreId)
          : averageSolidOreDensity(grid, x, z, yLevels, oreId);
        if (trueDensity === undefined) continue;

        const noisy = trueDensity + rng.gaussian(0, finalError);
        const rounded = roundToEstimateStep(clamp(noisy, 0, 1));
        if (rounded > 0) colEstimates[oreId] = rounded;
      }

      if (Object.keys(colEstimates).length > 0) {
        estimates[`${x},${z}`] = colEstimates;
      }
    }
  }

  return { id, method, centerX, centerZ, surveyorId, completedTick, estimates, confidence };
}

