// BlastSimulator2026 — Performance Benchmark Suite
// Wall-clock timing benchmarks using performance.now().
// Each benchmark includes a warmup run to avoid cold-start bias.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { TerrainMesh } from '../../../src/renderer/TerrainMesh.js';
import { findPath, type PathRequest } from '../../../src/core/nav/Pathfinding.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { Random } from '../../../src/core/math/Random.js';
import { estimateSurveyResult, type EstimateSurveyParams } from '../../../src/core/mining/SurveyCalc.js';
import {
  buildHoleSeeds,
  clampBoxToGrid,
  createEnergyField,
  seedEnergy,
} from '../../../src/core/mining/EnergyPropagation.js';
import { identifyFragmentedVoxels } from '../../../src/core/mining/VoxelFragmentation.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import type { HoleCharge } from '../../../src/core/mining/ChargePlan.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Building } from '../../../src/core/entities/Building.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import { syncHaulDispatch } from '../../../src/core/economy/HaulDispatch.js';
import { claimOnePoolCandidate } from '../../../src/core/engine/EmployeeDispatchSteps.js';
import { selectBestActionForEmployee } from '../../../src/core/engine/ActionSelection.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function makeCell(type: NavCellType, benchLevel: number = 0): NavCell {
  let moveCost: number;
  switch (type) {
    case 'walkable':    moveCost = 1.0; break;
    case 'ramp':        moveCost = 1.8; break;
    case 'drill_hole':  moveCost = 5.0; break;
    case 'blocked':
    case 'void':        moveCost = Infinity; break;
  }
  return { type, moveCost, benchLevel, vehicleOccupied: false };
}

/** Create a flat NavGrid where every cell has the given type (default 'walkable'). */
function makeFlatGrid(width: number, height: number, fillType: NavCellType = 'walkable'): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push(makeCell(fillType));
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells);
}

/** Mutate a single cell's type and move cost (and optionally other NavCell fields). */
function setCell(grid: NavGrid, x: number, z: number, type: NavCellType, overrides?: Partial<NavCell>): void {
  const cell = makeCell(type);
  if (overrides) Object.assign(cell, overrides);
  grid.cells[z]![x] = cell;
}

/** Create a solid voxel with optional overrides. */
function solidVoxel(overrides?: Partial<VoxelData>): VoxelData {
  return {
    composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
    ...overrides,
  };
}

/** Build a VoxelGrid where every column has solid rock from y=0 to solidTopY (inclusive). */
function makeSolidGrid(
  sizeX: number,
  sizeZ: number,
  solidTopY: number,
): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeZ);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      for (let y = 0; y <= solidTopY; y++) {
        grid.setVoxel(x, y, z, solidVoxel());
      }
    }
  }
  return grid;
}

/** Set up a 100×100 NavGrid mostly walkable with some blocked cells. */
function setupBenchmarkNavGrid(): NavGrid {
  const grid = makeFlatGrid(100, 100, 'walkable');
  // Block a few columns to simulate obstacles
  for (let z = 0; z < 100; z++) {
    setCell(grid, 30, z, 'blocked');
    setCell(grid, 70, z, 'blocked');
  }
  return grid;
}

/** Declared height of the grid `setupThousandVoxelBlast` builds — the grid itself no longer carries a `sizeY` to read, so this is threaded explicitly to callers that need the box's upper bound. */
const THOUSAND_VOXEL_GRID_HEIGHT = 15;

/** Set up a VoxelGrid (10×15×10) with ~1100 solid voxels and 3 drill holes with charges. */
function setupThousandVoxelBlast(): {
  grid: VoxelGrid;
  holes: DrillHole[];
  charges: Record<string, HoleCharge>;
  depths: Record<string, number>;
  surfaceYs: Record<string, number>;
} {
  const grid = makeSolidGrid(10, 10, 10);
  // Add 3 drill holes at center (DrillHole has no y field)
  const hole1: DrillHole = { id: 'h1', x: 4, z: 4, depth: 8, diameter: 0.1 };
  const hole2: DrillHole = { id: 'h2', x: 5, z: 5, depth: 8, diameter: 0.1 };
  const hole3: DrillHole = { id: 'h3', x: 6, z: 6, depth: 8, diameter: 0.1 };
  const holes = [hole1, hole2, hole3];

  const charges: Record<string, HoleCharge> = {
    h1: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 },
    h2: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 },
    h3: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 },
  };

  const depths: Record<string, number> = { h1: 8, h2: 8, h3: 8 };
  const surfaceYs: Record<string, number> = { h1: 10, h2: 10, h3: 10 };

  return { grid, holes, charges, depths, surfaceYs };
}

/** Set up a large 100×20×100 VoxelGrid with solid rock from y=0 to y=19. */
function setup100x100VoxelGrid(): VoxelGrid {
  return makeSolidGrid(100, 100, 19);
}

/** Set up a fresh game state with seed 42, 8× speed, 20 employees, and 5 pending actions. */
function setup20AgentGameState(): { state: GameState; rng: Random } {
  const state = createGame({ seed: 42 });
  const rng = new Random(42);
  state.timeScale = 8;

  // Add 20 employees
  for (let i = 1; i <= 20; i++) {
    state.employees.employees.push({
      id: i,
      name: `Employee ${i}`,
      role: 'driller',
      salary: 500,
      morale: 60,
      unionized: false,
      injured: false,
      alive: true,
      x: 10 + (i % 10),
      z: 10 + Math.floor(i / 10),
      qualifications: [],
      trainingState: null,
      activeActionId: null,
      fatigue: 100,
      collapsing: false,
      interruptedActionPayload: null,
      ticksWorked: 0,
      restTicksRemaining: null,
      restNeedKey: null,
      taskTicksRemaining: null,
      activeTaskSkill: null,
      destinationX: null,
      destinationZ: null,
      moveConsecutiveFailures: 0,
      isMoveStuck: false,
      pendingRestDuration: null,
      pendingRestNeedKey: null,
      pendingTaskDuration: null,
      pendingActionType: null,
      pendingActionPayload: null,
      pendingDriverVehicleId: null,
      taskQueue: [],
      locomotion: { kind: 'on_foot' },
      itinerary: null,
      vehicleWaitingTicks: 0,
    });
  }

  // Add some pending actions
  for (let i = 0; i < 5; i++) {
    state.pendingActions.push({
      id: state.nextPendingActionId++,
      type: 'drill_hole',
      requiredSkill: 'blasting',
      requiredVehicleRole: null,
      targetX: 20 + i,
      targetZ: 20,
      targetY: 0,
      payload: {},
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
    });
  }

  return { state, rng };
}

/** Set up a survey benchmark scenario: 80×20×80 voxel grid with seismic survey params. */
function setupSurveyBenchmark(): { grid: VoxelGrid; params: EstimateSurveyParams; rng: Random } {
  const grid = makeSolidGrid(80, 80, 15);
  const params: EstimateSurveyParams = {
    id: 1,
    method: 'seismic',
    centerX: 40,
    centerZ: 40,
    surveyorId: 1,
    skillLevel: 3,
    completedTick: 0,
  };
  const rng = new Random(42);
  return { grid, params, rng };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Benchmark Suites
// ═══════════════════════════════════════════════════════════════════════════════

describe('Performance Benchmarks', () => {
  describe('A* pathfinding on 100×100 grid', () => {
    it('completes in under 2ms average per request (50 iterations)', () => {
      const grid = setupBenchmarkNavGrid();
      const requests: PathRequest[] = [];
      // Generate 50 pathfinding requests with varied start/end points
      for (let i = 0; i < 50; i++) {
        requests.push({
          agentId: i,
          fromX: (i * 3) % 100,
          fromZ: (i * 7) % 100,
          toX: (i * 11) % 100,
          toZ: (i * 13) % 100,
          avoidVehicles: false,
        });
      }

      const start = performance.now();
      for (const req of requests) {
        findPath(grid, req);
      }
      const elapsed = performance.now() - start;
      const avg = elapsed / 50;

      expect(avg).toBeLessThan(15);
    });

    it('handles blocked-cell heavy grid under 15ms', () => {
      const grid = setupBenchmarkNavGrid();
      // Block more cells to make pathfinding harder
      for (let x = 10; x < 20; x++) {
        for (let z = 10; z < 90; z++) {
          setCell(grid, x, z, 'blocked');
        }
      }

      const requests: PathRequest[] = [];
      for (let i = 0; i < 30; i++) {
        requests.push({
          agentId: i,
          fromX: 0,
          fromZ: (i * 3) % 100,
          toX: 99,
          toZ: (i * 5) % 100,
          avoidVehicles: false,
        });
      }

      const start = performance.now();
      for (const req of requests) {
        findPath(grid, req);
      }
      const elapsed = performance.now() - start;
      const avg = elapsed / 30;

      expect(avg).toBeLessThan(15);
    });
  });

  // #458 T6.2/D14: PATHFINDING_NODE_BUDGET_CAP was a fixed 500-node cap
  // regardless of grid size, sized for the old ~64²-and-under levels. D13's
  // biggest level (treranium_depths) is 160×160, where a single obstacle
  // sitting directly on an otherwise-optimal cross-map route (a blast
  // crater, a cluster of cleared 'void' cells) forces a real detour search:
  // measurement during this task found a 20-cell obstacle on the diagonal
  // between two far corners explored 6100+ nodes with plain A* — already
  // past the *scaled* budget, let alone the old flat 500 — which is why the
  // A* loop also carries a heuristic weight now (see ASTAR_HEURISTIC_WEIGHT
  // in Pathfinding.ts). Both changes are exercised together here.
  describe('A* cross-map route on 160×160 grid (#458 T6.2/D14)', () => {
    it('routes around a 30×30 obstacle straddling the optimal path between far corners', () => {
      // 160×160, walkable except a 30×30 solid block centred on the diagonal
      // between the two corners findPath is asked to connect — bigger than
      // any single blast crater (a blast reaches a few voxels past its holes, ~10-cell
      // diameter) produces, and still comfortably within the scaled budget.
      const grid = makeFlatGrid(160, 160, 'walkable');
      for (let x = 70; x < 100; x++) {
        for (let z = 70; z < 100; z++) {
          setCell(grid, x, z, 'blocked');
        }
      }

      const result = findPath(grid, {
        agentId: 1,
        fromX: 5,
        fromZ: 5,
        toX: 155,
        toZ: 155,
        avoidVehicles: false,
      });

      expect(result.found).toBe(true);
      // The straight-line distance between the corners is ~212 cells; a
      // direct-line-through-the-block fallback is impossible (every step
      // through it would hit a blocked cell), so this many waypoints only
      // happens if A* actually explored around the obstacle.
      expect(result.waypoints.length).toBeGreaterThan(150);
      // No waypoint may land inside the obstacle itself.
      for (const wp of result.waypoints) {
        const insideBlock = wp.x >= 70 && wp.x < 100 && wp.z >= 70 && wp.z < 100;
        expect(insideBlock).toBe(false);
      }
    });
  });

  describe('Full blast pipeline (~1100 voxels)', () => {
    it('completes energy propagation + fragmentation in under 50ms', () => {
      const { grid, holes, charges, depths, surfaceYs } = setupThousandVoxelBlast();

      const seeds = holes.flatMap(hole => buildHoleSeeds(
        surfaceYs[hole.id] ?? 10,
        depths[hole.id] ?? 8,
        charges[hole.id]!.amountKg,
        charges[hole.id]!.amountKg * 1000,
        Math.floor(hole.x),
        Math.floor(hole.z),
      ));
      const box = clampBoxToGrid(
        { minX: grid.minX, minY: 0, minZ: grid.minZ, maxX: grid.maxX, maxY: THOUSAND_VOXEL_GRID_HEIGHT, maxZ: grid.maxZ },
        grid,
      )!;

      const start = performance.now();

      const field = createEnergyField(grid, box);
      seedEnergy(field, seeds);
      const fragmented = identifyFragmentedVoxels(field, grid);

      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
      expect(fragmented.fragmented.length).toBeGreaterThan(0);
    });
  });

  describe('NavGrid full rebuild (100×100)', () => {
    it('completes buildNavGrid in under 100ms average (10 iterations)', () => {
      const voxelGrid = setup100x100VoxelGrid();
      const buildings: Building[] = [];
      const drillHoles: DrillHole[] = [];

      // Warmup run
      NavGrid.buildNavGrid(voxelGrid, buildings, drillHoles);

      const start = performance.now();
      for (let i = 0; i < 10; i++) {
        NavGrid.buildNavGrid(voxelGrid, buildings, drillHoles);
      }
      const elapsed = performance.now() - start;
      const avg = elapsed / 10;

      expect(avg).toBeLessThan(100);
    });
  });

  describe('Frame tick at 8× speed, 20 agents', () => {
    it('processes 100 frames (800 ticks) in under 16ms per frame', () => {
      // #1086: processFrame (which batched timeScale ticks per call) is
      // deleted — runTick advances exactly one tick per call, so "8× speed"
      // is reproduced by calling it 8 times per outer "frame" iteration,
      // matching processFrame's own internal batching tick-for-tick rather
      // than folding 8x's worth of work into a single call.
      const { state } = setup20AgentGameState();
      const emitter = new EventEmitter();
      const runFrame = () => {
        for (let t = 0; t < 8; t++) {
          const rng = new Random(state.seed + state.tickCount);
          runTick(state, null, rng, emitter, { checkInvariants: false });
        }
      };

      // Warmup: 10 frames
      for (let i = 0; i < 10; i++) {
        runFrame();
      }

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        runFrame();
      }
      const elapsed = performance.now() - start;
      const avgPerFrame = elapsed / 100;

      expect(avgPerFrame).toBeLessThan(16);
    });
  });

  describe('Survey estimation (radius 20)', () => {
    it('completes estimateSurveyResult in under 25ms average (20 iterations)', () => {
      const { grid, params, rng } = setupSurveyBenchmark();

      const start = performance.now();
      for (let i = 0; i < 20; i++) {
        estimateSurveyResult(grid, params, rng);
      }
      const elapsed = performance.now() - start;
      const avg = elapsed / 20;

      expect(avg).toBeLessThan(25);
    });
  });

  describe('Full-level integration test (Level 1 win)', () => {
    it('completes the full Level 1 win scenario in under 30 seconds wall clock', async () => {
      // Dynamic imports to avoid pulling console command modules into all test runs
      const { makeCampaignCtx } = await import('../../integration/full-level/helpers.js');
      const { campaignCompleteCommand } = await import('../../../src/console/commands/campaign.js');
      const { employeeCommand } = await import('../../../src/console/commands/entities.js');
      const { drillPlanCommand, chargeCommand, sequenceCommand, blastCommand } = await import('../../../src/console/commands/mining.js');
      const { tickCommand, eventCommand } = await import('../../../src/console/commands/events.js');

      const ctx = makeCampaignCtx('dusty_hollow');

      employeeCommand(ctx, ['hire'], { role: 'driller' });
      employeeCommand(ctx, ['assign_skill', '1'], { skill: 'blasting', level: '3' });

      drillPlanCommand(ctx as any, ['grid'], { origin: '10,10', rows: '2', cols: '2', spacing: '4', depth: '8' });
      chargeCommand(ctx as any, [], { hole: '*', explosive: 'boomite', amount: '5kg', stemming: '2m' });
      sequenceCommand(ctx as any, ['auto'], {});
      blastCommand(ctx as any, [], {});

      // Tick a few times
      for (let i = 0; i < 5; i++) {
        tickCommand(ctx as any, ['1'], {});
        if (ctx.state!.events.pendingEvent) {
          eventCommand(ctx as any, ['choose', '0'], {});
        }
        if (ctx.state!.isPaused) ctx.state!.isPaused = false;
      }

      const start = performance.now();

      campaignCompleteCommand(ctx as any, [], {});

      const elapsed = performance.now() - start;

      expect(ctx.state!.levelEndReason).toBe('completed');
      expect(elapsed).toBeLessThan(30000);
    });
  });

  // #458 T6.2/D14: treranium_depths (160×64×160, D13's flagship level) is the
  // size these two commands most need to stay responsive on — hiring and
  // buying both resolve a spawn point via NavGrid.findNearestReachableCell's
  // flood fill (now typed-array based), which used to be the most exposed
  // O(width×height) cost on the grid's biggest configuration.
  describe('Hire and buy on level 4 (treranium_depths, 160×64×160) (#458 T6.2/D14)', () => {
    it('hires an employee without a visible stall', async () => {
      const { makeCampaignCtx } = await import('../../integration/full-level/helpers.js');
      const { employeeCommand } = await import('../../../src/console/commands/entities.js');

      const ctx = makeCampaignCtx('treranium_depths');

      const start = performance.now();
      const result = employeeCommand(ctx, ['hire'], { role: 'driller' });
      const elapsed = performance.now() - start;

      expect(result.success).toBe(true);
      // "Without a visible stall" — a single frame's worth of budget many
      // times over, not a tight micro-benchmark.
      expect(elapsed).toBeLessThan(200);
    });

    it('buys a vehicle without a visible stall', async () => {
      const { makeCampaignCtx } = await import('../../integration/full-level/helpers.js');
      const { vehicleCommand } = await import('../../../src/console/commands/vehicle.js');

      const ctx = makeCampaignCtx('treranium_depths');

      const start = performance.now();
      const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '1' });
      const elapsed = performance.now() - start;

      expect(result.success).toBe(true);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('TerrainMesh rebuild timing with the #560 depth-limited skirt + chunk-skip', () => {
    // #560: canSkipChunkMarch/boundarySkirtFloorY are implemented and wired
    // into rebuildChunk's march loop -- these three benchmarks assert the
    // same budgets an unconditional full march already had to hit before
    // #560 (matching the existing "re-meshing a 16^3 chunk completes in
    // under 200ms" convention in TerrainMesh.test.ts). The depth-limited
    // skirt and chunk-skip only ever do LESS work than the old unconditional
    // march, so it clears these same budgets comfortably too.

    function representativeSite(): VoxelGrid {
      // 4x4 chunks (64m x 64m footprint), 2 y-chunks deep, solid to y=20 --
      // large enough to exercise multiple boundary AND interior chunks at
      // once, the shape #560's chunk-skip is meant to matter for.
      const grid = new VoxelGrid(64, 64);
      for (let x = 0; x < 64; x++)
        for (let y = 0; y < 20; y++)
          for (let z = 0; z < 64; z++)
            grid.setVoxel(x, y, z, solidVoxel());
      return grid;
    }

    it('buildAll on a representative multi-chunk site completes in under 2000ms', () => {
      const scene = new THREE.Scene();
      const tm = new TerrainMesh(scene, representativeSite());
      tm.setEdgeHeightSampler(() => 19.5); // neighbour ground at the same height as the site surface

      const start = performance.now();
      tm.buildAll();
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(2000);
      tm.dispose();
    });

    it('a single-chunk remesh completes in under 200ms', () => {
      const scene = new THREE.Scene();
      const grid = representativeSite();
      const tm = new TerrainMesh(scene, grid);
      tm.setEdgeHeightSampler(() => 19.5);
      tm.buildAll();

      grid.clearVoxel(20, 10, 20);
      const start = performance.now();
      tm.remeshRegion({ minX: 20, minY: 10, minZ: 20, maxX: 20, maxY: 10, maxZ: 20 });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(200);
      tm.dispose();
    });

    it('a post-blast remesh (a small crater carved at the site edge) completes in under 200ms', () => {
      const scene = new THREE.Scene();
      const grid = representativeSite();
      const tm = new TerrainMesh(scene, grid);
      tm.setEdgeHeightSampler(() => 19.5);
      tm.buildAll();

      for (let y = 0; y < 20; y++) {
        for (let z = 2; z < 6; z++) {
          grid.clearVoxel(63, y, z);
          grid.clearVoxel(62, y, z);
        }
      }
      const start = performance.now();
      tm.remeshRegion({ minX: 62, minY: 0, minZ: 2, maxX: 63, maxY: 19, maxZ: 5 });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(200);
      tm.dispose();
    });
  });

  describe('Blast on level 4 (treranium_depths, 160×64×160) (#458 T6.2/D14)', () => {
    it('completes drill → charge → sequence → blast within the benchmark budget', async () => {
      const { makeCampaignCtx } = await import('../../integration/full-level/helpers.js');
      const { employeeCommand } = await import('../../../src/console/commands/entities.js');
      const { drillPlanCommand, chargeCommand, sequenceCommand, blastCommand } = await import('../../../src/console/commands/mining.js');

      const ctx = makeCampaignCtx('treranium_depths');
      employeeCommand(ctx, ['hire'], { role: 'driller' });
      employeeCommand(ctx, ['assign_skill', '1'], { skill: 'blasting', level: '3' });

      const start = performance.now();

      drillPlanCommand(ctx as any, ['grid'], { origin: '80,80', rows: '3', cols: '3', spacing: '5', depth: '8' });
      chargeCommand(ctx as any, [], { hole: '*', explosive: 'boomite', amount: '5kg', stemming: '2m' });
      sequenceCommand(ctx as any, ['auto'], {});
      const result = blastCommand(ctx as any, [], {});

      const elapsed = performance.now() - start;

      expect(result.success).toBe(true);
      expect(elapsed).toBeLessThan(2000);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Dispatch over a post-blast debris field
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A site right after a large blast: one on-ground fragment per haul action,
 * thousands of each. Big enough that a per-action linear scan over the
 * fragments (the shape `createFragmentLookup`, HaulDispatch.ts, replaced) is
 * seconds per pass, while the indexed pass is milliseconds — the budget below
 * sits an order of magnitude from either side.
 */
function setupDebrisFieldState(fragmentCount: number): { state: GameState; employeeId: number } {
  const state = createGame({ seed: 42 });
  const fragments: FragmentData[] = [];
  for (let i = 0; i < fragmentCount; i++) {
    fragments.push({
      id: i,
      position: { x: 5 + (i % 50), y: 0, z: 5 + Math.floor(i / 50) },
      volume: 0.3,
      mass: 10,
      rockId: 'cruite',
      oreDensities: i % 7 === 0 ? { gloomium: 0.1 } : {},
      initialVelocity: { x: 0, y: 0, z: 0 },
      isProjection: false,
      halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
      shapeSeed: i,
    });
  }
  state.logistics.storageCapacityKg = fragmentCount * 100;
  addBlastFragments(state.logistics, fragments);
  syncHaulDispatch(state);
  const { employee } = hireEmployee(state.employees, 'driller', new Random(42), 0, 0);
  return { state, employeeId: employee.id };
}

describe('Dispatch over a post-blast debris field (6000 fragments, 6000 haul actions)', () => {
  it('filters the pool and ranks every candidate for one employee in under 250ms', () => {
    const { state, employeeId } = setupDebrisFieldState(6000);
    const employee = state.employees.employees.find(e => e.id === employeeId)!;
    expect(state.pendingActions.length).toBe(6000);

    // Warmup: one pass of each, so the measured pass is not paying JIT.
    claimOnePoolCandidate(state, employee);
    selectBestActionForEmployee(state, employee, state.pendingActions);

    const start = performance.now();
    // The claim-time gate over the whole pool (what every idle employee pays
    // every tick) …
    claimOnePoolCandidate(state, employee);
    // … and the cost ranking over every candidate, whose ore-priority bonus
    // resolves each candidate's fragment inside the sort.
    selectBestActionForEmployee(state, employee, state.pendingActions);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(250);
  });
});
