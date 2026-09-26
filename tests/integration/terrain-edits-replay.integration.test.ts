// BlastSimulator2026 — Integration test: TerrainEdits record + replay (#1180)
//
// Drives a real gameplay sequence — a blast, a ramp with at least one fill
// column, a level_ground order, and a single-voxel dig — against a grid
// generated from the `dusty_hollow` level's own config, then proves that
// replaying the resulting `grid.edits` record onto a second, independently
// generated grid reproduces the live grid voxel for voxel: density,
// composition, ores, and fracture, at every voxel of every chunk the live
// grid owns.
//
// RED phase: TerrainEdits' instance methods and VoxelGrid.withoutEditRecording
// are still `throw new Error('not implemented')` stubs, and none of
// VoxelGrid's mutators (fillVoxel/clearVoxel/setVoxel/setFractureAt/
// scaleFractureAt) yet call into `grid.edits` at all — so `grid.edits` stays
// empty throughout the gameplay sequence below, and `replayTerrainEdits`
// itself throws immediately. This test is expected to FAIL for that reason.

import { describe, it, expect } from 'vitest';
import { getLevel } from '../../src/core/campaign/Level.js';
import { generateTerrain, type TerrainConfig } from '../../src/core/world/TerrainGen.js';
import { VoxelGrid, computeVoxelColumnSurfaceY, setVoxelColumnSurfaceHeight } from '../../src/core/world/VoxelGrid.js';
import { replayTerrainEdits } from '../../src/core/world/TerrainEdits.js';
import { createGridPlan, resetHoleIds, digVoxel } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../src/core/mining/BlastExecution.js';
import { defineRampSegments, carveRampSegment, type RampDef } from '../../src/core/mining/Ramp.js';
import { levelGroundRect } from '../../src/core/mining/LevelGround.js';

const DUSTY_HOLLOW_LEVEL = getLevel('dusty_hollow');
if (!DUSTY_HOLLOW_LEVEL) throw new Error('dusty_hollow level definition not found');

// The level's own declared height — used below as the scan bound in place of
// `live.sizeY`, which is now a fixed, height-free sentinel (4096) unrelated
// to how tall this level's terrain actually is. Scanning to the sentinel
// would multiply the voxel-for-voxel comparison's cost by ~170x per column.
const DECLARED_HEIGHT_FOR_SCAN = DUSTY_HOLLOW_LEVEL.gridY;

function dustyHollowTerrainConfig(): TerrainConfig {
  return {
    sizeX: DUSTY_HOLLOW_LEVEL!.gridX,
    datum: Math.floor(DUSTY_HOLLOW_LEVEL!.gridY * 0.55),
    sizeZ: DUSTY_HOLLOW_LEVEL!.gridZ,
    seed: DUSTY_HOLLOW_LEVEL!.terrainSeed,
    climateBias: DUSTY_HOLLOW_LEVEL!.climateBias,
    mixedRockHardness: DUSTY_HOLLOW_LEVEL!.mixedRockHardness,
  };
}

/**
 * Walks every voxel of every chunk `live` owns and compares it against the
 * same coordinate in `replayed` — density, dominant rock, ore densities, and
 * fracture modifier. Fails on the FIRST mismatch, naming the voxel and both
 * values, rather than aggregating every difference into one unreadable dump.
 */
function assertGridsMatchVoxelForVoxel(replayed: VoxelGrid, live: VoxelGrid): void {
  const chunks = live.ownedChunks();
  expect(chunks.length, 'the live grid owns no chunks at all — nothing to compare').toBeGreaterThan(0);

  for (const { cx, cz } of chunks) {
    const rect = live.chunkRect(cx, cz)!;
    for (let z = rect.minZ; z < rect.maxZ; z++) {
      for (let x = rect.minX; x < rect.maxX; x++) {
        for (let y = 0; y < DECLARED_HEIGHT_FOR_SCAN; y++) {
          const liveDensity = live.densityAt(x, y, z);
          const replayedDensity = replayed.densityAt(x, y, z);
          expect(
            replayedDensity,
            `density mismatch at (${x}, ${y}, ${z}): live=${liveDensity} replayed=${replayedDensity}`,
          ).toBe(liveDensity);

          const liveRock = live.dominantRockAt(x, y, z);
          const replayedRock = replayed.dominantRockAt(x, y, z);
          expect(
            replayedRock,
            `dominant rock mismatch at (${x}, ${y}, ${z}): live=${liveRock} replayed=${replayedRock}`,
          ).toBe(liveRock);

          const liveOres = live.oresAt(x, y, z);
          const replayedOres = replayed.oresAt(x, y, z);
          expect(
            replayedOres,
            `ore densities mismatch at (${x}, ${y}, ${z}): live=${JSON.stringify(liveOres)} replayed=${JSON.stringify(replayedOres)}`,
          ).toEqual(liveOres);

          const liveFracture = live.fractureAt(x, y, z);
          const replayedFracture = replayed.fractureAt(x, y, z);
          expect(
            replayedFracture,
            `fracture mismatch at (${x}, ${y}, ${z}): live=${liveFracture} replayed=${replayedFracture}`,
          ).toBeCloseTo(liveFracture, 10);
        }
      }
    }
  }
}

describe('TerrainEdits — record and replay against a dusty_hollow-shaped grid (#1180)', () => {
  it('replaying the live grid\'s edit record onto a fresh generated grid reproduces it voxel for voxel', () => {
    resetHoleIds();
    const config = dustyHollowTerrainConfig();
    const live = generateTerrain(config);

    // ── 1. Blast ────────────────────────────────────────────────────────
    const blastOriginX = 20, blastOriginZ = 20;
    const blastSurfaceY = computeVoxelColumnSurfaceY(live, blastOriginX, blastOriginZ);
    expect(blastSurfaceY, 'expected solid ground under the blast pattern').toBeGreaterThanOrEqual(0);

    const holes = createGridPlan({ x: blastOriginX, z: blastOriginZ }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const blastResult = executeBlast(plan, live, []);
    expect(blastResult).not.toBeNull();
    expect(blastResult!.clearedVoxels).toBeGreaterThan(0);

    // ── 2. Ramp — cut columns plus at least one fill column ───────────────
    // Force a fill column (#1172): carve a deep canyon dip straight into the
    // ramp's own width band before defining it, well below where its
    // straight floor line will sit, so `defineRampSegments` is guaranteed to
    // emit a `fillTarget` cell there rather than depending on whichever dip
    // the procedural terrain happens to contain at this seed.
    const rampOriginX = 50, rampOriginZ = 5;
    const canyonCompId = live.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let z = 10; z <= 12; z++) {
      for (let x = rampOriginX - 1; x <= rampOriginX + 1; x++) {
        setVoxelColumnSurfaceHeight(live, x, z, 2, canyonCompId);
      }
    }

    const ramp: RampDef = { originX: rampOriginX, originZ: rampOriginZ, direction: 'south', length: 12, targetDepth: 6 };
    const segments = defineRampSegments(live, ramp);
    expect(segments.length).toBeGreaterThan(0);
    expect(
      segments.some(s => s.cells.some(c => c.fillTarget !== undefined)),
      'expected at least one fill column among the ramp segments',
    ).toBe(true);

    for (const segment of segments) carveRampSegment(live, segment);

    // ── 3. level_ground over a small area ──────────────────────────────
    levelGroundRect(live, { minX: 70, maxX: 75, minZ: 70, maxZ: 75 });

    // ── 4. Single-voxel dig ─────────────────────────────────────────────
    const digX = 5, digZ = 5;
    const digSurfaceY = computeVoxelColumnSurfaceY(live, digX, digZ);
    expect(digSurfaceY).not.toBeNull();
    expect(digSurfaceY, 'expected solid ground at the dig column').toBeGreaterThanOrEqual(0);
    const digResult = digVoxel(live, digX, digSurfaceY!, digZ);
    expect(digResult.success).toBe(true);

    // ── Replay onto a fresh, independently generated grid ────────────────
    const fresh = generateTerrain(dustyHollowTerrainConfig());
    replayTerrainEdits(fresh, live.edits);

    assertGridsMatchVoxelForVoxel(fresh, live);
  });
});
