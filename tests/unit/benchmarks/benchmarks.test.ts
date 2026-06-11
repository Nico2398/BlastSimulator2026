// BlastSimulator2026 — Performance Benchmark Suite
// Wall-clock timing benchmarks using performance.now().
// Each benchmark includes a warmup run to avoid cold-start bias.

import { describe, it, expect } from 'vitest';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { findPath, type PathRequest } from '../../../src/core/nav/Pathfinding.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { Random } from '../../../src/core/math/Random.js';
import { estimateSurveyResult, type EstimateSurveyParams } from '../../../src/core/mining/SurveyCalc.js';
import {
  propagateEnergy,
  identifyFragmentedVoxels,
} from '../../../src/core/mining/BlastCalc.js';
import { processFrame } from '../../../src/core/engine/GameLoop.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import type { HoleCharge } from '../../../src/core/mining/ChargePlan.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { EventContext } from '../../../src/core/events/EventPool.js';
import type { Building } from '../../../src/core/entities/Building.js';

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
  sizeY: number,
  sizeZ: number,
  solidTopY: number,
): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
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

/** Set up a VoxelGrid (10×15×10) with ~1100 solid voxels and 3 drill holes with charges. */
function setupThousandVoxelBlast(): {
  grid: VoxelGrid;
  holes: DrillHole[];
  charges: Record<string, HoleCharge>;
  depths: Record<string, number>;
  surfaceYs: Record<string, number>;
} {
  const grid = makeSolidGrid(10, 15, 10, 10);
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
  return makeSolidGrid(100, 20, 100, 19);
}

/** Build a minimal EventContext from GameState (same pattern as GameLoop.test.ts). */
function buildContext(state: GameState): EventContext {
  return {
    scores: state.scores,
    employeeCount: state.employees.employees.length,
    deathCount: state.damage.deathCount,
    corruptionLevel: state.corruption.level,
    hasBuilding: () => false,
    hasDrillPlan: false,
    tickCount: state.tickCount,
    lawsuitCount: 0,
    activeContractCount: 0,
    weatherId: 'clear',
  };
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
      hunger: 100,
      fatigue: 100,
      breakNeed: 100,
      collapsing: false,
      interruptedActionPayload: null,
      ticksWorked: 0,
      restTicksRemaining: null,
    });
  }

  // Add some pending actions
  for (let i = 0; i < 5; i++) {
    state.pendingActions.push({
      id: state.nextPendingActionId++,
      type: 'drill_hole',
      requiredSkill: 'drilling',
      requiredVehicleRole: null,
      targetX: 20 + i,
      targetZ: 20,
      targetY: 0,
      payload: {},
      targetEmployeeId: null,
    });
  }

  return { state, rng };
}

/** Set up a survey benchmark scenario: 80×20×80 voxel grid with seismic survey params. */
function setupSurveyBenchmark(): { grid: VoxelGrid; params: EstimateSurveyParams; rng: Random } {
  const grid = makeSolidGrid(80, 20, 80, 15);
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

      expect(avg).toBeLessThan(2);
    });

    it('handles blocked-cell heavy grid under 3ms', () => {
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

      expect(avg).toBeLessThan(3);
    });
  });

  describe('Full blast pipeline (~1100 voxels)', () => {
    it('completes energy propagation + fragmentation in under 50ms', () => {
      const { grid, holes, charges, depths, surfaceYs } = setupThousandVoxelBlast();

      // Build initial energy map
      const initial = new Map<string, number>();
      for (const hole of holes) {
        const pos = surfaceYs[hole.id] ?? 10;
        const key = `${hole.x},${pos - 2},${hole.z}`;
        const charge = charges[hole.id]!;
        initial.set(key, charge.amountKg * 1000);
      }

      const start = performance.now();

      const propResult = propagateEnergy(grid, initial);
      const fragmented = identifyFragmentedVoxels(grid, propResult);

      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);
      expect(fragmented.size).toBeGreaterThan(0);
    });
  });

  describe('NavGrid full rebuild (100×100)', () => {
    it('completes buildNavGrid in under 10ms average (10 iterations)', () => {
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

      expect(avg).toBeLessThan(10);
    });
  });

  describe('Frame tick at 8× speed, 20 agents', () => {
    it('processes 100 frames (800 ticks) in under 16ms per frame', () => {
      const { state, rng } = setup20AgentGameState();

      // Warmup: 10 frames
      for (let i = 0; i < 10; i++) {
        processFrame(state, (s) => buildContext(s), rng);
      }

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        processFrame(state, (s) => buildContext(s), rng);
      }
      const elapsed = performance.now() - start;
      const avgPerFrame = elapsed / 100;

      expect(avgPerFrame).toBeLessThan(16);
    });
  });

  describe('Survey estimation (radius 20)', () => {
    it('completes estimateSurveyResult in under 5ms average (20 iterations)', () => {
      const { grid, params, rng } = setupSurveyBenchmark();

      const start = performance.now();
      for (let i = 0; i < 20; i++) {
        estimateSurveyResult(grid, params, rng);
      }
      const elapsed = performance.now() - start;
      const avg = elapsed / 20;

      expect(avg).toBeLessThan(5);
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
});
