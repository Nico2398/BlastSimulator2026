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

function sameSteps(a: NeighbourSteps, b: NeighbourSteps): boolean {
  return a.west === b.west && a.east === b.east && a.north === b.north && a.south === b.south;
}

/** `mesh` is the LandscapeMesh instance the streamer builds/disposes chunks against — one streamer per mesh. */
export function createLandscapeChunkStreamer(mesh: LandscapeMesh): LandscapeChunkStreamer {
  /** Chunks this streamer has asked `mesh` to build and not yet disposed, with the neighbour steps each was last built with. */
  const built = new Map<string, { id: LandscapeChunkId; steps: NeighbourSteps }>();
  // Cached from the last update() call so invalidateNear() (no handle/palette/cut
  // params of its own) can still rebuild — null before the first update().
  let lastHandle: LandscapeHandle | null = null;
  let lastPalette: CompositionPalette | null = null;
  let lastCut: PlayableCut | null = null;
  /** Chunks owed (missing or stale) after the last update()'s budgeted builds — see pendingChunkCount(). */
  let pending = 0;
  // Last camera position update() streamed against, so flush() can finish
  // that same residency set rather than needing its own camera argument.
  let lastCameraX = 0;
  let lastCameraZ = 0;
  /** Desired set the last stream() converged on; null when the next stream() must scan for work. */
  let convergedSignature: string | null = null;

  /**
   * `footprint`'s four sides' neighbour step, read geometrically against
   * `footprints` (the DESIRED set, so the answer does not depend on build
   * order): a probe point just past each side finds whichever footprint
   * covers it. Per side the step is the coarser of this chunk's own step and
   * the neighbour's — a finer neighbour reads as "no chord", since the finer
   * edge already has the vertices — and this chunk's own step when nothing
   * lies past that edge.
   */
  const neighbourStepsFor = (footprint: ChunkFootprint, footprints: readonly ChunkFootprint[]): NeighbourSteps => {
    const ownStep = LADDER_STEPS[footprint.id.level]!;
    const probe = (dx: number, dz: number): number => {
      const neighbour = footprintContaining(footprints, footprint.originX + dx, footprint.originZ + dz);
      if (!neighbour) return ownStep;
      return Math.max(ownStep, LADDER_STEPS[neighbour.id.level]!);
    };
    return {
      west: probe(-EDGE_PROBE_EPSILON, footprint.span / 2),
      east: probe(footprint.span + EDGE_PROBE_EPSILON, footprint.span / 2),
      north: probe(footprint.span / 2, -EDGE_PROBE_EPSILON),
      south: probe(footprint.span / 2, footprint.span + EDGE_PROBE_EPSILON),
    };
  };

  /** Build `id` with `steps` and record them, so staleChunks() can tell when the desired steps move on. */
  const buildRecorded = (
    id: LandscapeChunkId, steps: NeighbourSteps,
    handle: LandscapeHandle, palette: CompositionPalette, cut: PlayableCut,
  ): void => {
    mesh.buildChunk(id, handle, palette, steps, cut);
    built.set(chunkKey(id), { id, steps });
  };

  /** Resident, still-desired chunks whose recorded steps differ from what the desired set now implies. */
  const staleChunks = (desiredFootprints: readonly ChunkFootprint[]): ChunkFootprint[] =>
    desiredFootprints.filter(f => {
      const record = built.get(chunkKey(f.id));
      return record !== undefined && !sameSteps(record.steps, neighbourStepsFor(f, desiredFootprints));
    });

  /**
   * Bring residency in line with (cameraX, cameraZ): dispose what is no
   * longer wanted, then build at most `maxBuilds` of what is missing or
   * stale, nearest-first. Updates `pending` to what is still owed afterwards
   * and returns how many chunks were built. Shared by the per-frame
   * `update()` (budgeted) and `flush()` (unbounded).
   */
  const stream = (
    cameraX: number, cameraZ: number,
    handle: LandscapeHandle, palette: CompositionPalette, cut: PlayableCut,
    maxBuilds: number,
  ): number => {
    const desiredIds = selectLandscapeChunks(cameraX, cameraZ, handle.map.centerX, handle.map.centerZ, handle.map.extentHalf);
    const desiredKeys = new Set(desiredIds.map(chunkKey));

    // Dispose every resident chunk no longer desired — cheap, unbudgeted, every call.
    for (const [key, { id }] of built) {
      if (desiredKeys.has(key)) continue;
      mesh.disposeChunk(id);
      built.delete(key);
    }

    const signature = Array.from(desiredKeys).sort().join('|');
    if (signature === convergedSignature) return 0;

    const footprints = footprintsOf(desiredIds, handle.map.centerX, handle.map.centerZ);
    const stale = new Set(staleChunks(footprints).map(f => chunkKey(f.id)));
    const work = footprints.filter(f => !built.has(chunkKey(f.id)) || stale.has(chunkKey(f.id)));

    const distSqToCamera = (f: ChunkFootprint): number => {
      const dx = f.originX + f.span / 2 - cameraX;
      const dz = f.originZ + f.span / 2 - cameraZ;
      return dx * dx + dz * dz;
    };
    work.sort((a, b) => distSqToCamera(a) - distSqToCamera(b));

    const spent = Math.min(maxBuilds, work.length);
    for (let i = 0; i < spent; i++) {
      const f = work[i]!;
      buildRecorded(f.id, neighbourStepsFor(f, footprints), handle, palette, cut);
    }
    pending = work.length - spent;
    convergedSignature = pending === 0 ? signature : null;
    return spent;
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

      const desired = footprintsOf(
        selectLandscapeChunks(lastCameraX, lastCameraZ, handle.map.centerX, handle.map.centerZ, handle.map.extentHalf),
        handle.map.centerX, handle.map.centerZ,
      );
      const residentFootprints = footprintsOf(Array.from(built.values(), r => r.id), handle.map.centerX, handle.map.centerZ);

      for (const f of residentFootprints) {
        const intersects =
          f.originX < dirtyRect.maxX && f.originX + f.span > dirtyRect.minX &&
          f.originZ < dirtyRect.maxZ && f.originZ + f.span > dirtyRect.minZ;
        if (!intersects) continue;
        buildRecorded(f.id, neighbourStepsFor(f, desired), handle, palette, cut);
      }
    },

    reset() {
      mesh.dispose();
      built.clear();
      lastHandle = null;
      lastPalette = null;
      lastCut = null;
      convergedSignature = null;
      // Nothing is desired again until the next update() names a camera
      // position, so a reset streamer owes no chunks — reporting the old
      // level's backlog would make a capture wait for builds nobody asked
      // for.
      pending = 0;
    },
  };
}
