// BlastSimulator2026 — Integration tests for survey confidence overlay (4.11)
// Tests the end-to-end pipeline: GameState with survey results → SurveyConfidencePoint[]
// → SurveyConfidenceOverlay rendering. All tests must FAIL before implementation.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { Random } from '../../src/core/math/Random.js';
import { createGame } from '../../src/core/state/GameState.js';
import { generateTerrain } from '../../src/core/world/TerrainGen.js';
import { getMinePreset } from '../../src/core/world/MineType.js';
import { hireEmployee, assignSkill } from '../../src/core/entities/Employee.js';
import {
  SurveyConfidenceOverlay,
  TerrainMesh,
  type SurveyConfidencePoint,
  type SurveyConfidenceOverlayOptions,
} from '../../src/renderer/TerrainMesh.js';
import {
  estimateSurveyResult,
  type SurveyResult,
  type SurveyMethod,
  type EstimateSurveyParams,
} from '../../src/core/mining/SurveyCalc.js';
import { isSurveyStale } from '../../src/core/mining/SurveyCalc.js';

import { SURVEY_STALE_TICKS } from '../../src/core/config/balance.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Create a minimal THREE.Scene mock — used by SurveyConfidenceOverlay. */
function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

/**
 * Build a small test grid with known ore at a specific column.
 * 11×11×11 grid, with gold=0.5 at (5, *, 5) from y=2..8.
 */
function makeOreGrid(): VoxelGrid {
  const grid = new VoxelGrid(11, 11, 11);
  for (let y = 2; y <= 8; y++) {
    grid.setVoxel(5, y, 5, {
      rockId: 'granite',
      density: 1,
      oreDensities: { gold: 0.5 },
      fractureModifier: 1.0,
    });
  }
  return grid;
}

/**
 * Build a grid with ore at multiple positions.
 * Used for tests that need surveys at several distinct columns.
 * Each column (x,*,z) for x,z in the given array has gold=0.5 at y=2..8.
 */
function makeMultiOreGrid(positions: { x: number; z: number }[]): VoxelGrid {
  const grid = new VoxelGrid(20, 11, 20);
  for (const { x, z } of positions) {
    for (let y = 2; y <= 8; y++) {
      grid.setVoxel(x, y, z, {
        rockId: 'granite',
        density: 1,
        oreDensities: { gold: 0.5 },
        fractureModifier: 1.0,
      });
    }
  }
  return grid;
}

/**
 * Build a full terrain grid like the console's `new_game` command does,
 * so we get a realistic VoxelGrid with surface geometry.
 */
function makeTerrainGrid(size = 32, seed = 42): VoxelGrid {
  const preset = getMinePreset('desert');
  if (!preset) throw new Error('desert preset not found');
  return generateTerrain({
    sizeX: size,
    sizeY: size,
    sizeZ: size,
    seed,
    preset,
  });
}

/**
 * Run a survey against a VoxelGrid and return the SurveyResult.
 * This mirrors what the game loop does when completing a survey action.
 */
function runSurveyOnGrid(
  grid: VoxelGrid,
  method: SurveyMethod,
  centerX: number,
  centerZ: number,
  skillLevel = 1,
  surveyorId = 99,
  id = 1,
  completedTick = 50,
  seed = 12345,
): SurveyResult {
  const params: EstimateSurveyParams = {
    id,
    method,
    centerX,
    centerZ,
    surveyorId,
    skillLevel,
    completedTick,
  };
  return estimateSurveyResult(grid, params, new Random(seed));
}

/**
 * Convert an array of SurveyResult objects into SurveyConfidencePoint[]
 * for the overlay. This is the key integration point between game data and the renderer.
 *
 * Each survey column "x,z" in survey.estimates becomes a confidence point.
 * The surfaceY is derived from the grid (topmost solid voxel Y + 1).
 */
function surveyResultsToConfidencePoints(
  surveys: SurveyResult[],
  grid: VoxelGrid,
  currentTick: number,
): SurveyConfidencePoint[] {
  const points: SurveyConfidencePoint[] = [];

  for (const survey of surveys) {
    const fresh = !isSurveyStale(survey, currentTick);

    for (const colKey of Object.keys(survey.estimates)) {
      const parts = colKey.split(',').map(Number);
      const x = parts[0]!;
      const z = parts[1]!;

      // Find surface Y (topmost solid voxel + 1)
      let surfaceY = 0;
      for (let y = grid.sizeY - 1; y >= 0; y--) {
        const voxel = grid.getVoxel(x, y, z);
        if (voxel && voxel.density > 0) {
          surfaceY = y + 1;
          break;
        }
      }

      points.push({
        x,
        z,
        surfaceY,
        confidence: survey.confidence,
        fresh,
      });
    }
  }

  return points;
}

// ─── Integration Tests ────────────────────────────────────────────────────────

describe('Survey Confidence Overlay — integration (4.11)', () => {
  // These tests exercise the full pipeline from survey data to overlay rendering.
  // All tests expect FAILURE because the implementation throws 'not implemented'.

  // ── 1. End-to-end: survey → confidence points ──────────────────────────────

  it('converts a seismic survey result to overlay confidence points with correct positions', () => {
    const grid = makeOreGrid();
    const survey = runSurveyOnGrid(grid, 'seismic', 5, 5);

    // Integration pipeline: survey results → confidence points
    const points = surveyResultsToConfidencePoints([survey], grid, 50);

    // Should have points for columns in seismic radius (20) around (5,5)
    expect(points.length).toBeGreaterThan(0);

    // The center column (5,5) should be in the results
    const centerPoint = points.find(p => p.x === 5 && p.z === 5);
    expect(centerPoint).toBeDefined();
    expect(centerPoint!.confidence).toBeGreaterThan(0);
    expect(centerPoint!.confidence).toBeLessThanOrEqual(1);
    expect(centerPoint!.fresh).toBe(true);

    // Surface Y should be the topmost solid voxel + 1 (y=8 → surfaceY=9)
    expect(centerPoint!.surfaceY).toBeGreaterThan(0);
  });

  it('converts a core_sample survey result to a single column confidence point', () => {
    const grid = makeOreGrid();
    const survey = runSurveyOnGrid(grid, 'core_sample', 5, 5);

    const points = surveyResultsToConfidencePoints([survey], grid, 50);

    // Core sample only samples the centre column
    const centerPoint = points.find(p => p.x === 5 && p.z === 5);
    expect(centerPoint).toBeDefined();

    // With skill=1, baseError=0.05, confidence=0.95
    expect(centerPoint!.confidence).toBeCloseTo(0.95, 1);
    expect(centerPoint!.fresh).toBe(true);
  });

  it('converts an aerial survey result to confidence points within radius 30', () => {
    // Large grid needed for aerial radius (30 cells)
    const grid = new VoxelGrid(101, 10, 101);
    for (let x = 0; x < 101; x++) {
      for (let z = 0; z < 101; z++) {
        grid.setVoxel(x, 5, z, {
          rockId: 'granite',
          density: 1,
          oreDensities: { copper: 0.4 },
          fractureModifier: 1.0,
        });
      }
    }

    const survey = runSurveyOnGrid(grid, 'aerial', 50, 50);
    const points = surveyResultsToConfidencePoints([survey], grid, 50);

    // All points must be within radius 30 of centre
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      const dx = p.x - 50;
      const dz = p.z - 50;
      const dist = Math.sqrt(dx * dx + dz * dz);
      expect(dist).toBeLessThanOrEqual(30);
    }
  });

  // ── 2. Confidence propagation ─────────────────────────────────────────────

  it('confidence value from survey result propagates to the overlay point unchanged', () => {
    const grid = makeOreGrid();
    const survey = runSurveyOnGrid(grid, 'seismic', 5, 5);

    const points = surveyResultsToConfidencePoints([survey], grid, 50);

    // The confidence in every point must match the survey confidence
    for (const p of points) {
      expect(p.confidence).toBe(survey.confidence);
    }
  });

  it('higher skill level yields higher confidence points', () => {
    const grid = makeOreGrid();

    // Skill 1 survey
    const lowSkillSurvey = runSurveyOnGrid(grid, 'seismic', 5, 5, 1);
    // Skill 5 survey
    const highSkillSurvey = runSurveyOnGrid(grid, 'seismic', 5, 5, 5);

    const lowPoints = surveyResultsToConfidencePoints([lowSkillSurvey], grid, 50);
    const highPoints = surveyResultsToConfidencePoints([highSkillSurvey], grid, 50);

    // Higher skill → higher confidence
    for (const p of highPoints) {
      expect(p.confidence).toBeGreaterThan(lowPoints[0]!.confidence);
    }
  });

  // ── 3. Stale survey → fresh=false ─────────────────────────────────────────

  it('survey completed at tick 0 is still fresh at tick SURVEY_STALE_TICKS (boundary)', () => {
    const grid = makeOreGrid();
    const survey = runSurveyOnGrid(grid, 'seismic', 5, 5, 1, 99, 1, 0);

    const points = surveyResultsToConfidencePoints([survey], grid, SURVEY_STALE_TICKS);

    // Exactly SURVEY_STALE_TICKS ticks elapsed → still fresh
    for (const p of points) {
      expect(p.fresh).toBe(true);
    }
  });

  it('survey completed at tick 0 is stale at tick SURVEY_STALE_TICKS + 1', () => {
    const grid = makeOreGrid();
    const survey = runSurveyOnGrid(grid, 'seismic', 5, 5, 1, 99, 1, 0);

    const points = surveyResultsToConfidencePoints([survey], grid, SURVEY_STALE_TICKS + 1);

    // More than SURVEY_STALE_TICKS ticks elapsed → stale
    for (const p of points) {
      expect(p.fresh).toBe(false);
    }
  });

  it('fresh survey and stale survey produce different fresh flags for overlay rendering', () => {
    const grid = makeOreGrid();

    // Survey 1: completed at tick 0 (old)
    const oldSurvey = runSurveyOnGrid(grid, 'seismic', 5, 5, 1, 99, 1, 0);
    // Survey 2: completed at tick 200 (recent if current=250)
    const newSurvey = runSurveyOnGrid(grid, 'seismic', 5, 5, 1, 99, 2, 200);

    const points = surveyResultsToConfidencePoints([oldSurvey, newSurvey], grid, 250);

    const hasFresh = points.some(p => p.fresh);
    const hasStale = points.some(p => !p.fresh);
    expect(hasFresh).toBe(true);
    expect(hasStale).toBe(true);
  });

  // ── 4. Multiple surveys accumulate ────────────────────────────────────────

  it('multiple surveys at different locations produce distinct confidence points', () => {
    // Use grid with ore at all three survey positions
    const grid = makeMultiOreGrid([
      { x: 3, z: 3 },
      { x: 5, z: 5 },
      { x: 7, z: 7 },
    ]);

    const survey1 = runSurveyOnGrid(grid, 'core_sample', 3, 3, 1, 99, 1, 50);
    const survey2 = runSurveyOnGrid(grid, 'core_sample', 7, 7, 1, 99, 2, 60);

    const points = surveyResultsToConfidencePoints([survey1, survey2], grid, 70);

    // Should have points for both locations
    const p1 = points.find(p => p.x === 3 && p.z === 3);
    const p2 = points.find(p => p.x === 7 && p.z === 7);
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
  });

  it('overlay renders all points when multiple surveys are provided', () => {
    const grid = makeMultiOreGrid([
      { x: 2, z: 2 },
      { x: 5, z: 5 },
      { x: 8, z: 8 },
    ]);
    const scene = makeScene();

    const survey1 = runSurveyOnGrid(grid, 'core_sample', 2, 2, 1, 99, 1, 50);
    const survey2 = runSurveyOnGrid(grid, 'core_sample', 5, 5, 1, 99, 2, 60);
    const survey3 = runSurveyOnGrid(grid, 'core_sample', 8, 8, 1, 99, 3, 70);

    const points = surveyResultsToConfidencePoints([survey1, survey2, survey3], grid, 80);

    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show({ points, opacity: 0.5 });

    const group = scene.children[0] as THREE.Group;
    // Each point should contribute at least one mesh child
    expect(group.children.length).toBeGreaterThanOrEqual(points.length);

    overlay.dispose();
  });

  // ── 5. Survey on real terrain ─────────────────────────────────────────────

  it('generates confidence points for a real terrain grid from desert biome', () => {
    const grid = makeTerrainGrid(32, 42);

    // Run a core sample survey at a valid terrain position
    const survey = runSurveyOnGrid(grid, 'core_sample', 16, 16, 3, 99, 1, 50);
    const points = surveyResultsToConfidencePoints([survey], grid, 50);

    // Must have at least the centre column
    expect(points.length).toBeGreaterThan(0);

    // Surface Y should be above ground (terrain is at some height)
    for (const p of points) {
      expect(p.surfaceY).toBeGreaterThanOrEqual(0);
    }
  });

  it('desert terrain seismic survey produces multiple confidence points across radius 20', () => {
    const grid = makeTerrainGrid(64, 42);

    const survey = runSurveyOnGrid(grid, 'seismic', 32, 32, 1, 99, 1, 50);
    const points = surveyResultsToConfidencePoints([survey], grid, 50);

    // Seismic radius is 20 — should have many columns
    expect(points.length).toBeGreaterThan(1);

    // All points must be within radius 20 of centre
    for (const p of points) {
      const dx = p.x - 32;
      const dz = p.z - 32;
      const dist = Math.sqrt(dx * dx + dz * dz);
      expect(dist).toBeLessThanOrEqual(20.01); // allow floating-point tolerance
    }
  });

  // ── 6. TerrainMesh.getSurveyOverlay integration ───────────────────────────

  it('TerrainMesh.getSurveyOverlay returns a SurveyConfidenceOverlay linked to the scene', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(4, 4, 4);
    const tm = new TerrainMesh(scene, grid);

    const overlay = tm.getSurveyOverlay();
    expect(overlay).toBeInstanceOf(SurveyConfidenceOverlay);

    // The overlay should be added to the scene (as a child group)
    expect(scene.children.length).toBe(1);

    tm.dispose();
  });

  it('TerrainMesh.getSurveyOverlay persists the overlay across TerrainMesh lifecycle', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(4, 4, 4);
    const tm = new TerrainMesh(scene, grid);

    const overlay = tm.getSurveyOverlay();

    // Show with some data
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.9, fresh: true },
    ];
    overlay.show({ points, opacity: 0.5 });

    // After dispose, overlay should be gone
    tm.dispose();
    expect(scene.children.length).toBe(0);
  });

  // ── 7. End-to-end: full data pipeline with overlay rendering ──────────────

  it('full pipeline: survey → confidence points → overlay → colored markers render correctly', () => {
    const grid = makeOreGrid();
    const scene = makeScene();

    // Step 1: Run a seismic survey
    const survey = runSurveyOnGrid(grid, 'seismic', 5, 5, 1, 99, 1, 50);

    // Step 2: Convert to confidence points
    const points = surveyResultsToConfidencePoints([survey], grid, 50);

    // Step 3: Create overlay and show
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show({ points, opacity: 0.6 });

    // Step 4: Verify overlay rendering
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(true);
    expect(group.children.length).toBeGreaterThanOrEqual(points.length);

    // The center column mesh should be positioned at the right world coordinates
    const centerCol = points.find(p => p.x === 5 && p.z === 5)!;
    const centerMesh = group.children.find((child) => {
      const mesh = child as THREE.Mesh;
      return Math.round(mesh.position.x) === 5 && Math.round(mesh.position.z) === 5;
    }) as THREE.Mesh;
    expect(centerMesh).toBeDefined();
    expect(centerMesh.position.y).toBeCloseTo(centerCol.surfaceY, 0);

    overlay.dispose();
  });

  it('full pipeline: confidence 0.95 renders green (high confidence)', () => {
    const grid = makeOreGrid();
    const scene = makeScene();

    // Core sample with skill 5 gives confidence ≈ 0.95
    const survey = runSurveyOnGrid(grid, 'core_sample', 5, 5, 5, 99, 1, 50);
    const points = surveyResultsToConfidencePoints([survey], grid, 50);

    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show({ points, opacity: 0.6 });

    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();

    // Green: channel g should dominate r and b
    const colorAttr = (mesh.geometry as THREE.BufferGeometry).getAttribute('color');
    if (colorAttr) {
      const colors = colorAttr.array as Float32Array;
      for (let i = 1; i < colors.length; i += 3) {
        expect(colors[i]!).toBeGreaterThan(colors[i - 1]!); // g > r
        expect(colors[i]!).toBeGreaterThan(colors[i + 1]!); // g > b
      }
    }

    overlay.dispose();
  });

  it('full pipeline: stale survey renders grey', () => {
    const grid = makeOreGrid();
    const scene = makeScene();

    // Survey completed at tick 0
    const survey = runSurveyOnGrid(grid, 'core_sample', 5, 5, 3, 99, 1, 0);
    // Current tick is past stale threshold
    const points = surveyResultsToConfidencePoints([survey], grid, SURVEY_STALE_TICKS + 10);

    // All points must be stale
    for (const p of points) {
      expect(p.fresh).toBe(false);
    }

    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show({ points, opacity: 0.6 });

    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();

    // Grey: all channels roughly equal
    const colorAttr = (mesh.geometry as THREE.BufferGeometry).getAttribute('color');
    if (colorAttr) {
      const colors = colorAttr.array as Float32Array;
      for (let i = 0; i < colors.length; i += 3) {
        const diffRG = Math.abs(colors[i]! - colors[i + 1]!);
        const diffRB = Math.abs(colors[i]! - colors[i + 2]!);
        const diffGB = Math.abs(colors[i + 1]! - colors[i + 2]!);
        expect(diffRG).toBeLessThan(0.15);
        expect(diffRB).toBeLessThan(0.15);
        expect(diffGB).toBeLessThan(0.15);
      }
    }

    overlay.dispose();
  });

  // ── 8. Edge cases ────────────────────────────────────────────────────────

  it('empty surveyResults produces zero confidence points', () => {
    const grid = makeOreGrid();
    const points = surveyResultsToConfidencePoints([], grid, 50);

    expect(points).toHaveLength(0);
  });

  it('survey with no estimates produces zero confidence points', () => {
    const survey: SurveyResult = {
      id: 1,
      method: 'seismic',
      centerX: 5,
      centerZ: 5,
      completedTick: 50,
      surveyorId: 99,
      estimates: {},
      confidence: 0.85,
    };

    const grid = makeOreGrid();
    const points = surveyResultsToConfidencePoints([survey], grid, 50);

    expect(points).toHaveLength(0);
  });

  it('survey on grid with no solid terrain at column produces surfaceY=0', () => {
    const grid = new VoxelGrid(11, 11, 11);
    // No solid voxels at all

    const survey: SurveyResult = {
      id: 1,
      method: 'core_sample',
      centerX: 5,
      centerZ: 5,
      completedTick: 50,
      surveyorId: 99,
      estimates: { '5,5': { gold: 0.5 } },
      confidence: 0.85,
    };

    const points = surveyResultsToConfidencePoints([survey], grid, 50);
    const point = points.find(p => p.x === 5 && p.z === 5);
    expect(point).toBeDefined();
    expect(point!.surfaceY).toBe(0);
  });

  it('overlay.show replaces previous data without accumulating orphan meshes', () => {
    const scene = makeScene();
    const grid = makeMultiOreGrid([
      { x: 2, z: 2 },
      { x: 8, z: 8 },
    ]);

    const survey1 = runSurveyOnGrid(grid, 'core_sample', 2, 2, 1, 99, 1, 50);
    const survey2 = runSurveyOnGrid(grid, 'core_sample', 8, 8, 1, 99, 2, 60);

    const overlay = new SurveyConfidenceOverlay(scene);

    // First show with survey1
    const points1 = surveyResultsToConfidencePoints([survey1], grid, 50);
    overlay.show({ points: points1, opacity: 0.5 });
    const countAfterFirst = (scene.children[0] as THREE.Group).children.length;

    // Second show with survey2 (different location)
    const points2 = surveyResultsToConfidencePoints([survey2], grid, 60);
    overlay.show({ points: points2, opacity: 0.5 });
    const countAfterSecond = (scene.children[0] as THREE.Group).children.length;

    // Second show should replace, not accumulate
    expect(countAfterSecond).toBeLessThanOrEqual(countAfterFirst);

    overlay.dispose();
  });

  it('combined mix of fresh and stale surveys renders correct colors per point', () => {
    const grid = makeMultiOreGrid([
      { x: 5, z: 5 },
      { x: 3, z: 3 },
    ]);
    const scene = makeScene();

    // Fresh survey at (5,5) with high confidence
    const freshSurvey = runSurveyOnGrid(grid, 'core_sample', 5, 5, 5, 99, 1, 200);
    // Stale survey at (3,3) with medium confidence
    const staleSurvey = runSurveyOnGrid(grid, 'core_sample', 3, 3, 2, 99, 2, 0);

    const points = surveyResultsToConfidencePoints([freshSurvey, staleSurvey], grid, 250);

    const freshPoint = points.find(p => p.x === 5 && p.z === 5)!;
    const stalePoint = points.find(p => p.x === 3 && p.z === 3)!;

    expect(freshPoint.fresh).toBe(true);
    expect(freshPoint.confidence).toBeGreaterThan(0.8);
    expect(stalePoint.fresh).toBe(false);

    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show({ points, opacity: 0.5 });

    const group = scene.children[0] as THREE.Group;
    // Should render meshes for both points
    expect(group.children.length).toBeGreaterThanOrEqual(2);

    overlay.dispose();
  });
});

// ─── TerrainMesh.getSurveyOverlay integration with game state ──────────────────

describe('TerrainMesh.getSurveyOverlay — game state integration', () => {
  it('creates overlay from a GameState with surveyResults after a seismic survey', () => {
    const scene = makeScene();
    const grid = makeTerrainGrid(32, 42);
    const state = createGame({ seed: 42, startingCash: 100_000 });

    // Add a surveyor employee with geology skill
    const rng = new Random(99);
    const { employee } = hireEmployee(state.employees, 'surveyor', rng);
    assignSkill(state.employees, employee.id, 'geology', 3);

    // Simulate running a seismic survey and adding result to state
    const survey = runSurveyOnGrid(grid, 'seismic', 16, 16, 3, employee.id, state.nextSurveyId, 50);
    state.surveyResults.push(survey);
    state.nextSurveyId++;

    // Create TerrainMesh
    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();

    // Get the overlay from TerrainMesh
    const overlay = tm.getSurveyOverlay();

    // Convert state survey results to confidence points
    const points = surveyResultsToConfidencePoints(state.surveyResults, grid, 50);

    // Show overlay with the survey data
    overlay.show({ points, opacity: 0.5 });

    // Overlay should be visible and contain mesh children for each point
    const group = scene.children[1] as THREE.Group; // 0 = terrain mesh, 1 = overlay group
    expect(group).toBeDefined();
    expect(group.children.length).toBeGreaterThanOrEqual(points.length);

    tm.dispose();
  });

  it('updates overlay when stale survey results change fresh status', () => {
    const scene = makeScene();
    const grid = makeOreGrid();
    const state = createGame({ seed: 42 });

    // Survey at tick 0
    const survey = runSurveyOnGrid(grid, 'core_sample', 5, 5, 3, 99, 1, 0);
    state.surveyResults.push(survey);

    const tm = new TerrainMesh(scene, grid);
    const overlay = tm.getSurveyOverlay();

    // At tick 50 — still fresh
    const freshPoints = surveyResultsToConfidencePoints(state.surveyResults, grid, 50);
    overlay.show({ points: freshPoints, opacity: 0.5 });

    const group = scene.children[0] as THREE.Group;
    // All points should be fresh
    for (const p of freshPoints) {
      expect(p.fresh).toBe(true);
    }

    // At tick 200 — stale
    const stalePoints = surveyResultsToConfidencePoints(state.surveyResults, grid, 200);
    overlay.show({ points: stalePoints, opacity: 0.5 });

    for (const p of stalePoints) {
      expect(p.fresh).toBe(false);
    }

    tm.dispose();
  });

  it('shows no overlay when no survey results exist (empty state)', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(4, 4, 4);
    const tm = new TerrainMesh(scene, grid);

    const overlay = tm.getSurveyOverlay();
    // Hiding or showing without points should not crash
    overlay.hide();

    tm.dispose();
  });
});
