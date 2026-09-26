// BlastSimulator2026 — Integration test: terrain save/reload against a real
// campaign level (#1181)
//
// Drives a real gameplay sequence — a blast, then a site expansion past the
// level's original footprint — against `treranium_depths` (a
// `mixedRockHardness: true` level), saves through the console's save/load
// commands, and proves that reloading reproduces the live grid voxel for
// voxel against a SECOND, independently-built context that ran the identical
// sequence but was never saved. Covers a blast-edited chunk, a newly-claimed
// chunk, and an untouched chunk — and separately proves the
// mixedRockHardness fix (#1181) reaches a real reload by checking that an
// untouched column's strata still alternate rock ids with depth after the
// round trip.

import { describe, it, expect } from 'vitest';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { campaignStartCommand } from '../../src/console/commands/campaign.js';
import { saveCommand, loadCommand } from '../../src/console/commands/saveload.js';
import { claimForAction } from '../../src/console/commands/siteExpansion.js';
import { buildNavGridSyncTarget, type GameContext } from '../../src/console/commands/world.js';
import { subscribeNavGridToUpdates } from '../../src/core/nav/NavGridSync.js';
import { resetHoleIds, createGridPlan } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../src/core/mining/BlastExecution.js';
import { computeVoxelColumnSurfaceY, MAX_TERRAIN_GEN_DIMENSION, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';

const BLAST_ORIGIN_X = 20;
const BLAST_ORIGIN_Z = 20;
// East of the level's original 160-wide footprint (0..160) — claiming here
// only succeeds if site expansion genuinely grows the site past its base size.
const EXPANSION_X = 165;
// Column sampled well away from both the blast and the expansion — proves the
// mixedRockHardness fix reaches ordinary, never-touched generated ground too.
const UNTOUCHED_COLUMN_X = 100;
const UNTOUCHED_COLUMN_Z = 100;

/** A bare console GameContext, wired the same way createRunner.ts wires production. */
function makeEmptyGameContext(): GameContext {
  const ctx: GameContext = {
    state: null, grid: null, landscape: null, playableArea: null, emitter: new EventEmitter(),
  };
  subscribeNavGridToUpdates(ctx.emitter, () => buildNavGridSyncTarget(ctx));
  return ctx;
}

/**
 * Starts `treranium_depths` (tier 3, locked by default) by unlocking it on a
 * freshly created campaign, then starting it — mirroring the console's own
 * `campaign_start` flow rather than reaching into CampaignState internals.
 */
function startTreraniumDepths(): GameContext {
  const ctx = makeEmptyGameContext();
  const bootstrap = campaignStartCommand(ctx, [], { level: 'tutorial_pit' });
  if (!bootstrap.success) throw new Error(`campaignStartCommand(tutorial_pit) failed: ${bootstrap.output}`);
  const entry = ctx.state!.campaign.levels['treranium_depths'];
  if (!entry) throw new Error('treranium_depths has no campaign progress entry');
  entry.unlocked = true;

  const result = campaignStartCommand(ctx, [], { level: 'treranium_depths' });
  if (!result.success) throw new Error(`campaignStartCommand(treranium_depths) failed: ${result.output}`);
  return ctx;
}

/** Runs the identical blast + site-expansion sequence against `ctx`'s grid. */
function runBlastAndExpansion(ctx: GameContext): void {
  resetHoleIds();

  const blastSurfaceY = computeVoxelColumnSurfaceY(ctx.grid!, BLAST_ORIGIN_X, BLAST_ORIGIN_Z);
  expect(blastSurfaceY, 'expected solid ground under the blast pattern').toBeGreaterThanOrEqual(0);

  const holes = createGridPlan({ x: BLAST_ORIGIN_X, z: BLAST_ORIGIN_Z }, 2, 3, 4, 8, 0.15);
  const holeIds = holes.map(h => h.id);
  const holeDepths: Record<string, number> = {};
  for (const h of holes) holeDepths[h.id] = h.depth;
  const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
  const delays = autoVPattern(holes, 25);
  const plan = assembleBlastPlan(holes, charges, delays);

  const blastResult = executeBlast(plan, ctx.grid!, []);
  expect(blastResult).not.toBeNull();
  expect(blastResult!.clearedVoxels).toBeGreaterThan(0);

  const expandCells: Array<{ x: number; z: number }> = [];
  for (let z = 0; z < 16; z++) expandCells.push({ x: EXPANSION_X, z });
  const claim = claimForAction(ctx, expandCells, 'test expansion');
  expect(claim.ok, `site expansion refused: ${claim.output}`).toBe(true);
  expect(claim.expanded).toBe(true);
}

/** Walks every voxel of chunk (cx, cz) and compares `a` against `b` — density, dominant rock, ores, fracture. */
function assertChunkMatchesVoxelForVoxel(a: VoxelGrid, b: VoxelGrid, cx: number, cz: number): void {
  const rect = b.chunkRect(cx, cz);
  expect(rect, `chunk (${cx}, ${cz}) is not owned by the reference grid`).not.toBeNull();
  expect(a.hasChunk(cx, cz), `chunk (${cx}, ${cz}) is not owned by the reloaded grid`).toBe(true);

  for (let x = rect!.minX; x < rect!.maxX; x++) {
    for (let z = rect!.minZ; z < rect!.maxZ; z++) {
      for (let y = 0; y < MAX_TERRAIN_GEN_DIMENSION; y++) {
        const aDensity = a.densityAt(x, y, z);
        const bDensity = b.densityAt(x, y, z);
        expect(aDensity, `density mismatch at (${x},${y},${z}): reloaded=${aDensity} reference=${bDensity}`).toBe(bDensity);

        const aRock = a.dominantRockAt(x, y, z);
        const bRock = b.dominantRockAt(x, y, z);
        expect(aRock, `dominant rock mismatch at (${x},${y},${z}): reloaded=${aRock} reference=${bRock}`).toBe(bRock);

        const aOres = a.oresAt(x, y, z);
        const bOres = b.oresAt(x, y, z);
        expect(aOres, `ore mismatch at (${x},${y},${z}): reloaded=${JSON.stringify(aOres)} reference=${JSON.stringify(bOres)}`).toEqual(bOres);

        const aFracture = a.fractureAt(x, y, z);
        const bFracture = b.fractureAt(x, y, z);
        expect(aFracture, `fracture mismatch at (${x},${y},${z}): reloaded=${aFracture} reference=${bFracture}`).toBeCloseTo(bFracture, 10);
      }
    }
  }
}

describe('terrain save/reload against treranium_depths (#1181)', () => {
  it(
    'reloading a save reproduces the live grid voxel for voxel across blast-edited, newly-claimed, and untouched chunks, and preserves mixedRockHardness strata',
    () => {
      // ── Context 1: blast, expand, save, reset the grid, reload ───────────
      const live = startTreraniumDepths();
      expect(live.state!.world!.mixedRockHardness, 'treranium_depths should carry mixedRockHardness through campaign start').toBe(true);
      runBlastAndExpansion(live);

      const saveResult = saveCommand(live, [], { slot: 'treranium-reload' });
      expect(saveResult.success).toBe(true);

      live.grid = null;
      const loadResult = loadCommand(live, [], { slot: 'treranium-reload' });
      expect(loadResult.success).toBe(true);
      expect(live.grid).not.toBeNull();

      // ── Context 2: identical sequence, never saved ────────────────────────
      const reference = startTreraniumDepths();
      runBlastAndExpansion(reference);

      // Blast-edited chunk.
      assertChunkMatchesVoxelForVoxel(live.grid!, reference.grid!, 1, 1);
      // Newly-claimed chunk (east of the level's original 160-wide footprint).
      assertChunkMatchesVoxelForVoxel(live.grid!, reference.grid!, 10, 0);
      // Untouched chunk elsewhere on the site.
      assertChunkMatchesVoxelForVoxel(live.grid!, reference.grid!, 6, 6);

      // The mixedRockHardness fix reaches a real reload: an untouched column
      // still shows the interleaved hard/soft strata bands, not a single
      // uniform rock the way a mixedRockHardness-less regeneration would.
      const rocksWithDepth = new Set<string>();
      for (let y = 0; y < MAX_TERRAIN_GEN_DIMENSION; y++) {
        const rock = live.grid!.dominantRockAt(UNTOUCHED_COLUMN_X, y, UNTOUCHED_COLUMN_Z);
        if (rock) rocksWithDepth.add(rock);
      }
      expect(
        rocksWithDepth.size,
        `expected an interleaved mixedRockHardness profile at (${UNTOUCHED_COLUMN_X}, ${UNTOUCHED_COLUMN_Z}), got only ${JSON.stringify([...rocksWithDepth])}`,
      ).toBeGreaterThanOrEqual(2);
    },
    30000,
  );
});
