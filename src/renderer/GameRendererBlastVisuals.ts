// BlastSimulator2026 — GameRenderer blast visual effects (skeleton, #767)
// Extracted from GameRenderer.ts: blast overlay display, post-blast effects
// trigger, and bird-scatter notification.
//
// Skeleton phase only: signatures/types are final, bodies are stubs.
// Real logic moves here at implementation phase (#767).

import type { MiningContext } from '../console/commands/mining.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import type { TerrainMesh } from './TerrainMesh.js';
import type { BlastPlanOverlay } from './BlastPlanOverlay.js';
import type { FragmentMesh } from './FragmentMesh.js';
import type { FragmentAnimator } from './FragmentAnimator.js';
import type { BlastEffects } from './BlastEffects.js';
import type { BirdFlocks } from './ambient/BirdFlocks.js';

/** Mutable GameRenderer fields these blast-visual helpers read/write, passed in place of `this` (#767). */
export interface BlastVisualsDeps {
  terrain: TerrainMesh | null;
  lastGrid: VoxelGrid | null;
  blastOverlay: BlastPlanOverlay | null;
  fragments: FragmentMesh | null;
  fragmentAnimator: FragmentAnimator | null;
  blastEffects: BlastEffects | null;
  birds: BirdFlocks | null;
  getTerrainSurfaceY: (x: number, z: number) => number;
}

/** Trigger blast visual effects. Call from main.ts immediately after a successful blast command. */
export function onBlast(deps: BlastVisualsDeps, ctx: MiningContext): void {
  void deps;
  void ctx;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/** Show blast plan overlay from current drill/charge/sequence state. */
export function showBlastPlanOverlay(deps: BlastVisualsDeps, ctx: MiningContext): void {
  void deps;
  void ctx;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/** A blast fired at (originX, originZ) — scatters any nearby bird flock (#458 T7.2/D12/A26). */
export function notifyBlastScatter(deps: BlastVisualsDeps, originX: number, originZ: number): void {
  void deps;
  void originX;
  void originZ;
  // TODO: implement (#767)
}
