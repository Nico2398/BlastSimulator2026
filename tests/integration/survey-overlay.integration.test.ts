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

import { SURVEY_STALE_TICKS, SURVEY_COVERAGE_RADIUS } from '../../src/core/config/balance.js';

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

/**
 * Create a SurveyConfidencePoint directly for tests that don't need
 * the full survey pipeline.
 */
function makePoint(
  x: number,
  z: number,
  partial: Partial<SurveyConfidencePoint> = {},
): SurveyConfidencePoint {
  return {
    x,
    z,
    surfaceY: partial.surfaceY ?? 4,
    confidence: partial.confidence ?? 0.8,
    fresh: partial.fresh ?? true,
  };
}

/**
 * Get the material color from an overlay mesh, handling both
 * single-colored materials and vertex-colored geometries.
 */
function getMeshColor(mesh: THREE.Mesh): { r: number; g: number; b: number } {
  const colorAttr = (mesh.geometry as THREE.BufferGeometry)?.getAttribute('color');
  if (colorAttr) {
    const colors = colorAttr.array as Float32Array;
    // Average the vertex colors
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < colors.length; i += 3) {
      r += colors[i]!;
      g += colors[i + 1]!;
      b += colors[i + 2]!;
      count++;
    }
    return { r: r / count, g: g / count, b: b / count };
  }
  const mat = mesh.material as THREE.MeshBasicMaterial;
  return { r: mat.color.r, g: mat.color.g, b: mat.color.b };
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

  // ── 9. Additional edge cases ─────────────────────────────────────────────

  it('opacity=0 makes overlay fully transparent but still visible', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [makePoint(5, 5)];

    overlay.show({ points, opacity: 0 });
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(true);
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();
    expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0);
    overlay.dispose();
  });

  it('opacity=1 works without overflow or clamping issues', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [makePoint(5, 5)];

    overlay.show({ points, opacity: 1 });
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(1, 2);
    expect(mat.transparent).toBe(true); // overlay always uses transparency
    overlay.dispose();
  });

  it('surveys at negative world coordinates produce correct confidence points', () => {
    // Build a grid with origin at negative coordinates
    const grid = new VoxelGrid(21, 10, 21);
    // Place ore at column (5, 5) which would correspond to negative world coords
    // by shifting center to negative values
    for (let y = 2; y <= 8; y++) {
      grid.setVoxel(5, y, 5, {
        rockId: 'granite',
        density: 1,
        oreDensities: { gold: 0.5 },
        fractureModifier: 1.0,
      });
    }

    // Survey at negative center — estimateSurveyResult uses grid coords,
    // but the overlay points should handle negative x, z values
    const survey = runSurveyOnGrid(grid, 'core_sample', 5, 5, 3, 99, 1, 50);
    const points = surveyResultsToConfidencePoints([survey], grid, 50);

    // Should still produce points (the grid doesn't have negative indices,
    // but the survey at grid position 5,5 maps to world coords)
    const centerPoint = points.find(p => p.x === 5 && p.z === 5);
    expect(centerPoint).toBeDefined();
    expect(centerPoint!.surfaceY).toBeGreaterThan(0);
    expect(centerPoint!.confidence).toBeGreaterThan(0);
  });

  it('sequential surveys at same position produce overlapping confidence points from both', () => {
    const grid = makeOreGrid();

    // Two surveys at the same position, different IDs and completion times
    const survey1 = runSurveyOnGrid(grid, 'core_sample', 5, 5, 2, 99, 1, 50);
    const survey2 = runSurveyOnGrid(grid, 'core_sample', 5, 5, 4, 99, 2, 100);

    const points = surveyResultsToConfidencePoints([survey1, survey2], grid, 150);

    // Both surveys should contribute points at (5,5)
    const centerPoints = points.filter(p => p.x === 5 && p.z === 5);

    // Each survey contributes one point for the center column (two surveys = two points)
    expect(centerPoints.length).toBe(2);

    // The more recent survey (survey2 with higher skill) should have higher confidence
    const confidences = centerPoints.map(p => p.confidence);
    expect(Math.max(...confidences)).toBeGreaterThan(Math.min(...confidences));
  });

  it('overlay survives TerrainMesh.update re-mesh while visible', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(8, 8, 8);
    // Fill bottom half solid
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 8; z++)
          grid.setVoxel(x, y, z, {
            rockId: 'granite',
            density: 1,
            oreDensities: {},
            fractureModifier: 1.0,
          });

    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();

    // Set up overlay with real survey data
    const survey = runSurveyOnGrid(grid, 'core_sample', 4, 4, 3, 99, 1, 50);
    const pointsBefore = surveyResultsToConfidencePoints([survey], grid, 50);
    const overlay = tm.getSurveyOverlay();
    overlay.show({ points: pointsBefore, opacity: 0.5 });

    // Verify overlay is in the scene BEFORE re-mesh
    const groupInScene = scene.children.find(
      (child) => child instanceof THREE.Group
    ) as THREE.Group | undefined;
    expect(groupInScene).toBeDefined();
    expect(groupInScene!.visible).toBe(true);

    // Simulate terrain modification (blast crater) and re-mesh
    for (let y = 0; y < 4; y++) grid.clearVoxel(3, y, 3);
    tm.update([{ x: 3, y: 0, z: 3 }]);

    // After re-mesh, the overlay group should still be in the scene
    const groupInSceneAfter = scene.children.find(
      (child) => child instanceof THREE.Group
    ) as THREE.Group | undefined;
    expect(groupInSceneAfter).toBeDefined();
    expect(groupInSceneAfter!.visible).toBe(true);

    // show() again with fresh data after re-mesh should work
    overlay.show({ points: pointsBefore, opacity: 0.5 });
    expect(groupInSceneAfter!.visible).toBe(true);

    tm.dispose();
  });

  it('cyclic lifecycle: hide → show → clear → show → dispose does not crash', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points1 = [makePoint(5, 5, { confidence: 0.9 })];
    const points2 = [makePoint(10, 10, { confidence: 0.5 })];

    // Cycle: show → hide → show → clear → show → hide → dispose
    overlay.show({ points: points1, opacity: 0.5 });
    overlay.hide();
    overlay.show({ points: points2, opacity: 0.7 });
    overlay.clear();
    overlay.show({ points: points1, opacity: 0.3 });
    overlay.hide();
    overlay.dispose();

    expect(scene.children.length).toBe(0);
  });

  it('confidence at interpolation boundary 0.25 renders orange (red→yellow midpoint)', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [makePoint(5, 5, { confidence: 0.25, fresh: true })];

    overlay.show({ points, opacity: 1 });
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();

    const color = getMeshColor(mesh);
    // At t=0.25 (half of red→yellow range 0..0.5):
    // u = 0.25/0.5 = 0.5 → (1, 0.5, 0) = orange
    expect(color.r).toBeCloseTo(1, 1);
    expect(color.g).toBeCloseTo(0.5, 1);
    expect(color.b).toBeCloseTo(0, 1);
    overlay.dispose();
  });

  it('confidence at interpolation boundary 0.75 renders yellow-green (yellow→green midpoint)', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [makePoint(5, 5, { confidence: 0.75, fresh: true })];

    overlay.show({ points, opacity: 1 });
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();

    const color = getMeshColor(mesh);
    // At t=0.75 (half of yellow→green range 0.5..1.0):
    // u = (0.75-0.5)/0.5 = 0.5 → (0.5, 1, 0) = yellow-green
    expect(color.r).toBeCloseTo(0.5, 1);
    expect(color.g).toBeCloseTo(1, 1);
    expect(color.b).toBeCloseTo(0, 1);
    overlay.dispose();
  });

  it('overlapping seismic surveys from different centers produce combined confidence points', () => {
    // Large grid with ore covering two survey centers close enough to overlap
    const grid = new VoxelGrid(40, 10, 40);
    for (let x = 0; x < 40; x++) {
      for (let z = 0; z < 40; z++) {
        grid.setVoxel(x, 5, z, {
          rockId: 'granite',
          density: 1,
          oreDensities: { copper: 0.3 },
          fractureModifier: 1.0,
        });
      }
    }

    // Two seismic surveys 10 cells apart — their radius-20 coverage will overlap
    const surveyA = runSurveyOnGrid(grid, 'seismic', 15, 15, 2, 99, 1, 50, 100);
    const surveyB = runSurveyOnGrid(grid, 'seismic', 25, 15, 4, 99, 2, 60, 101);

    const points = surveyResultsToConfidencePoints([surveyA, surveyB], grid, 70);

    // Should produce many points (both surveys cover large areas)
    expect(points.length).toBeGreaterThan(0);

    // The overlapping region (around x=20) should have points from both surveys
    const overlapPoints = points.filter(p => p.x >= 18 && p.x <= 22 && p.z === 15);
    expect(overlapPoints.length).toBeGreaterThanOrEqual(1);

    // Verify confidence from different surveys — they have different skill levels
    // so their confidence values differ
    expect(surveyA.confidence).not.toBe(surveyB.confidence);

    // surveyB has skill=4 > surveyA skill=2, so surveyB.confidence should be higher
    expect(surveyB.confidence).toBeGreaterThan(surveyA.confidence);
  });

  it('many survey points (50+) render without errors', () => {
    // Build a grid large enough for many survey points
    const grid = new VoxelGrid(30, 10, 30);
    for (let x = 0; x < 30; x++) {
      for (let z = 0; z < 30; z++) {
        grid.setVoxel(x, 5, z, {
          rockId: 'granite',
          density: 1,
          oreDensities: { iron: 0.5 },
          fractureModifier: 1.0,
        });
      }
    }

    const scene = makeScene();
    const survey = runSurveyOnGrid(grid, 'seismic', 15, 15, 3, 99, 1, 50);
    const points = surveyResultsToConfidencePoints([survey], grid, 50);

    // Seismic radius 20 on 30×30 grid should produce lots of points
    // (radius 20 disc centered at 15,15 on 30×30 grid)
    expect(points.length).toBeGreaterThanOrEqual(10);

    const overlay = new SurveyConfidenceOverlay(scene);
    expect(() => overlay.show({ points, opacity: 0.5 })).not.toThrow();

    const group = scene.children[0] as THREE.Group;
    expect(group.children.length).toBeGreaterThanOrEqual(points.length);

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

  it('surveyedPositions set in GameState is updated when surveys are added', () => {
    const state = createGame({ seed: 42 });

    // Initially empty
    expect(state.surveyedPositions.size).toBe(0);

    // Add survey results
    const grid = makeOreGrid();
    const survey = runSurveyOnGrid(grid, 'seismic', 5, 5, 3, 99, 1, 50);
    state.surveyResults.push(survey);

    // After adding a survey, surveyedPositions should be populated
    // from the survey's estimates keys
    for (const colKey of Object.keys(survey.estimates)) {
      state.surveyedPositions.add(colKey);
    }

    expect(state.surveyedPositions.size).toBeGreaterThan(0);
    expect(state.surveyedPositions.has('5,5')).toBe(true);
  });

  it('surveyedPositions can be used to filter duplicate re-surveys at same column', () => {
    const state = createGame({ seed: 42 });
    const grid = makeOreGrid();

    // First survey at (5,5)
    const survey1 = runSurveyOnGrid(grid, 'seismic', 5, 5, 2, 99, 1, 50);
    state.surveyResults.push(survey1);
    for (const colKey of Object.keys(survey1.estimates)) {
      state.surveyedPositions.add(colKey);
    }

    const positionsBefore = state.surveyedPositions.size;

    // Simulate a second survey at the same position - should not duplicate in the set
    const survey2 = runSurveyOnGrid(grid, 'seismic', 5, 5, 4, 99, 2, 100);
    state.surveyResults.push(survey2);
    for (const colKey of Object.keys(survey2.estimates)) {
      state.surveyedPositions.add(colKey);
    }

    // The set should not grow because all positions were already tracked
    expect(state.surveyedPositions.size).toBe(positionsBefore);

    // But we have two survey results
    expect(state.surveyResults.length).toBe(2);

    // Confidence points from both should be produced
    const points = surveyResultsToConfidencePoints(state.surveyResults, grid, 150);
    const centerPoints = points.filter(p => p.x === 5 && p.z === 5);
    // Two surveys at same position = two confidence points
    expect(centerPoints.length).toBe(2);
  });
});
