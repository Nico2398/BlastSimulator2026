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
import {
  LandscapeMesh, uniformNeighbourSteps, buildChunkMesh, type PlayableCut, type NeighbourSteps,
} from '../../../../src/renderer/terrain/LandscapeMesh.js';
import { createLandscapeChunkStreamer, type LandscapeChunkStreamer } from '../../../../src/renderer/terrain/LandscapeChunkStreamer.js';
import { Random } from '../../../../src/core/math/Random.js';
import type { VoxelGrid } from '../../../../src/core/world/VoxelGrid.js';
import { measureSeam } from '../../../helpers/landscapeSeam.js';
import { heightField, makeLadderChunk } from '../../../helpers/ladderField.js';

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

describe('createLandscapeChunkStreamer — neighbourSteps fallback (#1153, #1655)', () => {
  it("builds with uniformNeighbourSteps(ownStep) when the chunk's neighbours are same-step chunks of the desired set, built yet or not", () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, 40); // 4 root tiles, all at the coarsest ladder level

    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const buildSpy = vi.spyOn(mesh, 'buildChunk');
    const streamer = createLandscapeChunkStreamer(mesh);

    expect(() => streamer.update(0, CAMERA_X, CAMERA_Z, handle, palette, FAR_CUT)).not.toThrow();

    // Only BUDGET(2) of the 4 desired chunks got built this call. Neighbour
    // steps come from the desired set, not from what happens to be resident,
    // so a same-step neighbour answers with its own step whether or not it is
    // built, and an outward side with no neighbour at all falls back to this
    // chunk's own step: all four sides read the coarsest step.
    expect(buildSpy.mock.calls.length).toBe(BUDGET);
    for (const call of buildSpy.mock.calls) {
      const neighbourSteps = (call as BuildChunkArgs)[3];
      expect(neighbourSteps).toEqual(uniformNeighbourSteps(COARSEST_STEP));
    }

    mesh.dispose();
  });

  it('falls back to the own step only on a side with no neighbour in the desired set, and chords toward a coarser desired neighbour on the others', () => {
    const { palette, compId } = makePalette();
    const handle = makeRidgedHandle(compId, 550);
    // Camera in the map's north-west corner, so the ladder refines right
    // against the map edge: some refined chunk has no neighbour at all on its
    // outward side and a coarser one on another.
    const camera = [-1000, -400] as const;
    const ids = selectLandscapeChunks(camera[0], camera[1], 0, 0, 550);
    const fps = footprintsFor(ids);
    const sideProbes = (f: Footprint): Array<Footprint | undefined> => [
      footprintAt(fps, f.originX - 0.5, f.originZ + f.span / 2),
      footprintAt(fps, f.originX + f.span + 0.5, f.originZ + f.span / 2),
      footprintAt(fps, f.originX + f.span / 2, f.originZ - 0.5),
      footprintAt(fps, f.originX + f.span / 2, f.originZ + f.span + 0.5),
    ];
    const corner = fps.find(f => {
      const n = sideProbes(f);
      return n.some(x => !x) && n.some(x => x && x.step > f.step);
    });
    expect(corner, 'premise: a chunk with a map-edge side and a coarser neighbour exists').toBeDefined();
    const expected = expectedSteps(corner!, fps);
    const sides: Side[] = ['west', 'east', 'north', 'south'];
    sideProbes(corner!).forEach((n, i) => {
      if (!n) expect(expected[sides[i]!]).toBe(corner!.step);
      else expect(expected[sides[i]!]).toBe(Math.max(corner!.step, n.step));
    });

    const mesh = new LandscapeMesh(makeScene(), makeMaterial());
    const buildSpy = vi.spyOn(mesh, 'buildChunk');
    const streamer = createLandscapeChunkStreamer(mesh);
    converge(streamer, camera, handle, palette);

    const cornerCalls = buildSpy.mock.calls.filter(c => chunkKey((c as BuildChunkArgs)[0]) === chunkKey(corner!.id));
    expect(cornerCalls.length).toBeGreaterThan(0);
    for (const call of cornerCalls) expect((call as BuildChunkArgs)[3]).toEqual(expected);

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

// ── Seam consistency under residency changes (#1655) ────────────────────────
//
// LandscapeMesh.buildChunkMesh closes the join between two chunks of different
// ladder steps when it is told the neighbour's step (LandscapeSeam.test.ts).
// What it is told is the streamer's job, and chunks arrive one frame at a time,
// in distance order, while the camera keeps moving. The seam is only as good
// as the neighbour steps the streamer stamps on each build AND keeps current
// as the neighbourhood changes, so these tests drive the real streamer on a
// ridged height field (a flat one hides every gap) and measure the finished
// edges.

/** Metres the edge profile may disagree by. A missing chord is tenths of a metre on the ridged field; float32 positions are good to ~1e-6. */
const EDGE_GAP_TOLERANCE = 1e-4;

/** Frames a converging streamer may take before the test calls it stuck. */
const MAX_FRAMES = 600;

type Side = keyof NeighbourSteps;

interface Footprint {
  id: LandscapeChunkId;
  originX: number;
  originZ: number;
  span: number;
  step: number;
}

/** A shared edge where `fine` meets a strictly coarser `coarse` neighbour along `side` of `fine`. */
interface LodEdge {
  fine: Footprint;
  coarse: Footprint;
  side: Side;
  axis: 'x' | 'z';
  /** World coordinate of the edge line along `axis`. */
  coord: number;
  /** Extent along the other axis. */
  lo: number;
  hi: number;
}

/** A handle over the ridged `heightField`, so chunk lattices at different steps disagree wherever a chord is missing. */
function makeRidgedHandle(compId: number, extentHalf: number): LandscapeHandle {
  const cache = new Map<string, LandscapeChunk>();
  const map: LazyLandscapeMap = {
    extentHalf, centerX: 0, centerZ: 0,
    getChunk(id: LandscapeChunkId): LandscapeChunk {
      const key = chunkKey(id);
      let c = cache.get(key);
      if (!c) {
        const { originX, originZ } = chunkOrigin(id, 0, 0);
        c = makeLadderChunk(id, originX, originZ, LADDER_STEPS[id.level]!, compId);
        cache.set(key, c);
      }
      return c;
    },
    hasChunk: (id: LandscapeChunkId) => cache.has(chunkKey(id)),
    get cachedChunkIds() { return Array.from(cache.values(), (c) => c.id); },
  };
  return {
    ...makeHandle(compId, extentHalf),
    map,
    sampleColumn: (x: number, z: number) => ({ height: heightField(x, z), biomeId: 0, surfCompId: compId }),
  };
}

function footprintsFor(ids: readonly LandscapeChunkId[]): Footprint[] {
  return ids.map(id => ({ id, ...chunkOrigin(id, 0, 0), span: chunkSpanAt(id.level), step: LADDER_STEPS[id.level]! }));
}

function footprintAt(fps: readonly Footprint[], x: number, z: number): Footprint | undefined {
  return fps.find(f => x >= f.originX && x < f.originX + f.span && z >= f.originZ && z < f.originZ + f.span);
}

/** What each side of `f` must be stamped with: the coarser of own and neighbour step; own step where no neighbour is desired. */
function expectedSteps(f: Footprint, fps: readonly Footprint[]): NeighbourSteps {
  const probe = (dx: number, dz: number): number => {
    const n = footprintAt(fps, f.originX + dx, f.originZ + dz);
    return n ? Math.max(f.step, n.step) : f.step;
  };
  return {
    west: probe(-0.5, f.span / 2),
    east: probe(f.span + 0.5, f.span / 2),
    north: probe(f.span / 2, -0.5),
    south: probe(f.span / 2, f.span + 0.5),
  };
}

/** Every edge where a chunk meets a coarser neighbour, optionally only for one fine step. */
function lodEdges(fps: readonly Footprint[], fineStep?: number): LodEdge[] {
  const edges: LodEdge[] = [];
  for (const fine of fps) {
    if (fineStep !== undefined && fine.step !== fineStep) continue;
    const sides: Array<[Side, 'x' | 'z', number, number, number]> = [
      ['west', 'x', fine.originX, fine.originZ + fine.span / 2, fine.originZ],
      ['east', 'x', fine.originX + fine.span, fine.originZ + fine.span / 2, fine.originZ],
      ['north', 'z', fine.originZ, fine.originX + fine.span / 2, fine.originX],
      ['south', 'z', fine.originZ + fine.span, fine.originX + fine.span / 2, fine.originX],
    ];
    for (const [side, axis, coord, mid, lo] of sides) {
      const probeX = axis === 'x' ? coord + (side === 'west' ? -0.5 : 0.5) : mid;
      const probeZ = axis === 'x' ? mid : coord + (side === 'north' ? -0.5 : 0.5);
      const coarse = footprintAt(fps, probeX, probeZ);
      if (!coarse || coarse.step <= fine.step) continue;
      edges.push({ fine, coarse, side, axis, coord, lo, hi: lo + fine.span });
    }
  }
  return edges;
}

/** Frames of `streamer.update` until a frame builds nothing with nothing pending; returns each frame's buildChunk call count. */
function converge(
  streamer: LandscapeChunkStreamer, camera: readonly [number, number] | readonly number[],
  handle: LandscapeHandle, palette: CompositionPalette, buildSpy?: { mock: { calls: unknown[] } },
): number[] {
  const counts: number[] = [];
  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    const before = buildSpy?.mock.calls.length ?? 0;
    streamer.update(0, camera[0]!, camera[1]!, handle, palette, FAR_CUT);
    counts.push((buildSpy?.mock.calls.length ?? 0) - before);
    if (streamer.pendingChunkCount() === 0 && (buildSpy ? counts[counts.length - 1] === 0 : frame > 0)) return counts;
  }
  throw new Error(`streamer still pending after ${MAX_FRAMES} frames`);
}

/** The mesh each desired chunk currently has, rebuilt from the arguments of its LAST buildChunk call — what `LandscapeMesh` holds for it. */
function residentMeshes(
  buildSpy: { mock: { calls: unknown[] } }, handle: LandscapeHandle, palette: CompositionPalette,
): (id: LandscapeChunkId) => THREE.Mesh {
  const cache = new Map<string, THREE.Mesh>();
  return (id) => {
    const key = chunkKey(id);
    const hit = cache.get(key);
    if (hit) return hit;
    const calls = (buildSpy.mock.calls as BuildChunkArgs[]).filter(c => chunkKey(c[0]) === key);
    expect(calls.length, `chunk ${key} was never built`).toBeGreaterThan(0);
    const last = calls[calls.length - 1]!;
    const built = buildChunkMesh(handle.map.getChunk(id), last[3], palette, last[4] ?? FAR_CUT, handle.sampleColumn);
    expect(built, `chunk ${key} has no mesh`).not.toBeNull();
    cache.set(key, built!);
    return built!;
  };
}

/** (t along the edge, height) of every drawn vertex of `mesh` that sits on the edge line within [lo, hi], sorted by t. */
function edgeProfile(mesh: THREE.Mesh, edge: LodEdge): Array<{ t: number; y: number }> {
  const pos = mesh.geometry.attributes['position'] as THREE.BufferAttribute;
  const index = mesh.geometry.getIndex();
  const used = new Set<number>();
  if (index) for (let i = 0; i < index.count; i++) used.add(index.getX(i));
  else for (let i = 0; i < pos.count; i++) used.add(i);
  const byT = new Map<number, number>();
  for (const i of used) {
    const along = edge.axis === 'x' ? pos.getX(i) : pos.getZ(i);
    const t = edge.axis === 'x' ? pos.getZ(i) : pos.getX(i);
    if (Math.abs(along - edge.coord) > 1e-4 || t < edge.lo - 1e-4 || t > edge.hi + 1e-4) continue;
    byT.set(Math.round(t * 1000) / 1000, pos.getY(i));
  }
  return Array.from(byT, ([t, y]) => ({ t, y })).sort((a, b) => a.t - b.t);
}

/**
 * Worst vertical distance between the fine chunk's edge vertices and the
 * coarse chunk's straight edge between its own nodes, metres. Infinity when
 * the coarse edge does not span a fine vertex.
 */
function worstEdgeGap(fineMesh: THREE.Mesh, coarseMesh: THREE.Mesh, edge: LodEdge): number {
  const fine = edgeProfile(fineMesh, edge);
  const coarse = edgeProfile(coarseMesh, edge);
  if (fine.length < 2 || coarse.length < 2) return Infinity;
  let worst = 0;
  for (const v of fine) {
    let upper = coarse.findIndex(c => c.t >= v.t - 1e-6);
    if (upper < 0) return Infinity;
    if (upper === 0 && coarse[0]!.t > v.t + 1e-6) return Infinity;
    upper = Math.max(upper, 1);
    const a = coarse[upper - 1]!, b = coarse[upper]!;
    const w = (v.t - a.t) / (b.t - a.t);
    worst = Math.max(worst, Math.abs(v.y - (a.y + w * (b.y - a.y))));
  }
  return worst;
}

/** Asserts one edge closes: no height gap at any fine vertex, and (when `viaSeam`) measureSeam sees no uncovered / double-covered cell and no shared-node disagreement. */
function expectEdgeClosed(
  edge: LodEdge, meshOf: (id: LandscapeChunkId) => THREE.Mesh, viaSeam: boolean, label: string,
): void {
  const fineMesh = meshOf(edge.fine.id), coarseMesh = meshOf(edge.coarse.id);
  const where = `${label}: ${chunkKey(edge.fine.id)} (${edge.fine.step}m) ${edge.side} -> ${chunkKey(edge.coarse.id)} (${edge.coarse.step}m)`;
  expect(worstEdgeGap(fineMesh, coarseMesh, edge), `edge gap, ${where}`).toBeLessThan(EDGE_GAP_TOLERANCE);
  if (!viaSeam) return;
  const band = edge.coarse.step / 2;
  const window = edge.axis === 'x'
    ? { minX: edge.coord, maxX: edge.coord, minZ: edge.lo + band, maxZ: edge.hi - band }
    : { minZ: edge.coord, maxZ: edge.coord, minX: edge.lo + band, maxX: edge.hi - band };
  const seam = measureSeam([fineMesh], [coarseMesh], window as unknown as VoxelGrid, edge.fine.step, edge.coarse.step);
  expect(seam.doubleCovered, `double covered, ${where}`).toEqual([]);
  expect(seam.uncovered, `uncovered, ${where}`).toEqual([]);
  expect(seam.worstDisagreement, `shared node disagreement, ${where}`).toBeLessThan(1e-6);
}

/** Distance from the camera to a footprint's centre, squared — the streamer's build order. */
function distSq(f: Footprint, camera: readonly number[]): number {
  return (f.originX + f.span / 2 - camera[0]!) ** 2 + (f.originZ + f.span / 2 - camera[1]!) ** 2;
}

const LOD_PAIRS: ReadonlyArray<readonly [number, number]> = [[1, 2], [2, 4], [4, 8], [8, 16]];
const EXTENT = 550;
const CAMERA_A = [0, 0] as const;
const CAMERA_B = [80, 0] as const;

function setup() {
  const { palette, compId } = makePalette();
  const handle = makeRidgedHandle(compId, EXTENT);
  const mesh = new LandscapeMesh(makeScene(), makeMaterial());
  const buildSpy = vi.spyOn(mesh, 'buildChunk');
  const streamer = createLandscapeChunkStreamer(mesh);
  return { palette, handle, mesh, buildSpy, streamer };
}

function desiredFootprints(camera: readonly number[]): Footprint[] {
  return footprintsFor(selectLandscapeChunks(camera[0]!, camera[1]!, 0, 0, EXTENT));
}

describe('createLandscapeChunkStreamer — seam consistency under residency changes (#1655)', () => {
  describe.each(LOD_PAIRS)('%im chunk beside a %im neighbour', (fineStep, coarseStep) => {
    it('a fine chunk built before its coarse neighbour is stamped with the coarse step and meets it with no gap', () => {
      const { palette, handle, mesh, buildSpy, streamer } = setup();
      const fps = desiredFootprints(CAMERA_A);
      const edges = lodEdges(fps, fineStep).filter(e => e.coarse.step === coarseStep);
      expect(edges.length, `premise: camera ${CAMERA_A} puts a ${fineStep}m chunk beside a ${coarseStep}m one`).toBeGreaterThan(0);
      // The fine chunk is nearer the camera than its coarse neighbour, so the
      // nearest-first queue builds it first — the case that used to get no chord.
      const earlyEdges = edges.filter(e => distSq(e.fine, CAMERA_A) < distSq(e.coarse, CAMERA_A));
      expect(earlyEdges.length, 'premise: a fine chunk precedes its coarse neighbour in the build queue').toBeGreaterThan(0);
      const edge = earlyEdges.sort((a, b) => distSq(a.fine, CAMERA_A) - distSq(b.fine, CAMERA_A))[0]!;

      converge(streamer, CAMERA_A, handle, palette, buildSpy);

      const builtKeys = (buildSpy.mock.calls as BuildChunkArgs[]).map(c => chunkKey(c[0]));
      const fineKey = chunkKey(edge.fine.id), coarseKey = chunkKey(edge.coarse.id);
      expect(builtKeys.indexOf(fineKey), 'premise: fine chunk built first').toBeLessThan(builtKeys.indexOf(coarseKey));

      const fineCalls = (buildSpy.mock.calls as BuildChunkArgs[]).filter(c => chunkKey(c[0]) === fineKey);
      for (const call of fineCalls) {
        expect(call[3][edge.side], `${fineKey} ${edge.side} step on a build call`).toBe(coarseStep);
      }
      expectEdgeClosed(edge, residentMeshes(buildSpy, handle, palette), true, 'converged');
      mesh.dispose();
    });

    it('stays gap-free at both stages when the neighbour changes level after a camera move', () => {
      const { palette, handle, mesh, buildSpy, streamer } = setup();
      const stageA = desiredFootprints(CAMERA_A), stageB = desiredFootprints(CAMERA_B);
      // Premise: a chunk of this step survives the move and one of its sides now faces a different step.
      const changed = stageA.filter(f => {
        const after = stageB.find(g => chunkKey(g.id) === chunkKey(f.id));
        if (!after || f.step !== fineStep) return false;
        const before = expectedSteps(f, stageA), now = expectedSteps(after, stageB);
        return (['west', 'east', 'north', 'south'] as const).some(s => before[s] !== now[s]);
      });
      expect(changed.length, `premise: the move changes a neighbour of a ${fineStep}m chunk`).toBeGreaterThan(0);

      for (const [label, camera, fps] of [['stage A', CAMERA_A, stageA], ['stage B', CAMERA_B, stageB]] as const) {
        converge(streamer, camera, handle, palette, buildSpy);
        const edges = lodEdges(fps, fineStep).filter(e => e.coarse.step === coarseStep);
        expect(edges.length, `premise: ${label} has a ${fineStep}/${coarseStep} edge`).toBeGreaterThan(0);
        const meshOf = residentMeshes(buildSpy, handle, palette);
        edges.forEach((edge, i) => expectEdgeClosed(edge, meshOf, i === 0, label));
        // Every chunk, not just the ones on this pair's edges, ends up stamped with the steps its neighbourhood implies.
        for (const f of fps) {
          const calls = (buildSpy.mock.calls as BuildChunkArgs[]).filter(c => chunkKey(c[0]) === chunkKey(f.id));
          expect(calls[calls.length - 1]![3], `${label}: last stamp of ${chunkKey(f.id)}`).toEqual(expectedSteps(f, fps));
        }
      }
      mesh.dispose();
    });
  });

  it.each([
    ['from the origin', [CAMERA_A]],
    ['across a camera move', [CAMERA_A, CAMERA_B, [-50, 20], [0, -70]]],
  ] as const)('never exceeds the per-frame build budget, and a converged streamer builds nothing (%s)', (_name, cameras) => {
    const { palette, handle, mesh, buildSpy, streamer } = setup();
    for (const camera of cameras) {
      const counts = converge(streamer, camera, handle, palette, buildSpy);
      for (const n of counts) expect(n).toBeLessThanOrEqual(BUDGET);
      expect(counts[counts.length - 1]).toBe(0);
      expect(streamer.pendingChunkCount()).toBe(0);
      for (let i = 0; i < 3; i++) {
        const before = buildSpy.mock.calls.length;
        streamer.update(0, camera[0]!, camera[1]!, handle, palette, FAR_CUT);
        expect(buildSpy.mock.calls.length - before, 'converged update() rebuilt something').toBe(0);
      }
    }
    mesh.dispose();
  });

  it('counts chunks left stale by a camera move as pending, and flush() drains stale and missing together', () => {
    const { palette, handle, mesh, buildSpy, streamer } = setup();
    converge(streamer, CAMERA_A, handle, palette, buildSpy);
    streamer.update(0, CAMERA_B[0], CAMERA_B[1], handle, palette, FAR_CUT);
    const owed = streamer.pendingChunkCount();
    expect(owed, 'a camera move owes work').toBeGreaterThan(BUDGET);

    const before = buildSpy.mock.calls.length;
    expect(streamer.flush(), 'flush reports what it built').toBe(owed);
    expect(buildSpy.mock.calls.length - before).toBe(owed);
    expect(streamer.pendingChunkCount()).toBe(0);
    expect(streamer.flush()).toBe(0);

    const after = buildSpy.mock.calls.length;
    streamer.update(0, CAMERA_B[0], CAMERA_B[1], handle, palette, FAR_CUT);
    expect(buildSpy.mock.calls.length, 'update after flush found more to do').toBe(after);

    const fps = desiredFootprints(CAMERA_B);
    const meshOf = residentMeshes(buildSpy, handle, palette);
    for (const edge of lodEdges(fps)) expectEdgeClosed(edge, meshOf, false, 'after flush');
    for (const f of fps) {
      const calls = (buildSpy.mock.calls as BuildChunkArgs[]).filter(c => chunkKey(c[0]) === chunkKey(f.id));
      expect(calls[calls.length - 1]![3]).toEqual(expectedSteps(f, fps));
    }
    mesh.dispose();
  });

  it('leaves every lod edge gap-free after flush() at each of ~20 seeded camera positions', () => {
    const { palette, handle, mesh, buildSpy, streamer } = setup();
    const rng = new Random(1655);
    let checked = 0;
    for (let i = 0; i < 20; i++) {
      const camera = [rng.nextFloat(-300, 300), rng.nextFloat(-300, 300)] as const;
      streamer.update(0, camera[0], camera[1], handle, palette, FAR_CUT);
      streamer.flush();
      expect(streamer.pendingChunkCount()).toBe(0);

      const fps = desiredFootprints(camera);
      const meshOf = residentMeshes(buildSpy, handle, palette);
      for (const edge of lodEdges(fps)) {
        expectEdgeClosed(edge, meshOf, false, `sweep ${i} at (${camera[0].toFixed(1)}, ${camera[1].toFixed(1)})`);
        checked++;
      }
    }
    expect(checked, 'the sweep met no lod edges at all').toBeGreaterThan(100);
    mesh.dispose();
  }, 120_000);

  it('invalidateNear rebuilds with the steps the desired set implies, even when the coarse neighbour is not built yet', () => {
    const { palette, handle, mesh, buildSpy, streamer } = setup();
    const fps = desiredFootprints(CAMERA_A);
    // Stream until some built chunk faces a coarser chunk that has not been built yet.
    let target: Footprint | undefined;
    for (let frame = 0; frame < 20 && !target; frame++) {
      streamer.update(0, CAMERA_A[0], CAMERA_A[1], handle, palette, FAR_CUT);
      const builtKeys = new Set((buildSpy.mock.calls as BuildChunkArgs[]).map(c => chunkKey(c[0])));
      target = fps.find(f => builtKeys.has(chunkKey(f.id))
        && lodEdges(fps).some(e => chunkKey(e.fine.id) === chunkKey(f.id) && !builtKeys.has(chunkKey(e.coarse.id))));
    }
    expect(target, 'premise: a built chunk has a coarser neighbour that is still unbuilt').toBeDefined();

    const before = buildSpy.mock.calls.length;
    streamer.invalidateNear({
      minX: target!.originX + target!.span * 0.4, maxX: target!.originX + target!.span * 0.6,
      minZ: target!.originZ + target!.span * 0.4, maxZ: target!.originZ + target!.span * 0.6,
    });
    const rebuilds = (buildSpy.mock.calls.slice(before) as BuildChunkArgs[]).filter(c => chunkKey(c[0]) === chunkKey(target!.id));
    expect(rebuilds.length).toBe(1);
    expect(rebuilds[0]![3]).toEqual(expectedSteps(target!, fps));
    mesh.dispose();
  });
});

// ── No hole on screen while residency changes ──────────────────────────────
//
// A camera move quarters a coarse chunk into four finer ones (or merges four
// back into one). Builds are budgeted per frame, so the replacements arrive
// over several frames; disposing the old chunk the frame it fell out of the
// desired set left its footprint empty until they did — terrain blinking out
// for a frame or two while the camera moves. Whatever is drawn after any
// single update() must tile the whole extent: no hole, no overlap.

/** World-space x/z rectangle of every drawn chunk mesh in `scene`. */
function drawnFootprints(scene: THREE.Scene): Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> {
  return scene.children
    .filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible)
    .map(m => {
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!;
      return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
    });
}

describe('createLandscapeChunkStreamer — no hole while the camera moves', () => {
  it('every frame of a camera sweep draws ground over the whole extent, with no chunk drawn over another', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, EXTENT);
    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const streamer = createLandscapeChunkStreamer(mesh);
    const roots = selectLandscapeChunks(1e6, 1e6, 0, 0, EXTENT);
    const extentArea = roots.length * chunkSpanAt(LADDER_STEPS.length - 1) ** 2;

    streamer.update(0, 0, 0, handle, palette, FAR_CUT);
    streamer.flush();

    let framesWithWork = 0;
    for (let i = 1; i <= 60; i++) {
      const camera = [i * 7, i * 3] as const;
      streamer.update(0, camera[0], camera[1], handle, palette, FAR_CUT);
      if (streamer.pendingChunkCount() > 0) framesWithWork++;
      const drawn = drawnFootprints(scene);
      for (let a = 0; a < drawn.length; a++) {
        for (let b = a + 1; b < drawn.length; b++) {
          const p = drawn[a]!, q = drawn[b]!;
          const overlap = Math.max(0, Math.min(p.maxX, q.maxX) - Math.max(p.minX, q.minX))
            * Math.max(0, Math.min(p.maxZ, q.maxZ) - Math.max(p.minZ, q.minZ));
          expect(overlap, `frame ${i}: two drawn chunks overlap`).toBe(0);
        }
      }
      const area = drawn.reduce((s, r) => s + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0);
      expect(area, `frame ${i} at camera (${camera[0]}, ${camera[1]}): drawn ground area`).toBe(extentArea);
    }
    expect(framesWithWork, 'premise: the sweep makes the budget spread builds across frames').toBeGreaterThan(0);

    mesh.dispose();
  });

  it('a chunk built while the one it replaces is still drawn stays hidden from picking until the swap', () => {
    const { palette, compId } = makePalette();
    const handle = makeHandle(compId, EXTENT);
    const scene = makeScene();
    const mesh = new LandscapeMesh(scene, makeMaterial());
    const streamer = createLandscapeChunkStreamer(mesh);

    streamer.update(0, 0, 0, handle, palette, FAR_CUT);
    streamer.flush();
    streamer.update(0, 300, 200, handle, palette, FAR_CUT);
    expect(streamer.pendingChunkCount(), 'premise: the move left builds owed').toBeGreaterThan(0);

    expect(mesh.meshCount, 'premise: a replacement is built and waiting').toBeGreaterThan(drawnFootprints(scene).length);
    for (const m of mesh.meshes) expect(m.visible).toBe(true);
    expect(mesh.meshes.length).toBe(drawnFootprints(scene).length);
    streamer.flush();
    expect(mesh.meshes.length).toBe(mesh.meshCount);

    mesh.dispose();
  });
});
