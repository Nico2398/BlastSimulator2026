// TerrainMesh — unit tests
// Tests geometry generation from VoxelGrid without needing a browser.

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { VoxelGrid, CHUNK_SIZE } from '../../../src/core/world/VoxelGrid.js';
import {
  TerrainMesh,
  SurveyConfidenceOverlay,
  virtualEdgeDensity,
  SKIRT_VISIBILITY_MARGIN_M,
  type SurveyConfidencePoint,
  type SurveyConfidenceOverlayOptions,
} from '../../../src/renderer/TerrainMesh.js';
import { TerrainMaterial } from '../../../src/renderer/terrain/TerrainMaterial.js';

/** Access to TerrainMesh's private #560 stubs — TS-private, not runtime-private,
 *  so a narrow structural cast is enough to exercise the documented contract
 *  directly rather than only through indirect geometry assertions. */
type TerrainMeshSkirtInternals = {
  boundarySkirtFloorY(
    x: number, z: number,
    rect: { minX: number; minZ: number; maxX: number; maxZ: number },
    hasWest: boolean, hasEast: boolean, hasNorth: boolean, hasSouth: boolean,
  ): number | null;
  canSkipChunkMarch(
    cx: number, cy: number, cz: number,
    rect: { minX: number; minZ: number; maxX: number; maxZ: number },
  ): boolean;
};
function skirtInternals(tm: TerrainMesh): TerrainMeshSkirtInternals {
  return tm as unknown as TerrainMeshSkirtInternals;
}

// Minimal mock THREE.Scene — just captures adds/removes
function makeScene(): THREE.Scene {
  return new THREE.Scene();
}

function makeSolidVoxel(rockId = 'sandite'): import('../../../src/core/world/VoxelGrid.js').VoxelData {
  return { composition: { rocks: [{ rockId, coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
}

// #560: 3x3 chunks horizontally, 2 chunks tall, fully solid throughout — chunk
// (1, 0, 1) sits fully enclosed on every side: 4 solid owned horizontal
// neighbours, and solid material continuing above it into chunk cy=1, so no
// surface of any kind (wall or ground) passes through its own slab. The
// canonical "provably skippable, no marching needed" fixture.
const MULTI_CHUNK_SIZE_XZ = CHUNK_SIZE * 3;
const MULTI_CHUNK_SIZE_Y = CHUNK_SIZE * 2;
function fullySolidMultiChunkGrid(): VoxelGrid {
  const grid = new VoxelGrid(MULTI_CHUNK_SIZE_XZ, MULTI_CHUNK_SIZE_Y, MULTI_CHUNK_SIZE_XZ);
  for (let x = 0; x < MULTI_CHUNK_SIZE_XZ; x++)
    for (let y = 0; y < MULTI_CHUNK_SIZE_Y; y++)
      for (let z = 0; z < MULTI_CHUNK_SIZE_XZ; z++)
        grid.setVoxel(x, y, z, makeSolidVoxel());
  return grid;
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

  it('buildAll on a fully-solid grid seals the sides, but does not cap the floor (#560)', () => {
    // The grid is a finite volume, not an infinite solid: its side faces are
    // real surfaces, and stay sealed. But #560 removes the floor cap that
    // used to close the bottom too — an invisible, wasted surface under the
    // whole site. Only the visible ground and the boundary/skirt walls are
    // emitted; nothing closes the bottom of the world.
    const scene = makeScene();
    const grid = new VoxelGrid(4, 4, 4);
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 4; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel());
    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();

    expect(scene.children.length).toBeGreaterThan(0);

    // The four side faces must still carry geometry reaching the site edge.
    const pos = (scene.children[0] as THREE.Mesh).geometry.getAttribute('position').array as Float32Array;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxZ = -Infinity, minZ = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i]!);     maxX = Math.max(maxX, pos[i]!);
      minY = Math.min(minY, pos[i + 1]!);
      minZ = Math.min(minZ, pos[i + 2]!); maxZ = Math.max(maxZ, pos[i + 2]!);
    }
    expect(minX).toBeLessThanOrEqual(-0.5);
    expect(maxX).toBeGreaterThanOrEqual(3.5);
    expect(minZ).toBeLessThanOrEqual(-0.5);
    expect(maxZ).toBeGreaterThanOrEqual(3.5);
    // No floor cap: the old sealed box put its lowest vertex at y = -0.5 (one
    // cell below the grid). #560's fallback (no sampler installed) still
    // marches the skirt walls to the very bottom of the grid (y = 0), but
    // never below it.
    expect(minY).toBeGreaterThanOrEqual(-1e-6);
    tm.dispose();
  });

  describe('site boundary is sealed', () => {
    /** Widest X reached by any vertex across every chunk mesh in the scene. */
    function maxVertexX(scene: THREE.Scene): number {
      let m = -Infinity;
      for (const child of scene.children) {
        const geo = (child as THREE.Mesh).geometry;
        if (!geo) continue;
        const pos = geo.getAttribute('position').array as Float32Array;
        for (let i = 0; i < pos.length; i += 3) m = Math.max(m, pos[i]!);
      }
      return m;
    }

    /** Terrain filled solid below `surfaceY`, air above — a flat site. */
    function flatSite(size: number, surfaceY: number): VoxelGrid {
      const grid = new VoxelGrid(size, size, size);
      for (let x = 0; x < size; x++)
        for (let y = 0; y < surfaceY; y++)
          for (let z = 0; z < size; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      return grid;
    }

    it('closes the far X face so the volume is not an open shell', () => {
      const scene = makeScene();
      const size = 8;
      const tm = new TerrainMesh(scene, flatSite(size, 4));
      tm.buildAll();
      // The wall is interpolated midway between the last solid voxel and the
      // empty cell past it, i.e. at size - 0.5.
      expect(maxVertexX(scene)).toBeGreaterThanOrEqual(size - 0.5 - 1e-4);
      tm.dispose();
    });

    it('still closes it after an edge blast cuts terrain away at that face', () => {
      // The reported defect: blasting at the edge of the site opened a void
      // between the playable mesh and the landscape, because the mesh had no
      // face there to cut into — you saw straight through it.
      const scene = makeScene();
      const size = 8;
      const grid = flatSite(size, 4);
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();

      // Blow a hole through the whole depth of the boundary column.
      for (let y = 0; y < 4; y++) {
        for (let z = 2; z < 5; z++) {
          grid.clearVoxel(size - 1, y, z);
          grid.clearVoxel(size - 2, y, z);
        }
      }
      tm.remeshRegion({ minX: size - 2, minY: 0, minZ: 2, maxX: size - 1, maxY: 3, maxZ: 4 });

      // Geometry must still reach the boundary: the surrounding rock keeps its
      // wall, so the crater is cut into a solid face rather than into nothing.
      expect(maxVertexX(scene)).toBeGreaterThanOrEqual(size - 0.5 - 1e-4);
      tm.dispose();
    });
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

  it('chunk meshes cast and receive shadows (#458 T5.1/CSM)', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(8, 8, 8);
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 8; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel());
    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    const mesh = scene.children.find(c => c instanceof THREE.Mesh) as THREE.Mesh;
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    tm.dispose();
  });

  it('generated geometry has position and rock/ore attributes, no CPU vertex color (#458 T4.1/A18)', () => {
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
    // Color now comes entirely from TerrainMaterial's shader (#458 T4.1/D9).
    expect(geo.getAttribute('color')).toBeUndefined();
    expect(geo.getAttribute('aRockA')).toBeDefined();
    expect(geo.getAttribute('aRockB')).toBeDefined();
    expect(geo.getAttribute('aRockWeight')).toBeDefined();
    expect(geo.getAttribute('aOre')).toBeDefined();
    expect(geo.getAttribute('aOre').itemSize).toBe(2);

    // cruite is the only rock present — both A and B should index it, weight
    // should be 0 or 1 everywhere (no cross-rock boundary in a single-rock grid).
    const rockAAttr = geo.getAttribute('aRockA').array as Float32Array;
    const cruiteIndex = rockAAttr[0]!;
    for (const v of rockAAttr) expect(v).toBe(cruiteIndex);
    tm.dispose();
  });

  it('aOreId is -1 and aOreAmt is 0 when no corner carries ore', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(8, 8, 8);
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 8; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel('cruite')); // no ores set

    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    const mesh = scene.children[0] as THREE.Mesh;
    const oreAttr = mesh.geometry.getAttribute('aOre').array as Float32Array;
    for (let i = 0; i < oreAttr.length; i += 2) {
      expect(oreAttr[i]).toBe(-1);
      expect(oreAttr[i + 1]).toBe(0);
    }
    tm.dispose();
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

  describe('remeshRegion — dirty-set precision (#458 T3.1/A17 accept criterion)', () => {
    // 3 chunks along X (0..15, 16..31, 32..47), 1 along Y/Z. Solid bottom
    // half everywhere so every chunk has real geometry to compare identity against.
    function makeThreeChunkGrid(): VoxelGrid {
      const grid = new VoxelGrid(48, 16, 16);
      for (let x = 0; x < 48; x++)
        for (let y = 0; y < 8; y++)
          for (let z = 0; z < 16; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      return grid;
    }

    it('a region at a chunk boundary re-marches exactly the touched chunks plus the -1 halo, and no others', () => {
      const scene = makeScene();
      const grid = makeThreeChunkGrid();
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();
      expect(tm.chunkGridDims).toEqual({ ncx: 3, ncy: 1, ncz: 1 });

      const mesh0Before = tm.getChunkMesh(0, 0, 0);
      const mesh1Before = tm.getChunkMesh(1, 0, 0);
      const mesh2Before = tm.getChunkMesh(2, 0, 0);
      expect(mesh0Before).not.toBeNull();
      expect(mesh1Before).not.toBeNull();
      expect(mesh2Before).not.toBeNull();

      // Mutate one voxel at x=16 — chunk 1's very first column. The dirty
      // region's min edge sits exactly on the chunk boundary, so the -1 read
      // margin (marching a cube at v reads up to v+1, so a change at v
      // affects cubes from v-1) pulls chunk 0 in too as a halo — this is the
      // "+halo" the accept criterion names, not an off-by-one.
      grid.clearVoxel(16, 0, 5);
      tm.remeshRegion({ minX: 16, minY: 0, minZ: 5, maxX: 16, maxY: 0, maxZ: 5 });

      // Touched: chunk 0 (halo) and chunk 1 (directly) — new mesh instances.
      expect(tm.getChunkMesh(0, 0, 0)).not.toBe(mesh0Before);
      expect(tm.getChunkMesh(1, 0, 0)).not.toBe(mesh1Before);
      // Untouched: chunk 2 — same mesh instance, never disposed or rebuilt.
      expect(tm.getChunkMesh(2, 0, 0)).toBe(mesh2Before);

      tm.dispose();
    });

    it('a region entirely inside one chunk, away from its edges, touches only that chunk', () => {
      const scene = makeScene();
      const grid = makeThreeChunkGrid();
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();

      const mesh0Before = tm.getChunkMesh(0, 0, 0);
      const mesh1Before = tm.getChunkMesh(1, 0, 0);
      const mesh2Before = tm.getChunkMesh(2, 0, 0);

      // x=20..22 sits well inside chunk 1 (16..31), away from both edges.
      grid.clearVoxel(20, 0, 5);
      tm.remeshRegion({ minX: 20, minY: 0, minZ: 5, maxX: 22, maxY: 0, maxZ: 5 });

      expect(tm.getChunkMesh(0, 0, 0)).toBe(mesh0Before); // untouched
      expect(tm.getChunkMesh(1, 0, 0)).not.toBe(mesh1Before); // rebuilt
      expect(tm.getChunkMesh(2, 0, 0)).toBe(mesh2Before); // untouched

      tm.dispose();
    });

    it('full rebuild (buildAll) touches every chunk, including ones a prior remeshRegion left untouched', () => {
      const scene = makeScene();
      const grid = makeThreeChunkGrid();
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();

      grid.clearVoxel(20, 0, 5);
      tm.remeshRegion({ minX: 20, minY: 0, minZ: 5, maxX: 20, maxY: 0, maxZ: 5 });
      const mesh2AfterPartialRemesh = tm.getChunkMesh(2, 0, 0); // untouched by the partial remesh above

      tm.buildAll();
      expect(tm.getChunkMesh(2, 0, 0)).not.toBe(mesh2AfterPartialRemesh); // full rebuild touches it too

      tm.dispose();
    });
  });

  describe('adjacent chunks share exact boundary geometry (#491)', () => {
    it('shares exact position AND normal at the seam between two chunks, for a surface that varies along the seam', () => {
      // A flat, uniform surface would make any implementation agree trivially.
      // Varying the surface height by z gives the boundary several distinct
      // vertices, each a real test that both chunks compute the identical
      // interpolated crossing from the same shared VoxelGrid data.
      const scene = makeScene();
      const grid = new VoxelGrid(32, 16, 16); // 2 chunks along x (16 each), 1 along y/z
      for (let x = 0; x < 32; x++) {
        for (let z = 0; z < 16; z++) {
          const surfaceY = 4 + (z % 5); // varies 4..8 with z
          for (let y = 0; y < surfaceY; y++) grid.setVoxel(x, y, z, makeSolidVoxel());
        }
      }
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();

      const mesh0 = tm.getChunkMesh(0, 0, 0);
      const mesh1 = tm.getChunkMesh(1, 0, 0);
      expect(mesh0).not.toBeNull();
      expect(mesh1).not.toBeNull();

      function boundaryVertices(mesh: THREE.Mesh): Map<string, { position: [number, number, number]; normal: [number, number, number] }> {
        const pos = mesh.geometry.getAttribute('position').array as Float32Array;
        const nrm = mesh.geometry.getAttribute('normal').array as Float32Array;
        const out = new Map<string, { position: [number, number, number]; normal: [number, number, number] }>();
        for (let i = 0; i < pos.length; i += 3) {
          if (Math.abs(pos[i]! - 16) < 1e-9) {
            const key = `${pos[i + 1]!.toFixed(4)},${pos[i + 2]!.toFixed(4)}`;
            out.set(key, {
              position: [pos[i]!, pos[i + 1]!, pos[i + 2]!],
              normal: [nrm[i]!, nrm[i + 1]!, nrm[i + 2]!],
            });
          }
        }
        return out;
      }

      const b0 = boundaryVertices(mesh0!);
      const b1 = boundaryVertices(mesh1!);
      expect(b0.size).toBeGreaterThan(0);

      for (const [key, v0] of b0) {
        const v1 = b1.get(key);
        expect(v1).toBeDefined();
        expect(v1!.position[0]).toBeCloseTo(v0.position[0], 6);
        expect(v1!.position[1]).toBeCloseTo(v0.position[1], 6);
        expect(v1!.position[2]).toBeCloseTo(v0.position[2], 6);
        expect(v1!.normal[0]).toBeCloseTo(v0.normal[0], 6);
        expect(v1!.normal[1]).toBeCloseTo(v0.normal[1], 6);
        expect(v1!.normal[2]).toBeCloseTo(v0.normal[2], 6);
      }
      tm.dispose();
    });
  });

  describe('virtualEdgeDensity (#559)', () => {
    // Same half-voxel crossing convention as emitVertex/
    // computeVoxelColumnSurfaceHeight: solid (1) a half-voxel below the
    // surface, air (0) a half-voxel above, linear in between.
    it('is 1 well below surfaceHeight - 0.5 (fully solid)', () => {
      expect(virtualEdgeDensity(5, 2)).toBe(1);
      expect(virtualEdgeDensity(5, 4)).toBe(1);
    });

    it('is 0 well above surfaceHeight + 0.5 (fully air)', () => {
      expect(virtualEdgeDensity(5, 6)).toBe(0);
      expect(virtualEdgeDensity(5, 8)).toBe(0);
    });

    it('is exactly 0.5 at the crossing height itself', () => {
      expect(virtualEdgeDensity(5, 5)).toBeCloseTo(0.5, 6);
    });

    it('interpolates linearly across the one-voxel transition band', () => {
      expect(virtualEdgeDensity(5, 4.5)).toBeCloseTo(1, 6);
      expect(virtualEdgeDensity(5, 4.75)).toBeCloseTo(0.75, 6);
      expect(virtualEdgeDensity(5, 5.25)).toBeCloseTo(0.25, 6);
      expect(virtualEdgeDensity(5, 5.5)).toBeCloseTo(0, 6);
    });

    it('is stable across different surfaceHeight values (translation invariant)', () => {
      expect(virtualEdgeDensity(10, 10)).toBeCloseTo(virtualEdgeDensity(5, 5), 6);
      expect(virtualEdgeDensity(10, 10.25)).toBeCloseTo(virtualEdgeDensity(5, 5.25), 6);
    });
  });

  describe('edge vertex normals honor an installed EdgeHeightSampler (#559)', () => {
    const SURFACE_Y = 4; // flat terrain: solid y < 4, air y >= 4 -> crossing at y = 3.5
    const SIZE = 8;

    function flatGrid(): VoxelGrid {
      const grid = new VoxelGrid(SIZE, 8, SIZE);
      for (let x = 0; x < SIZE; x++)
        for (let y = 0; y < SURFACE_Y; y++)
          for (let z = 0; z < SIZE; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      return grid;
    }

    /** Normal at the outermost owned top-surface vertex on the +X edge, for a given z. */
    function edgeNormalAt(tm: TerrainMesh, z: number): [number, number, number] | undefined {
      for (const mesh of tm.meshes) {
        const pos = mesh.geometry.getAttribute('position').array as Float32Array;
        const nrm = mesh.geometry.getAttribute('normal').array as Float32Array;
        for (let i = 0; i < pos.length; i += 3) {
          if (
            Math.abs(pos[i]! - (SIZE - 1)) < 1e-6 &&
            Math.abs(pos[i + 2]! - z) < 1e-6 &&
            Math.abs(pos[i + 1]! - (SURFACE_Y - 0.5)) < 1e-6
          ) {
            return [nrm[i]!, nrm[i + 1]!, nrm[i + 2]!];
          }
        }
      }
      return undefined;
    }

    it('without a sampler, the outermost vertex normal tilts away from up (false-cliff regression, #559 root cause 2)', () => {
      const scene = makeScene();
      const grid = flatGrid();
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();
      const n = edgeNormalAt(tm, 4);
      expect(n).toBeDefined();
      // A pure "up" normal has ny === 1. The unowned neighbour column reads
      // as air, so the gradient tilts the normal away from up.
      expect(n![1]).toBeLessThan(0.999);
      tm.dispose();
    });

    it('with a sampler reporting the same flat height past the edge, the outermost vertex normal is close to up (#559 fix)', () => {
      const scene = makeScene();
      const grid = flatGrid();
      const tm = new TerrainMesh(scene, grid);
      tm.setEdgeHeightSampler(() => SURFACE_Y - 0.5);
      tm.buildAll();
      const n = edgeNormalAt(tm, 4);
      expect(n).toBeDefined();
      // ~pure up, within a couple of degrees (cos(2.5deg) ~= 0.999).
      expect(n![1]).toBeGreaterThan(0.999);
      expect(Math.abs(n![0])).toBeLessThan(0.05);
      tm.dispose();
    });
  });

  describe('EdgeHeightSampler is opt-in — null (default) leaves mesh output unchanged (#559 regression safety net)', () => {
    it('setEdgeHeightSampler(null) produces byte-identical geometry to never calling it, for the two-chunk seam fixture', () => {
      // Reuses the exact fixture from "adjacent chunks share exact boundary
      // geometry" above — a non-flat surface across a chunk seam, the case
      // most likely to be perturbed if a sampler were threaded unconditionally.
      function buildSeamGrid(): VoxelGrid {
        const grid = new VoxelGrid(32, 16, 16);
        for (let x = 0; x < 32; x++) {
          for (let z = 0; z < 16; z++) {
            const surfaceY = 4 + (z % 5);
            for (let y = 0; y < surfaceY; y++) grid.setVoxel(x, y, z, makeSolidVoxel());
          }
        }
        return grid;
      }

      function collectAllAttributes(tm: TerrainMesh): { pos: number[]; nrm: number[] } {
        const pos: number[] = [];
        const nrm: number[] = [];
        for (const mesh of tm.meshes) {
          pos.push(...(mesh.geometry.getAttribute('position').array as Float32Array));
          nrm.push(...(mesh.geometry.getAttribute('normal').array as Float32Array));
        }
        return { pos, nrm };
      }

      const sceneA = makeScene();
      const tmA = new TerrainMesh(sceneA, buildSeamGrid());
      tmA.buildAll(); // never touches setEdgeHeightSampler — default null
      const baseline = collectAllAttributes(tmA);
      tmA.dispose();

      const sceneB = makeScene();
      const tmB = new TerrainMesh(sceneB, buildSeamGrid());
      tmB.setEdgeHeightSampler(null); // explicit null — must behave identically
      tmB.buildAll();
      const explicit = collectAllAttributes(tmB);
      tmB.dispose();

      expect(explicit.pos).toEqual(baseline.pos);
      expect(explicit.nrm).toEqual(baseline.nrm);
    });
  });

  describe('a blast adjacent to the site edge still produces a closed shell (#559)', () => {
    /**
     * True when every triangle edge in the scene's chunk meshes is shared by
     * exactly two triangles — the discrete stand-in for "the surface is a
     * closed 2-manifold with no holes". Positions are rounded to fold
     * floating-point noise into a shared key; geometry here has no index
     * buffer (each chunk's triangle list is a flat, duplicated soup), so
     * matching by position is the only option.
     */
    function isWatertight(scene: THREE.Scene): boolean {
      const edgeCounts = new Map<string, number>();
      const key = (arr: Float32Array, i: number): string =>
        `${arr[i]!.toFixed(3)},${arr[i + 1]!.toFixed(3)},${arr[i + 2]!.toFixed(3)}`;
      let minY = Infinity;
      for (const child of scene.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        const pos = child.geometry.getAttribute('position').array as Float32Array;
        for (let i = 1; i < pos.length; i += 3) minY = Math.min(minY, pos[i]!);
      }
      for (const child of scene.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        const pos = child.geometry.getAttribute('position').array as Float32Array;
        for (let t = 0; t < pos.length; t += 9) {
          const v = [key(pos, t), key(pos, t + 3), key(pos, t + 6)];
          for (let e = 0; e < 3; e++) {
            const a = v[e]!, b = v[(e + 1) % 3]!;
            const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
            edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) ?? 0) + 1);
          }
        }
      }
      for (const [edgeKey, count] of edgeCounts) {
        if (count === 2) continue;
        // #560: the floor is no longer capped, so the open bottom rim — an
        // edge whose two endpoints both sit at the mesh's own lowest Y — is
        // deliberately unstitched, not a hole in the visible surface. Any
        // other unmatched edge is a real gap.
        const [aStr, bStr] = edgeKey.split('|');
        const aY = parseFloat(aStr!.split(',')[1]!);
        const bY = parseFloat(bStr!.split(',')[1]!);
        if (Math.abs(aY - minY) < 1e-3 && Math.abs(bY - minY) < 1e-3) continue;
        return false;
      }
      return edgeCounts.size > 0;
    }

    it('a flat site with no blast is watertight to begin with (sanity baseline)', () => {
      const scene = makeScene();
      const size = 8;
      const grid = new VoxelGrid(size, size, size);
      for (let x = 0; x < size; x++)
        for (let y = 0; y < 4; y++)
          for (let z = 0; z < size; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();
      expect(isWatertight(scene)).toBe(true);
      tm.dispose();
    });

    it('stays watertight after a blast carves a crater right at the site edge', () => {
      const scene = makeScene();
      const size = 8;
      const grid = new VoxelGrid(size, size, size);
      for (let x = 0; x < size; x++)
        for (let y = 0; y < 4; y++)
          for (let z = 0; z < size; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();

      // Blow a hole through the whole depth of the boundary column, exactly
      // the "blast at the edge of the site" scenario #559 is concerned with.
      for (let y = 0; y < 4; y++) {
        for (let z = 2; z < 5; z++) {
          grid.clearVoxel(size - 1, y, z);
          grid.clearVoxel(size - 2, y, z);
        }
      }
      tm.remeshRegion({ minX: size - 2, minY: 0, minZ: 2, maxX: size - 1, maxY: 3, maxZ: 4 });

      expect(isWatertight(scene)).toBe(true);
      tm.dispose();
    });
  });

  describe('meshes (P2 — scene picking raycast targets)', () => {
    it('returns every built chunk mesh', () => {
      const scene = makeScene();
      const grid = new VoxelGrid(8, 4, 8);
      for (let x = 0; x < 8; x++)
        for (let y = 0; y < 4; y++)
          for (let z = 0; z < 8; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();
      expect(tm.meshes.length).toBeGreaterThan(0);
      expect(tm.meshes.every(m => m instanceof THREE.Mesh)).toBe(true);
      tm.dispose();
    });

    it('is empty for an all-air grid', () => {
      const scene = makeScene();
      const grid = new VoxelGrid(4, 4, 4);
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();
      expect(tm.meshes).toEqual([]);
      tm.dispose();
    });

    it('excludes empty (null) chunks from a partially-solid grid', () => {
      const scene = makeScene();
      const grid = new VoxelGrid(32, 4, 8); // 2 chunks wide at CHUNK_SIZE=16, only one populated
      for (let x = 0; x < 16; x++)
        for (let y = 0; y < 4; y++)
          for (let z = 0; z < 8; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();
      // Every returned mesh must actually carry geometry (non-empty chunk).
      for (const mesh of tm.meshes) {
        expect(mesh.geometry.attributes['position']!.count).toBeGreaterThan(0);
      }
      tm.dispose();
    });
  });

  it('material uses DoubleSide so terrain is visible from below', () => {
    const scene = makeScene();
    const grid = new VoxelGrid(8, 8, 8);
    // Fill bottom half solid, top half air — creates mesh
    for (let x = 0; x < 8; x++)
      for (let y = 0; y < 4; y++)
        for (let z = 0; z < 8; z++)
          grid.setVoxel(x, y, z, makeSolidVoxel());
    const tm = new TerrainMesh(scene, grid);
    tm.buildAll();
    const mesh = scene.children.find(c => c instanceof THREE.Mesh) as THREE.Mesh;
    expect(mesh).toBeDefined();
    const mat = mesh.material as THREE.Material;
    expect(mat.side).toBe(THREE.DoubleSide);
    tm.dispose();
  });

  it('sharedMaterial is a TerrainMaterial (#458 T4.1)', () => {
    // The material no longer keeps a uPlayRect: the site edge is drawn by
    // WorldBorderWall rather than shaded into the ground here.
    const scene = makeScene();
    const grid = new VoxelGrid(8, 12, 20);
    const tm = new TerrainMesh(scene, grid);
    expect(tm.sharedMaterial).toBeInstanceOf(TerrainMaterial);
    expect(tm.sharedMaterial.customUniforms['uPlayRect']).toBeUndefined();
    tm.dispose();
  });

  // ─── #560: depth-limited perimeter skirt + chunk-skip ──────────────────

  describe('boundarySkirtFloorY (direct method contract, #560)', () => {
    const RECT = { minX: 0, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE };

    it('returns null for an interior column (owned neighbours on all four sides), regardless of sampler', () => {
      const tm = new TerrainMesh(makeScene(), new VoxelGrid(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE));
      tm.setEdgeHeightSampler(() => 10);
      expect(skirtInternals(tm).boundarySkirtFloorY(8, 8, RECT, true, true, true, true)).toBeNull();
      tm.dispose();
    });

    it('returns null (full-depth fallback) when no sampler is installed, even at a true boundary column', () => {
      const tm = new TerrainMesh(makeScene(), new VoxelGrid(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE));
      // The halo column rebuildChunk actually marches on the west side when
      // !hasWest is rect.minX - 1, not rect.minX itself — see the method's
      // own doc comment ("same coordinates rebuildChunk's xStart/... use").
      expect(skirtInternals(tm).boundarySkirtFloorY(-1, 8, RECT, false, true, true, true)).toBeNull();
      tm.dispose();
    });

    it("returns the sampled neighbour height minus SKIRT_VISIBILITY_MARGIN_M for a column bordering unclaimed land on exactly one side", () => {
      const tm = new TerrainMesh(makeScene(), new VoxelGrid(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE));
      tm.setEdgeHeightSampler(() => 20);
      // x = rect.minX - 1 is the actual west halo column the march visits (see above).
      const floor = skirtInternals(tm).boundarySkirtFloorY(-1, 8, RECT, false, true, true, true);
      expect(floor).toBeCloseTo(20 - SKIRT_VISIBILITY_MARGIN_M, 6);
      tm.dispose();
    });

    it("at a site corner (unclaimed on two sides), returns the minimum (deepest) of the two applicable sides' floors", () => {
      const tm = new TerrainMesh(makeScene(), new VoxelGrid(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE));
      // West neighbour reads much deeper (lower cutoff) than north.
      tm.setEdgeHeightSampler((x) => (x < 0 ? 5 : 25));
      // (rect.minX - 1, rect.minZ - 1) is the actual corner halo cell both
      // the west and north loop extensions visit together.
      const floor = skirtInternals(tm).boundarySkirtFloorY(-1, -1, RECT, false, true, false, true);
      expect(floor).toBeCloseTo(5 - SKIRT_VISIBILITY_MARGIN_M, 6);
      tm.dispose();
    });

    it('falls back to null (no cutoff) rather than returning NaN when the sampler reports an unusable value', () => {
      const tm = new TerrainMesh(makeScene(), new VoxelGrid(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE));
      tm.setEdgeHeightSampler(() => NaN);
      const floor = skirtInternals(tm).boundarySkirtFloorY(-1, 8, RECT, false, true, true, true);
      expect(floor).toBeNull();
      tm.dispose();
    });
  });

  describe('canSkipChunkMarch (direct method contract, #560)', () => {
    it('returns true for a chunk with no marchable geometry anywhere (uniformly solid, fully enclosed on every side)', () => {
      const grid = fullySolidMultiChunkGrid();
      const tm = new TerrainMesh(makeScene(), grid);
      const rect = grid.chunkRect(1, 1)!;
      expect(skirtInternals(tm).canSkipChunkMarch(1, 0, 1, rect)).toBe(true);
      tm.dispose();
    });

    it('returns false for a chunk that genuinely contains a surface (never a false positive)', () => {
      const grid = new VoxelGrid(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
      for (let x = 0; x < CHUNK_SIZE; x++)
        for (let y = 0; y < CHUNK_SIZE / 2; y++)
          for (let z = 0; z < CHUNK_SIZE; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      const tm = new TerrainMesh(makeScene(), grid);
      const rect = grid.chunkRect(0, 0)!;
      expect(skirtInternals(tm).canSkipChunkMarch(0, 0, 0, rect)).toBe(false);
      tm.dispose();
    });

    it('returns false for a fully-solid boundary chunk when no sampler is installed (full-depth fallback still needs the wall)', () => {
      // Single chunk footprint (boundary on all four sides), 2 y-chunks tall
      // and solid throughout, so chunk cy=0 has no top surface of its own —
      // isolating the "boundary wall still needed" reason from "has a real surface".
      const grid = new VoxelGrid(CHUNK_SIZE, CHUNK_SIZE * 2, CHUNK_SIZE);
      for (let x = 0; x < CHUNK_SIZE; x++)
        for (let y = 0; y < CHUNK_SIZE * 2; y++)
          for (let z = 0; z < CHUNK_SIZE; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      const tm = new TerrainMesh(makeScene(), grid);
      const rect = grid.chunkRect(0, 0)!;
      expect(skirtInternals(tm).canSkipChunkMarch(0, 0, 0, rect)).toBe(false);
      tm.dispose();
    });
  });

  describe('boundary/skirt walls without a sampler still march full depth (#560 fallback)', () => {
    function flatSiteLocal(size: number, surfaceY: number): VoxelGrid {
      const grid = new VoxelGrid(size, size, size);
      for (let x = 0; x < size; x++)
        for (let y = 0; y < surfaceY; y++)
          for (let z = 0; z < size; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      return grid;
    }

    it('reaches the bottom of the grid (y=0) when no EdgeHeightSampler is installed', () => {
      const scene = makeScene();
      const size = 8;
      const tm = new TerrainMesh(scene, flatSiteLocal(size, 4));
      tm.buildAll();
      let minY = Infinity;
      for (const mesh of tm.meshes) {
        const pos = mesh.geometry.getAttribute('position').array as Float32Array;
        for (let i = 0; i < pos.length; i += 3) minY = Math.min(minY, pos[i + 1]!);
      }
      expect(minY).toBeLessThanOrEqual(0 + 1e-6);
      tm.dispose();
    });
  });

  describe('EdgeHeightSampler depth-limits the skirt (#560)', () => {
    const SIZE = 8;
    const SURFACE_Y = 30;
    const DEEP_SIZE_Y = 40;

    function deepFlatSite(): VoxelGrid {
      const grid = new VoxelGrid(SIZE, DEEP_SIZE_Y, SIZE);
      for (let x = 0; x < SIZE; x++)
        for (let y = 0; y < SURFACE_Y; y++)
          for (let z = 0; z < SIZE; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      return grid;
    }

    it('with a sampler reporting the neighbour ground near the site surface, total vertex count is strictly less than with no sampler installed', () => {
      const sceneA = makeScene();
      const tmA = new TerrainMesh(sceneA, deepFlatSite());
      tmA.buildAll(); // no sampler — full-depth fallback
      const withoutSampler = tmA.getBounds()?.vertexCount ?? 0;
      tmA.dispose();

      const sceneB = makeScene();
      const tmB = new TerrainMesh(sceneB, deepFlatSite());
      tmB.setEdgeHeightSampler(() => SURFACE_Y - 0.5); // neighbour ground right at the site's own surface
      tmB.buildAll();
      const withSampler = tmB.getBounds()?.vertexCount ?? 0;
      tmB.dispose();

      expect(withSampler).toBeGreaterThan(0);
      expect(withSampler).toBeLessThan(withoutSampler);
    });

    it('a blast crater at the site edge stays closed (no see-through gap) with a sampler installed and the skirt depth-limited', () => {
      function flatSiteLocal(size: number, surfaceY: number): VoxelGrid {
        const grid = new VoxelGrid(size, size, size);
        for (let x = 0; x < size; x++)
          for (let y = 0; y < surfaceY; y++)
            for (let z = 0; z < size; z++)
              grid.setVoxel(x, y, z, makeSolidVoxel());
        return grid;
      }
      function maxVertexXLocal(scene: THREE.Scene): number {
        let m = -Infinity;
        for (const child of scene.children) {
          const geo = (child as THREE.Mesh).geometry;
          if (!geo) continue;
          const pos = geo.getAttribute('position').array as Float32Array;
          for (let i = 0; i < pos.length; i += 3) m = Math.max(m, pos[i]!);
        }
        return m;
      }

      const scene = makeScene();
      const size = 8;
      const grid = flatSiteLocal(size, 4);
      const tm = new TerrainMesh(scene, grid);
      tm.setEdgeHeightSampler(() => 3.5); // neighbour ground reported at the same height as the site surface
      tm.buildAll();

      for (let y = 0; y < 4; y++) {
        for (let z = 2; z < 5; z++) {
          grid.clearVoxel(size - 1, y, z);
          grid.clearVoxel(size - 2, y, z);
        }
      }
      tm.remeshRegion({ minX: size - 2, minY: 0, minZ: 2, maxX: size - 1, maxY: 3, maxZ: 4 });

      expect(maxVertexXLocal(scene)).toBeGreaterThanOrEqual(size - 0.5 - 1e-4);
      tm.dispose();
    });
  });

  describe('canSkipChunkMarch — chunk-skip via VoxelGrid density summary (#560)', () => {
    it('a fully-solid interior chunk (all 4 neighbours owned, no surface anywhere in its slab) is skipped without marching a single cube', () => {
      const scene = makeScene();
      const grid = fullySolidMultiChunkGrid();
      const marchSpy = vi.spyOn(TerrainMesh.prototype as unknown as { marchCube: (...args: unknown[]) => void }, 'marchCube');
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();

      expect(tm.getChunkMesh(1, 0, 1)).toBeNull();

      // Chunk (1, 0, 1) owns exactly x:16..31, y:0..15, z:16..31 (CHUNK_SIZE=16)
      // and has an owned neighbour on every horizontal side, so no other
      // chunk's own halo march ever needs to touch this region either.
      const rect = grid.chunkRect(1, 1)!;
      const touchedSkippedChunk = marchSpy.mock.calls.some((args) => {
        const [x, y, z] = args as [number, number, number];
        return x >= rect.minX && x < rect.maxX && y >= 0 && y < CHUNK_SIZE && z >= rect.minZ && z < rect.maxZ;
      });
      expect(touchedSkippedChunk).toBe(false);

      marchSpy.mockRestore();
      tm.dispose();
    });

    it('a fully-solid boundary chunk entirely below the sampled skirt floor is also skipped', () => {
      // Single chunk footprint (boundary on every side), 2 y-chunks tall,
      // solid throughout. Neighbour ground reported at y=22 -> skirt floor
      // ~= 22 - SKIRT_VISIBILITY_MARGIN_M = 20, comfortably above chunk
      // cy=0's own span (0..15).
      const scene = makeScene();
      const grid = new VoxelGrid(CHUNK_SIZE, CHUNK_SIZE * 2, CHUNK_SIZE);
      for (let x = 0; x < CHUNK_SIZE; x++)
        for (let y = 0; y < CHUNK_SIZE * 2; y++)
          for (let z = 0; z < CHUNK_SIZE; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      const tm = new TerrainMesh(scene, grid);
      tm.setEdgeHeightSampler(() => 22);
      tm.buildAll();
      expect(tm.getChunkMesh(0, 0, 0)).toBeNull();
      tm.dispose();
    });

    it('a boundary chunk straddling the skirt cutoff is NOT skipped', () => {
      const scene = makeScene();
      const grid = new VoxelGrid(CHUNK_SIZE, CHUNK_SIZE * 2, CHUNK_SIZE);
      for (let x = 0; x < CHUNK_SIZE; x++)
        for (let y = 0; y < CHUNK_SIZE * 2; y++)
          for (let z = 0; z < CHUNK_SIZE; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      const tm = new TerrainMesh(scene, grid);
      tm.setEdgeHeightSampler(() => 22); // cutoff ~20, inside chunk cy=1's own span (16..31)
      tm.buildAll();
      expect(tm.getChunkMesh(0, 1, 0)).not.toBeNull();
      tm.dispose();
    });

    it('a chunk that becomes mixed after a blast (density crosses SURFACE_THRESHOLD in its own slab) is re-marched on the next rebuild, not left stale from a prior skip', () => {
      const scene = makeScene();
      const grid = fullySolidMultiChunkGrid();
      const tm = new TerrainMesh(scene, grid);
      tm.buildAll();
      expect(tm.getChunkMesh(1, 0, 1)).toBeNull(); // provably solid interior, skipped

      // Carve a small air pocket well inside chunk (1, 0, 1)'s own span
      // (x:16..31, y:0..15, z:16..31).
      for (let y = 4; y < 8; y++) grid.clearVoxel(20, y, 20);
      tm.remeshRegion({ minX: 19, minY: 3, minZ: 19, maxX: 21, maxY: 8, maxZ: 21 });

      expect(tm.getChunkMesh(1, 0, 1)).not.toBeNull();
      tm.dispose();
    });
  });

  describe('boundarySkirtFloorY corner columns use the minimum (deepest) applicable floor (#560)', () => {
    // Single chunk footprint -> (0,0) is the grid's own NW corner, bordering
    // unclaimed land on both west and north. 2 y-chunks tall, solid
    // throughout, so there's no top-surface confound near the corner's own
    // deep cutoff.
    function tallCornerColumn(): VoxelGrid {
      const grid = new VoxelGrid(CHUNK_SIZE, CHUNK_SIZE * 2, CHUNK_SIZE);
      for (let x = 0; x < CHUNK_SIZE; x++)
        for (let y = 0; y < CHUNK_SIZE * 2; y++)
          for (let z = 0; z < CHUNK_SIZE; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      return grid;
    }

    /** Lowest Y reached by any wall vertex within a small window around the grid's NW corner. */
    function minCornerWallY(scene: THREE.Scene): number {
      let m = Infinity;
      for (const child of scene.children) {
        const geo = (child as THREE.Mesh).geometry;
        if (!geo) continue;
        const pos = geo.getAttribute('position').array as Float32Array;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
          if (x <= 1 && z <= 1) m = Math.min(m, y);
        }
      }
      return m;
    }

    it("a corner column bordering unclaimed land on two sides reaches down to the deeper of the two sides' floors", () => {
      // Shallow uniform sampler: both directions read the same high (shallow) neighbour height.
      const sceneShallow = makeScene();
      const tmShallow = new TerrainMesh(sceneShallow, tallCornerColumn());
      tmShallow.setEdgeHeightSampler(() => 25);
      tmShallow.buildAll();
      const shallowMinY = minCornerWallY(sceneShallow);
      tmShallow.dispose();

      // West much deeper than north: the corner must follow the deeper
      // (west) side, not the shallow one.
      const sceneCorner = makeScene();
      const tmCorner = new TerrainMesh(sceneCorner, tallCornerColumn());
      tmCorner.setEdgeHeightSampler((x) => (x < 0 ? 5 : 25));
      tmCorner.buildAll();
      const cornerMinY = minCornerWallY(sceneCorner);
      tmCorner.dispose();

      expect(cornerMinY).toBeLessThan(shallowMinY);
    });
  });

  describe('EdgeHeightSampler robustness (#560)', () => {
    it('a NaN sampler value falls back to full depth instead of propagating NaN into the emitted geometry', () => {
      const scene = makeScene();
      const size = 8;
      const grid = new VoxelGrid(size, size, size);
      for (let x = 0; x < size; x++)
        for (let y = 0; y < 4; y++)
          for (let z = 0; z < size; z++)
            grid.setVoxel(x, y, z, makeSolidVoxel());
      const tm = new TerrainMesh(scene, grid);
      tm.setEdgeHeightSampler(() => NaN);
      expect(() => tm.buildAll()).not.toThrow();

      let minY = Infinity;
      for (const mesh of tm.meshes) {
        const pos = mesh.geometry.getAttribute('position').array as Float32Array;
        for (let i = 0; i < pos.length; i += 3) {
          expect(Number.isNaN(pos[i]!)).toBe(false);
          expect(Number.isNaN(pos[i + 1]!)).toBe(false);
          expect(Number.isNaN(pos[i + 2]!)).toBe(false);
          minY = Math.min(minY, pos[i + 1]!);
        }
      }
      // No cutoff applied — full-depth fallback, same as no sampler installed at all.
      expect(minY).toBeLessThanOrEqual(0 + 1e-6);
      tm.dispose();
    });
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

  // ── Stale point opacity (STALE_OPACITY = 0.6) ──
  it('stale point has opacity multiplied by STALE_OPACITY (0.6)', () => {
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

    // Stale opacity should be 0.6x the fresh opacity
    // Fresh: 0.6 * 1.0 = 0.6
    // Stale: 0.6 * 0.6 = 0.36
    expect(freshOpacity).toBeCloseTo(0.6, 2);
    expect(staleMat.opacity).toBeCloseTo(0.36, 2);
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
