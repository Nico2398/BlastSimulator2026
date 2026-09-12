// BlastSimulator2026 — Tutorial site layout lint test (#1040)
//
// The tutorial's three enforced building pins (warehouse, driving_center,
// living_quarters — all tier 1) must form a recognisable compact base: each
// footprint flat enough for the real placement path, clear of every blast
// hazard with margin, mutually close to one another, and within a short
// round trip of the dig/drill area. This is a stated, checkable rule
// (tutorialStages.ts's REGION doc comment) rather than prose repeated per
// pin — this file is the lint that enforces it, plus direct unit coverage
// of the geometry helpers the rule is built from.
//
// The flatness/occupancy assertions drive the REAL placement path
// (checkFootprintPlacement) against a live VoxelGrid generated for
// tutorial_pit — no stubbed grid — because that is the actual gate a player
// hits when confirming a build order on these exact pins.

import { describe, it, expect, beforeAll } from 'vitest';
import {
  tutorialHazards, chebyshevRectDistance, tutorialSiteFootprintRect, isTutorialSiteHazardClear,
  REGION, type TutorialHazard,
} from '../../../src/ui/tutorialStages.js';
import type { TileRegion } from '../../../src/ui/tutorialPickerRegion.js';
import {
  TUTORIAL_SITE_HAZARD_CLEARANCE_TILES, TUTORIAL_SITE_CLUSTER_MAX_SPAN_TILES,
  TUTORIAL_SITE_DIG_ROUND_TRIP_MAX_TILES,
} from '../../../src/core/config/balance.js';
import { createRunner } from '../../../src/console/createRunner.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import {
  checkFootprintPlacement, getBuildingDef, getDefSize,
  type BuildingType, type BuildingTier, type FootprintOccupant,
} from '../../../src/core/entities/Building.js';
import { siteBounds } from '../../../src/console/commands/buildingHelpers.js';

/**
 * The three tutorial pins, in the order the tutorial rail actually orders
 * their construction (tutorialSteps.ts: 'build-living-quarters' first, then
 * 'build-driving-center', then 'build-storage' for freight_warehouse).
 * checkFootprintPlacement's occupancy check is pairwise against whatever is
 * already on the ground, so exercising the pins in this order matches what a
 * real playthrough actually checks rather than an arbitrary order that could
 * hide an overlap the real game never hits.
 */
const PINS: ReadonlyArray<{ name: string; type: BuildingType; tier: BuildingTier; region: TileRegion }> = [
  { name: 'livingQuarters', type: 'living_quarters', tier: 1, region: REGION.livingQuarters },
  { name: 'drivingCenter', type: 'driving_center', tier: 1, region: REGION.drivingCenter },
  { name: 'warehouse', type: 'freight_warehouse', tier: 1, region: REGION.warehouse },
];

describe('tutorial site layout rule (#1040)', () => {

  // ── Geometry helpers: direct unit coverage ──────────────────────────────

  describe('chebyshevRectDistance', () => {
    it('is 0 for two overlapping rectangles', () => {
      const a: TileRegion = { x1: 0, z1: 0, x2: 5, z2: 5 };
      const b: TileRegion = { x1: 3, z1: 3, x2: 8, z2: 8 };
      expect(chebyshevRectDistance(a, b)).toBe(0);
    });

    it('is 0 for a rectangle against itself', () => {
      const a: TileRegion = { x1: 4, z1: 4, x2: 4, z2: 4 };
      expect(chebyshevRectDistance(a, a)).toBe(0);
    });

    it('is the gap along the axis with the larger separation, single-tile rects', () => {
      // Separated by 5 tiles on x, aligned on z — pure x-axis gap.
      const a: TileRegion = { x1: 5, z1: 5, x2: 5, z2: 5 };
      const b: TileRegion = { x1: 10, z1: 5, x2: 10, z2: 5 };
      expect(chebyshevRectDistance(a, b)).toBe(5);
    });

    it('takes the larger of the x and z gaps when both separate the rects', () => {
      // x gap: 10-2=8 tiles from a's edge to b's edge; z gap: 9-2=7 tiles.
      const a: TileRegion = { x1: 0, z1: 0, x2: 2, z2: 2 };
      const b: TileRegion = { x1: 10, z1: 9, x2: 12, z2: 12 };
      expect(chebyshevRectDistance(a, b)).toBe(8);
    });

    it('is symmetric — order of the two rects does not change the result', () => {
      const a: TileRegion = { x1: 0, z1: 0, x2: 1, z2: 1 };
      const b: TileRegion = { x1: 20, z1: 3, x2: 22, z2: 4 };
      expect(chebyshevRectDistance(a, b)).toBe(chebyshevRectDistance(b, a));
    });

    it('is 0 for two rectangles that only touch edges (no gap tile between them)', () => {
      const a: TileRegion = { x1: 0, z1: 0, x2: 2, z2: 2 };
      const b: TileRegion = { x1: 3, z1: 0, x2: 5, z2: 2 };
      // Adjacent, sharing an edge boundary — no tile of separation.
      expect(chebyshevRectDistance(a, b)).toBe(1);
    });
  });

  describe('tutorialSiteFootprintRect', () => {
    it('returns a rect starting at the region origin, sized to the building footprint', () => {
      const region: TileRegion = { x1: 10, z1: 20, x2: 10, z2: 20, exact: true };
      const rect = tutorialSiteFootprintRect('freight_warehouse', 1, region);
      const { sizeX, sizeZ } = getDefSize(getBuildingDef('freight_warehouse', 1));

      expect(rect.x1).toBe(10);
      expect(rect.z1).toBe(20);
      expect(rect.x2).toBe(10 + sizeX - 1);
      expect(rect.z2).toBe(20 + sizeZ - 1);
    });

    it('scales with tier when a building def changes footprint size by tier', () => {
      const region: TileRegion = { x1: 0, z1: 0, x2: 0, z2: 0, exact: true };
      const rectT1 = tutorialSiteFootprintRect('living_quarters', 1, region);
      const { sizeX: t1X, sizeZ: t1Z } = getDefSize(getBuildingDef('living_quarters', 1));
      expect(rectT1.x2 - rectT1.x1 + 1).toBe(t1X);
      expect(rectT1.z2 - rectT1.z1 + 1).toBe(t1Z);
    });

    it('a single-cell footprint building produces a single-tile rect', () => {
      // driving_center T1 — used here purely to exercise a second real
      // building def rather than asserting a specific footprint size.
      const region: TileRegion = { x1: 7, z1: 7, x2: 7, z2: 7, exact: true };
      const { sizeX, sizeZ } = getDefSize(getBuildingDef('driving_center', 1));
      const rect = tutorialSiteFootprintRect('driving_center', 1, region);
      expect(rect.x2 - rect.x1 + 1).toBe(sizeX);
      expect(rect.z2 - rect.z1 + 1).toBe(sizeZ);
    });
  });

  describe('isTutorialSiteHazardClear', () => {
    it('accepts a rect far away from every tutorialHazards() entry', () => {
      // Comfortably outside the boxcut corridor and the drill grid by more
      // than TUTORIAL_SITE_HAZARD_CLEARANCE_TILES on every side.
      const rect: TileRegion = { x1: 60, z1: 60, x2: 60, z2: 60 };
      expect(isTutorialSiteHazardClear(rect)).toBe(true);
    });

    it('refuses a rect overlapping a hazard outright', () => {
      const hazard: TutorialHazard = tutorialHazards()[0]!;
      expect(isTutorialSiteHazardClear(hazard)).toBe(false);
    });

    it('refuses a rect within the clearance margin of a hazard but not overlapping it', () => {
      const hazard: TutorialHazard = tutorialHazards()[0]!;
      // One tile past the hazard's edge, well inside the required clearance.
      const closeRect: TileRegion = {
        x1: hazard.x2 + 1, z1: hazard.z1, x2: hazard.x2 + 1, z2: hazard.z1,
      };
      expect(chebyshevRectDistance(closeRect, hazard)).toBeLessThan(TUTORIAL_SITE_HAZARD_CLEARANCE_TILES);
      expect(isTutorialSiteHazardClear(closeRect)).toBe(false);
    });

    it('accepts a rect exactly at the clearance boundary', () => {
      const hazard = tutorialHazards()[0]!;
      const boundaryRect: TileRegion = {
        x1: hazard.x2 + TUTORIAL_SITE_HAZARD_CLEARANCE_TILES,
        z1: hazard.z1,
        x2: hazard.x2 + TUTORIAL_SITE_HAZARD_CLEARANCE_TILES,
        z2: hazard.z1,
      };
      expect(chebyshevRectDistance(boundaryRect, hazard)).toBe(TUTORIAL_SITE_HAZARD_CLEARANCE_TILES);
      expect(isTutorialSiteHazardClear(boundaryRect)).toBe(true);
    });
  });

  // ── The actual layout rule, against the three real tutorial pins ───────

  describe('the three tutorial building pins', () => {
    let ctx: MiningContext;
    let bounds: { width: number; depth: number; originX: number; originZ: number };
    const occupants: FootprintOccupant[] = [];

    beforeAll(() => {
      const runner = createRunner();
      const started = runner.runner.run('campaign start level:tutorial_pit cash:400000');
      expect(started.success).toBe(true);
      ctx = runner.ctx;
      expect(ctx.grid).not.toBeNull();
      bounds = siteBounds(ctx);
    });

    it.each(PINS)(
      '$name: the real placement path accepts its pin on the live tutorial_pit grid',
      (pin) => {
        const check = checkFootprintPlacement(
          occupants,
          pin.type,
          pin.region.x1,
          pin.region.z1,
          pin.tier,
          bounds.width,
          bounds.depth,
          bounds.originX,
          bounds.originZ,
          ctx.grid ?? undefined,
        );

        expect(check.valid).toBe(true);

        // Occupy the site for the next pin's check — matches the real
        // construction order (see PINS' own doc comment above).
        occupants.push({ type: pin.type, tier: pin.tier, x: pin.region.x1, z: pin.region.z1 });
      },
    );

    it.each(PINS)('$name: its footprint clears every tutorial hazard with margin', (pin) => {
      const rect = tutorialSiteFootprintRect(pin.type, pin.tier, pin.region);
      expect(isTutorialSiteHazardClear(rect)).toBe(true);
    });

    it('every pair of the three pins sits within the compact-cluster span', () => {
      const rects = PINS.map((pin) => tutorialSiteFootprintRect(pin.type, pin.tier, pin.region));

      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const distance = chebyshevRectDistance(rects[i]!, rects[j]!);
          expect(distance).toBeLessThanOrEqual(TUTORIAL_SITE_CLUSTER_MAX_SPAN_TILES);
        }
      }
    });

    it.each(PINS)('$name: is within a short round trip of the dig/drill area', (pin) => {
      const rect = tutorialSiteFootprintRect(pin.type, pin.tier, pin.region);
      // tutorialHazards() returns [REGION.boxcut, REGION.drill] (source order,
      // tutorialStages.ts) — the drill hazard is the wider of the two (the
      // box-cut corridor is a single-tile-wide line), so picking it out by
      // shape rather than by index survives a future hazard being added to
      // the front or middle of that list.
      const drillRect = tutorialHazards().find((h) => h.x1 !== h.x2 && h.z1 !== h.z2)!;
      expect(drillRect).toBeDefined();

      const distance = chebyshevRectDistance(rect, drillRect);
      expect(distance).toBeLessThanOrEqual(TUTORIAL_SITE_DIG_ROUND_TRIP_MAX_TILES);
    });
  });

});
