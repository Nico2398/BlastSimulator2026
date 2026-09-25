// BlastSimulator2026 — BlastExecution unit tests
// Focused on the shape of the hole a blast leaves in the terrain: a charge with
// enough energy for its burden must break through to the surface, one buried too
// deep must not, and neither may touch rock outside the blast zone.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VoxelGrid, setVoxelColumnSurfaceHeight, computeVoxelColumnSurfaceY, computeVoxelColumnSurfaceHeight,
} from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan, resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { executeBlast, buildBlastReport, type BlastResult } from '../../../src/core/mining/BlastExecution.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { GRAVITY } from '../../../src/core/config/balance.js';

function fillRegion(
  grid: VoxelGrid,
  rock: string,
  minX: number, maxX: number,
  minY: number, maxY: number,
  minZ: number, maxZ: number,
  oreId?: string,
  oreDensity?: number,
) {
  for (let z = minZ; z <= maxZ; z++) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const ores: Record<string, number> = {};
        if (oreId && oreDensity) ores[oreId] = oreDensity;
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: rock, coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: ores,
          fractureModifier: 1.0,
        });
      }
    }
  }
}

beforeEach(() => resetHoleIds());

describe('executeBlast — crater', () => {
  it('breaks through to the surface, so the blast leaves a visible crater', () => {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);

    // 2×3 grid, spacing 4, origin (12,12) — holes at x∈{12,16,20}, z∈{12,16}.
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();
    expect(result!.clearedVoxels).toBeGreaterThan(0);

    // The charges sit at the bottom of the holes, so a blast that only broke
    // rock around them would leave a sealed cavity under intact ground — the
    // player would see nothing happen. The burden above has to come out too.
    let surfaceOpened = 0;
    for (let z = 5; z <= 25; z++) {
      for (let x = 5; x <= 25; x++) {
        if (grid.densityAt(x, 10, z) === 0) surfaceOpened++;
      }
    }
    expect(surfaceOpened, 'no surface voxel was removed — the crater is buried').toBeGreaterThan(0);

    // And the ground directly over a hole is gone.
    expect(grid.densityAt(12, 10, 12)).toBe(0);
  });

  it('leaves rock standing where the charge is buried too deep to break out', () => {
    // A single small charge at the bottom of a very deep hole: it breaks rock
    // around itself, but the burden above is far too thick to lift.
    const grid = new VoxelGrid(40, 40, 40);
    fillRegion(grid, 'molite', 5, 25, 0, 30, 5, 25);

    const holes = createGridPlan({ x: 15, z: 15 }, 1, 1, 4, 28, 0.15);
    const holeDepths: Record<string, number> = { [holes[0]!.id]: holes[0]!.depth };
    const { charges } = batchCharge([holes[0]!.id], holeDepths, 'boomite', 2, 2);
    const plan = assembleBlastPlan(holes, charges, autoVPattern(holes, 25));

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();
    expect(result!.clearedVoxels).toBeGreaterThan(0);

    // The surface over the hole survives: too much burden to break out.
    expect(grid.densityAt(15, 30, 15)).toBeGreaterThan(0);
  });

  it('does not excavate voxels far outside the blast zone', () => {
    const grid = new VoxelGrid(60, 15, 60);
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);
    // Solid column far from the drill grid — outside the energy bbox
    // (BLAST_ZONE_RADIUS), so nothing should touch it.
    fillRegion(grid, 'molite', 50, 55, 0, 10, 50, 55);

    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();

    const farVoxel = grid.getVoxel(52, 10, 52);
    expect(farVoxel?.density).toBe(1.0);
  });

  it('#1186: breaks through to the surface when the whole pit sits below y=0', () => {
    // Same 2×3 grid/plan as the plain crater test, just shifted 30 voxels
    // down so the surface and every hole resolve to negative Y — proving the
    // blast zone and energy field are no longer floored at y=0.
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'molite', 5, 25, -30, -20, 5, 25, 'blingite', 0.2);

    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();
    expect(result!.clearedVoxels).toBeGreaterThan(0);

    // The crater breaks through the (negative-Y) surface, same as the
    // above-ground case.
    expect(grid.densityAt(12, -20, 12)).toBe(0);
  });

  it('returns null and leaves terrain untouched for an invalid blast plan', () => {
    const grid = new VoxelGrid(20, 10, 20);
    const holes = createGridPlan({ x: 5, z: 5 }, 1, 1, 3, 6, 0.15);
    fillRegion(grid, 'cruite', 0, 19, 0, 5, 0, 19);
    const plan = assembleBlastPlan(holes, {}, {});

    const result = executeBlast(plan, grid, []);
    expect(result).toBeNull();
    expect(grid.getVoxel(5, 5, 5)?.density).toBe(1.0);
  });
});

// ── Post-carve renormalisation (#1148) ──────────────────────────────────────
//
// BlastExecution's own wiring around captureColumnTopsForCarve /
// renormaliseCarvedColumns (lines ~299-333) had zero coverage touching
// executeBlast itself — every existing #1148 test drove the standalone
// VoxelGrid primitive directly. The tests below close that gap.
//
// Note on the first two: identifyFragmentedVoxels' own
// liftUnderminedBurden pass (VoxelFragmentation.ts) already breaks a thin
// (<= BURDEN_BREAKOUT_MAX voxels) cap that reaches open air within the
// blast's own energy box, which is exactly the shape a stray sub-threshold
// residue directly above a freshly broken column takes — so a plain
// "residue gets cleared" fixture passes even with the #1148 wiring stubbed
// out, and doesn't by itself prove this file's own call sites fire. The
// third test below (stale, off-formula residue density) is the
// discriminating one instead: manually stubbing renormaliseCarvedColumns
// out of executeBlast leaves that residue at the stale values it started
// with, while the real wiring rewrites them to the canonical band — so
// that test genuinely fails without this file's own call sites running.

describe('executeBlast — post-carve renormalisation (#1148)', () => {
  const CRUST_HEIGHT = 10.5;

  /**
   * 2×3 hole grid over a fractional crust: every column in the fill footprint
   * is solid rock from y=0 up (so the charge column has real rock to seed
   * energy into, same as the plain crater fixture), with its real top at
   * y=10 (density 0.75) and a connected sub-threshold residue slab at y=11
   * (density 0.25) above it.
   *
   * Fills 0..9 solid first (fillRegion) and only then bands the crossing at
   * CRUST_HEIGHT via setVoxelColumnSurfaceHeight — that primitive only ever
   * touches the band between a column's existing top and the new target's
   * own crossing band (#1143's own design; #1184 made the "no existing top"
   * case degenerate to *just* that band instead of flattening the whole
   * column to y=0), so calling it against bare air, as this fixture used to,
   * left every column a floating 2-voxel slab with nothing underneath for
   * the charge to seed into.
   */
  function buildCrustFixture() {
    const grid = new VoxelGrid(40, 20, 40);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'molite', coefficient: 1.0 }] });
    fillRegion(grid, 'molite', 5, 25, 0, 9, 5, 25);
    for (let z = 5; z <= 25; z++) {
      for (let x = 5; x <= 25; x++) {
        setVoxelColumnSurfaceHeight(grid, x, z, CRUST_HEIGHT, compId);
      }
    }

    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    return { grid, plan: assembleBlastPlan(holes, charges, delays) };
  }

  it('leaves no dangling sub-threshold residue above a carved column\'s new top', () => {
    const { grid, plan } = buildCrustFixture();
    // Sanity-check the fixture: a genuine residue voxel sits above the real top.
    expect(grid.densityAt(12, 10, 12)).toBeGreaterThanOrEqual(0.5);
    expect(grid.densityAt(12, 11, 12)).toBeGreaterThan(0);
    expect(grid.densityAt(12, 11, 12)).toBeLessThan(0.5);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();

    // Breaks through to the surface, same as the plain crater fixture...
    expect(grid.densityAt(12, 10, 12)).toBe(0);
    // ...and the stranded residue above it is gone too, not left dangling.
    expect(grid.densityAt(12, 11, 12)).toBe(0);
  });

  it('widens the emitted terrain:updated region\'s maxY to cover renormalisation, not just the raw fragmented voxels', () => {
    const { grid, plan } = buildCrustFixture();
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('terrain:updated', handler);

    const result = executeBlast(plan, grid, [], undefined, undefined, emitter);
    expect(result).not.toBeNull();

    expect(handler).toHaveBeenCalledTimes(1);
    const emitted = handler.mock.calls[0]![0] as { region: { maxY: number } };
    // Renormalisation reaches y=11 (the residue) — one cell above the raw
    // fragmented voxels' own top (y=10) — so the emitted event's region must
    // widen to cover it, not stop at the raw fragmented voxels' own Y range.
    expect(emitted.region.maxY).toBeGreaterThanOrEqual(11);
  });

  /**
   * A single shallow hole over bedrock (y=0..3, solid) topped by a
   * deliberately STALE crossing pair — y=4/y=5 hand-set to densities
   * (0.6, 0.4) that do NOT match the canonical band `setVoxelColumnSurfaceHeight`
   * would write for whatever height they interpolate to (0.75/0.25 for the
   * 4.5 that pair implies) — plus a single fully solid burden voxel at y=6
   * that the blast breaks through. This is the discriminating case: unlike
   * the crust fixture above, nothing here needs liftUnderminedBurden or the
   * unsupported-flood-fill pass — the stale pair survives untouched by
   * ordinary fragmentation (it's already below the new top once y=6 is
   * cleared), so only renormaliseVoxelColumnAfterCarve's REGRADE branch can
   * possibly rewrite it. Verified by hand: stubbing
   * renormaliseCarvedColumns out of executeBlast leaves y=4/y=5 at their
   * stale (0.6, 0.4) values; the real wiring rewrites them to (0.75, 0.25).
   */
  function buildStaleResidueFixture() {
    const grid = new VoxelGrid(30, 20, 30);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'molite', coefficient: 1.0 }] });
    for (let z = 5; z <= 20; z++) {
      for (let x = 5; x <= 20; x++) {
        for (let y = 0; y <= 3; y++) grid.fillVoxel(x, y, z, compId, undefined, 1);
        grid.fillVoxel(x, 4, z, compId, undefined, 0.6);
        grid.fillVoxel(x, 5, z, compId, undefined, 0.4);
        grid.fillVoxel(x, 6, z, compId, undefined, 1);
      }
    }

    const holes = createGridPlan({ x: 12, z: 12 }, 1, 1, 4, 1, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 1, 0.5);
    const delays = autoVPattern(holes, 25);
    return { grid, plan: assembleBlastPlan(holes, charges, delays) };
  }

  it('regrades a stale, off-formula crossing exposed by the carve into the canonical band', () => {
    const { grid, plan } = buildStaleResidueFixture();

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();

    // The burden voxel broke, exposing the crossing pair as the new top.
    expect(grid.densityAt(12, 6, 12)).toBe(0);
    expect(computeVoxelColumnSurfaceY(grid, 12, 12)).toBe(4);

    // The stale (0.6, 0.4) pair — self-consistent enough to interpolate a
    // height (4.5), but not what a fresh write for that height would
    // produce — must have been rewritten to the canonical (0.75, 0.25) band,
    // not left exactly as it was found.
    expect(grid.densityAt(12, 4, 12)).toBeCloseTo(0.75, 6);
    expect(grid.densityAt(12, 5, 12)).toBeCloseTo(0.25, 6);
    expect(computeVoxelColumnSurfaceHeight(grid, 12, 12)).toBeCloseTo(4.5, 6);
  });
});

describe('executeBlast — flooded holes (wetHoleIds, water-sensitive explosive)', () => {
  /** Same 2×3 grid/plan as the crater tests above, built fresh so the two sides of a dry/flooded comparison never share a mutated grid. */
  function buildCraterPlan(explosiveId: string) {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, explosiveId, 8, 2);
    const delays = autoVPattern(holes, 25);
    return { grid, holes, holeIds, plan: assembleBlastPlan(holes, charges, delays) };
  }

  it('a flooded hole charged with a water-sensitive explosive (boomite) clears fewer voxels than the same plan dry', () => {
    const dry = buildCraterPlan('boomite');
    const dryResult = executeBlast(dry.plan, dry.grid, []);
    expect(dryResult).not.toBeNull();

    const flooded = buildCraterPlan('boomite');
    const allHolesWet = new Set(flooded.holeIds);
    const floodedResult = executeBlast(flooded.plan, flooded.grid, [], undefined, undefined, undefined, allHolesWet);
    expect(floodedResult).not.toBeNull();

    expect(floodedResult!.clearedVoxels).toBeLessThan(dryResult!.clearedVoxels);
    expect(floodedResult!.totalRockVolume).toBeLessThan(dryResult!.totalRockVolume);
  });

  it('a flooded hole charged with a water-resistant explosive (krackle) clears the same as dry', () => {
    const dry = buildCraterPlan('krackle');
    const dryResult = executeBlast(dry.plan, dry.grid, []);
    expect(dryResult).not.toBeNull();

    const flooded = buildCraterPlan('krackle');
    const allHolesWet = new Set(flooded.holeIds);
    const floodedResult = executeBlast(flooded.plan, flooded.grid, [], undefined, undefined, undefined, allHolesWet);
    expect(floodedResult).not.toBeNull();

    expect(floodedResult!.clearedVoxels).toBe(dryResult!.clearedVoxels);
  });

  it('a wetHoleIds entry with no overlap with the plan behaves exactly like no flooding at all', () => {
    const dry = buildCraterPlan('boomite');
    const dryResult = executeBlast(dry.plan, dry.grid, []);

    const unaffected = buildCraterPlan('boomite');
    const irrelevantWetIds = new Set(['hole-not-in-this-plan']);
    const result = executeBlast(unaffected.plan, unaffected.grid, [], undefined, undefined, undefined, irrelevantWetIds);

    expect(result!.clearedVoxels).toBe(dryResult!.clearedVoxels);
  });
});

describe('buildBlastReport', () => {
  it('carries the tick, rating, and per-blast totals straight from the result', () => {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();

    const report = buildBlastReport(result!, 42, 960);
    expect(report.tick).toBe(42);
    expect(report.spent).toBe(960);
    expect(report.rating).toBe(result!.rating);
    expect(report.clearedVoxels).toBe(result!.clearedVoxels);
    expect(report.crackedVoxels).toBe(result!.crackedVoxels);
    expect(report.fragmentCount).toBe(result!.fragmentCount);
    expect(report.oversizedFragments).toBe(result!.oversizedFragments);
    expect(report.totalRockVolume).toBe(result!.totalRockVolume);
    expect(report.projectionCount).toBe(result!.projectionCount);
    expect(report.totalOreValue).toBe(result!.totalOreValue);
    expect(report.destroyedBuildings).toBe(result!.destroyedBuildings);
  });

  it('estimates max projection distance as the 45°-launch range of the fastest projected fragment', () => {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);
    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();

    const report = buildBlastReport(result!, 0, 0);
    const expectedRange = (result!.maxProjectionSpeed * result!.maxProjectionSpeed) / Math.abs(GRAVITY);
    expect(report.maxProjectionDistanceM).toBeCloseTo(expectedRange, 6);
  });

  it('reports zero projection distance when nothing was projected', () => {
    // Hand-built minimal BlastResult rather than a real blast pipeline —
    // this is testing buildBlastReport's arithmetic in isolation, not
    // executeBlast's decision about when projection happens.
    const result: BlastResult = {
      fragments: [],
      fragmentCount: 0,
      averageFragmentSize: 0,
      oversizedFragments: 0,
      projectionCount: 0,
      maxProjectionSpeed: 0,
      vibrationAtVillages: [],
      totalRockVolume: 0,
      totalOreValue: 0,
      rating: 'mediocre',
      crackedVoxels: 0,
      clearedVoxels: 0,
      clearedRegion: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
      destroyedBuildings: [],
      secondaryBlastEvents: [],
      maxThrowDistance: 0,
      projectileCount: 0,
      flights: [],
      clearedColumns: [],
    };
    const report = buildBlastReport(result, 0, 0);
    expect(report.maxProjectionDistanceM).toBe(0);
  });
});
