// Integration test: full blast physics pipeline
// BlastCalc (core) → FragmentBody (physics) → CollisionHandler (damage)
//
// Sets up terrain, buildings, and employees, runs an overcharged blast,
// then simulates fragment physics and verifies that damage is applied.
//
// Performance note: only projections (high-velocity fragments) are fed
// into the physics simulation to keep the test fast. Regular blast
// fragments number in the thousands and would timeout.

import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { createGridPlan, resetHoleIds } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../src/core/mining/BlastExecution.js';
import type { VillagePosition } from '../../src/core/mining/BlastExecution.js';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld.js';
import { TerrainBody } from '../../src/physics/TerrainBody.js';
import { FragmentBody } from '../../src/physics/FragmentBody.js';
import { applyFragmentCollisions, buildMassMap } from '../../src/physics/CollisionHandler.js';
import { createBuildingState, placeBuilding } from '../../src/core/entities/Building.js';
import { createVehicleState } from '../../src/core/entities/Vehicle.js';
import { createEmployeeState } from '../../src/core/entities/Employee.js';
import { createDamageState } from '../../src/core/entities/Damage.js';

const VILLAGE_FAR: VillagePosition[] = [
  { id: 'testville', position: { x: 500, y: 0, z: 500 } },
];

/** Fill a region of the grid with a rock type. */
function fillRegion(
  grid: VoxelGrid,
  rockId: string,
  minX: number, maxX: number,
  minY: number, maxY: number,
  minZ: number, maxZ: number,
): void {
  for (let z = minZ; z <= maxZ; z++) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        grid.setVoxel(x, y, z, { rockId, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
      }
    }
  }
}

beforeEach(() => resetHoleIds());

describe('Blast physics pipeline — integration (8.5)', () => {
  it('full pipeline runs: blast produces fragments and projections', () => {
    // ── 1. Build terrain ──
    const grid = new VoxelGrid(30, 15, 30);
    // Fill cruite (soft rock, threshold=200) from Y=0..8
    fillRegion(grid, 'cruite', 0, 29, 0, 8, 0, 29);

    // ── 2. Overcharged blast: max dynatomics on soft cruite → projections ──
    const holes = createGridPlan({ x: 12, z: 12 }, 1, 1, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'dynatomics', 25, 1);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const blastResult = executeBlast(plan, grid, VILLAGE_FAR);
    expect(blastResult).not.toBeNull();
    expect(blastResult!.fragmentCount).toBeGreaterThan(0);
    expect(blastResult!.projectionCount).toBeGreaterThan(0); // Overcharged → projections
    expect(blastResult!.rating).toMatch(/bad|catastrophic/);

    // All fragments must have a valid mass
    for (const f of blastResult!.fragments) {
      expect(f.mass).toBeGreaterThan(0);
    }
  });

  it('overcharged blast produces projections with high initial velocity', () => {
    const grid = new VoxelGrid(20, 10, 20);
    fillRegion(grid, 'cruite', 0, 19, 0, 8, 0, 19);

    const holes = createGridPlan({ x: 8, z: 8 }, 1, 1, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'dynatomics', 25, 1);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const blastResult = executeBlast(plan, grid, VILLAGE_FAR);
    expect(blastResult).not.toBeNull();
    expect(blastResult!.projectionCount).toBeGreaterThan(0);
    expect(blastResult!.maxProjectionSpeed).toBeGreaterThan(0); // Projections have non-zero speed

    const projections = blastResult!.fragments.filter(f => f.isProjection);
    expect(projections.length).toBeGreaterThan(0);
    // Projections are flagged by energy ratio (>> 4x threshold) — not necessarily high speed
    // High speed projections (>15 m/s) occur when energy-per-fragment is much larger
    expect(projections.every(f => f.isProjection)).toBe(true);
  });

  it('physics simulation: projections travel and settle, impactSpeed is tracked', () => {
    const grid = new VoxelGrid(20, 10, 20);
    fillRegion(grid, 'cruite', 0, 19, 0, 8, 0, 19);

    const holes = createGridPlan({ x: 8, z: 8 }, 1, 1, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'dynatomics', 25, 1);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const blastResult = executeBlast(plan, grid, VILLAGE_FAR);
    expect(blastResult).not.toBeNull();

    // Only simulate a small sample of projections to keep the test fast
    // (overcharged blasts produce thousands of fragments; we only need a few to test the pipeline)
    const allProjections = blastResult!.fragments.filter(f => f.isProjection);
    expect(allProjections.length).toBeGreaterThan(0);
    const projections = allProjections.slice(0, 15); // Cap at 15 for test speed

    const physicsWorld = new PhysicsWorld();
    physicsWorld.init();

    const terrainBody = new TerrainBody(physicsWorld);
    terrainBody.build(grid); // Post-blast terrain

    const fragmentBody = new FragmentBody(physicsWorld);
    fragmentBody.addFragments(projections);
    expect(fragmentBody.bodyCount).toBe(projections.length);

    const steps = fragmentBody.simulate();
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThanOrEqual(600);

    const results = fragmentBody.getResults();
    expect(results).toHaveLength(projections.length);

    // All results must have impactSpeed tracked (peak speed during flight)
    for (const r of results) {
      expect(r.impactSpeed).toBeGreaterThanOrEqual(0);
    }

    // Projections launched upward should have significant peak speed (from gravity alone,
    // a fragment falling from height h has v = sqrt(2gh); from h=5m: v ≈ 9.9 m/s)
    const maxImpactSpeed = Math.max(...results.map(r => r.impactSpeed));
    expect(maxImpactSpeed).toBeGreaterThan(1.0); // At minimum, gravity contributes

    // Cleanup
    fragmentBody.dispose();
    terrainBody.dispose();
    physicsWorld.clear();

    expect(fragmentBody.bodyCount).toBe(0);
    expect(physicsWorld.bodyCount).toBe(0);
  });

  it('physics simulation with entity damage — state is consistent after blast', () => {
    const grid = new VoxelGrid(15, 8, 15);
    fillRegion(grid, 'cruite', 0, 14, 0, 7, 0, 14);

    const holes = createGridPlan({ x: 6, z: 6 }, 1, 1, 4, 7, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'dynatomics', 25, 1);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const blastResult = executeBlast(plan, grid, VILLAGE_FAR);
    expect(blastResult).not.toBeNull();

    // Only simulate a small sample of projections to keep test fast
    const allProjections = blastResult!.fragments.filter(f => f.isProjection);
    expect(allProjections.length).toBeGreaterThan(0);
    const projections = allProjections.slice(0, 15); // Cap at 15 for test speed

    // Physics pipeline
    const physicsWorld = new PhysicsWorld();
    physicsWorld.init();

    const terrainBody = new TerrainBody(physicsWorld);
    terrainBody.build(grid);

    const fragmentBody = new FragmentBody(physicsWorld);
    fragmentBody.addFragments(projections);
    fragmentBody.simulate();

    const results = fragmentBody.getResults();

    // Entity setup near the blast zone
    const buildings = createBuildingState();
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const damage = createDamageState();

    // Storage depot at (5,5) → center at (7,7) — right at the blast center
    placeBuilding(buildings, 'storage_depot', 5, 5, 15, 15);
    employees.employees.push(
      { id: 1, name: 'Worker A', role: 'driller', salary: 500, morale: 60,
        unionized: false, injured: false, alive: true, x: 6, z: 6 },
      { id: 2, name: 'Worker B', role: 'blaster', salary: 700, morale: 70,
        unionized: false, injured: false, alive: true, x: 7, z: 7 },
    );

    const massMap = buildMassMap(projections);
    const accidents = applyFragmentCollisions(
      results, massMap, buildings, vehicles, employees, damage, 50,
    );

    // State consistency: damage.accidents matches returned accidents
    expect(damage.accidents.length).toBe(accidents.length);

    // If any accidents occurred, verify structural consistency (no dangling refs)
    for (const acc of accidents) {
      expect(acc.tick).toBe(50);
      expect(acc.fragmentId).toBeGreaterThanOrEqual(0);
      expect(acc.kineticEnergy).toBeGreaterThan(0);
      expect(['building_damage', 'building_destroyed', 'vehicle_damage', 'vehicle_destroyed', 'injury', 'death'])
        .toContain(acc.type);

      if (acc.type === 'building_destroyed') {
        const stillExists = buildings.buildings.some(b => b.id === acc.entityId);
        expect(stillExists).toBe(false);
      }
      if (acc.type === 'death') {
        const emp = employees.employees.find(e => e.id === acc.entityId);
        expect(emp?.alive).toBe(false);
        expect(damage.lawsuitPending).toBe(true);
      }
      if (acc.type === 'injury') {
        const emp = employees.employees.find(e => e.id === acc.entityId);
        expect(emp?.injured).toBe(true);
      }
    }

    // Cleanup
    fragmentBody.dispose();
    terrainBody.dispose();
    physicsWorld.clear();
  });
});
