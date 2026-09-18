import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CompositionPalette } from '../../../src/core/world/VoxelGrid.js';
import { NODES_PER_CHUNK, LADDER_STEPS, type LandscapeChunk, type LandscapeChunkId, type LazyLandscapeMap } from '../../../src/core/world/LandscapeMap.js';
import type { Rect } from '../../../src/core/world/WorldGen.js';
import type { LandscapeHandle } from '../../../src/console/commands/world.js';
import {
  LandscapeMesh,
  rockBlendFor,
  classifyQuad,
  buildBoundaryQuad,
  buildChunkMesh,
  uniformNeighbourSteps,
  chordHeight,
  type PlayableCut,
  type NeighbourSteps,
} from '../../../src/renderer/terrain/LandscapeMesh.js';
import { rockIndexOf } from '../../../src/core/world/RockCatalog.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';

/** LADDER_STEPS[0], the ladder's finest rung — mirrors LandscapeMesh.ts's own (unexported) FINE_STEP. */
const FINE_STEP = LADDER_STEPS[0]!;

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

/** One fake LandscapeChunk: NODES_PER_CHUNK x NODES_PER_CHUNK, sampled from `heightFn` (flat by default). */
function makeFakeChunk(
  id: LandscapeChunkId, originX: number, originZ: number, step: number, compId: number,
  heightFn: (x: number, z: number) => number = () => 10,
): LandscapeChunk {
  const n = NODES_PER_CHUNK;
  const heights = new Float32Array(n * n);
  const biomeIds = new Uint8Array(n * n);
  const surfCompIds = new Uint16Array(n * n).fill(compId);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      heights[row * n + col] = heightFn(originX + col * step, originZ + row * step);
    }
  }
  return { id, step, originX, originZ, heights, biomeIds, surfCompIds };
}

const idKey = (id: LandscapeChunkId): string => `${id.level},${id.cx},${id.cz}`;

/** A LazyLandscapeMap backed by a fixed set of pre-built fake chunks — the test double for LandscapeHandle.map. */
function makeFakeMap(chunks: LandscapeChunk[], extentHalf = 1600, centerX = 0, centerZ = 0): LazyLandscapeMap {
  const byKey = new Map<string, LandscapeChunk>();
  for (const c of chunks) byKey.set(idKey(c.id), c);
  return {
    extentHalf, centerX, centerZ,
    getChunk: (id) => {
      const c = byKey.get(idKey(id));
      if (!c) throw new Error(`no fake chunk registered for ${idKey(id)}`);
      return c;
    },
    hasChunk: (id) => byKey.has(idKey(id)),
    get cachedChunkIds() { return [...byKey.values()].map(c => c.id); },
  };
}

function makeFakeHandle(
  rect: Rect, chunks: LandscapeChunk[], compId: number,
  sampleColumn?: LandscapeHandle['sampleColumn'],
): LandscapeHandle {
  return {
    map: makeFakeMap(chunks),
    playableRect: rect,
    sampleColumn: sampleColumn ?? ((x, z) => ({ height: 20 - Math.abs(x) * 0.01 - Math.abs(z) * 0.01, biomeId: 0, surfCompId: compId })),
    groundLevelY: 0,
    structureSet: { overlays: [], spatialIndex: new Map(), rivers: [], villages: [], trees: [], landmarks: [] },
  };
}

describe('buildChunkMesh (#1153)', () => {
  it('returns null when the chunk lies entirely inside the claim (fully owned, nothing to draw)', () => {
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
    const chunk = makeFakeChunk({ level: 0, cx: 0, cz: 0 }, 0, 0, 4, compId);
    const cut: PlayableCut = { rect, ownsColumn: () => true };
    const sampleColumn = (x: number, z: number): { height: number; biomeId: number; surfCompId: number } => ({ height: 10, biomeId: 0, surfCompId: compId });

    const mesh = buildChunkMesh(chunk, uniformNeighbourSteps(chunk.step), palette, cut, sampleColumn);
    expect(mesh).toBeNull();
  });

  it('returns a Mesh with non-empty geometry when the chunk has ground of its own to draw', () => {
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 1_000_000, minZ: 1_000_000, maxX: 1_000_001, maxZ: 1_000_001 }; // far away
    const chunk = makeFakeChunk({ level: 0, cx: 0, cz: 0 }, -100, -100, 4, compId, () => 10);
    const cut: PlayableCut = { rect, ownsColumn: () => false };
    const sampleColumn = (x: number, z: number): { height: number; biomeId: number; surfCompId: number } => ({ height: 10, biomeId: 0, surfCompId: compId });

    const mesh = buildChunkMesh(chunk, uniformNeighbourSteps(chunk.step), palette, cut, sampleColumn);
    expect(mesh).not.toBeNull();
    expect(mesh!.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(mesh!.geometry.getIndex()!.count).toBe((NODES_PER_CHUNK - 1) * (NODES_PER_CHUNK - 1) * 6);
  });
});

describe('LandscapeMesh.buildChunk (#1153)', () => {
  it('builds one mesh per built chunk id, with no separate seam mesh (#491)', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const idA: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
    const idB: LandscapeChunkId = { level: 0, cx: 1, cz: 0 };
    const chunkA = makeFakeChunk(idA, -100, -100, 4, compId);
    const chunkB = makeFakeChunk(idB, 100, 100, 4, compId);
    const handle = makeFakeHandle(rect, [chunkA, chunkB], compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.buildChunk(idA, handle, palette, uniformNeighbourSteps(chunkA.step));
    lm.buildChunk(idB, handle, palette, uniformNeighbourSteps(chunkB.step));

    expect(lm.meshCount).toBe(2);
    expect(scene.children.length).toBe(2);
    lm.dispose();
  });

  for (const step of LADDER_STEPS) {
    it(`step ${step}m: a chunk untouched by the claim, uniform neighbours, has NODES_PER_CHUNK^2 vertices and a full-grid index (#458 T4.1)`, () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      // Far enough away that no quad of the chunk can ever be 'inside' or
      // 'boundary' — isolates the untouched-chunk shape from claim handling.
      const rect: Rect = { minX: 1_000_000, minZ: 1_000_000, maxX: 1_000_032, maxZ: 1_000_032 };
      const id: LandscapeChunkId = { level: LADDER_STEPS.indexOf(step), cx: 0, cz: 0 };
      const chunk = makeFakeChunk(id, -100, -100, step, compId, () => 42);
      const handle = makeFakeHandle(rect, [chunk], compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.buildChunk(id, handle, palette, uniformNeighbourSteps(step));

      expect(scene.children.length).toBe(1);
      const mesh = scene.children[0] as THREE.Mesh;
      const geo = mesh.geometry;
      expect(geo.getAttribute('position').count).toBe(NODES_PER_CHUNK * NODES_PER_CHUNK);
      // Color comes entirely from TerrainMaterial's shader (#458 T4.1/D9).
      expect(geo.getAttribute('color')).toBeUndefined();
      expect(geo.getIndex()).not.toBeNull();
      expect(geo.getIndex()!.count).toBe((NODES_PER_CHUNK - 1) * (NODES_PER_CHUNK - 1) * 6);

      const positions = geo.getAttribute('position').array as Float32Array;
      for (let i = 0; i < positions.length; i += 3) {
        expect(positions[i + 1]).toBeCloseTo(42, 5);
      }

      const rockA = geo.getAttribute('aRockA').array as Float32Array;
      const rockB = geo.getAttribute('aRockB').array as Float32Array;
      const rockWeight = geo.getAttribute('aRockWeight').array as Float32Array;
      const ore = geo.getAttribute('aOre').array as Float32Array;
      expect(geo.getAttribute('aOre').itemSize).toBe(2);
      for (let i = 0; i < NODES_PER_CHUNK * NODES_PER_CHUNK; i++) {
        expect(rockA[i]).toBe(rockB[i]);
        expect(rockWeight[i]).toBe(0);
        expect(ore[i * 2]).toBe(-1);
        expect(ore[i * 2 + 1]).toBe(0);
      }
      lm.dispose();
    });
  }

  it('built chunk meshes cast and receive shadows (#458 T5.1/CSM)', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 1_000_000, minZ: 1_000_000, maxX: 1_000_032, maxZ: 1_000_032 };
    const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
    const chunk = makeFakeChunk(id, -100, -100, 4, compId);
    const handle = makeFakeHandle(rect, [chunk], compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));

    expect(scene.children.length).toBeGreaterThan(0);
    for (const child of scene.children) {
      const mesh = child as THREE.Mesh;
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    }
    lm.dispose();
  });

  it('a second buildChunk() with the same id replaces rather than accumulates (no double mesh)', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 1_000_000, minZ: 1_000_000, maxX: 1_000_032, maxZ: 1_000_032 };
    const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
    const chunk = makeFakeChunk(id, -100, -100, 4, compId);
    const handle = makeFakeHandle(rect, [chunk], compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));
    const countAfterFirst = scene.children.length;

    lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));
    expect(scene.children.length).toBe(countAfterFirst);
    expect(lm.meshCount).toBe(countAfterFirst);

    lm.dispose();
  });

  it('disposeChunk removes exactly that chunk\'s mesh, leaving the others resident', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 1_000_000, minZ: 1_000_000, maxX: 1_000_032, maxZ: 1_000_032 };
    const idA: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
    const idB: LandscapeChunkId = { level: 0, cx: 1, cz: 0 };
    const chunkA = makeFakeChunk(idA, -100, -100, 4, compId);
    const chunkB = makeFakeChunk(idB, 100, 100, 4, compId);
    const handle = makeFakeHandle(rect, [chunkA, chunkB], compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.buildChunk(idA, handle, palette, uniformNeighbourSteps(chunkA.step));
    lm.buildChunk(idB, handle, palette, uniformNeighbourSteps(chunkB.step));
    expect(lm.meshCount).toBe(2);

    lm.disposeChunk(idA);
    expect(lm.meshCount).toBe(1);
    expect(scene.children.length).toBe(1);

    lm.dispose();
  });

  it('disposeChunk on an id that was never built is a no-op', () => {
    const scene = makeScene();
    const lm = new LandscapeMesh(scene, makeMaterial());
    expect(() => lm.disposeChunk({ level: 0, cx: 99, cz: 99 })).not.toThrow();
    expect(lm.meshCount).toBe(0);
    lm.dispose();
  });

  it('dispose() removes every resident chunk mesh from the scene and clears meshCount', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 1_000_000, minZ: 1_000_000, maxX: 1_000_032, maxZ: 1_000_032 };
    const idA: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
    const idB: LandscapeChunkId = { level: 0, cx: 1, cz: 0 };
    const chunkA = makeFakeChunk(idA, -100, -100, 4, compId);
    const chunkB = makeFakeChunk(idB, 100, 100, 4, compId);
    const handle = makeFakeHandle(rect, [chunkA, chunkB], compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.buildChunk(idA, handle, palette, uniformNeighbourSteps(chunkA.step));
    lm.buildChunk(idB, handle, palette, uniformNeighbourSteps(chunkB.step));
    expect(scene.children.length).toBeGreaterThan(0);

    lm.dispose();
    expect(scene.children.length).toBe(0);
    expect(lm.meshCount).toBe(0);
    expect(lm.meshes.length).toBe(0);
  });

  describe('a chunk\'s mesh never fully covers the playable claim', () => {
    // A chunk spans (NODES_PER_CHUNK - 1) * step metres. At step 4 that's 128m
    // — far larger than the 32m playable rect used here — so the rect sits
    // deep inside the chunk. Before this exclusion the coarse sheet was
    // emitted straight across the pit at the pre-dig surface height, hiding
    // everything the voxel mesh did underneath it.
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const STEP = 4;

    /** A chunk spanning -48..80 on both axes at 4m step — swallows the whole rect with margin. */
    function chunkCoveringRect(id: LandscapeChunkId, compId: number): LandscapeChunk {
      return makeFakeChunk(id, -48, -48, STEP, compId);
    }

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

    it('never emits a triangle deeper than one boundary-quad ring inside the playable rect (#491)', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
      const chunk = chunkCoveringRect(id, compId);
      const handle = makeFakeHandle(rect, [chunk], compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));

      expect(scene.children.length).toBe(1);
      const mesh = scene.children[0] as THREE.Mesh;
      const maxBoundaryReach = Math.SQRT2; // diagonal fine-cell slack
      for (const tri of triangles(mesh)) {
        for (const [x, z] of tri) {
          expect(insideDepth(x, z)).toBeLessThanOrEqual(maxBoundaryReach + 1e-6);
        }
      }
      lm.dispose();
    });

    it('still emits chunk ground outside the rect (the pit is cut out, not the whole chunk)', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
      const chunk = chunkCoveringRect(id, compId);
      const handle = makeFakeHandle(rect, [chunk], compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));

      const mesh = scene.children[0] as THREE.Mesh;
      const triangleCount = mesh.geometry.getIndex()!.count / 3;
      const fullGridTriangleCount = (NODES_PER_CHUNK - 1) * (NODES_PER_CHUNK - 1) * 2;
      expect(triangleCount).toBeGreaterThan(0);
      expect(triangleCount).not.toBe(fullGridTriangleCount);
      lm.dispose();
    });

    it('leaves a chunk that never touches the rect completely intact', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
      const chunk = makeFakeChunk(id, 400, 400, STEP, compId);
      const handle = makeFakeHandle(rect, [chunk], compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));

      const mesh = scene.children[0] as THREE.Mesh;
      expect(mesh.geometry.getIndex()!.count).toBe((NODES_PER_CHUNK - 1) * (NODES_PER_CHUNK - 1) * 6);
      lm.dispose();
    });

    it('drops the chunk entirely when every one of its quads is inside the rect (no double coverage of the claim)', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const big: Rect = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
      const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
      const chunk = makeFakeChunk(id, 0, 0, STEP, compId);
      const handle = makeFakeHandle(big, [chunk], compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));

      expect(lm.meshCount).toBe(0);
      expect(scene.children.length).toBe(0);
      lm.dispose();
    });
  });

  describe('no landscape vertex sits above the sampled height field (#491)', () => {
    it('every emitted vertex matches a linear ground-truth field exactly (interior and flat-edge nodes both interpolate exactly for a linear field)', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const field = (x: number, z: number) => 10 + 0.5 * x + 0.3 * z;
      const rect: Rect = { minX: 0, minZ: 0, maxX: 20, maxZ: 20 };
      const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
      const chunk = makeFakeChunk(id, -20, -20, 4, compId, field);
      const handle = makeFakeHandle(rect, [chunk], compId, (x, z) => ({ height: field(x, z), biomeId: 0, surfCompId: compId }));

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));
      expect(scene.children.length).toBeGreaterThan(0);

      for (const child of scene.children) {
        const mesh = child as THREE.Mesh;
        const pos = mesh.geometry.getAttribute('position').array as Float32Array;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
          expect(y).toBeCloseTo(field(x, z), 4);
        }
      }
      lm.dispose();
    });
  });

  describe('claim-boundary ring (#491: no overlap, no gap, no crack)', () => {
    it('never leaves two vertices at the same (x, z) with different heights (no T-junction crack)', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
      const field = (x: number, z: number) => 20 + Math.sin(x * 0.1) * 3 + Math.cos(z * 0.07) * 2;
      const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
      const chunk = makeFakeChunk(id, -48, -48, 4, compId, field);
      const handle = makeFakeHandle(rect, [chunk], compId, (x, z) => ({ height: field(x, z), biomeId: 0, surfCompId: compId }));

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));

      const mesh = scene.children[0] as THREE.Mesh;
      const positions = mesh.geometry.getAttribute('position').array as Float32Array;
      const heightAt = new Map<string, number>();
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
        const key = `${x.toFixed(3)},${z.toFixed(3)}`;
        const existing = heightAt.get(key);
        if (existing !== undefined) expect(y).toBeCloseTo(existing, 4);
        else heightAt.set(key, y);
      }
      lm.dispose();
    });

    it('uses the live boundaryHeightAt (not the theoretical WorldGen height) inside the boundary ring', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
      const theoreticalH = 50;
      const liveH = 12; // deliberately far off, so a fallback to the theoretical height is unmistakable
      const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
      const chunk = makeFakeChunk(id, -48, -48, 4, compId, () => theoreticalH);
      const handle = makeFakeHandle(rect, [chunk], compId, () => ({ height: theoreticalH, biomeId: 0, surfCompId: compId }));
      const cut: PlayableCut = {
        rect,
        ownsColumn: (x, z) => x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ,
        boundaryHeightAt: () => liveH,
      };

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step), cut);

      const mesh = scene.children[0] as THREE.Mesh;
      const positions = mesh.geometry.getAttribute('position').array as Float32Array;
      let sawLiveHeight = false;
      for (let i = 0; i < positions.length; i += 3) {
        if (positions[i + 1] === liveH) sawLiveHeight = true;
      }
      expect(sawLiveHeight).toBe(true);
      lm.dispose();
    });

    it('is deterministic for the same handle, palette, and cut', () => {
      const { palette, compId } = makePalette();
      const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
      const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
      const chunk = makeFakeChunk(id, -48, -48, 4, compId);
      const handle = makeFakeHandle(rect, [chunk], compId);

      const sceneA = makeScene();
      const lmA = new LandscapeMesh(sceneA, makeMaterial());
      lmA.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));
      const meshA = sceneA.children[0] as THREE.Mesh;

      const sceneB = makeScene();
      const lmB = new LandscapeMesh(sceneB, makeMaterial());
      lmB.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));
      const meshB = sceneB.children[0] as THREE.Mesh;

      expect(Array.from(meshA.geometry.getAttribute('position').array))
        .toEqual(Array.from(meshB.geometry.getAttribute('position').array));

      lmA.dispose();
      lmB.dispose();
    });
  });

  describe('pit/landscape junction continuity via PlayableCut.boundaryHeightAt (#491)', () => {
    function makeJunctionHandle(theoreticalHeight: number) {
      const { palette, compId } = makePalette();
      const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
      const chunk = makeFakeChunk(id, 0, -100, 4, compId, () => theoreticalHeight);
      const rect: Rect = { minX: 16, minZ: -1000, maxX: 1000, maxZ: 1000 };
      const handle = makeFakeHandle(rect, [chunk], compId, () => ({ height: theoreticalHeight, biomeId: 0, surfCompId: compId }));
      return { id, chunk, handle, palette, rect };
    }

    /**
     * Height of the emitted vertex nearest the claim edge (largest x still < 16),
     * restricted to genuine interior boundary-quad nodes — the flat-edge rule
     * routes every perimeter-row node through coarse-corner interpolation
     * regardless of live grid state, so only nodes off the chunk's own Z rows
     * (row spacing multiples of `step` from originZ) can ever reflect
     * boundaryHeightAt. Mirrors the pre-#1153 LandscapeMesh helper.
     */
    function closestUnownedVertexHeight(scene: THREE.Scene, originZ: number, step: number): number {
      let bestX = -Infinity;
      let bestY = NaN;
      for (const child of scene.children) {
        const mesh = child as THREE.Mesh;
        const pos = mesh.geometry.getAttribute('position')?.array as Float32Array | undefined;
        if (!pos) continue;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i]!;
          const z = pos[i + 2]!;
          const offsetFromOrigin = ((z - originZ) % step + step) % step;
          const onZPerimeter = Math.abs(offsetFromOrigin) < 1e-6;
          if (onZPerimeter) continue; // flat-edge rule node — never reflects boundaryHeightAt
          if (x < 16 && x > bestX) { bestX = x; bestY = pos[i + 1]!; }
        }
      }
      return bestY;
    }

    it('before a blast: boundary nodes track the live pre-dig height supplied by boundaryHeightAt', () => {
      const scene = makeScene();
      const { id, chunk, handle, palette, rect } = makeJunctionHandle(50);
      const cut: PlayableCut = { rect, ownsColumn: (x) => x >= 16, boundaryHeightAt: () => 50 };

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step), cut);
      expect(closestUnownedVertexHeight(scene, -100, chunk.step)).toBeCloseTo(50, 1);
      lm.dispose();
    });

    it('after a blast: boundary nodes track the lower live height, not the stale WorldGen height (#491)', () => {
      const scene = makeScene();
      const { id, chunk, handle, palette, rect } = makeJunctionHandle(50); // sampleColumn/WorldGen still reports the theoretical pre-dig 50
      const cut: PlayableCut = { rect, ownsColumn: (x) => x >= 16, boundaryHeightAt: () => 44 }; // TerrainMesh currently renders a dug crater at 44

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step), cut);
      const y = closestUnownedVertexHeight(scene, -100, chunk.step);
      expect(y).toBeCloseTo(44, 1);
      expect(Math.abs(y - 50)).toBeGreaterThan(2); // must not have fallen back to the theoretical height
      lm.dispose();
    });
  });
});

describe('rockBlendFor (#491)', () => {
  it('single-rock composition: weight 0, rockA === rockB, matching the dominant rock index', () => {
    const palette = new CompositionPalette();
    const compId = palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });

    const result = rockBlendFor(palette, compId);
    expect(result.rockA).toBe(result.rockB);
    expect(result.weight).toBe(0);
    expect(result.rockA).toBe(Math.max(0, rockIndexOf('cruite')));
  });

  it('two-rock composition: dominant sorts to rockA, runner-up to rockB, weight is the runner-up fraction', () => {
    const palette = new CompositionPalette();
    const compId = palette.intern({ rocks: [{ rockId: 'sandite', coefficient: 0.65 }, { rockId: 'molite', coefficient: 0.35 }] });

    const result = rockBlendFor(palette, compId);
    expect(result.rockA).toBe(Math.max(0, rockIndexOf('sandite')));
    expect(result.rockB).toBe(Math.max(0, rockIndexOf('molite')));
    expect(result.weight).toBeCloseTo(0.35, 5);
  });

  it('sorts by coefficient magnitude, not input array order', () => {
    const palette = new CompositionPalette();
    // Deliberately entered with the smaller coefficient first — the palette
    // itself re-sorts entries by rockId, not coefficient, so rockBlendFor must
    // do its own magnitude sort rather than trusting array order.
    const compId = palette.intern({ rocks: [{ rockId: 'molite', coefficient: 0.2 }, { rockId: 'sandite', coefficient: 0.8 }] });

    const result = rockBlendFor(palette, compId);
    expect(result.rockA).toBe(Math.max(0, rockIndexOf('sandite')));
    expect(result.rockB).toBe(Math.max(0, rockIndexOf('molite')));
    expect(result.weight).toBeCloseTo(0.2, 5);
  });

  it('air composition (palette index 0) resolves without throwing, weight 0', () => {
    const palette = new CompositionPalette();
    expect(() => rockBlendFor(palette, 0)).not.toThrow();
    const result = rockBlendFor(palette, 0);
    expect(result.weight).toBe(0);
    expect(result.rockA).toBe(result.rockB);
  });
});

describe('classifyQuad (#491)', () => {
  function cut(owns: (x: number, z: number) => boolean): PlayableCut {
    return { rect: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 }, ownsColumn: owns };
  }

  it('outside: all four corners unowned', () => {
    const playable = cut(() => false);
    expect(classifyQuad(playable, 0, 0, 4, 4)).toBe('outside');
  });

  it('inside: all four corners owned', () => {
    const playable = cut(() => true);
    expect(classifyQuad(playable, 0, 0, 4, 4)).toBe('inside');
  });

  it('boundary: exactly one corner owned', () => {
    const playable = cut((x, z) => x === 4 && z === 4);
    expect(classifyQuad(playable, 0, 0, 4, 4)).toBe('boundary');
  });

  it('boundary: exactly three corners owned', () => {
    const playable = cut((x, z) => !(x === 0 && z === 0));
    expect(classifyQuad(playable, 0, 0, 4, 4)).toBe('boundary');
  });

  it('boundary: one full side owned (two adjacent corners)', () => {
    const playable = cut((x) => x === 4);
    expect(classifyQuad(playable, 0, 0, 4, 4)).toBe('boundary');
  });

  it('boundary: two diagonally-opposite corners owned', () => {
    const playable = cut((x, z) => (x === 0 && z === 0) || (x === 4 && z === 4));
    expect(classifyQuad(playable, 0, 0, 4, 4)).toBe('boundary');
  });
});

describe('classifyQuad — cells, and a fine ring on both sides of the claim edge (#907)', () => {
  function cut(claims: (x: number, z: number) => boolean): PlayableCut {
    return {
      rect: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
      ownsColumn: claims,
      meshClaimsColumn: claims,
    };
  }

  it("counts a quad's own 16 cells, not its four corner nodes", () => {
    // The cell at x = 4 belongs to the NEXT quad. Claiming only that cell must
    // leave this quad with nothing of its own claimed — the node-corner rule
    // called it 'boundary' and kept the neighbour's cell as well, which is the
    // doubled square metre on the site's east/south edge.
    const playable = cut((x, z) => x === 4 && z === 0);
    expect(classifyQuad(playable, 0, 0, 4, 4)).toBe('boundary'); // adjacent, so still fine…
    // …but its own cells are all unclaimed, which is what the keep rule sees.
    expect(classifyQuad(cut((x, z) => x >= 4 && z >= 0), 0, 0, 4, 4)).toBe('boundary');
    expect(classifyQuad(cut((x, z) => x >= 8 && z >= 0), 0, 0, 4, 4)).toBe('outside');
  });

  it("is 'inside' only when every one of its own cells is claimed", () => {
    expect(classifyQuad(cut((x, z) => x >= 0 && x < 4 && z >= 0 && z < 4), 0, 0, 4, 4)).toBe('inside');
    // One cell short — the quad still has ground of its own to draw.
    expect(classifyQuad(cut((x, z) => x >= 0 && x < 4 && z >= 0 && z < 3), 0, 0, 4, 4)).toBe('boundary');
  });

  it("is 'boundary' for a fully-unclaimed quad that touches the claim, so the ring exists on the outside too (#907)", () => {
    // The case that put a 4 m-spaced landscape edge against a 1 m-spaced
    // playable one: with the claim edge exactly on a lattice line, the quad
    // outside it has no claimed cell at all, yet it is the quad that meets the
    // playable mesh. Edge-adjacent and corner-adjacent both count.
    expect(classifyQuad(cut(x => x >= 4), 0, 0, 4, 4)).toBe('boundary');   // shares the x = 4 edge
    expect(classifyQuad(cut(z => z >= 4), 0, 0, 4, 4)).toBe('boundary');
    expect(classifyQuad(cut((x, z) => x === 4 && z === 4), 0, 0, 4, 4)).toBe('boundary'); // diagonal only
    // Two cells away: genuinely open ground.
    expect(classifyQuad(cut(x => x >= 5), 0, 0, 4, 4)).toBe('outside');
  });

  it('is outside for a quad the claim cannot reach, without consulting the predicate', () => {
    let calls = 0;
    const playable: PlayableCut = {
      rect: { minX: 0, minZ: 0, maxX: 32, maxZ: 32 },
      ownsColumn: () => { calls++; return true; },
    };
    expect(classifyQuad(playable, 400, 400, 404, 404)).toBe('outside');
    expect(calls).toBe(0);
  });
});

describe('uniformNeighbourSteps (#1153)', () => {
  it('returns the same step on all four sides', () => {
    expect(uniformNeighbourSteps(4)).toEqual({ west: 4, east: 4, north: 4, south: 4 });
  });

  it('at the finest ladder step, every side reports the finest step', () => {
    expect(uniformNeighbourSteps(FINE_STEP)).toEqual({ west: FINE_STEP, east: FINE_STEP, north: FINE_STEP, south: FINE_STEP });
  });

  it('at the coarsest ladder step, every side reports the coarsest step', () => {
    const coarsest = LADDER_STEPS[LADDER_STEPS.length - 1]!;
    expect(uniformNeighbourSteps(coarsest)).toEqual({ west: coarsest, east: coarsest, north: coarsest, south: coarsest });
  });
});

describe('chordHeight (#1153)', () => {
  /** Non-linear in both axes, so a chord reads measurably different from the true sampled height. */
  const sample = (compId: number) => (x: number, z: number) => ({ height: x * x + z * z, biomeId: 0, surfCompId: compId });

  it('along x: interpolates linearly between the two neighbourStep-spaced nodes bracketing x, holding z fixed', () => {
    const { compId } = makePalette();
    const s = sample(compId);
    const neighbourStep = 4;
    const x = 6, z = 5;
    const h0 = s(4, z).height, h1 = s(8, z).height;
    const expected = h0 + ((x - 4) / neighbourStep) * (h1 - h0);
    expect(chordHeight(s, 'x', x, z, neighbourStep)).toBeCloseTo(expected, 9);
  });

  it('along z: interpolates linearly between the two neighbourStep-spaced nodes bracketing z, holding x fixed', () => {
    const { compId } = makePalette();
    const s = sample(compId);
    const neighbourStep = 4;
    const x = 3, z = 10;
    const h0 = s(x, 8).height, h1 = s(x, 12).height;
    const expected = h0 + ((z - 8) / neighbourStep) * (h1 - h0);
    expect(chordHeight(s, 'z', x, z, neighbourStep)).toBeCloseTo(expected, 9);
  });

  it('differs measurably from the true sampled height on a non-linear field', () => {
    const { compId } = makePalette();
    const s = sample(compId);
    const chord = chordHeight(s, 'x', 6, 5, 4);
    const trueSampled = s(6, 5).height;
    expect(Math.abs(chord - trueSampled)).toBeGreaterThan(0.5);
  });

  it('at a point exactly on a neighbourStep multiple, the chord equals the true sampled height (bracket collapses)', () => {
    const { compId } = makePalette();
    const s = sample(compId);
    expect(chordHeight(s, 'x', 8, 5, 4)).toBeCloseTo(s(8, 5).height, 9);
    expect(chordHeight(s, 'z', 3, 12, 4)).toBeCloseTo(s(3, 12).height, 9);
  });
});

describe('buildBoundaryQuad (#1153: sides is now a NeighbourSteps, not a boolean BoundaryQuadSides)', () => {
  const SUBDIV = 4; // documented fine-cell subdivision factor for a boundary quad

  /** Deliberately non-linear in x: a flat-edge interpolation reads measurably different from the true sampled height. */
  function makeSample(compId: number) {
    return (x: number, z: number) => ({ height: x * x + z, biomeId: 0, surfCompId: compId });
  }

  /** Deliberately non-linear in z (mirror of makeSample): isolates the onXEdge flat-edge branch, which interpolates along z. */
  function makeSampleZ(compId: number) {
    return (x: number, z: number) => ({ height: x + z * z, biomeId: 0, surfCompId: compId });
  }

  /** All four sides coarse (neighbourStep 2, > FINE_STEP) — the old ALL_SIDES_COARSE default, now spelled out explicitly. */
  const ALL_COARSE: NeighbourSteps = { west: 2, east: 2, north: 2, south: 2 };

  function run(playable: PlayableCut, palette: CompositionPalette, compId: number, sample = makeSample(compId), sides?: NeighbourSteps) {
    const positions: number[] = [];
    const normals: number[] = [];
    const rockA: number[] = [];
    const rockB: number[] = [];
    const rockWeight: number[] = [];
    const ore: number[] = [];
    const indices: number[] = [];
    buildBoundaryQuad(
      positions, normals, rockA, rockB, rockWeight, ore, indices,
      0, 0, 4, 4,
      sample, palette, playable,
      ...(sides ? [sides] as const : []),
    );
    return { positions, normals, rockA, rockB, rockWeight, ore, indices };
  }

  function verticesAt(positions: number[], normals: number[], x: number, z: number) {
    const out: { y: number; nx: number; ny: number; nz: number }[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      if (Math.abs(positions[i]! - x) < 1e-6 && Math.abs(positions[i + 2]! - z) < 1e-6) {
        out.push({ y: positions[i + 1]!, nx: normals[i]!, ny: normals[i + 1]!, nz: normals[i + 2]! });
      }
    }
    return out;
  }

  function heightsAt(positions: number[], x: number, z: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      if (Math.abs(positions[i]! - x) < 1e-6 && Math.abs(positions[i + 2]! - z) < 1e-6) out.push(positions[i + 1]!);
    }
    return out;
  }

  it('emits geometry for a boundary quad (coherent triangle list, non-empty)', () => {
    const { palette, compId } = makePalette();
    const playable: PlayableCut = { rect: { minX: 2, minZ: -100, maxX: 100, maxZ: 100 }, ownsColumn: (x) => x >= 2 };

    const { indices, positions } = run(playable, palette, compId);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices.length % 3).toBe(0);
    expect(positions.length / 3).toBeGreaterThan(0);
  });

  it("flat-edge rule: nodes on a coarse parent side interpolate linearly between that side's two coarse corners, not the true sampled height", () => {
    const { palette, compId } = makePalette();
    // Whole quad outside the claim so every fine cell survives — isolates the
    // flat-edge behaviour from the keep/drop rule.
    const playable: PlayableCut = { rect: { minX: 1000, minZ: 1000, maxX: 2000, maxZ: 2000 }, ownsColumn: () => false };
    const { positions } = run(playable, palette, compId, makeSample(compId), ALL_COARSE);

    const sample = makeSample(compId);
    const h00 = sample(0, 0).height; // 0
    const h40 = sample(4, 0).height; // 16
    const expectedEdge = h00 + (2 / 4) * (h40 - h00); // 8, linear interpolation
    const trueSampled = sample(2, 0).height; // 4
    expect(expectedEdge).not.toBeCloseTo(trueSampled, 3); // the field really is non-linear here

    const edgeHeights = heightsAt(positions, 2, 0);
    expect(edgeHeights.length).toBeGreaterThan(0);
    for (const h of edgeHeights) expect(h).toBeCloseTo(expectedEdge, 4);
  });

  it("flat-edge rule (onXEdge): nodes on a coarse parent left/right side interpolate linearly between that side's two coarse corners, not the true sampled height", () => {
    const { palette, compId } = makePalette();
    // Whole quad outside the claim so every fine cell survives — isolates the
    // flat-edge behaviour from the keep/drop rule. Uses a field non-linear in z
    // (mirroring the onZEdge test's field non-linear in x) so a bug that swapped
    // which pair of corners feeds this branch would show up as a wrong value.
    const playable: PlayableCut = { rect: { minX: 1000, minZ: 1000, maxX: 2000, maxZ: 2000 }, ownsColumn: () => false };
    const sample = makeSampleZ(compId);
    const { positions } = run(playable, palette, compId, sample, ALL_COARSE);

    const h00 = sample(0, 0).height; // 0
    const h04 = sample(0, 4).height; // 16
    const expectedEdge = h00 + (2 / 4) * (h04 - h00); // 8, linear interpolation along z at x=0
    const trueSampled = sample(0, 2).height; // 4
    expect(expectedEdge).not.toBeCloseTo(trueSampled, 3); // the field really is non-linear here

    const edgeHeights = heightsAt(positions, 0, 2);
    expect(edgeHeights.length).toBeGreaterThan(0);
    for (const h of edgeHeights) expect(h).toBeCloseTo(expectedEdge, 4);
  });

  it('interior nodes get the true sampled height and a height-field normal (not a flat-edge interpolation)', () => {
    const { palette, compId } = makePalette();
    const playable: PlayableCut = { rect: { minX: 1000, minZ: 1000, maxX: 2000, maxZ: 2000 }, ownsColumn: () => false };
    const { positions, normals } = run(playable, palette, compId, makeSample(compId), ALL_COARSE);

    const sample = makeSample(compId);
    const trueSampled = sample(2, 2).height; // interior node (2,2) => 4 + 2 = 6
    const verts = verticesAt(positions, normals, 2, 2);
    expect(verts.length).toBeGreaterThan(0);

    // Analytic gradient of height = x^2 + z at (2, 2): dhdx = 2x = 4, dhdz = 1.
    const dhdx = 4, dhdz = 1;
    const len = Math.hypot(dhdx, 1, dhdz);
    for (const v of verts) {
      expect(v.y).toBeCloseTo(trueSampled, 4);
      expect(v.nx).toBeCloseTo(-dhdx / len, 3);
      expect(v.ny).toBeCloseTo(1 / len, 3);
      expect(v.nz).toBeCloseTo(-dhdz / len, 3);
    }
  });

  it('keeps a fine cell only when at least one of its four corners is unowned', () => {
    const { palette, compId } = makePalette();
    // Top-right quadrant (x>=2 && z>=2) is owned by the claim — exactly the 4
    // innermost fine cells (of SUBDIV*SUBDIV=16) have every corner owned and
    // must be dropped; the other 12 keep at least one unowned corner.
    const playable: PlayableCut = {
      rect: { minX: 2, minZ: 2, maxX: 100, maxZ: 100 },
      ownsColumn: (x, z) => x >= 2 && z >= 2,
    };
    const { indices } = run(playable, palette, compId);
    const totalCells = SUBDIV * SUBDIV;
    const fullyOwnedCells = 4;
    const keptCells = totalCells - fullyOwnedCells;
    expect(indices.length).toBe(keptCells * 6); // 2 triangles (6 indices) per kept cell
  });

  it('array lengths stay coherent: one rockA/rockB/rockWeight per vertex, two entries per vertex in ore', () => {
    const { palette, compId } = makePalette();
    const playable: PlayableCut = { rect: { minX: 1000, minZ: 1000, maxX: 2000, maxZ: 2000 }, ownsColumn: () => false };
    const { positions, normals, rockA, rockB, rockWeight, ore } = run(playable, palette, compId);

    const vertexCount = positions.length / 3;
    expect(vertexCount).toBeGreaterThan(0);
    expect(normals.length).toBe(positions.length);
    expect(rockA.length).toBe(vertexCount);
    expect(rockB.length).toBe(vertexCount);
    expect(rockWeight.length).toBe(vertexCount);
    expect(ore.length).toBe(vertexCount * 2);
  });
});

describe('LandscapeMesh.buildChunk — normals come from the height field, not the triangles (#458)', () => {
  /** Deliberately non-planar: a plane would hide the difference, since every scheme agrees on one. */
  const bumpy = (row: number, col: number): number => 10 + Math.sin(col * 0.9) * 2 + Math.cos(row * 0.7) * 1.5;

  function makeBumpyChunk(id: LandscapeChunkId, compId: number, step: number): LandscapeChunk {
    const n = NODES_PER_CHUNK;
    const heights = new Float32Array(n * n);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) heights[row * n + col] = bumpy(row, col);
    }
    return {
      id, step, originX: -1000, originZ: -1000,
      heights, biomeIds: new Uint8Array(n * n), surfCompIds: new Uint16Array(n * n).fill(compId),
    };
  }

  const step = 4;

  function buildBumpy(): { mesh: THREE.Mesh; lm: LandscapeMesh } {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 1_000_000, minZ: 1_000_000, maxX: 1_000_032, maxZ: 1_000_032 }; // never touches the chunk
    const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
    const chunk = makeBumpyChunk(id, compId, step);
    const handle = makeFakeHandle(rect, [chunk], compId);
    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.buildChunk(id, handle, palette, uniformNeighbourSteps(step));
    const mesh = scene.children[0] as THREE.Mesh;
    return { mesh, lm };
  }

  it('matches the analytic slope of the sampled heights at interior vertices', () => {
    const { mesh, lm } = buildBumpy();
    const normals = mesh.geometry.getAttribute('normal').array as Float32Array;

    for (const [row, col] of [[3, 3], [4, 5], [5, 2], [2, 6]] as const) {
      const dhdx = (bumpy(row, col + 1) - bumpy(row, col - 1)) / (2 * step);
      const dhdz = (bumpy(row + 1, col) - bumpy(row - 1, col)) / (2 * step);
      const len = Math.hypot(dhdx, 1, dhdz);
      const idx = (row * NODES_PER_CHUNK + col) * 3;
      expect(normals[idx]!).toBeCloseTo(-dhdx / len, 5);
      expect(normals[idx + 1]!).toBeCloseTo(1 / len, 5);
      expect(normals[idx + 2]!).toBeCloseTo(-dhdz / len, 5);
    }
    lm.dispose();
  });

  it('emits unit-length, upward normals everywhere', () => {
    const { mesh, lm } = buildBumpy();
    const normals = mesh.geometry.getAttribute('normal').array as Float32Array;
    for (let i = 0; i < normals.length; i += 3) {
      expect(Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!)).toBeCloseTo(1, 4);
      expect(normals[i + 1]!).toBeGreaterThan(0);
    }
    lm.dispose();
  });

  it('boundary-ring vertices are shaded from the sampled height field too (#491)', () => {
    // The boundary ring's fine nodes are appended past the chunk's own
    // NODES_PER_CHUNK^2 coarse nodes (buildChunkMesh pushes those unconditionally
    // first), so indices >= NODES_PER_CHUNK^2 identify them without needing to
    // know which quads were classified 'boundary'.
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    // A slope steep enough that a wrong normal is unmistakable.
    const sample = (x: number, z: number) => ({ height: 20 + x * 0.25 - z * 0.1, biomeId: 0, surfCompId: compId });
    const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
    const chunk = makeFakeChunk(id, -48, -48, 4, compId, (x, z) => sample(x, z).height);
    const handle = makeFakeHandle(rect, [chunk], compId, sample);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));
    const mesh = scene.children[0] as THREE.Mesh;
    const normals = mesh.geometry.getAttribute('normal').array as Float32Array;
    const vertexCount = normals.length / 3;
    expect(vertexCount).toBeGreaterThan(NODES_PER_CHUNK * NODES_PER_CHUNK); // boundary ring really did append vertices

    const len = Math.hypot(0.25, 1, -0.1);
    for (let i = NODES_PER_CHUNK * NODES_PER_CHUNK; i < vertexCount; i++) {
      expect(normals[i * 3]!).toBeCloseTo(-0.25 / len, 3);
      expect(normals[i * 3 + 1]!).toBeCloseTo(1 / len, 3);
      expect(normals[i * 3 + 2]!).toBeCloseTo(0.1 / len, 3);
    }
    lm.dispose();
  });
});

describe('LandscapeMesh.buildChunk — per-biome coverage (#491)', () => {
  for (const biome of getAllBiomes()) {
    it(`${biome.id}: buildChunk() produces a continuous, blended surface with no double coverage of the claim`, () => {
      const scene = makeScene();
      const palette = new CompositionPalette();
      const [primary, secondary] = biome.dominantRocks;
      const compId = palette.intern({
        rocks: secondary
          ? [{ rockId: primary!, coefficient: 0.7 }, { rockId: secondary, coefficient: 0.3 }]
          : [{ rockId: primary!, coefficient: 1 }],
      });
      const rect: Rect = { minX: 0, minZ: 0, maxX: 20, maxZ: 20 };
      const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
      const chunk = makeFakeChunk(id, -40, -40, 4, compId, () => 12);
      const handle = makeFakeHandle(rect, [chunk], compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step));

      expect(lm.meshCount).toBe(1);
      const mesh = scene.children[0] as THREE.Mesh;
      const geo = mesh.geometry;
      const rockAArr = geo.getAttribute('aRockA').array as Float32Array;
      const rockBArr = geo.getAttribute('aRockB').array as Float32Array;
      const weightArr = geo.getAttribute('aRockWeight').array as Float32Array;

      for (let i = 0; i < weightArr.length; i++) {
        expect(weightArr[i]).toBeGreaterThanOrEqual(0);
        expect(weightArr[i]).toBeLessThanOrEqual(1);
      }

      if (secondary) {
        expect(rockAArr[0]).not.toBe(rockBArr[0]);
        expect(weightArr[0]).toBeCloseTo(0.3, 5);
      } else {
        expect(rockAArr[0]).toBe(rockBArr[0]);
        expect(weightArr[0]).toBe(0);
      }
      lm.dispose();
    });
  }
});

// #559: the landscape/playable-mesh boundary. Root causes 3 and 4 of that
// issue: LandscapeMesh must not read a NaN live height as a real one, and
// must treat TerrainMesh's own meshing footprint (meshClaimsColumn), not raw
// ownsColumn, as ground it must not draw into.

describe('LandscapeMesh.buildChunk — dense boundary sample walk against a known height field (#559)', () => {
  const POSITION_TOLERANCE = 1e-3;
  const NORMAL_ANGLE_TOLERANCE_DEG = 5;

  it('every boundary-ring vertex along a dense walk of the site edge matches the theoretical height and slope within tolerance', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    // A single flat plane: the playable surface height function and the
    // landscape height function are literally the same function, so they
    // agree everywhere -- including densely along the whole boundary, not
    // just at one spot-checked point.
    const field = (x: number, z: number) => 20 + x * 0.2 - z * 0.15;
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
    const chunk = makeFakeChunk(id, -100, -100, 4, compId, field);
    const handle = makeFakeHandle(rect, [chunk], compId, (x, z) => ({ height: field(x, z), biomeId: 0, surfCompId: compId }));
    const cut: PlayableCut = { rect, ownsColumn: (x, z) => x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ, boundaryHeightAt: field };

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step), cut);

    const dhdx = 0.2, dhdz = -0.15; // analytic slope of `field`
    const expectedLen = Math.hypot(dhdx, 1, dhdz);
    const expectedNormal = [-dhdx / expectedLen, 1 / expectedLen, -dhdz / expectedLen] as const;
    const angleToleranceRad = (NORMAL_ANGLE_TOLERANCE_DEG * Math.PI) / 180;

    let sampled = 0;
    for (const child of scene.children) {
      const mesh = child as THREE.Mesh;
      const pos = mesh.geometry.getAttribute('position').array as Float32Array;
      const nrm = mesh.geometry.getAttribute('normal').array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
        const inExtendedBox =
          x >= rect.minX - 2 && x <= rect.maxX + 2 && z >= rect.minZ - 2 && z <= rect.maxZ + 2;
        const nearBoundary =
          inExtendedBox && (
            Math.abs(x - rect.minX) < 2 || Math.abs(x - rect.maxX) < 2 ||
            Math.abs(z - rect.minZ) < 2 || Math.abs(z - rect.maxZ) < 2
          );
        if (!nearBoundary) continue;
        sampled++;

        expect(Math.abs(y - field(x, z))).toBeLessThan(POSITION_TOLERANCE);

        const nx = nrm[i]!, ny = nrm[i + 1]!, nz = nrm[i + 2]!;
        const dot = nx * expectedNormal[0] + ny * expectedNormal[1] + nz * expectedNormal[2];
        const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
        expect(angle).toBeLessThan(angleToleranceRad);
      }
    }
    expect(sampled).toBeGreaterThan(0); // the walk actually found boundary vertices to check
    lm.dispose();
  });
});

describe('LandscapeMesh.buildChunk — classifyQuad/buildBoundaryQuad must honor meshClaimsColumn, not raw ownsColumn (#559 root cause 4)', () => {
  it('emits no triangle inside the west halo column TerrainMesh now claims via meshClaimsColumn', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
    const chunk = makeFakeChunk(id, -100, -100, 1, compId);
    const handle = makeFakeHandle(rect, [chunk], compId);

    const cut: PlayableCut = {
      rect,
      ownsColumn: (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32,
      // Mirrors TerrainMesh's own outward march (rebuildChunk's xStart =
      // rect.minX - 1 when no owned chunk lies to the west): one extra
      // column claimed to the west of ownsColumn's own rect, same z range.
      meshClaimsColumn: (x, z) => x >= -1 && x < 32 && z >= 0 && z < 32,
    };

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step), cut);

    // With chunk step 1m (FINE_STEP) every emitted vertex sits at an integer x
    // whether or not the halo cell is skipped, so a vertex-position range
    // check can never fail regardless of what classifyQuad/buildBoundaryQuad
    // do. Check the index buffer instead: the fine cell whose 4 corners are
    // (x=-1,z)/(x=0,z)/(x=-1,z+1)/(x=0,z+1) is exactly the halo column
    // TerrainMesh now claims via meshClaimsColumn, so no triangle may span it.
    let haloColumnTriangles = 0;
    for (const child of scene.children) {
      const mesh = child as THREE.Mesh;
      const pos = mesh.geometry.getAttribute('position').array as Float32Array;
      const index = mesh.geometry.getIndex();
      if (!index) continue;
      const idx = index.array;
      for (let t = 0; t < idx.length; t += 3) {
        const xs = [0, 1, 2].map(k => pos[idx[t + k]! * 3]!);
        const zs = [0, 1, 2].map(k => pos[idx[t + k]! * 3 + 2]!);
        const allOnHaloEdges = xs.every(x => Math.abs(x + 1) < 1e-6 || Math.abs(x) < 1e-6);
        const spansBothEdges = xs.some(x => Math.abs(x + 1) < 1e-6) && xs.some(x => Math.abs(x) < 1e-6);
        const strictlyInsideRectZ = zs.every(z => z >= rect.minZ - 1e-6 && z < rect.maxZ - 1e-6);
        if (allOnHaloEdges && spansBothEdges && strictlyInsideRectZ) haloColumnTriangles++;
      }
    }
    expect(haloColumnTriangles).toBe(0);
    lm.dispose();
  });

  it('still emits ground two columns west of the rect, outside even the meshClaimsColumn halo', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
    const chunk = makeFakeChunk(id, -100, -100, 1, compId);
    const handle = makeFakeHandle(rect, [chunk], compId);

    const cut: PlayableCut = {
      rect,
      ownsColumn: (x, z) => x >= 0 && x < 32 && z >= 0 && z < 32,
      meshClaimsColumn: (x, z) => x >= -1 && x < 32 && z >= 0 && z < 32,
    };

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step), cut);

    let sawFarWestGround = false;
    for (const child of scene.children) {
      const mesh = child as THREE.Mesh;
      const pos = mesh.geometry.getAttribute('position').array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i]! < -1 - 1e-6) sawFarWestGround = true;
      }
    }
    expect(sawFarWestGround).toBe(true);
    lm.dispose();
  });
});

describe('LandscapeMesh.buildChunk — boundaryHeightAt NaN falls back to the theoretical sampleColumn height (#559 root cause 2/3)', () => {
  it('never emits a NaN position or normal, and falls back to the theoretical height, for an irregular (#473-style) shape whose unowned notch reports NaN', () => {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const theoreticalH = 30;
    const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
    const chunk = makeFakeChunk(id, -100, -100, 1, compId, () => theoreticalH);
    const handle = makeFakeHandle(rect, [chunk], compId, () => ({ height: theoreticalH, biomeId: 0, surfCompId: compId }));

    // Irregular #473-style shape inside the rectangular rect: an L, where the
    // (x < 16, z < 16) corner is an unclaimed notch.
    const cut: PlayableCut = {
      rect,
      ownsColumn: (x, z) => x >= 16 || z >= 16,
      // Mirrors computeVoxelColumnSurfaceHeight's post-#559 answer for a
      // column truly outside every owned chunk: NaN, not a clamped guess.
      boundaryHeightAt: (x, z) => (x < 16 && z < 16 ? NaN : theoreticalH),
    };

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.buildChunk(id, handle, palette, uniformNeighbourSteps(chunk.step), cut);

    expect(scene.children.length).toBeGreaterThan(0);
    for (const child of scene.children) {
      const mesh = child as THREE.Mesh;
      const pos = mesh.geometry.getAttribute('position').array as Float32Array;
      const nrm = mesh.geometry.getAttribute('normal').array as Float32Array;
      for (const v of pos) expect(Number.isNaN(v)).toBe(false);
      for (const v of nrm) expect(Number.isNaN(v)).toBe(false);
      // Every vertex height must land on the theoretical field's constant
      // height -- both because the true field IS that constant everywhere,
      // and because the notch's own boundaryHeightAt reports NaN, so any
      // vertex sampled there can only be correct by having fallen back.
      for (let i = 1; i < pos.length; i += 3) {
        expect(pos[i]).toBeCloseTo(theoreticalH, 4);
      }
    }
    lm.dispose();
  });
});

describe('buildBoundaryQuad — the flat-edge rule stops at the claim (#907)', () => {
  /** Curved in both axes, so a 4 m chord is measurably wrong everywhere. */
  const curved = (compId: number) => (x: number, z: number) => ({
    height: 10 + Math.sin(x * 1.3) * 2 + Math.cos(z * 0.9) * 1.5,
    biomeId: 0,
    surfCompId: compId,
  });

  function run(playable: PlayableCut, palette: CompositionPalette, compId: number, sides?: NeighbourSteps) {
    const positions: number[] = [], normals: number[] = [], rockA: number[] = [];
    const rockB: number[] = [], rockWeight: number[] = [], ore: number[] = [], indices: number[] = [];
    buildBoundaryQuad(
      positions, normals, rockA, rockB, rockWeight, ore, indices,
      0, 0, 4, 4, curved(compId), palette, playable,
      ...(sides ? [sides] as const : []),
    );
    return { positions, indices };
  }

  function heightAt(positions: number[], x: number, z: number): number | null {
    for (let i = 0; i < positions.length; i += 3) {
      if (Math.abs(positions[i]! - x) < 1e-6 && Math.abs(positions[i + 2]! - z) < 1e-6) return positions[i + 1]!;
    }
    return null;
  }

  it('keeps a fine cell on its own minimum corner alone — never on a neighbour cell\'s corner node', () => {
    const { palette, compId } = makePalette();
    // Cells 0..2 unclaimed, cell 3 (spanning x 3..4) claimed.
    const claims = (x: number): boolean => Math.floor(x) >= 3;
    const playable: PlayableCut = {
      rect: { minX: 3, minZ: -100, maxX: 100, maxZ: 100 },
      ownsColumn: claims, meshClaimsColumn: claims,
    };
    const { positions } = run(playable, palette, compId);
    // Node x = 3 is the shared ring and must be emitted; node x = 4 belongs
    // only to the dropped cell and must not be.
    expect(heightAt(positions, 3, 2)).not.toBeNull();
    expect(heightAt(positions, 4, 2)).toBeNull();
  });

  it('places a node facing the claim at the sampled height, not on the parent chord', () => {
    const { palette, compId } = makePalette();
    const claims = (x: number): boolean => Math.floor(x) >= 4; // claim edge exactly on the quad's east side
    const playable: PlayableCut = {
      rect: { minX: 4, minZ: -100, maxX: 100, maxZ: 100 },
      ownsColumn: claims, meshClaimsColumn: claims,
    };
    const sample = curved(compId);
    const { positions } = run(playable, palette, compId, {
      west: 2, east: 1, north: 2, south: 2, // east faces the claim: fine (not coarse)
    });

    const y = heightAt(positions, 4, 2);
    expect(y).not.toBeNull();
    expect(y!).toBeCloseTo(sample(4, 2).height, 9);
    // ...and that is a different number from the chord the flat-edge rule
    // would have put there, so the assertion above has teeth.
    const chord = sample(4, 0).height + (2 / 4) * (sample(4, 4).height - sample(4, 0).height);
    expect(Math.abs(y! - chord)).toBeGreaterThan(0.1);
  });

  it('still follows the parent chord on a side facing a coarser neighbour (#491 T-junction rule kept)', () => {
    const { palette, compId } = makePalette();
    const claims = (x: number): boolean => Math.floor(x) >= 4;
    const playable: PlayableCut = {
      rect: { minX: 4, minZ: -100, maxX: 100, maxZ: 100 },
      ownsColumn: claims, meshClaimsColumn: claims,
    };
    const sample = curved(compId);
    const { positions } = run(playable, palette, compId, {
      west: 2, east: 1, north: 2, south: 2,
    });

    const y = heightAt(positions, 2, 0); // north side, facing a coarse neighbour
    expect(y).not.toBeNull();
    const chord = sample(0, 0).height + (2 / 4) * (sample(4, 0).height - sample(0, 0).height);
    expect(y!).toBeCloseTo(chord, 9);
  });

  it('defaults every side to the true sampled height (no chord) when no neighbourhood is supplied — a lone chunk assumes same-step neighbours', () => {
    // uniformNeighbourSteps(FINE_STEP) is the default: every side reports the
    // SAME step as this quad's own, so none is "coarser" and no side chords.
    // This is the opposite of the pre-#1153 default (which assumed every
    // side coarse) — a lone chunk with no streamer-classified neighbourhood
    // now assumes a same-resolution neighbour, not a coarser one.
    const { palette, compId } = makePalette();
    const claims = (x: number): boolean => Math.floor(x) >= 4;
    const playable: PlayableCut = {
      rect: { minX: 4, minZ: -100, maxX: 100, maxZ: 100 },
      ownsColumn: claims, meshClaimsColumn: claims,
    };
    const sample = curved(compId);
    const { positions } = run(playable, palette, compId);
    const trueSampled = sample(4, 2).height;
    expect(heightAt(positions, 4, 2)!).toBeCloseTo(trueSampled, 9);
  });
});
