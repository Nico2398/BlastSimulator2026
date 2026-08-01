import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CompositionPalette } from '../../../src/core/world/VoxelGrid.js';
import type { LandscapeMap, LandscapeTile } from '../../../src/core/world/LandscapeMap.js';
import type { Rect } from '../../../src/core/world/WorldGen.js';
import type { LandscapeHandle } from '../../../src/console/commands/world.js';
import { LandscapeMesh } from '../../../src/renderer/terrain/LandscapeMesh.js';

function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

function makeMaterial(): THREE.Material {
  return new THREE.MeshPhongMaterial({ vertexColors: true });
}

function makePalette(): { palette: CompositionPalette; compId: number } {
  const palette = new CompositionPalette();
  const compId = palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
  return { palette, compId };
}

/** A tiny (4x4) fake tile, far from any playable rect, flat at a known height. */
function makeFakeTile(originX: number, originZ: number, n: number, compId: number, height = 10): LandscapeTile {
  const size = n * n;
  const heights = new Float32Array(size).fill(height);
  const biomeIds = new Uint8Array(size);
  const surfCompIds = new Uint16Array(size).fill(compId);
  return { tileX: 0, tileZ: 0, originX, originZ, heights, biomeIds, surfCompIds };
}

function makeFakeHandle(
  rect: Rect,
  tiles: LandscapeTile[],
  n: number,
  compId: number,
  sampleColumn?: LandscapeHandle['sampleColumn'],
): LandscapeHandle {
  const map: LandscapeMap = { tiles, extentHalf: 1600, tileSpan: 512, coarseStep: 4, samplesPerTile: n };
  return {
    map,
    playableRect: rect,
    sampleColumn: sampleColumn ?? ((x, z) => ({ height: 20 - Math.abs(x) * 0.01 - Math.abs(z) * 0.01, biomeId: 0, surfCompId: compId })),
  };
}

describe('LandscapeMesh', () => {
  it('builds one Mesh per non-empty tile plus a seam mesh, all added to the scene', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const n = 4;
    const tiles = [
      makeFakeTile(-100, -100, n, compId),
      makeFakeTile(100, 100, n, compId),
    ];
    const handle = makeFakeHandle(rect, tiles, n, compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.build(handle, palette);

    expect(lm.meshCount).toBe(3); // 2 tiles + 1 seam
    expect(scene.children.length).toBe(3);
    lm.dispose();
  });

  it('a tile with zero-length heights (empty) contributes no mesh', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const emptyTile: LandscapeTile = { tileX: 0, tileZ: 0, originX: 0, originZ: 0, heights: new Float32Array(0), biomeIds: new Uint8Array(0), surfCompIds: new Uint16Array(0) };
    const handle = makeFakeHandle(rect, [emptyTile], 4, compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.build(handle, palette);

    expect(lm.meshCount).toBe(1); // seam mesh only
    lm.dispose();
  });

  it('tile mesh geometry has position, index, and rock/ore attributes matching a regular grid (#458 T4.1)', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const n = 5;
    const tiles = [makeFakeTile(-200, -200, n, compId, 42)];
    const handle = makeFakeHandle(rect, tiles, n, compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.build(handle, palette);

    const tileMesh = scene.children.find(c => c instanceof THREE.Mesh && c.geometry.attributes['position']!.count === n * n) as THREE.Mesh;
    expect(tileMesh).toBeDefined();
    const geo = tileMesh.geometry;
    expect(geo.getAttribute('position').count).toBe(n * n);
    // Color now comes entirely from TerrainMaterial's shader (#458 T4.1/D9).
    expect(geo.getAttribute('color')).toBeUndefined();
    expect(geo.getIndex()).not.toBeNull();
    expect(geo.getIndex()!.count).toBe((n - 1) * (n - 1) * 6); // 2 triangles/quad, 3 indices/triangle

    // Every vertex should sit at the fake tile's flat height (42).
    const positions = geo.getAttribute('position').array as Float32Array;
    for (let i = 0; i < positions.length; i += 3) {
      expect(positions[i + 1]).toBeCloseTo(42, 5);
    }

    // Single-rock samples: both shader rock slots agree, weight 0, no ore (#458 A18).
    const rockA = geo.getAttribute('aRockA').array as Float32Array;
    const rockB = geo.getAttribute('aRockB').array as Float32Array;
    const rockWeight = geo.getAttribute('aRockWeight').array as Float32Array;
    const ore = geo.getAttribute('aOre').array as Float32Array;
    expect(geo.getAttribute('aOre').itemSize).toBe(2);
    for (let i = 0; i < n * n; i++) {
      expect(rockA[i]).toBe(rockB[i]);
      expect(rockWeight[i]).toBe(0);
      expect(ore[i * 2]).toBe(-1);
      expect(ore[i * 2 + 1]).toBe(0);
    }
    lm.dispose();
  });

  it('tile and seam meshes cast and receive shadows (#458 T5.1/CSM)', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const tiles = [makeFakeTile(-100, -100, 4, compId)];
    const handle = makeFakeHandle(rect, tiles, 4, compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.build(handle, palette);

    expect(scene.children.length).toBeGreaterThan(0);
    for (const child of scene.children) {
      const mesh = child as THREE.Mesh;
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    }
    lm.dispose();
  });

  it('dispose() removes every mesh from the scene and clears meshCount', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const tiles = [makeFakeTile(-100, -100, 4, compId)];
    const handle = makeFakeHandle(rect, tiles, 4, compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.build(handle, palette);
    expect(scene.children.length).toBeGreaterThan(0);

    lm.dispose();
    expect(scene.children.length).toBe(0);
    expect(lm.meshCount).toBe(0);
  });

  it('a second build() disposes the previous meshes before adding new ones (no accumulation)', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const tiles = [makeFakeTile(-100, -100, 4, compId)];
    const handle = makeFakeHandle(rect, tiles, 4, compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.build(handle, palette);
    const countAfterFirst = scene.children.length;

    lm.build(handle, palette);
    expect(scene.children.length).toBe(countAfterFirst); // same count, not doubled

    lm.dispose();
  });

  describe('seam mesh (#458 A16 anti-gap overlap)', () => {
    it('lowers height by exactly OVERLAP_DROP (0.15m) for vertices inside the playable rect', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
      // Flat sampleColumn (height always 50) isolates the overlap-drop effect from any terrain slope.
      const handle = makeFakeHandle(rect, [], 4, compId, () => ({ height: 50, biomeId: 0, surfCompId: compId }));

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);

      const seamMesh = scene.children[0] as THREE.Mesh;
      const positions = seamMesh.geometry.getAttribute('position').array as Float32Array;
      let sawInside = false, sawOutside = false;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
        const insideRect = x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ;
        if (insideRect) {
          expect(y).toBeCloseTo(50 - 0.15, 5);
          sawInside = true;
        } else {
          expect(y).toBeCloseTo(50, 5);
          sawOutside = true;
        }
      }
      expect(sawInside).toBe(true); // the 2m overlap strip really is included
      expect(sawOutside).toBe(true);
      lm.dispose();
    });

    it('never emits a vertex more than OVERLAP + one grid step inside the playable rect', () => {
      // A quad is included if ANY of its 4 corners is within OVERLAP — so an
      // included quad's deepest corner can be up to OVERLAP + FINE_STEP in
      // the worst case (the quantization slack of a discrete grid, not a
      // bug: the playable mesh already fully covers that ground regardless).
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
      const handle = makeFakeHandle(rect, [], 4, compId, () => ({ height: 50, biomeId: 0, surfCompId: compId }));

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);

      const seamMesh = scene.children[0] as THREE.Mesh;
      const positions = seamMesh.geometry.getAttribute('position').array as Float32Array;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]!, z = positions[i + 2]!;
        const dx = Math.min(x - rect.minX, rect.maxX - x);
        const dz = Math.min(z - rect.minZ, rect.maxZ - z);
        const insideDepth = Math.min(dx, dz);
        expect(insideDepth).toBeLessThanOrEqual(2 + 1 + 1e-9);
      }
      lm.dispose();
    });

    it('reaches at least FINE_MARGIN (24m) outside the playable rect', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
      const handle = makeFakeHandle(rect, [], 4, compId, () => ({ height: 50, biomeId: 0, surfCompId: compId }));

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);

      const seamMesh = scene.children[0] as THREE.Mesh;
      const positions = seamMesh.geometry.getAttribute('position').array as Float32Array;
      let minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        minX = Math.min(minX, positions[i]!);
        maxX = Math.max(maxX, positions[i]!);
      }
      expect(minX).toBeLessThanOrEqual(rect.minX - 24);
      expect(maxX).toBeGreaterThanOrEqual(rect.maxX + 24);
      lm.dispose();
    });

    it('is deterministic for the same handle and palette', () => {
      const { palette, compId } = makePalette();
      const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
      const handle = makeFakeHandle(rect, [], 4, compId);

      const sceneA = makeScene();
      const lmA = new LandscapeMesh(sceneA, makeMaterial());
      lmA.build(handle, palette);
      const meshA = sceneA.children[0] as THREE.Mesh; // only the seam mesh — tiles is []

      const sceneB = makeScene();
      const lmB = new LandscapeMesh(sceneB, makeMaterial());
      lmB.build(handle, palette);
      const meshB = sceneB.children[0] as THREE.Mesh;

      expect(Array.from(meshA.geometry.getAttribute('position').array))
        .toEqual(Array.from(meshB.geometry.getAttribute('position').array));

      lmA.dispose();
      lmB.dispose();
    });
  });
});
