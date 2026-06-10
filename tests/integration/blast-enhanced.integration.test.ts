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
  propagateEnergy,
  identifyFragmentedVoxels,
  calculateFragmentation,
  calculateInitialVelocity,
  classifyProjection,
  calculateHoleEnergy,
  computeInitialEnergy,
} from '../../src/core/mining/BlastCalc.js';
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

  it('energy propagates through rock decreasing with distance', () => {
    const grid = new VoxelGrid(10, 5, 10);
    fillRegion(grid, 'cruite', 0, 9, 0, 4, 0, 9);

    // Calculate hole energy for a single boomite 8kg charge
    const holeEnergy = calculateHoleEnergy({ explosiveId: 'boomite', amountKg: 8, stemmingM: 2 });
    expect(holeEnergy).toBe(340 * 8); // 2720

    // Inject large energy at the centre voxel (3× the single-hole energy)
    const initialEnergy = new Map<string, number>();
    initialEnergy.set('5,1,5', holeEnergy * 3);
    const result = propagateEnergy(grid, initialEnergy);

    // Energy should have spread to multiple voxels
    expect(result.effectiveEnergy.size).toBeGreaterThan(0);

    // The source voxel should be saturated (cruite threshold = 200)
    expect(result.effectiveEnergy.has('5,1,5')).toBe(true);
    expect(result.effectiveEnergy.get('5,1,5')).toBeCloseTo(200, 0);

    // At least some neighbours should have received energy
    const neighbours = ['6,1,5', '4,1,5', '5,1,6', '5,1,4'];
    const hasNeighbour = neighbours.some(nk => result.effectiveEnergy.has(nk));
    expect(hasNeighbour).toBe(true);

    // Overflow should have been generated (energy that spilled past neighbours)
    expect(result.generatedOverflow.size).toBeGreaterThan(0);

    // identifyFragmentedVoxels should find the source voxel and its neighbours
    const fragmented = identifyFragmentedVoxels(grid, result);
    expect(fragmented.has('5,1,5')).toBe(true);
    // At least one neighbour should also be fragmented
    const fragmentedNeighbours = neighbours.filter(nk => fragmented.has(nk));
    expect(fragmentedNeighbours.length).toBeGreaterThan(0);
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

  it('calculateFragmentation classifies based on energy ratio', () => {
    // ratio >= 4 → isProjection = true
    const proj = calculateFragmentation(2000, 500);
    expect(proj.isProjection).toBe(true);
    expect(proj.result).toBe('fractured');
    expect(proj.energyRatio).toBeCloseTo(4, 1);

    // ratio < 0.5 → unaffected
    const unaffected = calculateFragmentation(100, 500);
    expect(unaffected.result).toBe('unaffected');
    expect(unaffected.isProjection).toBe(false);

    // 0.5 <= ratio < 1.0 → cracked
    const cracked = calculateFragmentation(300, 500);
    expect(cracked.result).toBe('cracked');
    expect(cracked.isProjection).toBe(false);

    // 1.0 <= ratio < 2.0 → fractured, not projected
    const fractured = calculateFragmentation(750, 500);
    expect(fractured.result).toBe('fractured');
    expect(fractured.isProjection).toBe(false);
    expect(fractured.fragmentSizeFraction).toBeGreaterThan(0.3);

    // ratio 0 → still unaffected
    const zero = calculateFragmentation(0, 500);
    expect(zero.result).toBe('unaffected');

    // threshold 0 → unaffected (no rock = no fracture possible)
    const noThreshold = calculateFragmentation(1000, 0);
    expect(noThreshold.result).toBe('unaffected');

    // --- calculateInitialVelocity ---

    // Fragment at (6,1,6) with hole at (5,1,5): direction should be (1,0,1) normalised
    const vel = calculateInitialVelocity(vec3(6, 1, 6), vec3(5, 1, 5), 1000, 10);
    expect(vel.x).toBeGreaterThan(0);
    expect(vel.z).toBeGreaterThan(0);
    // Speed: sqrt(2 * 1000 / 10) = sqrt(200) ≈ 14.14
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    expect(speed).toBeCloseTo(14.14, 0);

    // --- classifyProjection ---

    // Speed > PROJECTION_SPEED_THRESHOLD (15) → projection
    expect(classifyProjection(20, 2)).toBe(true);
    // Energy ratio >= 4 → projection (even with low speed)
    expect(classifyProjection(10, 5)).toBe(true);
    // Neither → not a projection
    expect(classifyProjection(10, 2)).toBe(false);
    expect(classifyProjection(0, 0)).toBe(false);
  });

  // ── 10. Terrain clearing ──────────────────────────────────────────────────

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
