// BlastSimulator2026 — GameRenderer blast visual effects
// Extracted from GameRenderer.ts: blast overlay display, post-blast effects
// trigger, and bird-scatter notification.

import * as THREE from 'three';
import type { MiningContext } from '../console/commands/mining.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import {
  BLAST_ORIGIN_SURFACE_SEARCH_MIN_RADIUS,
  BLAST_ORIGIN_SURFACE_SEARCH_MARGIN,
} from '../core/config/balance.js';
import { assembleBlastPlan } from '../core/mining/BlastPlan.js';
import { previewHoleDetails } from '../core/mining/Software.js';
import { boundingBoxXZ, getBlastOriginSurfaceY } from './BlastOriginSampling.js';
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
  console.log(`[GameRenderer] onBlast: lastGrid=${deps.lastGrid?.id} fragments=${ctx.lastBlastFragments?.length ?? 0}`);
  if (!deps.terrain || !deps.lastGrid) return;

  // Clear the blast plan overlay (holes are consumed by blast)
  if (deps.blastOverlay) {
    deps.blastOverlay.hide();
  }

  // Terrain remesh already happened: executeBlast emits terrain:updated,
  // which main.ts's subscription turns into rebuildTerrain() synchronously
  // before this method ever runs (#458 T0.2) — no longer this method's job.

  // Spawn fragment meshes for the blasted rock, then play the collapse.
  // spawnFragments places them where they came to rest; the animator walks
  // them there from where they broke, so the player sees the face come down
  // instead of a finished muck pile appearing at the moment of detonation.
  if (deps.fragments && ctx.lastBlastFragmentData && ctx.lastBlastFragmentData.length > 0) {
    deps.fragments.clearAll();
    deps.fragments.spawnFragments(ctx.lastBlastFragmentData);
    if (ctx.lastBlastFlights) deps.fragmentAnimator?.begin(ctx.lastBlastFlights);
  }

  if (!deps.blastEffects || !ctx.state) return;

  // Compute blast origin from fragment centroid or grid centre
  let ox = deps.lastGrid.minX + deps.lastGrid.sizeX / 2;
  let oz = deps.lastGrid.minZ + deps.lastGrid.sizeZ / 2;
  // Size the surface-sample ring to the blast's own footprint (half its
  // bounding-box diagonal + margin), so a large multi-hole blast's crater
  // doesn't swallow the whole sampling ring.
  let sampleRadius: number = BLAST_ORIGIN_SURFACE_SEARCH_MIN_RADIUS;
  if (ctx.lastBlastFragments && ctx.lastBlastFragments.length > 0) {
    ox = ctx.lastBlastFragments.reduce((s, p) => s + p.x, 0) / ctx.lastBlastFragments.length;
    oz = ctx.lastBlastFragments.reduce((s, p) => s + p.z, 0) / ctx.lastBlastFragments.length;
    const { minX, maxX, minZ, maxZ } = boundingBoxXZ(ctx.lastBlastFragments);
    const halfDiagonal = Math.hypot(maxX - minX, maxZ - minZ) / 2;
    sampleRadius = Math.max(
      BLAST_ORIGIN_SURFACE_SEARCH_MIN_RADIUS,
      halfDiagonal + BLAST_ORIGIN_SURFACE_SEARCH_MARGIN,
    );
  }
  // Anchor at the surrounding terrain surface, not y=0. A mine site rarely
  // sits at grid y=0 — it's typically well above it — so a hardcoded 0 here
  // buried the dust cloud and detonation flash inside solid terrain, fully
  // occluded and never visible on screen.
  const origin = new THREE.Vector3(
    ox,
    getBlastOriginSurfaceY(deps.lastGrid, deps.getTerrainSurfaceY, ox, oz, sampleRadius),
    oz,
  );

  // Build per-hole detonation list from sequence delays
  const holes: import('./BlastEffects.js').HoleDetonation[] = [];
  const sequenceDelays = ctx.state.sequenceDelays;

  // If we have sequence delays, use them for per-hole timing
  if (Object.keys(sequenceDelays).length > 0) {
    for (const [holeId, delayMs] of Object.entries(sequenceDelays)) {
      // Find hole position from last known drill holes
      const holePos = ctx.lastBlastHoles?.find(h => h.id === holeId)
        ?? ctx.state.drillHoles.find(h => h.id === holeId);
      if (holePos) {
        holes.push({
          x: holePos.x,
          y: deps.getTerrainSurfaceY(holePos.x, holePos.z),
          z: holePos.z,
          delaySeconds: delayMs / 1000,
        });
      }
    }
  }

  // Fallback: single explosion at centroid if no per-hole data
  if (holes.length === 0) {
    holes.push({ x: ox, y: origin.y, z: oz, delaySeconds: 0 });
  }

  deps.blastEffects.trigger({
    holes,
    energyLevel: 0.6,
    origin,
  });
}

/**
 * Show blast plan overlay from current drill/charge/sequence state.
 * Call from main.ts after drill_plan, charge, or sequence commands.
 */
export function showBlastPlanOverlay(deps: BlastVisualsDeps, ctx: MiningContext): void {
  if (!deps.blastOverlay || !ctx.state) return;
  const { drillHoles, plannedDrillHoles, chargesByHole, plannedChargesByHole, sequenceDelays, softwareTier } = ctx.state;
  const allHoles = [...drillHoles, ...plannedDrillHoles];
  if (allHoles.length === 0) { deps.blastOverlay.hide(); return; }

  const cx = allHoles.reduce((s, h) => s + h.x, 0) / allHoles.length;
  const cz = allHoles.reduce((s, h) => s + h.z, 0) / allHoles.length;
  const originSurfaceY = deps.getTerrainSurfaceY(cx, cz);

  // Per-hole fragment-size / projection-speed predictions, tier-gated the
  // same as the console `preview` commands. Without these, BlastPlanOverlay's
  // fragment-size dots and projection arcs never render — their per-hole
  // fields stay undefined and the overlay's own guards skip them. Only
  // already-drilled holes have a charge to preview against — an ordered
  // hole (#553) has no charge/delay/frag-size data yet.
  let holeDetails: Record<string, import('../core/mining/Software.js').HolePreviewDetail> = {};
  if (softwareTier >= 2 && ctx.grid && drillHoles.length > 0) {
    const plan = assembleBlastPlan(drillHoles, chargesByHole, sequenceDelays);
    holeDetails = previewHoleDetails(plan, ctx.grid, softwareTier);
  }

  deps.blastOverlay.show({
    softwareTier,
    origin: new THREE.Vector3(cx, originSurfaceY, cz),
    holes: [
      ...drillHoles.map(h => {
        const hd: import('./BlastPlanOverlay.js').HoleOverlayData = {
          hole: h,
          delayMs: sequenceDelays[h.id] ?? 0,
          surfaceY: deps.getTerrainSurfaceY(h.x, h.z),
          drilled: true,
          chargeOrdered: h.id in plannedChargesByHole,
        };
        const charge = chargesByHole[h.id];
        if (charge) hd.charge = charge;
        const detail = holeDetails[h.id];
        if (detail?.fragSizeCm !== undefined) hd.predictedFragSizeCm = detail.fragSizeCm;
        if (detail?.projectionSpeedMs !== undefined) hd.projectionSpeed = detail.projectionSpeedMs;
        return hd;
      }),
      // Ordered-but-undrilled holes (#553) — rendered as ghosts by
      // BlastPlanOverlay (drilled: false), no charge/delay/frag-size data.
      ...plannedDrillHoles.map(h => ({
        hole: h,
        delayMs: -1,
        surfaceY: deps.getTerrainSurfaceY(h.x, h.z),
        drilled: false,
      } satisfies import('./BlastPlanOverlay.js').HoleOverlayData)),
    ],
  });
}

/** A blast fired at (originX, originZ) — scatters any nearby bird flock (#458 T7.2/D12/A26). */
export function notifyBlastScatter(deps: BlastVisualsDeps, originX: number, originZ: number): void {
  deps.birds?.onBlast(originX, originZ);
}
