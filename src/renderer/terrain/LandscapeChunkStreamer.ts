// BlastSimulator2026 — Landscape chunk streamer (#1153)
// Drives which landscape chunks are resident in a LandscapeMesh against the
// camera position, replacing the old eager whole-map LandscapeMesh.build()
// call with a per-frame near/far resolution-ladder residency update.

import {
  selectLandscapeChunks, chunkOrigin, chunkSpanAt, chunkKey, LADDER_STEPS, type LandscapeChunkId,
} from '../../core/world/LandscapeMap.js';
import type { LandscapeMesh, NeighbourSteps, PlayableCut } from './LandscapeMesh.js';
import type { LandscapeHandle } from '../../console/commands/world.js';
import type { CompositionPalette } from '../../core/world/VoxelGrid.js';
import type { Rect } from '../../core/world/WorldGen.js';

/** Chunk builds `update()` may perform in one call — budgets the per-frame cost so a camera move never stalls a frame. */
const MAX_CHUNK_BUILDS_PER_FRAME = 2;

/** Small outward nudge past a chunk's own edge so a probe point falls
 *  unambiguously inside the neighbouring footprint instead of landing
 *  exactly on the shared boundary line. Well under the finest chunk span
 *  (32 m), so it can never skip past a genuine neighbour. */
const EDGE_PROBE_EPSILON = 0.5;

interface ChunkFootprint {
  id: LandscapeChunkId;
  originX: number;
  originZ: number;
  span: number;
}

function footprintsOf(ids: readonly LandscapeChunkId[], centerX: number, centerZ: number): ChunkFootprint[] {
  return ids.map(id => {
    const { originX, originZ } = chunkOrigin(id, centerX, centerZ);
    return { id, originX, originZ, span: chunkSpanAt(id.level) };
  });
}

/** The footprint (of `footprints`) whose square contains world point (x, z), or null past the edge of the set. */
function footprintContaining(footprints: readonly ChunkFootprint[], x: number, z: number): ChunkFootprint | null {
  for (const f of footprints) {
    if (x >= f.originX && x < f.originX + f.span && z >= f.originZ && z < f.originZ + f.span) return f;
  }
  return null;
}

/** Streams landscape chunk residency against the camera, and invalidates cached chunks a terrain edit has made stale. */
export interface LandscapeChunkStreamer {
  update(dt: number, cameraX: number, cameraZ: number, handle: LandscapeHandle, palette: CompositionPalette, cut: PlayableCut): void;
  invalidateNear(dirtyRect: Rect): void;
  reset(): void;
  /**
   * Chunks the last `update()` wanted resident and could not build within its
   * budget — 0 once the ladder has converged, and 0 before the first update.
   *
   * Exists for the browser-driven harnesses. Streaming is budgeted against a
   * live 60 fps loop, where the ~56 calls a full ladder needs cost under a
   * second and nobody sees the gap. A screenshot is the opposite case: it
   * captures one instant a fraction of a second after a camera move, so the
   * chunks still queued render as sky, and the props standing on them float
   * in it.
   */
  pendingChunkCount(): number;
  /**
   * Build every chunk the last `update()` still owes, ignoring the per-frame
   * budget, and return how many were built. A no-op (returning 0) before the
   * first update, or once streaming has converged.
   *
   * The budget exists to protect a live loop's frame pacing. A screenshot has
   * no pacing to protect and cannot wait the queue out either: without a GPU
   * a drawn frame costs seconds, so the ~56 frames a full ladder needs are
   * minutes, and the capture harness renders frames one at a time on demand.
   * Draining in one call costs the sampling and meshing once —
   * `captureFrame` (scripts/shared/puppeteer-utils.ts) calls this through
   * `window.__landscapeFlush` so the image shows ground everywhere the camera
   * can see, not sky with the scenery hanging in it.
   */
  flush(): number;
}

/** `mesh` is the LandscapeMesh instance the streamer builds/disposes chunks against — one streamer per mesh. */
export function createLandscapeChunkStreamer(mesh: LandscapeMesh): LandscapeChunkStreamer {
  /** Chunks this streamer has asked `mesh` to build and not yet disposed. */
  const built = new Map<string, LandscapeChunkId>();
  // Cached from the last update() call so invalidateNear() (no handle/palette/cut
  // params of its own) can still rebuild — null before the first update().
  let lastHandle: LandscapeHandle | null = null;
  let lastPalette: CompositionPalette | null = null;
  let lastCut: PlayableCut | null = null;
  /** Desired-but-not-resident chunks left after the last update()'s budgeted builds — see pendingChunkCount(). */
  let pending = 0;
  // Last camera position update() streamed against, so flush() can finish
  // that same residency set rather than needing its own camera argument.
  let lastCameraX = 0;
  let lastCameraZ = 0;

  /**
   * `footprint`'s four sides' real neighbour step, read geometrically against
   * `footprints` (the desired or resident set to search) — a probe point just
   * past each side finds whichever footprint covers it, and its ladder step
   * is that side's answer. Falls back to this chunk's own step (no chord)
   * when no neighbour is found there, or the neighbour found hasn't actually
   * been built yet — never crashes on a sparse residency set.
   */
  const neighbourStepsFor = (footprint: ChunkFootprint, footprints: readonly ChunkFootprint[]): NeighbourSteps => {
    const ownStep = LADDER_STEPS[footprint.id.level]!;
    const probe = (dx: number, dz: number): number => {
      const neighbour = footprintContaining(footprints, footprint.originX + dx, footprint.originZ + dz);
      if (!neighbour || !built.has(chunkKey(neighbour.id))) return ownStep;
      return LADDER_STEPS[neighbour.id.level]!;
    };
    return {
      west: probe(-EDGE_PROBE_EPSILON, footprint.span / 2),
      east: probe(footprint.span + EDGE_PROBE_EPSILON, footprint.span / 2),
      north: probe(footprint.span / 2, -EDGE_PROBE_EPSILON),
      south: probe(footprint.span / 2, footprint.span + EDGE_PROBE_EPSILON),
    };
  };

  /**
   * Bring residency in line with (cameraX, cameraZ): dispose what is no
   * longer wanted, then build at most `maxBuilds` of what is missing,
   * nearest-first. Updates `pending` to what is still owed afterwards and
   * returns how many chunks were built. Shared by the per-frame `update()`
   * (budgeted) and `flush()` (unbounded).
   */
  const stream = (
    cameraX: number, cameraZ: number,
    handle: LandscapeHandle, palette: CompositionPalette, cut: PlayableCut,
    maxBuilds: number,
  ): number => {
    const desiredIds = selectLandscapeChunks(cameraX, cameraZ, handle.map.centerX, handle.map.centerZ, handle.map.extentHalf);
    const desiredKeys = new Set(desiredIds.map(chunkKey));

    // Dispose every resident chunk no longer desired — cheap, unbudgeted, every call.
    for (const [key, id] of built) {
      if (desiredKeys.has(key)) continue;
      mesh.disposeChunk(id);
      built.delete(key);
    }

    const missingIds = desiredIds.filter(id => !built.has(chunkKey(id)));
    pending = missingIds.length;
    if (missingIds.length === 0) return 0;

    const footprints = footprintsOf(desiredIds, handle.map.centerX, handle.map.centerZ);
    const footprintById = new Map(footprints.map(f => [chunkKey(f.id), f]));

    const distSqToCamera = (id: LandscapeChunkId): number => {
      const f = footprintById.get(chunkKey(id))!;
      const dx = f.originX + f.span / 2 - cameraX;
      const dz = f.originZ + f.span / 2 - cameraZ;
      return dx * dx + dz * dz;
    };
    missingIds.sort((a, b) => distSqToCamera(a) - distSqToCamera(b));

    const budget = Math.min(maxBuilds, missingIds.length);
    for (let i = 0; i < budget; i++) {
      const id = missingIds[i]!;
      const footprint = footprintById.get(chunkKey(id))!;
      const neighbourSteps = neighbourStepsFor(footprint, footprints);
      mesh.buildChunk(id, handle, palette, neighbourSteps, cut);
      built.set(chunkKey(id), id);
    }
    pending = missingIds.length - budget;
    return budget;
  };

  return {
    update(_dt, cameraX, cameraZ, handle, palette, cut) {
      lastHandle = handle;
      lastPalette = palette;
      lastCut = cut;
      lastCameraX = cameraX;
      lastCameraZ = cameraZ;
      stream(cameraX, cameraZ, handle, palette, cut, MAX_CHUNK_BUILDS_PER_FRAME);
    },

    pendingChunkCount() {
      return pending;
    },

    flush() {
      if (!lastHandle || !lastPalette || !lastCut) return 0;
      return stream(lastCameraX, lastCameraZ, lastHandle, lastPalette, lastCut, Infinity);
    },

    invalidateNear(dirtyRect) {
      if (!lastHandle || !lastPalette || !lastCut) return;
      const handle = lastHandle, palette = lastPalette, cut = lastCut;

      const residentIds = Array.from(built.values());
      const footprints = footprintsOf(residentIds, handle.map.centerX, handle.map.centerZ);

      for (const f of footprints) {
        const intersects =
          f.originX < dirtyRect.maxX && f.originX + f.span > dirtyRect.minX &&
          f.originZ < dirtyRect.maxZ && f.originZ + f.span > dirtyRect.minZ;
        if (!intersects) continue;
        const neighbourSteps = neighbourStepsFor(f, footprints);
        mesh.buildChunk(f.id, handle, palette, neighbourSteps, cut);
      }
    },

    reset() {
      mesh.dispose();
      built.clear();
      lastHandle = null;
      lastPalette = null;
      lastCut = null;
      // Nothing is desired again until the next update() names a camera
      // position, so a reset streamer owes no chunks — reporting the old
      // level's backlog would make a capture wait for builds nobody asked
      // for.
      pending = 0;
    },
  };
}
