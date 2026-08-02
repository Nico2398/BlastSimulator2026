import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CompositionPalette } from '../../../src/core/world/VoxelGrid.js';
import type { LandscapeMap, LandscapeTile } from '../../../src/core/world/LandscapeMap.js';
import type { Rect } from '../../../src/core/world/WorldGen.js';
import type { LandscapeHandle } from '../../../src/console/commands/world.js';
import { LandscapeMesh, seamHeightAt, voxelSurfaceHeight } from '../../../src/renderer/terrain/LandscapeMesh.js';

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

  describe('tile meshes never cover the playable rect', () => {
    // A tile spans 512m while a playable rect is 32-160m, so every rect sits
    // deep inside its tiles. Before this exclusion the coarse 4m sheet was
    // emitted straight across the pit at the pre-dig surface height, hiding
    // everything the voxel mesh did underneath it — a blast carved its crater
    // and the player saw flat ground.
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };

    /** Every triangle of `mesh`, as world-space corner triples. */
    function triangles(mesh: THREE.Mesh): [number, number][][] {
      const pos = mesh.geometry.getAttribute('position').array as Float32Array;
      const idx = mesh.geometry.getIndex()!.array;
      const out: [number, number][][] = [];
      for (let i = 0; i < idx.length; i += 3) {
        out.push([0, 1, 2].map((k) => {
          const v = idx[i + k]!;
          return [pos[v * 3]!, pos[v * 3 + 2]!] as [number, number];
        }));
      }
      return out;
    }

    function insideDepth(x: number, z: number): number {
      return Math.min(Math.min(x - rect.minX, rect.maxX - x), Math.min(z - rect.minZ, rect.maxZ - z));
    }

    /** A tile spanning -100..56 on both axes at 4m step — swallows the whole rect. */
    function tileCoveringRect(compId: number) {
      return { tile: makeFakeTile(-100, -100, 40, compId), n: 40 };
    }

    it('emits no triangle that reaches inside the playable rect', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const { tile, n } = tileCoveringRect(compId);
      const handle = makeFakeHandle(rect, [tile], n, compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);

      const tileMesh = scene.children.find(
        (c) => (c as THREE.Mesh).geometry?.getAttribute('position')?.count === n * n,
      ) as THREE.Mesh;
      expect(tileMesh).toBeDefined();

      for (const tri of triangles(tileMesh)) {
        for (const [x, z] of tri) {
          expect(insideDepth(x, z)).toBeLessThanOrEqual(0);
        }
      }
      lm.dispose();
    });

    it('still emits the tile ground outside the rect (the pit is cut out, not the whole tile)', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const { tile, n } = tileCoveringRect(compId);
      const handle = makeFakeHandle(rect, [tile], n, compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);

      const tileMesh = scene.children.find(
        (c) => (c as THREE.Mesh).geometry?.getAttribute('position')?.count === n * n,
      ) as THREE.Mesh;
      const kept = tileMesh.geometry.getIndex()!.count / 6;
      const total = (n - 1) * (n - 1);
      expect(kept).toBeGreaterThan(total * 0.8); // only the pit's few quads are gone
      expect(kept).toBeLessThan(total);          // but some really are gone
      lm.dispose();
    });

    it('leaves a tile that never touches the rect completely intact', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const n = 6;
      const handle = makeFakeHandle(rect, [makeFakeTile(400, 400, n, compId)], n, compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);

      const tileMesh = scene.children.find(
        (c) => (c as THREE.Mesh).geometry?.getAttribute('position')?.count === n * n,
      ) as THREE.Mesh;
      expect(tileMesh.geometry.getIndex()!.count).toBe((n - 1) * (n - 1) * 6);
      lm.dispose();
    });

    it('drops the tile entirely when every one of its quads is inside the rect', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const big: Rect = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
      const n = 4;
      const handle = makeFakeHandle(big, [makeFakeTile(0, 0, n, compId)], n, compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);

      const tileMesh = scene.children.find(
        (c) => (c as THREE.Mesh).geometry?.getAttribute('position')?.count === n * n,
      );
      expect(tileMesh).toBeUndefined(); // no geometry left to draw
      lm.dispose();
    });
  });

  describe('seam mesh (#458 A16 anti-gap overlap)', () => {
    it('locks seam height to the playable mesh at the rect edge, easing out to the true height', () => {
      // The two representations quantize differently: the landscape samples a
      // continuous height, while the voxel grid rounds to a voxel and marching
      // cubes lands the iso-surface half a voxel below the first air cell.
      // Left alone the seam floats up to a metre above the playable mesh — a
      // lip right round the site.
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
      // A flat, deliberately non-integer height isolates the quantization.
      const H = 50.4;
      const handle = makeFakeHandle(rect, [], 4, compId, () => ({ height: H, biomeId: 0, surfCompId: compId }));

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);

      const seamMesh = scene.children[0] as THREE.Mesh;
      const positions = seamMesh.geometry.getAttribute('position').array as Float32Array;
      const matched = voxelSurfaceHeight(H); // 49.5

      let sawInside = false, sawFarOutside = false;
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
        const dx = Math.min(x - rect.minX, rect.maxX - x);
        const dz = Math.min(z - rect.minZ, rect.maxZ - z);
        const insideDepth = Math.min(dx, dz);

        if (insideDepth > 0) {
          // Inside the rect: sits on the playable surface, dropped clear of it.
          expect(y).toBeCloseTo(matched - 0.15, 5);
          sawInside = true;
        } else if (insideDepth <= -24) {
          // A full margin out: back to the smooth continuous height.
          expect(y).toBeCloseTo(H, 5);
          sawFarOutside = true;
        }
        // Everywhere between is a blend, always within the two bounds.
        // Positions round-trip through Float32, so allow a float32 ulp.
        expect(y).toBeGreaterThanOrEqual(matched - 0.15 - 1e-4);
        expect(y).toBeLessThanOrEqual(H + 1e-4);
      }
      expect(sawInside).toBe(true);
      expect(sawFarOutside).toBe(true);
      lm.dispose();
    });

    it('seamHeightAt meets the voxel surface exactly at the boundary', () => {
      for (const h of [50.4, 50.5, 49.9, 12.0, 7.25]) {
        expect(seamHeightAt(h, 0)).toBeCloseTo(voxelSurfaceHeight(h), 6);
      }
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
