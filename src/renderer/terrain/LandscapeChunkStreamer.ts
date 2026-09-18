// BlastSimulator2026 — Landscape chunk streamer (#1153)
// Drives which landscape chunks are resident in a LandscapeMesh against the
// camera position, replacing the old eager whole-map LandscapeMesh.build()
// call with a per-frame near/far resolution-ladder residency update.

import type { LandscapeMesh, PlayableCut } from './LandscapeMesh.js';
import type { LandscapeHandle } from '../../console/commands/world.js';
import type { CompositionPalette } from '../../core/world/VoxelGrid.js';
import type { Rect } from '../../core/world/WorldGen.js';

/** Streams landscape chunk residency against the camera, and invalidates cached chunks a terrain edit has made stale. */
export interface LandscapeChunkStreamer {
  update(dt: number, cameraX: number, cameraZ: number, handle: LandscapeHandle, palette: CompositionPalette, cut: PlayableCut): void;
  invalidateNear(dirtyRect: Rect): void;
  reset(): void;
}

/** `mesh` is the LandscapeMesh instance the streamer builds/disposes chunks against — one streamer per mesh. */
export function createLandscapeChunkStreamer(_mesh: LandscapeMesh): LandscapeChunkStreamer {
  throw new Error('not implemented');
}
