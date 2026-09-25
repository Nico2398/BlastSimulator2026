// BlastSimulator2026 — LandscapeChunkStreamer tests (#1153, #1166)
// Covers the streamer's own residency policy — budgeted nearest-first
// builds, unbudgeted disposal, synchronous invalidateNear, reset, and the
// neighbourSteps fallback — against a real LandscapeMesh instance. Chunk
// *content* (the join/claim-boundary geometry itself) is covered by
// LandscapeMesh.test.ts and LandscapeSeam.test.ts; this file only cares
// about which chunk ids the streamer asks LandscapeMesh to build/dispose,
// and when.

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CompositionPalette } from '../../../../src/core/world/VoxelGrid.js';
import {
  chunkKey, chunkOrigin, chunkSpanAt, selectLandscapeChunks, NODES_PER_CHUNK, LADDER_STEPS,
  type LandscapeChunk, type LandscapeChunkId, type LazyLandscapeMap,
} from '../../../../src/core/world/LandscapeMap.js';
import type { Rect } from '../../../../src/core/world/WorldGen.js';
import type { LandscapeHandle } from '../../../../src/console/commands/world.js';
import { LandscapeMesh, uniformNeighbourSteps, type PlayableCut } from '../../../../src/renderer/terrain/LandscapeMesh.js';
import { createLandscapeChunkStreamer } from '../../../../src/renderer/terrain/LandscapeChunkStreamer.js';

/** Mirrors the module's own unexported MAX_CHUNK_BUILDS_PER_FRAME (src/renderer/terrain/LandscapeChunkStreamer.ts). */
const BUDGET = 2;

/** The ladder's finest and coarsest rungs — LADDER_STEPS = [1, 2, 4, 8, 16]. */
const COARSEST_STEP = LADDER_STEPS[LADDER_STEPS.length - 1]!;

type BuildChunkArgs = Parameters<LandscapeMesh['buildChunk']>;

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

/** One synthetic chunk at `id`, flat at height 10 — content is irrelevant to the streamer's own residency/scheduling behaviour. */
function makeChunkAt(id: LandscapeChunkId, compId: number, centerX: number, centerZ: number): LandscapeChunk {
  const step = LADDER_STEPS[id.level]!;
  const { originX, originZ } = chunkOrigin(id, centerX, centerZ);
  const n = NODES_PER_CHUNK;
  return {
    id, step, originX, originZ,
    heights: new Float32Array(n * n).fill(10),
    biomeIds: new Uint8Array(n * n),
    surfCompIds: new Uint16Array(n * n).fill(compId),
  };
}

/** A LazyLandscapeMap that synthesizes any requested chunk on demand — the streamer only ever cares which ids it asked for, never what geometry backs them. */
function makeSyntheticMap(compId: number, extentHalf: number, centerX = 0, centerZ = 0): LazyLandscapeMap {
  const cache = new Map<string, LandscapeChunk>();
  return {
    extentHalf, centerX, centerZ,
    getChunk(id: LandscapeChunkId): LandscapeChunk {
      const key = chunkKey(id);
      let c = cache.get(key);
      if (!c) { c = makeChunkAt(id, compId, centerX, centerZ); cache.set(key, c); }
      return c;
    },
    hasChunk: (id: LandscapeChunkId) => cache.has(chunkKey(id)),
    get cachedChunkIds() { return Array.from(cache.values(), (c) => c.id); },
  };
}

/** Far past any test chunk, so every built chunk always has ground of its own to draw (buildChunkMesh never returns null) — isolates streamer residency from LandscapeMesh's own claim-boundary logic. */
const FAR_RECT: Rect = { minX: 1e7, minZ: 1e7, maxX: 1e7 + 1, maxZ: 1e7 + 1 };
const FAR_CUT: PlayableCut = { rect: FAR_RECT, ownsColumn: () => false };

function makeHandle(compId: number, extentHalf: number, centerX = 0, centerZ = 0): LandscapeHandle {
  return {
    map: makeSyntheticMap(compId, extentHalf, centerX, centerZ),
    playableRect: FAR_RECT,
    sampleColumn: () => ({ height: 10, biomeId: 0, surfCompId: compId }),
    groundLevelY: 0,
    structureSet: { overlays: [], spatialIndex: new Map(), rivers: [], villages: [], trees: [], landmarks: [] },
  };
}

/**
 * Every id selectLandscapeChunks would return for (cameraX, cameraZ) against
 * `handle`, sorted nearest-first by squared distance to the camera — an
 * independent re-derivation of the same public math update() uses, not a
 * copy of the streamer's private loop.
 */
function expectedNearestFirst(cameraX: number, cameraZ: number, handle: LandscapeHandle): LandscapeChunkId[] {
  const ids = selectLandscapeChunks(cameraX, cameraZ, handle.map.centerX, handle.map.centerZ, handle.map.extentHalf);
  const distSq = (id: LandscapeChunkId): number => {
    const span = chunkSpanAt(id.level);
    const { originX, originZ } = chunkOrigin(id, handle.map.centerX, handle.map.centerZ);
    const dx = originX + span / 2 - cameraX;
    const dz = originZ + span / 2 - cameraZ;
    return dx * dx + dz * dz;
  };
  return [...ids].sort((a, b) => distSq(a) - distSq(b));
}

// A camera far enough from the origin that no root tile at either extentHalf
// used below (40 -> 4 tiles, 550 -> 16 tiles; both centred at (0,0)) is ever
// within refine range (1.5 * coarsest span = 768m) — so selectLandscapeChunks
// always returns the coarsest-level root tiles themselves, with no recursive
// subdivision, for every test in this file. Asymmetric in x and z so no two
// tiles are ever equidistant from it.
const CAMERA_X = 500_000;
const CAMERA_Z = 1_000;

describe('createLandscapeChunkStreamer — update budget enforcement (#1153)', () => {
  it('builds exactly BUDGET chunks per call, converging to the full desired set over enough calls, then no-ops', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 550); // halfCount=2 -> 16 coarsest-level root tiles
    const desired = selectLandscapeChunks(CAMERA_X, CAMERA_Z, handle.map.centerX, handle.map.centerZ, handle.map.extentHalf);
    expect(desired.length).toBe(16); // sanity check on this test's own premise

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const buildSpy = vi.spyOn(mesh, 'buildChunk');
    const streamer = createLandscapeChunkStreamer(mesh);

    const builtPerCall: number[] = [];
    for (let i = 0; i < 8; i++) {
      const before = buildSpy.mock.calls.length;
      streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);
      builtPerCall.push(buildSpy.mock.calls.length - before);
    }

    // 16 chunks / BUDGET(2) per call = exactly 8 calls, each building exactly BUDGET.
    for (const n of builtPerCall) expect(n).toBe(BUDGET);
    expect(mesh.meshCount).toBe(16);

    // Nothing left missing: a further call must not call buildChunk again.
    const beforeExtra = buildSpy.mock.calls.length;
    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);
    expect(buildSpy.mock.calls.length).toBe(beforeExtra);

    mesh.dispose();
  });

  it('a smaller desired set converges in fewer calls, bounded by ceil(desired / BUDGET)', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 40); // halfCount=1 -> 4 coarsest-level root tiles
    const desired = selectLandscapeChunks(CAMERA_X, CAMERA_Z, handle.map.centerX, handle.map.centerZ, handle.map.extentHalf);
    expect(desired.length).toBe(4);

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const streamer = createLandscapeChunkStreamer(mesh);

    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);
    expect(mesh.meshCount).toBe(BUDGET);
    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);
    expect(mesh.meshCount).toBe(4);

    mesh.dispose();
  });
});

describe('createLandscapeChunkStreamer — update nearest-first ordering (#1153)', () => {
  it('builds the chunks nearest the camera first, in nearest-first order', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 40); // exactly 4 coarsest-level root tiles
    const sortedIds = expectedNearestFirst(CAMERA_X, CAMERA_Z, handle);
    expect(sortedIds.length).toBe(4);

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const buildSpy = vi.spyOn(mesh, 'buildChunk');
    const streamer = createLandscapeChunkStreamer(mesh);

    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);

    expect(buildSpy.mock.calls.length).toBe(BUDGET);
    const builtKeys = buildSpy.mock.calls.map((call) => chunkKey((call as BuildChunkArgs)[0]));
    const expectedKeys = sortedIds.slice(0, BUDGET).map(chunkKey);
    expect(builtKeys).toEqual(expectedKeys);

    mesh.dispose();
  });

  it('the second call builds the remaining, still-farther chunks — not a repeat of the first two', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 40);
    const sortedIds = expectedNearestFirst(CAMERA_X, CAMERA_Z, handle);

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const buildSpy = vi.spyOn(mesh, 'buildChunk');
    const streamer = createLandscapeChunkStreamer(mesh);

    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);
    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);

    expect(buildSpy.mock.calls.length).toBe(4);
    const builtKeys = buildSpy.mock.calls.map((call) => chunkKey((call as BuildChunkArgs)[0]));
    expect(new Set(builtKeys).size).toBe(4); // no id built twice
    expect(builtKeys).toEqual(sortedIds.map(chunkKey)); // whole run matches the full nearest-first order
  });
});

describe('createLandscapeChunkStreamer — disposal (#1153)', () => {
  it('disposes chunks that fell out of the desired set, unbudgeted, in a single update() call', () => {
    const { palette, compId } = makePalette();
    const handleWide = makeHandle(compId, 550); // 16 root tiles, cx,cz in {-2,-1,0,1}
    const handleNarrow = makeHandle(compId, 40); // 4 root tiles, cx,cz in {-1,0} — a strict subset by id of the wide set

    const wideIds = selectLandscapeChunks(CAMERA_X, CAMERA_Z, handleWide.map.centerX, handleWide.map.centerZ, handleWide.map.extentHalf);
    const narrowIds = selectLandscapeChunks(CAMERA_X, CAMERA_Z, handleNarrow.map.centerX, handleNarrow.map.centerZ, handleNarrow.map.extentHalf);
    expect(wideIds.length).toBe(16);
    expect(narrowIds.length).toBe(4);
    const wideKeys = new Set(wideIds.map(chunkKey));
    for (const id of narrowIds) expect(wideKeys.has(chunkKey(id))).toBe(true); // sanity: narrow really is a subset

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const disposeSpy = vi.spyOn(mesh, 'disposeChunk');
    const streamer = createLandscapeChunkStreamer(mesh);

    // Fully build the wide set: 16 chunks / BUDGET(2) = 8 calls.
    for (let i = 0; i < 8; i++) streamer.update(0, CAMERA_X, CAMERA_Z, handleWide, palette, FAR_CUT);
    expect(mesh.meshCount).toBe(16);

    const disposeCallsBefore = disposeSpy.mock.calls.length;
    streamer.update(0, CAMERA_X, CAMERA_Z, handleNarrow, palette, FAR_CUT);

    // All 12 chunks outside the narrow set are gone after this one call —
    // every narrow-desired chunk was already resident (built during the wide
    // phase), so this update() triggers disposals only, no new builds.
    expect(mesh.meshCount).toBe(4);
    expect(disposeSpy.mock.calls.length - disposeCallsBefore).toBe(12);

    mesh.dispose();
  });
});

describe('createLandscapeChunkStreamer — invalidateNear (#1153)', () => {
  it("rebuilds synchronously only the resident chunk whose footprint intersects the dirty rect, leaving its sibling untouched", () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 40); // 4 root tiles

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const buildSpy = vi.spyOn(mesh, 'buildChunk');
    const streamer = createLandscapeChunkStreamer(mesh);

    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT); // builds BUDGET(2) of the 4
    const builtIds = buildSpy.mock.calls.map((call) => (call as BuildChunkArgs)[0]);
    expect(builtIds.length).toBe(BUDGET);
    const [targetId, otherId] = builtIds;

    const { originX, originZ } = chunkOrigin(targetId!, handle.map.centerX, handle.map.centerZ);
    const span = chunkSpanAt(targetId!.level);
    // Deep inside targetId's own footprint, nowhere near its (adjacent) sibling's.
    const dirtyRect: Rect = {
      minX: originX + span * 0.4, maxX: originX + span * 0.6,
      minZ: originZ + span * 0.4, maxZ: originZ + span * 0.6,
    };

    const callsBefore = buildSpy.mock.calls.length;
    streamer.invalidateNear(dirtyRect);

    // Happens synchronously within invalidateNear itself — no update() call in between.
    expect(buildSpy.mock.calls.length).toBe(callsBefore + 1);
    const rebuiltIds = buildSpy.mock.calls.slice(callsBefore).map((call) => chunkKey((call as BuildChunkArgs)[0]));
    expect(rebuiltIds).toEqual([chunkKey(targetId!)]);
    expect(rebuiltIds).not.toContain(chunkKey(otherId!));

    mesh.dispose();
  });

  it('touches nothing when the dirty rect intersects no resident chunk footprint', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 40);

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const buildSpy = vi.spyOn(mesh, 'buildChunk');
    const streamer = createLandscapeChunkStreamer(mesh);
    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);

    const callsBefore = buildSpy.mock.calls.length;
    streamer.invalidateNear({ minX: -1e9, maxX: -1e9 + 1, minZ: -1e9, maxZ: -1e9 + 1 });
    expect(buildSpy.mock.calls.length).toBe(callsBefore);

    mesh.dispose();
  });

  it('is a no-op before the first update() call (no cached handle/palette/cut yet)', () => {
    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const buildSpy = vi.spyOn(mesh, 'buildChunk');
    const streamer = createLandscapeChunkStreamer(mesh);

    expect(() => streamer.invalidateNear({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 })).not.toThrow();
    expect(buildSpy.mock.calls.length).toBe(0);

    mesh.dispose();
  });
});

describe('createLandscapeChunkStreamer — reset (#1153)', () => {
  it('disposes everything and clears internal tracking, so a subsequent update() rebuilds from scratch', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 40); // 4 root tiles

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const buildSpy = vi.spyOn(mesh, 'buildChunk');
    const streamer = createLandscapeChunkStreamer(mesh);

    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);
    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT); // fully resident: 4 = BUDGET * 2
    expect(mesh.meshCount).toBe(4);
    expect(buildSpy.mock.calls.length).toBe(4);

    streamer.reset();
    expect(mesh.meshCount).toBe(0);
    expect(scene.children.length).toBe(0);

    const callsBeforeRebuild = buildSpy.mock.calls.length;
    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);
    // Every chunk reads as missing again — reset() must not leave the old ids
    // still marked resident, which would make this a silent no-op instead.
    expect(buildSpy.mock.calls.length).toBe(callsBeforeRebuild + BUDGET);
    expect(mesh.meshCount).toBe(BUDGET);

    mesh.dispose();
  });

  it('reset() before any update() call is safe (nothing built, nothing to dispose)', () => {
    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const streamer = createLandscapeChunkStreamer(mesh);

    expect(() => streamer.reset()).not.toThrow();
    expect(mesh.meshCount).toBe(0);
  });
});

describe('createLandscapeChunkStreamer — pendingChunkCount', () => {
  it('counts what the budget could not build yet, falls to 0 as the ladder converges, and stays there', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 550); // 16 root tiles
    const desired = selectLandscapeChunks(CAMERA_X, CAMERA_Z, handle.map.centerX, handle.map.centerZ, handle.map.extentHalf);
    expect(desired.length).toBe(16);

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const streamer = createLandscapeChunkStreamer(mesh);

    // Nothing has been asked for yet, so nothing is owed — a capture must not
    // wait on a streamer that has never seen a camera position.
    expect(streamer.pendingChunkCount()).toBe(0);

    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);
      seen.push(streamer.pendingChunkCount());
    }
    // 16 desired, BUDGET(2) per call: 14, 12, ... 0 on the eighth.
    expect(seen).toEqual([14, 12, 10, 8, 6, 4, 2, 0]);

    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);
    expect(streamer.pendingChunkCount()).toBe(0);

    mesh.dispose();
  });

  it('a camera move that wants new chunks puts the count back up', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 550);
    // Inside the map this time, where the ladder actually refines, so moving
    // the camera changes which chunks are wanted — the far-away CAMERA_X the
    // rest of this file uses always resolves to the same coarsest root tiles.
    const [startX, startZ] = [0, 0];
    const [movedX, movedZ] = [200, 0];
    const startIds = selectLandscapeChunks(startX, startZ, handle.map.centerX, handle.map.centerZ, handle.map.extentHalf);
    const movedIds = selectLandscapeChunks(movedX, movedZ, handle.map.centerX, handle.map.centerZ, handle.map.extentHalf);
    const startKeys = new Set(startIds.map(chunkKey));
    expect(movedIds.some(id => !startKeys.has(chunkKey(id)))).toBe(true); // premise: the move wants chunks the start position did not

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const streamer = createLandscapeChunkStreamer(mesh);

    for (let i = 0; i < Math.ceil(startIds.length / BUDGET); i++) {
      streamer.update(0, startX, startZ, handle, palette, FAR_CUT);
    }
    expect(streamer.pendingChunkCount()).toBe(0);

    streamer.update(0, movedX, movedZ, handle, palette, FAR_CUT);
    expect(streamer.pendingChunkCount()).toBeGreaterThan(0);

    mesh.dispose();
  });

  it('flush() builds the whole backlog in one call and leaves nothing pending', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 550); // 16 root tiles
    const desired = selectLandscapeChunks(CAMERA_X, CAMERA_Z, handle.map.centerX, handle.map.centerZ, handle.map.extentHalf);

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const streamer = createLandscapeChunkStreamer(mesh);

    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);
    expect(mesh.meshCount).toBe(BUDGET);
    expect(streamer.pendingChunkCount()).toBe(desired.length - BUDGET);

    // One call, no budget: everything the camera position wants is resident.
    expect(streamer.flush()).toBe(desired.length - BUDGET);
    expect(mesh.meshCount).toBe(desired.length);
    expect(streamer.pendingChunkCount()).toBe(0);

    // Converged: a second flush has nothing left to do.
    expect(streamer.flush()).toBe(0);

    mesh.dispose();
  });

  it('flush() before any update() is a no-op — no camera position has been named yet', () => {
    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const streamer = createLandscapeChunkStreamer(mesh);

    expect(streamer.flush()).toBe(0);
    expect(mesh.meshCount).toBe(0);

    mesh.dispose();
  });

  it('flush() finishes the residency set of the camera position update() last saw', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 550);
    const [startX, startZ] = [0, 0];
    const [movedX, movedZ] = [200, 0];
    const movedIds = selectLandscapeChunks(movedX, movedZ, handle.map.centerX, handle.map.centerZ, handle.map.extentHalf);

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const streamer = createLandscapeChunkStreamer(mesh);

    streamer.update(0, startX, startZ, handle, palette, FAR_CUT);
    streamer.update(0, movedX, movedZ, handle, palette, FAR_CUT);
    streamer.flush();

    // The moved camera's set, not the one it started from — a capture frames
    // what the camera is looking at now.
    expect(mesh.meshCount).toBe(movedIds.length);
    expect(streamer.pendingChunkCount()).toBe(0);

    mesh.dispose();
  });

  it('reset() clears the backlog — a reset streamer owes nothing until the next update()', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 550);

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const streamer = createLandscapeChunkStreamer(mesh);

    streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT);
    expect(streamer.pendingChunkCount()).toBeGreaterThan(0);

    streamer.reset();
    expect(streamer.pendingChunkCount()).toBe(0);

    mesh.dispose();
  });
});

describe('createLandscapeChunkStreamer — neighbourSteps fallback (#1153)', () => {
  it("builds with uniformNeighbourSteps(ownStep) when a chunk's geometric neighbour is not yet built", () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 40); // 4 root tiles, all at the coarsest ladder level

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const buildSpy = vi.spyOn(mesh, 'buildChunk');
    const streamer = createLandscapeChunkStreamer(mesh);

    expect(() => streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT)).not.toThrow();

    // Only BUDGET(2) of the 4 desired chunks got built this call, so neither
    // built chunk's neighbours are resident yet — every side must fall back
    // to this chunk's own (coarsest) step.
    expect(buildSpy.mock.calls.length).toBe(BUDGET);
    for (const call of buildSpy.mock.calls) {
      const neighbourSteps = (call as BuildChunkArgs)[3];
      expect(neighbourSteps).toEqual(uniformNeighbourSteps(COARSEST_STEP));
    }

    mesh.dispose();
  });

  it('does not throw and reports a valid ladder step on every side once neighbours become resident across calls', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 40);

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const buildSpy = vi.spyOn(mesh, 'buildChunk');
    const streamer = createLandscapeChunkStreamer(mesh);

    expect(() => {
      streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT); // 2 built, neighbours still missing
      streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT); // remaining 2 built, neighbours now resident
    }).not.toThrow();

    expect(mesh.meshCount).toBe(4);
    for (const call of buildSpy.mock.calls) {
      const neighbourSteps = (call as BuildChunkArgs)[3];
      for (const side of [neighbourSteps.west, neighbourSteps.east, neighbourSteps.north, neighbourSteps.south]) {
        expect(LADDER_STEPS).toContain(side);
      }
    }

    mesh.dispose();
  });
});
