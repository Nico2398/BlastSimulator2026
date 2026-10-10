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
  routeDistanceToRect, REGION, tutorialVehicleSpawnPoint, TUTORIAL_POST_SURVEY_WORLD_SIZE,
  type TutorialHazard,
} from '../../../src/ui/tutorialStages.js';
import type { TileRegion } from '../../../src/ui/tutorialPickerRegion.js';
import {
  TUTORIAL_SITE_HAZARD_CLEARANCE_TILES, TUTORIAL_SITE_CLUSTER_MAX_SPAN_TILES,
  // #1170: the tutorial pins' round-trip bound moved from a straight-line
  // Chebyshev tile count to a real NavGrid route-cost bound — #1151's
  // slope-based navmesh made real walking routes much longer than straight-
  // line tile distance, so the old TUTORIAL_SITE_DIG_ROUND_TRIP_MAX_TILES
  // bound could pass while the real walk was far longer.
  TUTORIAL_SITE_DIG_ROUND_TRIP_MAX_ROUTE_COST,
} from '../../../src/core/config/balance.js';
import { createRunner } from '../../../src/console/createRunner.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import {
  checkFootprintPlacement, getBuildingDef, getDefSize,
  type BuildingType, type BuildingTier, type FootprintOccupant,
} from '../../../src/core/entities/Building.js';
import { siteBounds } from '../../../src/console/commands/buildingHelpers.js';
import { NavGrid, isStepClimbable, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { findPath } from '../../../src/core/nav/Pathfinding.js';

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

    it('is 1 for two rectangles that are adjacent with no gap tile between them', () => {
      const a: TileRegion = { x1: 0, z1: 0, x2: 2, z2: 2 };
      const b: TileRegion = { x1: 3, z1: 0, x2: 5, z2: 2 };
      // Adjacent, sharing an edge boundary — closest corners are one tile apart.
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
      // living_quarters footprint grows 3x3 -> 4x3 -> 5x4 across tiers
      // (BuildingDefs.ts), so this actually exercises tier-scaling rather
      // than just re-deriving one tier's own size.
      const region: TileRegion = { x1: 0, z1: 0, x2: 0, z2: 0, exact: true };
      const { sizeX: t1X, sizeZ: t1Z } = getDefSize(getBuildingDef('living_quarters', 1));
      const { sizeX: t2X, sizeZ: t2Z } = getDefSize(getBuildingDef('living_quarters', 2));
      const { sizeX: t3X, sizeZ: t3Z } = getDefSize(getBuildingDef('living_quarters', 3));
      expect(t2X).toBeGreaterThan(t1X);
      expect(t3X).toBeGreaterThan(t2X);
      expect(t3Z).toBeGreaterThan(t1Z);

      const rectT1 = tutorialSiteFootprintRect('living_quarters', 1, region);
      const rectT2 = tutorialSiteFootprintRect('living_quarters', 2, region);
      const rectT3 = tutorialSiteFootprintRect('living_quarters', 3, region);
      expect(rectT1.x2 - rectT1.x1 + 1).toBe(t1X);
      expect(rectT1.z2 - rectT1.z1 + 1).toBe(t1Z);
      expect(rectT2.x2 - rectT2.x1 + 1).toBe(t2X);
      expect(rectT2.z2 - rectT2.z1 + 1).toBe(t2Z);
      expect(rectT3.x2 - rectT3.x1 + 1).toBe(t3X);
      expect(rectT3.z2 - rectT3.z1 + 1).toBe(t3Z);
    });

    it('produces the correct rect for a second real building def, driving_center', () => {
      // driving_center T1 is 2x2 (BuildingDefs.ts) — used here to exercise a
      // second real building def, not to assert a single-cell footprint.
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
      // Built on hazard's x2 side (east), away from the drill grid / box-cut
      // corridor that sit west of the spawn point — going west lands exactly
      // at clearance from `hazard` but inside clearance of those other fixed
      // hazards, which isTutorialSiteHazardClear must also check.
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

  describe('routeDistanceToRect (#1170)', () => {
    /** Flat, fully walkable NavGrid of the given size — mirrors the identical
     * helper in RestActionHelpers.test.ts/EmployeeDispatchSteps.test.ts. */
    function makeFlatNavGrid(width: number, height: number): NavGrid {
      const cells: NavCell[][] = [];
      for (let z = 0; z < height; z++) {
        const row: NavCell[] = [];
        for (let x = 0; x < width; x++) {
          row.push({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
        }
        cells.push(row);
      }
      return new NavGrid(width, height, cells);
    }

    /** Impassable vertical wall spanning every row at world x. */
    function blockColumn(grid: NavGrid, x: number): void {
      for (let z = 0; z < grid.height; z++) {
        grid.cells[z]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
      }
    }

    it('returns a finite cost roughly matching the known path length for a short reachable route', () => {
      const grid = makeFlatNavGrid(20, 10);
      const from: TileRegion = { x1: 0, z1: 5, x2: 0, z2: 5, exact: true };
      const to: TileRegion = { x1: 8, z1: 5, x2: 8, z2: 5, exact: true };

      const distance = routeDistanceToRect(grid, from, to);

      expect(Number.isFinite(distance)).toBe(true);
      expect(distance).toBeCloseTo(8, 0);
    });

    it('returns Infinity when no route connects the two regions', () => {
      const grid = makeFlatNavGrid(20, 10);
      blockColumn(grid, 10);
      const from: TileRegion = { x1: 0, z1: 5, x2: 0, z2: 5, exact: true };
      const to: TileRegion = { x1: 15, z1: 5, x2: 15, z2: 5, exact: true };

      const distance = routeDistanceToRect(grid, from, to);

      expect(distance).toBe(Infinity);
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
      expect(ctx.state?.navGrid).not.toBeNull();
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

    // #1170: straight-line Chebyshev tile distance replaced with real NavGrid
    // route cost — #1151's slope-based navmesh can make the actual walking
    // route from a pin to the dig/drill area far longer than the tile-count
    // bound this used to check, so a pin could pass the old check while still
    // being a very long real walk. Compares the pin's own region (not its
    // footprint rect — routeDistanceToRect measures from the region's near
    // corner, the same "site" coordinate the pin is defined at) against the
    // dig/drill hazard region, using the tutorial level's own real NavGrid.
    it.each(PINS)('$name: is within a short round trip of the dig/drill area', (pin) => {
      // tutorialHazards() returns [spawn, REGION.boxcut, REGION.drill]
      // (source order, tutorialStages.ts) — the drill hazard is the widest of
      // the three (the box-cut corridor is a single-tile-wide line, the spawn
      // point a single tile), so picking it out by shape rather than by index
      // survives a future hazard being added to the front or middle of that
      // list.
      const drillHazardRegion = tutorialHazards().find((h) => h.x1 !== h.x2 && h.z1 !== h.z2)!;
      expect(drillHazardRegion).toBeDefined();

      const distance = routeDistanceToRect(ctx.state!.navGrid!, pin.region, drillHazardRegion);
      expect(distance).toBeLessThanOrEqual(TUTORIAL_SITE_DIG_ROUND_TRIP_MAX_ROUTE_COST);
    });
  });


  // ── #1587: the drill pattern sits on drivable ground, vehicles spawn off it ──

  describe('post-survey drill area (#1587)', () => {
    let state: NonNullable<MiningContext['state']>;
    let navGrid: NavGrid;
    /** Vehicle tiles right after each real purchase, in purchase order. */
    const purchased: Array<{ type: string; x: number; z: number }> = [];

    /** Planned hole cells: every GRID_SPACING-th cell across REGION.drill. */
    const SPACING = 4;
    const holes: Array<{ x: number; z: number }> = [];
    for (let z = REGION.drill.z1; z <= REGION.drill.z2; z += SPACING) {
      for (let x = REGION.drill.x1; x <= REGION.drill.x2; x += SPACING) holes.push({ x, z });
    }

    beforeAll(() => {
      const { runner, ctx: c } = createRunner();
      const run = (cmd: string): void => {
        const r = runner.run(cmd);
        expect(r.success, `${cmd}: ${r.output}`).toBe(true);
      };
      run('campaign start level:tutorial_pit');
      run('tutorial_start');
      run('time resume');
      run('employee hire role:surveyor');
      const surveyor = c.state!.employees.employees[0]!;
      run(`employee assign_skill ${surveyor.id} skill:geology level:3`);
      run(`survey seismic x:${REGION.survey.x1} z:${REGION.survey.z1}`);
      for (let i = 0; i < 40; i++) run('tick 10');

      state = c.state!;
      expect(state.navGrid).not.toBeNull();
      navGrid = state.navGrid!;
      state.cash = 10_000_000;

      for (const type of ['drill_rig', 'rock_digger', 'debris_hauler']) {
        run(`vehicle buy ${type}`);
        const v = state.vehicles.vehicles[state.vehicles.vehicles.length - 1]!;
        purchased.push({ type, x: v.x, z: v.z });
      }
    });

    it('the survey grows the world to TUTORIAL_POST_SURVEY_WORLD_SIZE', () => {
      expect(state.world.sizeX).toBe(TUTORIAL_POST_SURVEY_WORLD_SIZE);
      expect(state.world.sizeZ).toBe(TUTORIAL_POST_SURVEY_WORLD_SIZE);
    });

    it('every 8-neighbour step in REGION.drill plus a 1-cell margin is climbable', () => {
      const x1 = REGION.drill.x1 - 1, x2 = REGION.drill.x2 + 1;
      const z1 = REGION.drill.z1 - 1, z2 = REGION.drill.z2 + 1;
      const bad: string[] = [];
      for (let z = z1; z <= z2; z++) {
        for (let x = x1; x <= x2; x++) {
          const from = navGrid.cells[z]?.[x];
          if (!from) continue;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dz === 0) continue;
              const nx = x + dx, nz = z + dz;
              if (nx < x1 || nx > x2 || nz < z1 || nz > z2) continue;
              const to = navGrid.cells[nz]?.[nx];
              if (!to) continue;
              if (!isStepClimbable(from.surfaceY, to.surfaceY, Math.hypot(dx, dz))) {
                bad.push(`(${x},${z})->(${nx},${nz})`);
              }
            }
          }
        }
      }
      expect(bad, `unclimbable steps: ${bad.length}`).toEqual([]);
    });

    it('the worst hole-pair path cost is within 1.5x the octile distance', () => {
      const octile = (dx: number, dz: number): number => {
        const a = Math.abs(dx), b = Math.abs(dz);
        return Math.max(a, b) + (Math.SQRT2 - 1) * Math.min(a, b);
      };
      let worst = 0;
      let worstPair = '';
      for (const a of holes) {
        for (const b of holes) {
          if (a === b) continue;
          const path = findPath(navGrid, {
            agentId: -1, fromX: a.x, fromZ: a.z, toX: b.x, toZ: b.z, avoidVehicles: false,
          });
          const ratio = path.found ? path.totalCost / octile(b.x - a.x, b.z - a.z) : Infinity;
          if (ratio > worst) { worst = ratio; worstPair = `(${a.x},${a.z})->(${b.x},${b.z})`; }
        }
      }
      expect(holes.length).toBeGreaterThan(1);
      expect(worst, `worst pair ${worstPair}`).toBeLessThanOrEqual(1.5);
    });

    it('purchased vehicles (rig, digger, third slot) all spawn outside REGION.drill', () => {
      expect(purchased).toHaveLength(3);
      for (const v of purchased) {
        const inside = v.x >= REGION.drill.x1 && v.x <= REGION.drill.x2
          && v.z >= REGION.drill.z1 && v.z <= REGION.drill.z2;
        expect(inside, `${v.type} at (${v.x},${v.z})`).toBe(false);
      }
    });

    it('no purchased vehicle starts on a planned hole', () => {
      for (const v of purchased) {
        expect(holes.some((h) => h.x === v.x && h.z === v.z), `${v.type} at (${v.x},${v.z})`).toBe(false);
      }
    });

    it('tutorialVehicleSpawnPoint(realNavGrid) equals the first real purchase position', () => {
      const spawn = tutorialVehicleSpawnPoint(navGrid);
      expect(spawn.x1).toBe(spawn.x2);
      expect(spawn.z1).toBe(spawn.z2);
      expect({ x: spawn.x1, z: spawn.z1 }).toEqual({ x: purchased[0]!.x, z: purchased[0]!.z });
    });
  });

});
