// BlastSimulator2026 — Integration test: Tutorial level terrain coordinate verification
// Verifies the tutorial's guided-build regions land on genuinely flat ground
// on tutorial_pit seed 42 — the real placement path checks per-footprint
// flatness (#1008), so a region the tutorial steers the player into must
// itself be flat for the building it asks them to place there.
// Issues #333, #1008

import { describe, it, expect, beforeEach } from 'vitest';
import { makeCampaignCtx, driveConstructionToCompletion } from './helpers.js';
import { setupEvents, clearEvents } from '../../../src/core/events/index.js';
import { surveyCommand } from '../../../src/console/commands/world.js';
import { buildCommand, employeeCommand } from '../../../src/console/commands/entities.js';
import { buildRampCommand } from '../../../src/console/commands/mining.js';
import {
  isFootprintFlat,
  getSurfaceY,
  BUILDING_DEFS,
  type BuildingType,
  type BuildingTier,
} from '../../../src/core/entities/Building.js';
import { getDominantRockId } from '../../../src/core/world/VoxelGrid.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { HIRING_COSTS } from '../../../src/core/config/balance.js';

const DESERT_ROCKS = ['cruite', 'sandite', 'molite'];

/** Starting cash comes from the level catalogue, not a copy of it. */
const TUTORIAL_START_CASH = getLevel('tutorial_pit')!.startingCash;

interface PinnedRegion {
  type: BuildingType;
  tier: BuildingTier;
  x: number;
  z: number;
}

/**
 * The tutorial's guided-build regions (`REGION.warehouse`/`drivingCenter`/
 * `livingQuarters` in src/ui/tutorialStages.ts, duplicated here rather than
 * imported — this is an integration test for core/console behaviour, not a
 * UI dependency). Pinned to coordinates verified flat against the real
 * generated tutorial_pit seed-42 terrain for their own building's footprint
 * (#1008 — the real placement path now enforces flatness, and the tutorial
 * must land on ground that actually satisfies it).
 */
const PINNED_REGIONS: Record<'warehouse' | 'drivingCenter' | 'livingQuarters', PinnedRegion> = {
  warehouse: { type: 'freight_warehouse', tier: 1, x: 6, z: 9 },
  drivingCenter: { type: 'driving_center', tier: 1, x: 6, z: 7 },
  // #1008-followup (PR #1023): moved from (12,15) to (6,16) — flat (this
  // test's own Test 2 proves that), then to (29,12) — also flat — after a
  // second real interaction-mode CI run showed (6,16) deadlocks box-cut too,
  // just a different way (a fatigue/rest round-trip livelock, not a
  // stranding). Flatness alone was never sufficient; see tutorialStages.ts's
  // own REGION comment for the full trace and the new coordinate's
  // clearance margin against every hazard this file's history has actually
  // reproduced a deadlock at.
  livingQuarters: { type: 'living_quarters', tier: 1, x: 29, z: 12 },
};

/**
 * The tutorial's OLD guided-build coordinates, before #1008 — kept only as a
 * regression check documenting why the move above was necessary: the
 * placement path didn't check flatness before #1008, so these coordinates
 * silently ordered a building on a height step and nothing caught it.
 */
const OLD_REGIONS: Record<'warehouse' | 'drivingCenter' | 'livingQuarters', PinnedRegion> = {
  warehouse: { type: 'freight_warehouse', tier: 1, x: 6, z: 6 },
  drivingCenter: { type: 'driving_center', tier: 1, x: 10, z: 8 },
  livingQuarters: { type: 'living_quarters', tier: 1, x: 18, z: 14 },
};

describe('Tutorial Level Terrain Coordinates (Issue #333, #1008)', () => {
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

  // ── Test 2: pinned regions are flat for their own building's footprint (#1008) ──

  describe.each([
    ['warehouse', PINNED_REGIONS.warehouse],
    ['drivingCenter', PINNED_REGIONS.drivingCenter],
    ['livingQuarters', PINNED_REGIONS.livingQuarters],
  ] as const)('pinned %s region', (_name, region) => {
    it(`is flat for a ${region.type} T${region.tier} footprint at (${region.x},${region.z})`, () => {
      const def = BUILDING_DEFS[region.type][region.tier];
      const heightAt = (cx: number, cz: number): number => getSurfaceY(ctx.grid!, cx, cz);

      expect(isFootprintFlat(def.footprint, region.x, region.z, heightAt)).toBe(true);
    });
  });

  // ── Test 3: building placement at the pinned warehouse coordinates ────────

  it('a freight_warehouse orders and completes at the pinned warehouse coordinates', () => {
    // Arrange: fresh tutorial context
    expect(ctx.grid).not.toBeNull();
    expect(ctx.state!.cash).toBeGreaterThanOrEqual(15000); // freight_warehouse T1 cost

    // #556: confirming a placement only queues a construction site — an idle
    // employee must exist to finish it before it becomes a real building.
    const hireBuilder = employeeCommand(ctx, ['hire'], { role: 'manager' });
    expect(hireBuilder.success).toBe(true);

    const { x, z } = PINNED_REGIONS.warehouse;

    // ── Act: order the building ──
    const result: CommandResult = buildCommand(ctx, ['freight_warehouse'], { at: `${x},${z}` });

    // Assert: command succeeds — order confirmation, not an instant build.
    expect(result.success).toBe(true);
    expect(result.output).toContain('freight_warehouse T1 ordered');

    // Nothing is built yet — only queued.
    expect(ctx.state!.buildings.buildings.length).toBe(0);
    expect(ctx.state!.plannedBuildings.length).toBe(1);

    // Drive construction to completion.
    driveConstructionToCompletion(ctx);

    // Building exists in state
    expect(ctx.state!.buildings.buildings.length).toBe(1);
    const building = ctx.state!.buildings.buildings[0]!;
    expect(building.x).toBe(x);
    expect(building.z).toBe(z);
    expect(building.type).toBe('freight_warehouse');
    expect(building.tier).toBe(1);

    // Construction cost + the builder's hiring cost deducted from cash, at
    // minimum — the exact figure also includes payroll/upkeep for however
    // many ticks the walk + build actually took.
    expect(ctx.state!.cash).toBeLessThanOrEqual(TUTORIAL_START_CASH - 15000 - HIRING_COSTS.manager);
  });

  // ── Test 4: Ramp construction ─────────────────────────────────────────────

  it('ramp at (10,16) direction south builds successfully', () => {
    // Arrange: fresh tutorial context
    expect(ctx.grid).not.toBeNull();

    // Act: build ramp command from mining.ts
    const result: CommandResult = buildRampCommand(ctx as any, [], {
      origin: '10,16',
      direction: 'south',
      length: '10',
    });

    // Assert: ramp order accepted at this position (#555 — ramp excavation is
    // progressive: ordering queues dig_ramp_segment work, it no longer
    // carves the corridor synchronously).
    expect(result.success).toBe(true);
    expect(result.output).toContain('Ramp ordered');
    expect(result.output).toContain('segments queued');

    // Extract the number of segments queued — should be a positive integer
    const segmentMatch = result.output.match(/(\d+)\s*segments queued/i);
    if (segmentMatch) {
      const segmentsQueued = parseInt(segmentMatch[1]!, 10);
      expect(segmentsQueued).toBeGreaterThan(0);
    }

    // Ramp construction should have deducted cost at order time
    expect(ctx.state!.cash).toBeLessThan(TUTORIAL_START_CASH);
  });

  // ── Test 5: regression — the OLD coordinates were NOT flat (#1008) ────────
  // Documents why the tutorial's guided-build regions moved: the placement
  // path didn't check flatness before #1008, so these coordinates silently
  // ordered a building straddling a height step.

  describe.each([
    ['warehouse', OLD_REGIONS.warehouse],
    ['drivingCenter', OLD_REGIONS.drivingCenter],
    ['livingQuarters', OLD_REGIONS.livingQuarters],
  ] as const)('old %s region (regression)', (_name, region) => {
    it(`is NOT flat for a ${region.type} T${region.tier} footprint at (${region.x},${region.z})`, () => {
      const def = BUILDING_DEFS[region.type][region.tier];
      const heightAt = (cx: number, cz: number): number => getSurfaceY(ctx.grid!, cx, cz);

      expect(isFootprintFlat(def.footprint, region.x, region.z, heightAt)).toBe(false);
    });
  });

  // ── Test 6: Diagnostics dump for terrain debug (always passes) ────────────

  it('diagnostics: terrain surface heights at key coordinates', () => {
    // Helper to collect surface height info for diagnostic purposes
    const coords: Array<[number, number, string]> = [
      [10, 10, 'survey target'],
      [6, 9, 'warehouse footprint origin'],
      [6, 7, 'driving center footprint origin'],
      [29, 12, 'living quarters footprint origin'],
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
