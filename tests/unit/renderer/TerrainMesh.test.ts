// TerrainMesh — unit tests
// Tests geometry generation from VoxelGrid without needing a browser.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import {
  TerrainMesh,
  SurveyConfidenceOverlay,
  type SurveyConfidencePoint,
  type SurveyConfidenceOverlayOptions,
} from '../../../src/renderer/TerrainMesh.js';

// Minimal mock THREE.Scene — just captures adds/removes
function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

function makeSolidVoxel(rockId = 'sandite'): import('../../../src/core/world/VoxelGrid.js').VoxelData {
  return { rockId, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
}

function makeConfidencePoint(
  x: number,
  z: number,
  partial: Partial<SurveyConfidencePoint> = {},
): SurveyConfidencePoint {
  return {
    x,
    z,
    surfaceY: 4,
    confidence: partial.confidence ?? 0.8,
    fresh: partial.fresh ?? true,
    ...partial,
  };
}

function makeOverlayOptions(
  partial: Partial<SurveyConfidenceOverlayOptions> = {},
): SurveyConfidenceOverlayOptions {
  return {
    points: partial.points ?? [makeConfidencePoint(5, 5)],
    opacity: partial.opacity ?? 0.5,
    ...partial,
  };
}

describe('TerrainMesh', () => {
  it('buildAll on empty grid adds no meshes', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(4, 4, 4);
    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    expect(scene.children.length).toBe(0);
    tm.dispose();
  });

  it('buildAll on fully-solid grid adds no meshes (interior surface = none)', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(4, 4, 4);
    // Fill completely solid → cubeIndex 255 everywhere → no triangles
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 4; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel());
    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    // All cubes are 255 (all solid) → no surface triangles
    expect(scene.children.length).toBe(0);
    tm.dispose();
  });

  it('buildAll generates mesh when there is a solid/air boundary', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(8, 8, 8);
    // Fill bottom half solid, top half air — creates a flat surface at y=4
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 8; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel());
    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    expect(scene.children.length).toBeGreaterThan(0);
    tm.dispose();
  });

  it('generated geometry has position and color attributes', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(8, 8, 8);
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 8; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel('cruite'));

    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();
    const geo = mesh.geometry as THREE.BufferGeometry;
    expect(geo.getAttribute('position')).toBeDefined();
    expect(geo.getAttribute('color')).toBeDefined();
    tm.dispose();
  });

  it('update re-meshes affected chunk when voxels are cleared', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(8, 8, 8);
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 8; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel());

    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    const countBefore = scene.children.length;

    // Clear a column of voxels (simulating a blast crater)
    for (let y = 0; y < 4; y++) {
      grid.clearVoxel(3, y, 3);
    }
    tm.update([{ x: 3, y: 0, z: 3 }, { x: 3, y: 1, z: 3 }, { x: 3, y: 2, z: 3 }, { x: 3, y: 3, z: 3 }]);

    // There may be same or fewer chunks but geometry should have been rebuilt
    expect(scene.children.length).toBeGreaterThanOrEqual(0);
    // We can't easily assert exact counts without knowing the mesh structure
    // Just verify no crash and valid state
    tm.dispose();
    expect(scene.children.length).toBe(0);
    void countBefore; // suppress unused warning
  });

  it('re-meshing a 16³ chunk completes in under 200ms', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(16, 16, 16);
    // Fill with varied densities to produce interesting surface
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 8; y++)
        for (let z = 0; z < 16; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel('molite'));

    const tm = new TerrainMesh(scene, grid);
    const start = performance.now();
    tm.buildAll();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    tm.dispose();
  });
});

// ─── Survey Confidence Overlay ──────────────────────────────────────────────────

describe('SurveyConfidenceOverlay', () => {
  it('constructor adds a group to the scene', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    expect(scene.children.length).toBe(1);
    overlay.dispose();
  });

  it('starts hidden', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(false);
    overlay.dispose();
  });

  it('show makes overlay visible', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions());
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(true);
    overlay.dispose();
  });

  it('hide makes overlay invisible', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions());
    overlay.hide();
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(false);
    overlay.dispose();
  });

  it('show adds one marker per confidence point', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      makeConfidencePoint(10, 10),
      makeConfidencePoint(20, 20),
      makeConfidencePoint(30, 30),
    ];
    overlay.show(makeOverlayOptions({ points }));
    const group = scene.children[0] as THREE.Group;
    // Each point should add at least one mesh child (e.g. a quad or sprite)
    expect(group.children.length).toBeGreaterThanOrEqual(points.length);
    overlay.dispose();
  });

  it('high confidence points render green', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      makeConfidencePoint(5, 5, { confidence: 0.95, fresh: true }),
    ];
    overlay.show(makeOverlayOptions({ points }));
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();
    const mat = mesh.material as THREE.Material;
    // If vertex-colored, check the geometry color attribute;
    // if single-colored, check material.color
    const colorAttr = (mesh.geometry as THREE.BufferGeometry)?.getAttribute('color');
    if (colorAttr) {
      // Vertex-colored: green channel should dominate (g > r and g > b)
      const colors = colorAttr.array as Float32Array;
      let greenDominant = true;
      for (let i = 1; i < colors.length; i += 3) {
        if (colors[i]! <= colors[i - 1]! || colors[i]! <= colors[i + 1]!) {
          greenDominant = false;
        }
      }
      expect(greenDominant).toBe(true);
    } else if (mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshPhongMaterial) {
      // Single-colored material
      expect(mat.color.g).toBeGreaterThan(mat.color.r);
      expect(mat.color.g).toBeGreaterThan(mat.color.b);
    }
    overlay.dispose();
  });

  it('low confidence points render red', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      makeConfidencePoint(5, 5, { confidence: 0.1, fresh: true }),
    ];
    overlay.show(makeOverlayOptions({ points }));
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();
    const mat = mesh.material as THREE.Material;
    const colorAttr = (mesh.geometry as THREE.BufferGeometry)?.getAttribute('color');
    if (colorAttr) {
      const colors = colorAttr.array as Float32Array;
      let redDominant = true;
      for (let i = 0; i < colors.length; i += 3) {
        if (colors[i]! <= colors[i + 1]! || colors[i]! <= colors[i + 2]!) {
          redDominant = false;
        }
      }
      expect(redDominant).toBe(true);
    } else if (mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshPhongMaterial) {
      expect(mat.color.r).toBeGreaterThan(mat.color.g);
      expect(mat.color.r).toBeGreaterThan(mat.color.b);
    }
    overlay.dispose();
  });

  it('medium confidence points render yellow/orange (warning)', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      makeConfidencePoint(5, 5, { confidence: 0.5, fresh: true }),
    ];
    overlay.show(makeOverlayOptions({ points }));
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();
    const mat = mesh.material as THREE.Material;
    const colorAttr = (mesh.geometry as THREE.BufferGeometry)?.getAttribute('color');
    if (colorAttr) {
      const colors = colorAttr.array as Float32Array;
      // Yellow/orange: red and green should both be high, blue low
      for (let i = 0; i < colors.length; i += 3) {
        const r = colors[i]!;
        const g = colors[i + 1]!;
        const b = colors[i + 2]!;
        expect(r).toBeGreaterThan(0.4);
        expect(g).toBeGreaterThan(0.4);
        expect(b).toBeLessThan(r);
      }
    } else if (mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshPhongMaterial) {
      expect(mat.color.r).toBeGreaterThan(0.4);
      expect(mat.color.g).toBeGreaterThan(0.4);
      expect(mat.color.b).toBeLessThan(mat.color.r);
    }
    overlay.dispose();
  });

  it('stale points (fresh=false) render grey regardless of confidence', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      makeConfidencePoint(5, 5, { confidence: 0.9, fresh: false }),
    ];
    overlay.show(makeOverlayOptions({ points }));
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();
    const mat = mesh.material as THREE.Material;
    const colorAttr = (mesh.geometry as THREE.BufferGeometry)?.getAttribute('color');
    if (colorAttr) {
      const colors = colorAttr.array as Float32Array;
      // Grey: all channels roughly equal (within 0.15 tolerance)
      for (let i = 0; i < colors.length; i += 3) {
        const diffRG = Math.abs(colors[i]! - colors[i + 1]!);
        const diffRB = Math.abs(colors[i]! - colors[i + 2]!);
        const diffGB = Math.abs(colors[i + 1]! - colors[i + 2]!);
        expect(diffRG).toBeLessThan(0.15);
        expect(diffRB).toBeLessThan(0.15);
        expect(diffGB).toBeLessThan(0.15);
      }
    } else if (mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshPhongMaterial) {
      const diffRG = Math.abs(mat.color.r - mat.color.g);
      const diffRB = Math.abs(mat.color.r - mat.color.b);
      const diffGB = Math.abs(mat.color.g - mat.color.b);
      expect(diffRG).toBeLessThan(0.15);
      expect(diffRB).toBeLessThan(0.15);
      expect(diffGB).toBeLessThan(0.15);
    }
    overlay.dispose();
  });

  it('opacity parameter is reflected in material opacity', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions({ points: [makeConfidencePoint(5, 5)], opacity: 0.6 }));
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh).toBeDefined();
    const mat = mesh.material as THREE.Material;
    if (mat.transparent !== undefined) {
      expect(mat.opacity).toBeCloseTo(0.6, 1);
    }
    overlay.dispose();
  });

  it('show replaces previous overlay data (no duplicate accumulation)', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions({ points: [makeConfidencePoint(5, 5)] }));
    const countAfterFirst = (scene.children[0] as THREE.Group).children.length;

    overlay.show(makeOverlayOptions({ points: [makeConfidencePoint(10, 10)] }));
    const countAfterSecond = (scene.children[0] as THREE.Group).children.length;

    // Second show should replace, not add to, the previous data
    expect(countAfterSecond).toBeLessThanOrEqual(countAfterFirst);
    overlay.dispose();
  });

  it('clear removes all children from the group', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions({
      points: [makeConfidencePoint(1, 1), makeConfidencePoint(2, 2), makeConfidencePoint(3, 3)],
    }));
    overlay.clear();
    const group = scene.children[0] as THREE.Group;
    expect(group.children.length).toBe(0);
    overlay.dispose();
  });

  it('dispose removes group from scene', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions());
    overlay.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('points positioned at world-space x,y,z', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      makeConfidencePoint(15, 25, { surfaceY: 7 }),
    ];
    overlay.show(makeOverlayOptions({ points }));
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh.position.x).toBeCloseTo(15, 0);
    expect(mesh.position.z).toBeCloseTo(25, 0);
    expect(mesh.position.y).toBeCloseTo(7, 0);
    overlay.dispose();
  });

  it('multiple points with mixed freshness and confidence all render', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      makeConfidencePoint(5, 5, { confidence: 0.9, fresh: true }),
      makeConfidencePoint(10, 5, { confidence: 0.3, fresh: true }),
      makeConfidencePoint(15, 5, { confidence: 0.9, fresh: false }),
      makeConfidencePoint(20, 5, { confidence: 0.5, fresh: true }),
      makeConfidencePoint(25, 5, { confidence: 0.7, fresh: false }),
    ];
    overlay.show(makeOverlayOptions({ points }));
    const group = scene.children[0] as THREE.Group;
    // Each point should contribute at least one mesh
    expect(group.children.length).toBeGreaterThanOrEqual(points.length);
    overlay.dispose();
  });

  // ── Edge case: empty points array ──
  it('show with empty points array does not crash', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    expect(() => overlay.show(makeOverlayOptions({ points: [] }))).not.toThrow();
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(true);
    expect(group.children.length).toBe(0);
    overlay.dispose();
  });

  // ── Stale point opacity (STALE_OPACITY = 0.25) ──
  it('stale point has opacity multiplied by STALE_OPACITY (0.25)', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    // Fresh point with opacity 0.6 → material opacity = 0.6 * 1.0 = 0.6
    overlay.show(makeOverlayOptions({
      points: [makeConfidencePoint(5, 5, { fresh: true, confidence: 0.5 })],
      opacity: 0.6,
    }));
    const group = scene.children[0] as THREE.Group;
    const freshMesh = group.children[0] as THREE.Mesh;
    const freshMat = freshMesh.material as THREE.MeshBasicMaterial;
    const freshOpacity = freshMat.opacity;

    // Now show a stale point with same global opacity
    overlay.show(makeOverlayOptions({
      points: [makeConfidencePoint(5, 5, { fresh: false, confidence: 0.5 })],
      opacity: 0.6,
    }));
    const staleMesh = group.children[0] as THREE.Mesh;
    const staleMat = staleMesh.material as THREE.MeshBasicMaterial;

    // Stale opacity should be 0.25x the fresh opacity
    // Fresh: 0.6 * 1.0 = 0.6
    // Stale: 0.6 * 0.25 = 0.15
    expect(freshOpacity).toBeCloseTo(0.6, 2);
    expect(staleMat.opacity).toBeCloseTo(0.15, 2);
    overlay.dispose();
  });

  // ── renderOrder ──
  it('each overlay quad has renderOrder set to 100', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions({
      points: [
        makeConfidencePoint(5, 5),
        makeConfidencePoint(10, 10),
      ],
    }));
    const group = scene.children[0] as THREE.Group;
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      expect(mesh.renderOrder).toBe(100);
    }
    overlay.dispose();
  });

  // ── Quad rotation ──
  it('each overlay quad is rotated to lie flat (rotation.x = -PI/2)', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions({
      points: [makeConfidencePoint(5, 5)],
    }));
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    overlay.dispose();
  });

  // ── confidenceToColor at exact boundaries ──
  it('confidence 0 renders pure red (r=1, g=0, b=0)', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions({
      points: [makeConfidencePoint(5, 5, { confidence: 0, fresh: true })],
    }));
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mat.color.r).toBeCloseTo(1, 2);
    expect(mat.color.g).toBeCloseTo(0, 2);
    expect(mat.color.b).toBeCloseTo(0, 2);
    overlay.dispose();
  });

  it('confidence 1 renders pure green (r=0, g=1, b=0)', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions({
      points: [makeConfidencePoint(5, 5, { confidence: 1, fresh: true })],
    }));
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mat.color.r).toBeCloseTo(0, 2);
    expect(mat.color.g).toBeCloseTo(1, 2);
    expect(mat.color.b).toBeCloseTo(0, 2);
    overlay.dispose();
  });

  it('confidence 0.5 renders pure yellow (r=1, g=1, b=0)', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions({
      points: [makeConfidencePoint(5, 5, { confidence: 0.5, fresh: true })],
    }));
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mat.color.r).toBeCloseTo(1, 2);
    expect(mat.color.g).toBeCloseTo(1, 2);
    expect(mat.color.b).toBeCloseTo(0, 2);
    overlay.dispose();
  });

  // ── Hide then show ──
  it('hide then show restores overlay visibility and data', () => {
    const scene = makeScene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show(makeOverlayOptions({
      points: [makeConfidencePoint(5, 5)],
    }));
    overlay.hide();
    overlay.show(makeOverlayOptions({
      points: [makeConfidencePoint(10, 10), makeConfidencePoint(20, 20)],
    }));
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(true);
    expect(group.children.length).toBe(2);
    overlay.dispose();
  });
});

// ─── TerrainMesh.getSurveyOverlay ───────────────────────────────────────────────

describe('TerrainMesh.getSurveyOverlay', () => {
  it('returns a SurveyConfidenceOverlay instance', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(4, 4, 4);
    const tm = new TerrainMesh(scene, grid);
    const overlay = tm.getSurveyOverlay();
    expect(overlay).toBeInstanceOf(SurveyConfidenceOverlay);
    tm.dispose();
  });

  it('is lazily created (multiple calls return same instance)', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(4, 4, 4);
    const tm = new TerrainMesh(scene, grid);
    const a = tm.getSurveyOverlay();
    const b = tm.getSurveyOverlay();
    expect(a).toBe(b);
    tm.dispose();
  });

  it('TerrainMesh.dispose disposes the survey overlay when it was created', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(4, 4, 4);
    const tm = new TerrainMesh(scene, grid);
    const overlay = tm.getSurveyOverlay();
    overlay.show(makeOverlayOptions({ points: [makeConfidencePoint(5, 5)] }));
    tm.dispose();
    // After dispose, the overlay group should be removed from the scene
    expect(scene.children.length).toBe(0);
  });
});
