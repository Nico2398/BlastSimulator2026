// BlastSimulator2026 — #1147 skeleton
//
// Measures, per biome, the percentage of a generated 64x64x64 site
// reachable from its centre under two rules:
//   (a) today's step rule: NavGrid.buildNavGrid + NavGrid.computeClimbReachableSet
//   (b) a 30-degree grade rule: computeVoxelColumnSurfaceHeight + a local
//       grade-based flood fill over NEIGHBOUR_OFFSETS_8
//
// Test-only issue — no production code changes. Stubs only; test-writer
// fills in the flood-fill logic, grade computation, and assertions.

import { describe, it } from 'vitest';
import { generateTerrain, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { getBiome } from '../../../src/core/world/BiomeCatalog.js';
import { computeVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { NEIGHBOUR_OFFSETS_8 } from '../../../src/core/nav/NeighbourOffsets.js';

const SITE_SIZE = 64;
const SEED = 42;
const TOLERANCE_PP = 0.5;
const GRADE_LIMIT_DEGREES = 30;

const BIOME_IDS = [
  'desert_badlands',
  'volcanic_flats',
  'red_canyon',
  'green_foothills',
  'tropical_karst',
  'alpine_granite',
] as const;

type BiomeId = (typeof BIOME_IDS)[number];

/** Baseline reachable-percentage table from #1147, checked to ±TOLERANCE_PP. */
const STEP_RULE_BASELINE_PCT: Record<BiomeId, number> = {
  desert_badlands: 100,
  volcanic_flats: 100,
  red_canyon: 100,
  green_foothills: 100,
  tropical_karst: 100,
  alpine_granite: 100,
};

const GRADE_RULE_BASELINE_PCT: Record<BiomeId, number> = {
  desert_badlands: 100,
  volcanic_flats: 100,
  red_canyon: 98.7,
  green_foothills: 96.7,
  tropical_karst: 66.1,
  alpine_granite: 48.2,
};

/**
 * Builds the TerrainConfig for a biome's SITE_SIZE^3 site at SEED, climate-
 * biased toward that biome's centre (via getBiome). TODO: implement.
 */
function buildSiteConfig(biomeId: BiomeId): TerrainConfig {
  // TODO: implement — climateBias from getBiome(biomeId)?.climateCenter.
  void biomeId;
  void getBiome;
  return undefined as unknown as TerrainConfig;
}

/**
 * Grade in degrees for a step of horizontal run `dx`/`dz` (grid units) and
 * vertical rise `dh` (voxel units) between two adjacent surface columns.
 * TODO: implement.
 */
function gradeDegrees(dh: number, dx: number, dz: number): number {
  // TODO: implement — atan2(|dh|, hypot(dx, dz)) in degrees.
  void dh;
  void dx;
  void dz;
  return undefined as unknown as number;
}

/**
 * Flood-fills from the site centre over NEIGHBOUR_OFFSETS_8, admitting a
 * neighbour only when gradeDegrees(...) stays under GRADE_LIMIT_DEGREES.
 * Surface heights come from computeVoxelColumnSurfaceHeight. Returns the
 * reachable percentage of the site, [0, 100]. TODO: implement.
 */
function computeGradeReachablePercent(config: TerrainConfig): number {
  // TODO: implement — generateTerrain(config), flood fill from centre using
  // NEIGHBOUR_OFFSETS_8 and gradeDegrees(...) < GRADE_LIMIT_DEGREES, heights
  // via computeVoxelColumnSurfaceHeight.
  void config;
  void generateTerrain;
  void computeVoxelColumnSurfaceHeight;
  void NEIGHBOUR_OFFSETS_8;
  void gradeDegrees;
  return undefined as unknown as number;
}

/**
 * Today's rule: NavGrid.buildNavGrid + NavGrid.computeClimbReachableSet from
 * the site centre. Returns the reachable percentage of the site, [0, 100].
 * TODO: implement.
 */
function computeStepReachablePercent(config: TerrainConfig): number {
  // TODO: implement — generateTerrain(config), NavGrid.buildNavGrid(voxelGrid,
  // [], []), NavGrid.computeClimbReachableSet(navGrid, centreX, centreZ).
  void config;
  void generateTerrain;
  void NavGrid;
  return undefined as unknown as number;
}

describe('BiomeWalkabilityBaseline', () => {
  describe.each(BIOME_IDS)('%s', (biomeId) => {
    it.todo(
      `${SITE_SIZE}^3 site, seed ${SEED}: today's step-climb rule reaches the baseline ${STEP_RULE_BASELINE_PCT[biomeId]}% (±${TOLERANCE_PP}pp)`,
    );
    it.todo(
      `${SITE_SIZE}^3 site, seed ${SEED}: the ${GRADE_LIMIT_DEGREES}-degree grade rule reaches the baseline ${GRADE_RULE_BASELINE_PCT[biomeId]}% (±${TOLERANCE_PP}pp)`,
    );
  });
});

// Referenced so test-writer's stub-filling can call them directly; kept
// unused at module scope otherwise.
void buildSiteConfig;
void computeGradeReachablePercent;
void computeStepReachablePercent;
