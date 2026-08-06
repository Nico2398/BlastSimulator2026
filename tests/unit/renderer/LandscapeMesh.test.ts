import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CompositionPalette } from '../../../src/core/world/VoxelGrid.js';
import type { LandscapeMap, LandscapeTile } from '../../../src/core/world/LandscapeMap.js';
import type { Rect } from '../../../src/core/world/WorldGen.js';
import type { LandscapeHandle } from '../../../src/console/commands/world.js';
import {
  LandscapeMesh,
  rockBlendFor,
  classifyQuad,
  buildBoundaryQuad,
  type PlayableCut,
} from '../../../src/renderer/terrain/LandscapeMesh.js';
import { rockIndexOf } from '../../../src/core/world/RockCatalog.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';

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
  it('builds one Mesh per non-empty tile, with no separate seam mesh (#491)', () => {
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

    expect(lm.meshCount).toBe(2); // 2 tiles, no seam mesh (#491 removes the seam design)
    expect(scene.children.length).toBe(2);
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

    expect(lm.meshCount).toBe(0); // no tile geometry, and no seam mesh to fall back on (#491)
    expect(scene.children.length).toBe(0);
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

  it('tile meshes cast and receive shadows (#458 T5.1/CSM)', () => {
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

  describe('tile meshes never fully cover the playable claim', () => {
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

    it('never emits a triangle deeper than one boundary-quad ring inside the playable rect (#491)', () => {
      // Coarse quads fully inside the rect are dropped outright (classifyQuad
      // 'inside'). Only the single quad-wide ring straddling the claim edge
      // (classifyQuad 'boundary') is subdivided by buildBoundaryQuad, and
      // even there a fine cell survives only with >=1 unowned corner — so no
      // vertex can sit deeper than one diagonal fine step (FINE_STEP=1m)
      // inside the rect, unlike the old coarse-only test's strict <= 0.
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const { tile, n } = tileCoveringRect(compId);
      const handle = makeFakeHandle(rect, [tile], n, compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);

      expect(scene.children.length).toBe(1);
      const tileMesh = scene.children[0] as THREE.Mesh;

      const maxBoundaryReach = Math.SQRT2; // diagonal fine-cell slack
      for (const tri of triangles(tileMesh)) {
        for (const [x, z] of tri) {
          expect(insideDepth(x, z)).toBeLessThanOrEqual(maxBoundaryReach + 1e-6);
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

      const tileMesh = scene.children[0] as THREE.Mesh;
      const triangleCount = tileMesh.geometry.getIndex()!.count / 3;
      const fullGridTriangleCount = (n - 1) * (n - 1) * 2;
      // Ground outside the rect is still there — the tile isn't dropped
      // wholesale. Total count differs from a naive uncut grid either way:
      // fully-'inside' quads are dropped outright, while 'boundary' quads
      // are subdivided into more (smaller) triangles than the one coarse
      // quad they replace, so the two effects don't net to a simple bound.
      expect(triangleCount).toBeGreaterThan(0);
      expect(triangleCount).not.toBe(fullGridTriangleCount);
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

    it('drops the tile entirely when every one of its quads is inside the rect (no double coverage of the claim)', () => {
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

  describe('no landscape vertex sits above the sampled height field (#491)', () => {
    it('every emitted vertex matches a linear ground-truth field exactly, at every (x,z) it emits (interior and flat-edge nodes both interpolate exactly for a linear field)', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const field = (x: number, z: number) => 10 + 0.5 * x + 0.3 * z;
      const rect: Rect = { minX: 0, minZ: 0, maxX: 20, maxZ: 20 };
      const n = 9;
      const tile = makeFakeTile(-20, -20, n, compId);
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          const x = tile.originX + col * 4; // default coarseStep in makeFakeHandle
          const z = tile.originZ + row * 4;
          tile.heights[row * n + col] = field(x, z);
        }
      }
      const handle = makeFakeHandle(rect, [tile], n, compId, (x, z) => ({ height: field(x, z), biomeId: 0, surfCompId: compId }));

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);
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

  // #491: the old two-mesh design (a coarse tile sheet plus a separate,
  // overlapping fine "seam" mesh dropped OVERLAP_DROP below it) is gone.
  // Every tile is now the single source of ground at the claim boundary:
  // classifyQuad + buildBoundaryQuad subdivide only the one quad-wide ring
  // straddling the edge, in place. These tests cover the invariants the old
  // seam mesh existed for — no crack at the boundary, and the boundary ring
  // tracking the live playable surface — against the new design.
  describe('claim-boundary ring (#491: no overlap, no gap, no crack)', () => {
    it('never leaves two vertices at the same (x, z) with different heights (no T-junction crack)', () => {
      // A non-flat field makes any mismatch between the flat-edge-interpolated
      // boundary ring and its unsubdivided coarse neighbour visible as a
      // height disagreement at a shared (x, z) — a flat field would hide it
      // (every scheme agrees on a plane).
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
      const field = (x: number, z: number) => 20 + Math.sin(x * 0.1) * 3 + Math.cos(z * 0.07) * 2;
      const handle = makeFakeHandle(
        rect,
        [makeFakeTile(-100, -100, 40, compId)],
        40,
        compId,
        (x, z) => ({ height: field(x, z), biomeId: 0, surfCompId: compId }),
      );
      // makeFakeTile ignores the sample function for its stored heights, so
      // rebuild the tile's own samples from the same field the boundary ring
      // reads, or the tile's flat interior would trivially disagree with a
      // sloped boundary ring at every shared corner.
      const n = 40;
      const step = 4;
      const originX = -100, originZ = -100;
      const heights = new Float32Array(n * n);
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          heights[row * n + col] = field(originX + col * step, originZ + row * step);
        }
      }
      handle.map.tiles[0]!.heights.set(heights);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);

      const tileMesh = scene.children[0] as THREE.Mesh;
      const positions = tileMesh.geometry.getAttribute('position').array as Float32Array;

      const heightAt = new Map<string, number>();
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
        const key = `${x.toFixed(3)},${z.toFixed(3)}`;
        const existing = heightAt.get(key);
        if (existing !== undefined) {
          expect(y).toBeCloseTo(existing, 4);
        } else {
          heightAt.set(key, y);
        }
      }
      lm.dispose();
    });

    it('uses the live boundaryHeightAt (not the theoretical WorldGen height) inside the boundary ring', () => {
      const scene = makeScene();
      const { palette, compId } = makePalette();
      const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
      const theoreticalH = 50;
      const liveH = 12; // deliberately far off, so a fallback to the theoretical height is unmistakable
      const handle = makeFakeHandle(
        rect, [makeFakeTile(-100, -100, 40, compId)], 40, compId,
        () => ({ height: theoreticalH, biomeId: 0, surfCompId: compId }),
      );

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette, {
        rect,
        ownsColumn: (x, z) => x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ,
        boundaryHeightAt: () => liveH,
      });

      const tileMesh = scene.children[0] as THREE.Mesh;
      const positions = tileMesh.geometry.getAttribute('position').array as Float32Array;

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
      const handle = makeFakeHandle(rect, [makeFakeTile(-100, -100, 40, compId)], 40, compId);

      const sceneA = makeScene();
      const lmA = new LandscapeMesh(sceneA, makeMaterial());
      lmA.build(handle, palette);
      const meshA = sceneA.children[0] as THREE.Mesh;

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

  describe('pit/landscape junction continuity via PlayableCut.boundaryHeightAt (#491)', () => {
    function makeJunctionHandle(theoreticalHeight: number) {
      const { palette, compId } = makePalette();
      const n = 9;
      const tile = makeFakeTile(0, -1000, n, compId, theoreticalHeight);
      const rect: Rect = { minX: 16, minZ: -1000, maxX: 1000, maxZ: 1000 };
      const handle = makeFakeHandle(rect, [tile], n, compId, () => ({ height: theoreticalHeight, biomeId: 0, surfCompId: compId }));
      return { handle, palette, rect };
    }

    /** Height of the emitted vertex nearest the claim edge (largest x still < 16). */
    function closestUnownedVertexHeight(scene: THREE.Scene): number {
      let bestX = -Infinity;
      let bestY = NaN;
      for (const child of scene.children) {
        const mesh = child as THREE.Mesh;
        const pos = mesh.geometry.getAttribute('position')?.array as Float32Array | undefined;
        if (!pos) continue;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i]!;
          if (x < 16 && x > bestX) { bestX = x; bestY = pos[i + 1]!; }
        }
      }
      return bestY;
    }

    it('before a blast: boundary nodes track the live pre-dig height supplied by boundaryHeightAt', () => {
      const scene = makeScene();
      const { handle, palette, rect } = makeJunctionHandle(50);
      const playable: PlayableCut = { rect, ownsColumn: (x) => x >= 16, boundaryHeightAt: () => 50 };

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette, playable);
      expect(closestUnownedVertexHeight(scene)).toBeCloseTo(50, 1);
      lm.dispose();
    });

    it('after a blast: boundary nodes track the lower live height, not the stale WorldGen height (#491)', () => {
      const scene = makeScene();
      const { handle, palette, rect } = makeJunctionHandle(50); // sampleColumn/WorldGen still reports the theoretical pre-dig 50
      const playable: PlayableCut = { rect, ownsColumn: (x) => x >= 16, boundaryHeightAt: () => 44 }; // TerrainMesh currently renders a dug crater at 44

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette, playable);
      const y = closestUnownedVertexHeight(scene);
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

describe('buildBoundaryQuad (#491)', () => {
  const SUBDIV = 4; // documented fine-cell subdivision factor for a boundary quad

  /** Deliberately non-linear in x: a flat-edge interpolation reads measurably different from the true sampled height. */
  function makeSample(compId: number) {
    return (x: number, z: number) => ({ height: x * x + z, biomeId: 0, surfCompId: compId });
  }

  function run(playable: PlayableCut, palette: CompositionPalette, compId: number) {
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
      makeSample(compId), palette, playable,
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

  it("flat-edge rule: nodes on a parent side interpolate linearly between that side's two coarse corners, not the true sampled height", () => {
    const { palette, compId } = makePalette();
    // Whole quad outside the claim so every fine cell survives — isolates the
    // flat-edge behaviour from the keep/drop rule.
    const playable: PlayableCut = { rect: { minX: 1000, minZ: 1000, maxX: 2000, maxZ: 2000 }, ownsColumn: () => false };
    const { positions } = run(playable, palette, compId);

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

  it('interior nodes get the true sampled height and a height-field normal (not a flat-edge interpolation)', () => {
    const { palette, compId } = makePalette();
    const playable: PlayableCut = { rect: { minX: 1000, minZ: 1000, maxX: 2000, maxZ: 2000 }, ownsColumn: () => false };
    const { positions, normals } = run(playable, palette, compId);

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

describe('LandscapeMesh — normals come from the height field, not the triangles (#458)', () => {
  /** Deliberately non-planar: a plane would hide the difference, since every scheme agrees on one. */
  const bumpy = (row: number, col: number): number => 10 + Math.sin(col * 0.9) * 2 + Math.cos(row * 0.7) * 1.5;

  function makeBumpyTile(n: number, compId: number, step: number): LandscapeTile {
    const heights = new Float32Array(n * n);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) heights[row * n + col] = bumpy(row, col);
    }
    return {
      tileX: 0, tileZ: 0, originX: -1000, originZ: -1000,
      heights, biomeIds: new Uint8Array(n * n), surfCompIds: new Uint16Array(n * n).fill(compId),
    };
  }

  const n = 9;
  const step = 4;

  function buildBumpy(): { mesh: THREE.Mesh; lm: LandscapeMesh } {
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const handle = makeFakeHandle(rect, [makeBumpyTile(n, compId, step)], n, compId);
    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.build(handle, palette);
    const mesh = scene.children.find((c) => (c as THREE.Mesh).geometry?.getAttribute('position')?.count === n * n) as THREE.Mesh;
    return { mesh, lm };
  }

  it('matches the analytic slope of the sampled heights at interior vertices', () => {
    const { mesh, lm } = buildBumpy();
    const normals = mesh.geometry.getAttribute('normal').array as Float32Array;

    for (const [row, col] of [[3, 3], [4, 5], [5, 2], [2, 6]] as const) {
      const dhdx = (bumpy(row, col + 1) - bumpy(row, col - 1)) / (2 * step);
      const dhdz = (bumpy(row + 1, col) - bumpy(row - 1, col)) / (2 * step);
      const len = Math.hypot(dhdx, 1, dhdz);
      const idx = (row * n + col) * 3;
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

  it('shades a tile edge from its neighbour, so no line runs along the tile boundary', () => {
    // A tile knows only its own samples, so face-averaged normals go one-sided
    // at its edge and the two tiles sharing that edge disagree about the slope
    // there — a straight ruled line every tileSpan metres, right across open
    // ground. Reading the neighbour's samples removes the special case.
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const span = (n - 1) * step;

    // Two tiles side by side in x, sampling ONE continuous field. The shared
    // edge is tile A's last column and tile B's first.
    const field = (x: number, z: number): number => 10 + Math.sin(x * 0.05) * 6 + Math.cos(z * 0.04) * 4;
    const makeTile = (tileX: number, originX: number): LandscapeTile => {
      const heights = new Float32Array(n * n);
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) heights[row * n + col] = field(originX + col * step, -1000 + row * step);
      }
      return {
        tileX, tileZ: 0, originX, originZ: -1000,
        heights, biomeIds: new Uint8Array(n * n), surfCompIds: new Uint16Array(n * n).fill(compId),
      };
    };
    const handle = makeFakeHandle(rect, [makeTile(0, -1000), makeTile(1, -1000 + span)], n, compId);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.build(handle, palette);
    const tileMeshes = scene.children.filter(
      (c) => (c as THREE.Mesh).geometry?.getAttribute('position')?.count === n * n,
    ) as THREE.Mesh[];
    expect(tileMeshes).toHaveLength(2);

    const positionAt = (mesh: THREE.Mesh, row: number, col: number) => {
      const a = mesh.geometry.getAttribute('position').array as Float32Array;
      const i = (row * n + col) * 3;
      return [a[i]!, a[i + 1]!, a[i + 2]!] as const;
    };
    const normalAt = (mesh: THREE.Mesh, row: number, col: number) => {
      const a = mesh.geometry.getAttribute('normal').array as Float32Array;
      const i = (row * n + col) * 3;
      return [a[i]!, a[i + 1]!, a[i + 2]!] as const;
    };

    const row = 4;
    const edgeX = -1000 + span;
    const dhdx = (field(edgeX + step, -1000 + row * step) - field(edgeX - step, -1000 + row * step)) / (2 * step);
    const dhdz = (field(edgeX, -1000 + (row + 1) * step) - field(edgeX, -1000 + (row - 1) * step)) / (2 * step);
    const len = Math.hypot(dhdx, 1, dhdz);

    // Tile A's last column and tile B's first are the same world position:
    // exact position match (#491 regression) and exact normal match.
    const [posA, posB] = [positionAt(tileMeshes[0]!, row, n - 1), positionAt(tileMeshes[1]!, row, 0)];
    expect(posB[0]).toBeCloseTo(posA[0], 6);
    expect(posB[1]).toBeCloseTo(posA[1], 6);
    expect(posB[2]).toBeCloseTo(posA[2], 6);

    for (const [mesh, col] of [[tileMeshes[0]!, n - 1], [tileMeshes[1]!, 0]] as const) {
      const nrm = normalAt(mesh, row, col);
      expect(nrm[0]).toBeCloseTo(-dhdx / len, 5);
      expect(nrm[2]).toBeCloseTo(-dhdz / len, 5);
    }
    lm.dispose();
  });

  it('boundary-ring vertices are shaded from the sampled height field too (#491)', () => {
    // The boundary ring's fine nodes are appended past the tile's own n*n
    // coarse nodes (buildTileMesh pushes those unconditionally first), so
    // indices >= n*n identify them without needing to know which quads were
    // classified 'boundary'.
    const scene = makeScene();
    const { palette, compId } = makePalette();
    const rect: Rect = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
    const n = 40;
    // A slope steep enough that a wrong normal is unmistakable.
    const sample = (x: number, z: number) => ({ height: 20 + x * 0.25 - z * 0.1, biomeId: 0, surfCompId: compId });
    const handle = makeFakeHandle(rect, [makeFakeTile(-100, -100, n, compId)], n, compId, sample);

    const lm = new LandscapeMesh(scene, makeMaterial());
    lm.build(handle, palette);
    const tileMesh = scene.children[0] as THREE.Mesh;
    const normals = tileMesh.geometry.getAttribute('normal').array as Float32Array;
    const vertexCount = normals.length / 3;
    expect(vertexCount).toBeGreaterThan(n * n); // boundary ring really did append vertices

    const len = Math.hypot(0.25, 1, -0.1);
    for (let i = n * n; i < vertexCount; i++) {
      expect(normals[i * 3]!).toBeCloseTo(-0.25 / len, 3);
      expect(normals[i * 3 + 1]!).toBeCloseTo(1 / len, 3);
      expect(normals[i * 3 + 2]!).toBeCloseTo(0.1 / len, 3);
    }
    lm.dispose();
  });
});

describe('LandscapeMesh — per-biome coverage (#491)', () => {
  for (const biome of getAllBiomes()) {
    it(`${biome.id}: build() produces a continuous, blended surface with no double coverage of the claim`, () => {
      const scene = makeScene();
      const palette = new CompositionPalette();
      const [primary, secondary] = biome.dominantRocks;
      const compId = palette.intern({
        rocks: secondary
          ? [{ rockId: primary!, coefficient: 0.7 }, { rockId: secondary, coefficient: 0.3 }]
          : [{ rockId: primary!, coefficient: 1 }],
      });
      const n = 6;
      const rect: Rect = { minX: 0, minZ: 0, maxX: 20, maxZ: 20 };
      const tile = makeFakeTile(-40, -40, n, compId, 12);
      const handle = makeFakeHandle(rect, [tile], n, compId);

      const lm = new LandscapeMesh(scene, makeMaterial());
      lm.build(handle, palette);

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
