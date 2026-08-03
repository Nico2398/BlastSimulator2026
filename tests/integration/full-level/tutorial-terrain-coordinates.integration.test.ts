// BlastSimulator2026 — Integration test: Tutorial level terrain coordinate verification
// Verifies that the tutorial level (tutorial_pit) has proper terrain at specific
// coordinates for survey, building placement, and ramp construction.
// Issue #333

import { describe, it, expect, beforeEach } from 'vitest';
import { makeCampaignCtx } from './helpers.js';
import { setupEvents, clearEvents } from '../../../src/core/events/index.js';
import { surveyCommand } from '../../../src/console/commands/world.js';
import { buildCommand } from '../../../src/console/commands/entities.js';
import { buildRampCommand } from '../../../src/console/commands/mining.js';
import {
  buildPlacementGrid,
  canPlaceBuilding,
  getSurfaceY,
} from '../../../src/core/entities/Building.js';
import { getDominantRockId } from '../../../src/core/world/VoxelGrid.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';
import { getLevel } from '../../../src/core/campaign/Level.js';

const DESERT_ROCKS = ['cruite', 'sandite', 'molite'];

/** Starting cash comes from the level catalogue, not a copy of it. */
const TUTORIAL_START_CASH = getLevel('tutorial_pit')!.startingCash;

/**
 * The tutorial's real guided build area (`REGION.warehouse` in
 * src/ui/tutorialStages.ts, duplicated here rather than imported — this is
 * an integration test for core/console behaviour, not a UI dependency).
 * `canPlaceBuilding` requires an exactly flat footprint (#458 T9.1/D15) —
 * the terrain generator no longer guarantees a specific hardcoded
 * coordinate like (16,16) is that flat, so these tests search the tutorial's
 * own build region for a spot that qualifies rather than assuming one.
 */
const WAREHOUSE_REGION = { x1: 2, z1: 2, x2: 9, z2: 9 };

/** First (x, z) within `region` where a `type`/`tier` footprint is flat and clear, or null if none exists. */
function findBuildableSpot(
  ctx: ReturnType<typeof makeCampaignCtx>,
  type: string,
  tier: number,
  region: { x1: number; z1: number; x2: number; z2: number },
): { x: number; z: number } | null {
  const placementGrid = buildPlacementGrid(ctx.grid!, ctx.state!.buildings);
  for (let x = region.x1; x <= region.x2; x++) {
    for (let z = region.z1; z <= region.z2; z++) {
      if (canPlaceBuilding(placementGrid, type as any, x, z, tier as any).valid) {
        return { x, z };
      }
    }
  }
  return null;
}

describe('Tutorial Level Terrain Coordinates (Issue #333)', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    clearEvents();
    setupEvents();
    ctx = makeCampaignCtx('tutorial_pit');
  });

  // ── Test 1: Surface survey ────────────────────────────────────────────────

  it('surface survey at (10,10) returns solid ground with rocks and ores', () => {
    // Arrange: fresh tutorial context with desert terrain seed 42
    expect(ctx.grid).not.toBeNull();

    // Act: surface survey command from world.ts (NOT the mining survey)
    const result: CommandResult = surveyCommand(ctx, ['10,10'], {});

    // Assert: command succeeds
    expect(result.success).toBe(true);
    expect(result.output).toContain('Survey at (10,10):');

    // Must have solid ground — output must NOT contain "No solid ground"
    expect(result.output).not.toContain('No solid ground');

    // Must contain a desert rock name (cruite, sandite, or molite)
    const hasDesertRock = DESERT_ROCKS.some(rock => result.output.includes(rock));
    expect(hasDesertRock).toBe(true);

    // Must contain ore data
    expect(result.output).toContain('Ores:');

    // ── Direct voxel grid verification ──

    // Find surface height at (10,10)
    const surfaceY = getSurfaceY(ctx.grid!, 10, 10);
    expect(surfaceY).toBeGreaterThan(0); // solid ground exists

    // The voxel just below the surface (surfaceY - 1) is the topmost solid voxel
    const surfaceVoxel = ctx.grid!.getVoxel(10, surfaceY - 1, 10);
    expect(surfaceVoxel).toBeDefined();
    expect(surfaceVoxel!.density).toBeGreaterThan(0);

    // Dominant rock is one of the desert preset rocks
    const dominantRock = getDominantRockId(surfaceVoxel!.composition);
    expect(DESERT_ROCKS).toContain(dominantRock);

    // oreDensities has at least one entry
    expect(Object.keys(surfaceVoxel!.oreDensities).length).toBeGreaterThanOrEqual(1);

    // getRock returns a valid rock type for the dominant rock ID
    const rockType = getRock(dominantRock);
    expect(rockType).toBeDefined();
    expect(rockType!.hardnessTier).toBeGreaterThanOrEqual(1);
  });

  // ── Test 2: Building placement ────────────────────────────────────────────

  it('a freight_warehouse places successfully somewhere in the tutorial build area', () => {
    // Arrange: fresh tutorial context
    expect(ctx.grid).not.toBeNull();
    expect(ctx.state!.cash).toBeGreaterThanOrEqual(15000); // freight_warehouse T1 cost

    // The tutorial guides the player to build inside WAREHOUSE_REGION, not at
    // one specific hardcoded coordinate — a flat 4x4 footprint must exist
    // somewhere in it (#458 T9.1/D15), not necessarily at (16,16).
    const spot = findBuildableSpot(ctx, 'freight_warehouse', 1, WAREHOUSE_REGION);
    expect(spot).not.toBeNull();

    // ── Act: place the building ──
    const result: CommandResult = buildCommand(ctx, ['freight_warehouse'], { at: `${spot!.x},${spot!.z}` });

    // Assert: command succeeds
    expect(result.success).toBe(true);
    expect(result.output).toContain('Built freight_warehouse');

    // Building exists in state
    expect(ctx.state!.buildings.buildings.length).toBe(1);
    const building = ctx.state!.buildings.buildings[0]!;
    expect(building.x).toBe(spot!.x);
    expect(building.z).toBe(spot!.z);
    expect(building.type).toBe('freight_warehouse');
    expect(building.tier).toBe(1);

    // Construction cost deducted from cash
    expect(ctx.state!.cash).toBe(TUTORIAL_START_CASH - 15000);
  });

  // ── Test 3: Ramp construction ─────────────────────────────────────────────

  it('ramp at (10,16) direction south builds successfully', () => {
    // Arrange: fresh tutorial context
    expect(ctx.grid).not.toBeNull();

    // Act: build ramp command from mining.ts
    const result: CommandResult = buildRampCommand(ctx as any, [], {
      origin: '10,16',
      direction: 'south',
      length: '10',
    });

    // Assert: ramp built successfully
    expect(result.success).toBe(true);
    expect(result.output).toContain('Ramp built');
    expect(result.output).toContain('voxels cleared');

    // Extract the number of voxels cleared — should be a positive integer
    const voxelMatch = result.output.match(/voxels cleared:?\s*(\d+)/i);
    if (voxelMatch) {
      const voxelsCleared = parseInt(voxelMatch[1]!, 10);
      expect(voxelsCleared).toBeGreaterThan(0);
    }

    // Ramp construction should have deducted cost
    expect(ctx.state!.cash).toBeLessThan(TUTORIAL_START_CASH);
  });

  // ── Test 4: Surface height uniformity ─────────────────────────────────────

  it('surface height is uniform at a buildable footprint in the tutorial build area', () => {
    // A flat 4x4 spot must exist somewhere in WAREHOUSE_REGION (#458 T9.1/D15)
    // — not necessarily at (16,16), which the terrain generator no longer
    // guarantees is flat. Reuses the same search buildCommand's own
    // canPlaceBuilding gate would perform.
    const spot = findBuildableSpot(ctx, 'freight_warehouse', 1, WAREHOUSE_REGION);
    expect(spot).not.toBeNull();
    const { x: ox, z: oz } = spot!;

    // Inspect all 16 cells of the found 4×4 footprint.
    const surfaceYValues: number[] = [];

    for (let dx = 0; dx < 4; dx++) {
      for (let dz = 0; dz < 4; dz++) {
        const x = ox + dx;
        const z = oz + dz;
        const sy = getSurfaceY(ctx.grid!, x, z);
        surfaceYValues.push(sy);

        // Each footprint cell must have solid ground beneath it
        if (sy > 0) {
          const voxel = ctx.grid!.getVoxel(x, sy - 1, z);
          expect(voxel).toBeDefined();
          expect(voxel!.density).toBeGreaterThan(0);
        } else {
          // Entire column is empty — no ground at this cell
          expect(sy).toBeGreaterThan(0);
        }
      }
    }

    // All 16 surface heights must be identical — this is exactly what made
    // findBuildableSpot pick this spot (canPlaceBuilding requires exact
    // equality across the footprint), confirmed directly here too.
    const uniqueHeights = new Set(surfaceYValues);
    expect(uniqueHeights.size).toBe(1);

    // The common surface height should be within the grid Y range (0–12)
    const commonSurfaceY = surfaceYValues[0]!;
    expect(commonSurfaceY).toBeGreaterThanOrEqual(0);
    expect(commonSurfaceY).toBeLessThan(12);
  });

  // ── Test 5: Diagnostics dump for terrain debug (always passes) ────────────

  it('diagnostics: terrain surface heights at key coordinates', () => {
    // Helper to collect surface height info for diagnostic purposes
    const coords: Array<[number, number, string]> = [
      [10, 10, 'survey target'],
      [16, 16, 'building footprint origin'],
      [17, 16, 'building footprint'],
      [18, 16, 'building footprint'],
      [19, 16, 'building footprint'],
      [16, 17, 'building footprint'],
      [16, 18, 'building footprint'],
      [16, 19, 'building footprint'],
      [19, 19, 'building footprint corner'],
      [10, 16, 'ramp origin'],
    ];

    const lines: string[] = ['Terrain surface height diagnostics:'];
    for (const [x, z, label] of coords) {
      const sy = getSurfaceY(ctx.grid!, x, z);
      let rockInfo = 'air';
      if (sy > 0) {
        const voxel = ctx.grid!.getVoxel(x, sy - 1, z);
        if (voxel && voxel.density > 0) {
          const dominant = getDominantRockId(voxel.composition);
          const ores = Object.keys(voxel.oreDensities);
          rockInfo = `${dominant} density=${voxel.density} ores=[${ores.join(',')}]`;
        }
      }
      lines.push(`  (${x},${z}) — ${label}: surfaceY=${sy} ${rockInfo}`);
    }
    // Always pass — this test is purely diagnostic
    expect(true).toBe(true);
    // The output is logged via test name and can be viewed in verbose mode
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
  });
});
