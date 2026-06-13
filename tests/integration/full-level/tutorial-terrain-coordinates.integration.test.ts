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

const DESERT_ROCKS = ['cruite', 'sandite', 'molite'];

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

  it('building at (16,16) places successfully on flat ground', () => {
    // Arrange: fresh tutorial context
    expect(ctx.grid).not.toBeNull();
    expect(ctx.state!.cash).toBeGreaterThanOrEqual(15000); // freight_warehouse T1 cost

    // ── Flatness verification before placement ──
    const placementGrid = buildPlacementGrid(ctx.grid!, ctx.state!.buildings);
    const flatnessCheck = canPlaceBuilding(placementGrid, 'freight_warehouse', 16, 16, 1);
    // NOTE: This may fail if terrain seed 42 does not produce flat ground at (16,16).
    // If it fails, record diagnostic info for adjustment.
    if (!flatnessCheck.valid) {
      // Collect diagnostic info: surface heights across the footprint
      const heights: Record<string, number> = {};
      for (let dx = 0; dx < 4; dx++) {
        for (let dz = 0; dz < 4; dz++) {
          const x = 16 + dx;
          const z = 16 + dz;
          heights[`(${x},${z})`] = getSurfaceY(ctx.grid!, x, z);
        }
      }
      // Output diagnostic info via the test failure message
      expect(flatnessCheck).toEqual({
        valid: true,
        // If invalid, attach diagnostic as the reason
        ...(flatnessCheck.valid ? {} : { diagnostic: heights }),
      });
    }

    // ── Act: place the building ──
    const result: CommandResult = buildCommand(ctx, ['freight_warehouse'], { at: '16,16' });

    // Assert: command succeeds
    expect(result.success).toBe(true);
    expect(result.output).toContain('Built freight_warehouse');

    // Building exists in state
    expect(ctx.state!.buildings.buildings.length).toBe(1);
    const building = ctx.state!.buildings.buildings[0]!;
    expect(building.x).toBe(16);
    expect(building.z).toBe(16);
    expect(building.type).toBe('freight_warehouse');
    expect(building.tier).toBe(1);

    // Construction cost deducted from cash
    expect(ctx.state!.cash).toBe(20000 - 15000);
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
    expect(ctx.state!.cash).toBeLessThan(20000);
  });

  // ── Test 4: Surface height uniformity ─────────────────────────────────────

  it('surface height is uniform at building footprint (16,16)', () => {
    // Inspect all 16 cells of the 4×4 footprint at (16,16) to (19,19)
    // without placing any building.
    const surfaceYValues: number[] = [];

    for (let dx = 0; dx < 4; dx++) {
      for (let dz = 0; dz < 4; dz++) {
        const x = 16 + dx;
        const z = 16 + dz;
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

    // All 16 surface heights must be identical for flat building placement
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
