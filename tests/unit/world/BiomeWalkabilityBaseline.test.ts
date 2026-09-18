// BlastSimulator2026 — #1147
//
// Measures, per biome, the percentage of a generated 64x64x64 site
// reachable from its centre under two rules:
//   (a) today's step rule: NavGrid.buildNavGrid + NavGrid.computeClimbReachableSet
//   (b) a 30-degree grade rule: computeVoxelColumnSurfaceHeight + a local
//       grade-based flood fill over NEIGHBOUR_OFFSETS_8
//
// Test-only issue — no production code changes. Records today's figures as
// a baseline (part of the terrain-height epic, ahead of a walkability change
// moving from the step rule to the grade rule) so a later terrain-generation
// change moves them visibly rather than silently.

import { describe, it, expect } from 'vitest';
import { generateTerrain, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { getBiome } from '../../../src/core/world/BiomeCatalog.js';
import { computeVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { NEIGHBOUR_OFFSETS_8 } from '../../../src/core/nav/NeighbourOffsets.js';

const SITE_SIZE = 64;
const SEED = 42;
const TOLERANCE_PP = 0.5;
const GRADE_LIMIT_DEGREES = 30;
const CENTRE_X = Math.floor(SITE_SIZE / 2);
const CENTRE_Z = Math.floor(SITE_SIZE / 2);

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
 * biased toward that biome's centre (via getBiome).
 */
function buildSiteConfig(biomeId: BiomeId): TerrainConfig {
  const biome = getBiome(biomeId)!;
  return {
    sizeX: SITE_SIZE,
    sizeY: SITE_SIZE,
    sizeZ: SITE_SIZE,
    seed: SEED,
    climateBias: biome.climateCenter,
  };
}

/**
 * Grade in degrees for a step of horizontal run `dx`/`dz` (grid units) and
 * vertical rise `dh` (voxel units) between two adjacent surface columns.
 */
function gradeDegrees(dh: number, dx: number, dz: number): number {
  const rise = Math.abs(dh);
  const run = Math.hypot(dx, dz);
  return Math.atan2(rise, run) * (180 / Math.PI);
}

/**
 * Flood-fills from the site centre over NEIGHBOUR_OFFSETS_8, admitting a
 * neighbour only when gradeDegrees(...) stays under GRADE_LIMIT_DEGREES.
 * Surface heights come from computeVoxelColumnSurfaceHeight. Returns the
 * reachable percentage of the site, [0, 100].
 */
function computeGradeReachablePercent(config: TerrainConfig): number {
  const grid = generateTerrain(config);
  const { sizeX, sizeZ } = config;

  const visited = new Set<string>();
  const key = (x: number, z: number) => `${x},${z}`;

  const stack: [number, number][] = [[CENTRE_X, CENTRE_Z]];
  visited.add(key(CENTRE_X, CENTRE_Z));

  while (stack.length > 0) {
    const [x, z] = stack.pop()!;
    const h0 = computeVoxelColumnSurfaceHeight(grid, x, z);
    for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nx >= sizeX || nz < 0 || nz >= sizeZ) continue;
      const nKey = key(nx, nz);
      if (visited.has(nKey)) continue;

      const h1 = computeVoxelColumnSurfaceHeight(grid, nx, nz);
      if (Number.isNaN(h0) || Number.isNaN(h1)) continue;

      const grade = gradeDegrees(h1 - h0, dx, dz);
      if (grade <= GRADE_LIMIT_DEGREES) {
        visited.add(nKey);
        stack.push([nx, nz]);
      }
    }
  }

  return (visited.size / (sizeX * sizeZ)) * 100;
}

/**
 * Today's rule: NavGrid.buildNavGrid + NavGrid.computeClimbReachableSet from
 * the site centre. Returns the reachable percentage of the site, [0, 100].
 */
function computeStepReachablePercent(config: TerrainConfig): number {
  const grid = generateTerrain(config);
  const navGrid = NavGrid.buildNavGrid(grid, [], []);
  const reachable = NavGrid.computeClimbReachableSet(navGrid, CENTRE_X, CENTRE_Z);
  return (reachable.size / (config.sizeX * config.sizeZ)) * 100;
}

function expectWithinTolerance(actual: number, expected: number, label: string): void {
  expect(actual, label).toBeGreaterThanOrEqual(expected - TOLERANCE_PP);
  expect(actual, label).toBeLessThanOrEqual(expected + TOLERANCE_PP);
}

describe('BiomeWalkabilityBaseline', () => {
  describe.each(BIOME_IDS)('%s', (biomeId) => {
    it(`${SITE_SIZE}^3 site, seed ${SEED}: today's step-climb rule reaches the baseline ${STEP_RULE_BASELINE_PCT[biomeId]}% (±${TOLERANCE_PP}pp)`, () => {
      const config = buildSiteConfig(biomeId);
      const pct = computeStepReachablePercent(config);
      expectWithinTolerance(pct, STEP_RULE_BASELINE_PCT[biomeId], `${biomeId} step-rule reachable %`);
    });

    it(`${SITE_SIZE}^3 site, seed ${SEED}: the ${GRADE_LIMIT_DEGREES}-degree grade rule reaches the baseline ${GRADE_RULE_BASELINE_PCT[biomeId]}% (±${TOLERANCE_PP}pp)`, () => {
      const config = buildSiteConfig(biomeId);
      const pct = computeGradeReachablePercent(config);
      expectWithinTolerance(pct, GRADE_RULE_BASELINE_PCT[biomeId], `${biomeId} grade-rule reachable %`);
    });
  });
});
