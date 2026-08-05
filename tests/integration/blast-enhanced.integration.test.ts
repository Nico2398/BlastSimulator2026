// BlastSimulator2026 — Integration tests: Blast enhanced mechanics (Phase 5)
// Covers multi-rock composition, energy propagation, fragment classification,
// extending the existing blast-execution.test.ts with more edge cases.

import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import type { VoxelData } from '../../src/core/world/VoxelGrid.js';
import { createGridPlan, resetHoleIds } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../src/core/mining/BlastExecution.js';
import type { VillagePosition } from '../../src/core/mining/BlastExecution.js';
import {
  computeThreshold,
  calculateHoleEnergy,
  computeInitialEnergy,
} from '../../src/core/mining/BlastCalc.js';
import {
  createEnergyField,
  seedEnergy,
  effectiveAt,
  overflowAt,
  intensityAt,
} from '../../src/core/mining/EnergyPropagation.js';
import { identifyFragmentedVoxels } from '../../src/core/mining/VoxelFragmentation.js';
import { vec3 } from '../../src/core/math/Vec3.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Fill a region of the grid with a single rock type. */
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
        if (oreId !== undefined && oreDensity !== undefined) ores[oreId] = oreDensity;
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

/** Fill a region split at splitX: left side (x < splitX) gets rock1, right side gets rock2.
 *  Region is specified as [minX, maxX, minY, maxY, minZ, maxZ]. */
function fillMultiRock(
  grid: VoxelGrid,
  rock1: string,
  rock2: string,
  splitX: number,
  ...region: number[]
) {
  const [minX, maxX, minY, maxY, minZ, maxZ] = region;
  for (let z = minZ; z <= maxZ; z++) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const rock = x < splitX ? rock1 : rock2;
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: rock, coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: {},
          fractureModifier: 1.0,
        });
      }
    }
  }
}

/** Far-away village so vibrations don't affect ratings. */
const VILLAGE_FAR: VillagePosition[] = [
  { id: 'testville', position: vec3(200, 0, 200) },
];

// ── Blast enhanced ────────────────────────────────────────────────────────────

describe('Blast enhanced', () => {
  beforeEach(() => resetHoleIds());
  // ── 1. Multi-rock composition ─────────────────────────────────────────────

  it('multi-rock composition computes weighted threshold', () => {
    // cruite: energyAbsorption=200, molite: energyAbsorption=500
    // 50 % each → weighted threshold = 0.5 * 200 + 0.5 * 500 = 350
    const voxel: VoxelData = {
      composition: {
        rocks: [
          { rockId: 'cruite', coefficient: 0.5 },
          { rockId: 'molite', coefficient: 0.5 },
        ],
      },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    const threshold = computeThreshold(voxel);
    expect(threshold).toBeCloseTo(350, 0);

    // Also verify computeInitialEnergy: boomite 8kg, stem 2m, depth 8m
    const initE = computeInitialEnergy(
      { explosiveId: 'boomite', amountKg: 8, stemmingM: 2 },
      8,
    );
    // raw = 340 * 8 = 2720
    // stemmingFactor = max(0, min(1, 2/(8*0.3))) ≈ 0.833
    // efficiency = 0.5 + 0.5 * 0.833 ≈ 0.917
    // initE = 2720 * 0.917 ≈ 2494
    expect(initE).toBeGreaterThan(2000);
    expect(initE).toBeLessThan(2720);
  });

  // ── 2. Energy propagation ─────────────────────────────────────────────────

  it('energy propagates through rock, decreasing with distance', () => {
    const grid = new VoxelGrid(15, 15, 15);
    fillRegion(grid, 'cruite', 0, 14, 0, 14, 0, 14);

    const holeEnergy = calculateHoleEnergy({ explosiveId: 'boomite', amountKg: 8, stemmingM: 2 });
    expect(holeEnergy).toBe(340 * 8);

    const field = createEnergyField(grid, {
      minX: 0, minY: 0, minZ: 0, maxX: 15, maxY: 15, maxZ: 15,
    });
    seedEnergy(field, [{ x: 7, y: 7, z: 7, energy: holeEnergy * 30 }]);

    // The charged voxel is saturated at cruite's absorption, and the energy it
    // could not hold has moved outward.
    expect(effectiveAt(field, 7, 7, 7)).toBeGreaterThan(0);
    expect(overflowAt(field, 7, 7, 7)).toBeGreaterThan(0);
    expect(effectiveAt(field, 9, 7, 7)).toBeGreaterThan(effectiveAt(field, 13, 7, 7));

    const fragmentation = identifyFragmentedVoxels(field, grid);
    expect(fragmentation.fragmented.length).toBeGreaterThan(1);
  });

  // ── 3. Mixed-rock blast ───────────────────────────────────────────────────

  it('blast on mixed rock clears voxels', () => {
    const grid = new VoxelGrid(30, 15, 30);
    // Left half cruite (soft, threshold 200), right half titanite (hard, threshold 4000)
    fillMultiRock(grid, 'cruite', 'titanite', 15, 5, 25, 0, 10, 5, 25);

    // boomite 6kg (340E/kg × 6 = 2040E) — enough to fracture cruite but not titanite
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 2, 4, 6, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 6, 1.5);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    // Cruite voxels should be cleared
    expect(result!.clearedVoxels).toBeGreaterThan(0);
    // Not everything should be cleared (titanite remains mostly intact)
    expect(result!.clearedVoxels).toBeLessThan(500);
    expect(result!.fragmentCount).toBeGreaterThan(0);
  });

  // ── 4. Empty plan ─────────────────────────────────────────────────────────

  it('empty plan returns null blast result', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Holes exist but no charges or delays → validation fails
    const holes = createGridPlan({ x: 5, z: 5 }, 1, 1, 3, 6, 0.15);
    const plan = assembleBlastPlan(holes, {}, {});
    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).toBeNull();
  });

  // ── 5. Well-designed blast ────────────────────────────────────────────────

  it('well-designed blast produces good/perfect rating', () => {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'molite', 5, 30, 0, 12, 5, 30);

    // boomite 8kg (340E/kg × 8 = 2720E) on molite (threshold 500)
    // → energy ratio ~1.25 per hole → good fragmentation, minimal projections
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    expect(result!.fragmentCount).toBeGreaterThan(0);
    expect(result!.clearedVoxels).toBeGreaterThan(0);
    expect(result!.rating).toMatch(/perfect|good/);
  });

  // ── 6. Overcharged blast ──────────────────────────────────────────────────

  it('overcharged blast on soft rock produces projections', () => {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'cruite', 5, 30, 0, 12, 5, 30);

    // dynatomics 25kg (1300E/kg × 25 = 32500E) on cruite (threshold 200)
    // → grossly overcharged → projections, bad/catastrophic rating
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 3, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'dynatomics', 25, 1);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    expect(result!.projectionCount).toBeGreaterThan(0);
    expect(result!.rating).toMatch(/bad|catastrophic/);
  });

  // ── 7. Undercharged blast ─────────────────────────────────────────────────

  it('undercharged blast on hard rock produces bad rating', () => {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'titanite', 5, 30, 0, 12, 5, 30);

    // pop_rock 2kg (200E/kg × 2 = 400E) on titanite (threshold 4000)
    // → way undercharged → almost no fragmentation
    const holes = createGridPlan({ x: 12, z: 12 }, 1, 1, 3, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'pop_rock', 2, 1);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    // Very few cleared voxels since energy << threshold
    expect(result!.clearedVoxels).toBeLessThan(20);
    expect(result!.rating).toBe('bad');
  });

  // ── 8. Minimal energy ─────────────────────────────────────────────────────

  it('very small energy cracks very few or no voxels', () => {
    const grid = new VoxelGrid(30, 15, 30);
    fillRegion(grid, 'titanite', 5, 25, 0, 10, 5, 25);

    // pop_rock 0.5kg (minimum charge) on titanite (threshold 4000)
    // → extremely weak, far below any fracture threshold
    const holes = createGridPlan({ x: 10, z: 10 }, 1, 1, 3, 6, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'pop_rock', 0.5, 0.5);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    // Zero or one cleared voxel (barely any energy reaches fracture threshold)
    expect(result!.clearedVoxels).toBeLessThanOrEqual(1);
    expect(result!.fragmentCount).toBe(0);
  });

  // ── 9. Fragmentation classification ───────────────────────────────────────

  it('rates how hard rock was hit by the energy that passed through it', () => {
    const grid = new VoxelGrid(15, 15, 15);
    fillRegion(grid, 'cruite', 0, 14, 0, 14, 0, 14);

    const field = createEnergyField(grid, {
      minX: 0, minY: 0, minZ: 0, maxX: 15, maxY: 15, maxZ: 15,
    });
    seedEnergy(field, [{ x: 7, y: 7, z: 7, energy: 200 * 400 }]);

    // Retained energy alone cannot tell these apart — absorption stops at the
    // threshold, so every broken voxel reads exactly 1.0. Intensity counts what
    // passed through, so rock beside the charge reads far higher than rock at
    // the edge of the break.
    expect(intensityAt(field, 7, 7, 7)).toBeGreaterThan(intensityAt(field, 10, 7, 7));
    expect(intensityAt(field, 7, 7, 7)).toBeGreaterThan(1);
  });

  it('blast clears terrain voxels around charge', () => {
    const grid = new VoxelGrid(30, 15, 30);
    fillRegion(grid, 'cruite', 8, 20, 0, 8, 8, 20);

    // Verify voxels are solid before blast
    const beforeVoxel = grid.getVoxel(12, 2, 12);
    expect(beforeVoxel?.density).toBe(1.0);

    const holes = createGridPlan({ x: 12, z: 12 }, 2, 2, 3, 6, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 1.5);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    expect(result!.clearedVoxels).toBeGreaterThan(0);

    // Count cleared voxels (density === 0) near the blast centre
    let clearedCount = 0;
    for (let z = 10; z <= 14; z++) {
      for (let y = 0; y <= 4; y++) {
        for (let x = 10; x <= 14; x++) {
          const v = grid.getVoxel(x, y, z);
          if (v && v.density === 0) clearedCount++;
        }
      }
    }
    expect(clearedCount).toBeGreaterThan(0);
  });
});
