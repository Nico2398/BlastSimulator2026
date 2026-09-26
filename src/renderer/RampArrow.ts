// BlastSimulator2026 — Ramp direction arrow (#1211)
// A bold yellow arrow lying on the ground along a ramp, tail on the upper end
// (the origin tile, where the floor starts at surface level) and tip on the
// lower end (the last tile the carve reaches), inside an outline of the
// ramp's real corridor. Drawn by the ramp tool's preview (SelectionOverlay)
// and, for every ramp order still being dug, by RampArrowLayer.
//
// The layout reads the ramp's own RampDef, so the arrow shows the ramp that
// will actually be dug: the snapped cardinal axis rampDefFromEndpoints picks,
// the RAMP_WIDTH-wide band defineRampSegments carves (centred on the axis),
// and steps 0..length-1 — never the raw diagonal drag.
//
// Legibility: the yellow body sits on a dark, slightly larger underlay, so it
// reads against pale sand and dark rock alike, and both draw without a depth
// test above the other overlays — a ramp being dug sinks below the arrow's
// sampled height, and a depth-tested arrow would vanish into the cut.

import * as THREE from 'three';
import { RAMP_WIDTH, type RampDef } from '../core/mining/Ramp.js';
import { markSceneOverlay } from './post/SceneOverlay.js';
import type { SurfaceHeightSampler } from './GroundTint.js';

export const RAMP_ARROW_COLOR = 0xffd21f;
const UNDERLAY_COLOR = 0x1a1408;

/** Drawn after the ghost cubes (GHOST_RENDER_ORDER) so a pending layer never covers the arrow. */
export const RAMP_ARROW_RENDER_ORDER = 20;

const Y_OFFSET = 0.12;
/** How far past the tail/tip tile centres the arrow reaches, so it spans the corridor end to end. */
const END_REACH = 0.42;
const SHAFT_HALF_WIDTH = 0.32;
const HEAD_HALF_WIDTH = 1.05;
const HEAD_LENGTH = 1.3;
const UNDERLAY_MARGIN = 0.14;
/** Shaft is subdivided at this spacing so it follows the ground along a long ramp. */
const SHAFT_STEP = 0.5;

type RampArrowSpec = Pick<RampDef, 'originX' | 'originZ' | 'direction' | 'length'>;

interface RampArrowLayout {
  /** Upper-end tile — the ramp's origin. */
  tail: { x: number; z: number };
  /** Lower-end tile — the last step the carve reaches (origin + direction × (length − 1)). */
  tip: { x: number; z: number };
  /** Unit step along the ramp, top to bottom. */
  dir: { dx: number; dz: number };
  /** Inclusive tile bounds of the carved band. */
  corridor: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const DIR_STEP: Record<RampDef['direction'], { dx: number; dz: number }> = {
  north: { dx: 0, dz: -1 },
  south: { dx: 0, dz: 1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 },
};

/** Where the arrow and corridor lie for `ramp`, in tiles; null for a ramp with nothing to carve. */
export function rampArrowLayout(ramp: RampArrowSpec): RampArrowLayout | null {
  if (!(ramp.length >= 1)) return null;
  const dir = DIR_STEP[ramp.direction];
  const tail = { x: ramp.originX, z: ramp.originZ };
  const tip = { x: tail.x + dir.dx * (ramp.length - 1), z: tail.z + dir.dz * (ramp.length - 1) };
  const half = Math.floor(RAMP_WIDTH / 2);
  const alongX = dir.dx !== 0;
  const corridor = {
    minX: alongX ? Math.min(tail.x, tip.x) : tail.x - half,
    maxX: alongX ? Math.max(tail.x, tip.x) : tail.x + half,
    minZ: alongX ? tail.z - half : Math.min(tail.z, tip.z),
    maxZ: alongX ? tail.z + half : Math.max(tail.z, tip.z),
  };
  return { tail, tip, dir, corridor };
}

interface RampArrowOptions {
  /** Body and outline colour; defaults to RAMP_ARROW_COLOR. A refused preview passes its refusal red. */
  color?: number;
}

/**
 * The arrow and corridor outline for `ramp` as one group, heights sampled
 * from `sampler`; null when the ramp has no length. The caller owns disposal.
 */
export function buildRampArrow(
  ramp: RampArrowSpec, sampler: SurfaceHeightSampler, options: RampArrowOptions = {},
): THREE.Group | null {
  const layout = rampArrowLayout(ramp);
  if (!layout) return null;
  const color = options.color ?? RAMP_ARROW_COLOR;

  const group = new THREE.Group();
  group.name = 'ramp-arrow';
  markSceneOverlay(group);
  group.add(buildCorridorOutline(layout, sampler, color));
  group.add(buildArrowMesh(layout, sampler, UNDERLAY_MARGIN, UNDERLAY_COLOR, 0.75, 0));
  group.add(buildArrowMesh(layout, sampler, 0, color, 1, 1));
  return group;
}

/**
 * The ground arrow, in the ramp's own (u along, v across) frame measured from
 * the tail tile centre, grown by `margin` on every side for the underlay.
 */
function buildArrowMesh(
  layout: RampArrowLayout, sampler: SurfaceHeightSampler,
  margin: number, color: number, opacity: number, orderOffset: number,
): THREE.Mesh {
  const { tail, tip, dir } = layout;
  const run = Math.abs(tip.x - tail.x) + Math.abs(tip.z - tail.z);
  const uStart = -END_REACH - margin;
  const uEnd = run + END_REACH + margin;
  const headLength = Math.min(HEAD_LENGTH, (run + 2 * END_REACH) * 0.55) + margin;
  const uHead = uEnd - headLength;
  const shaftHalf = SHAFT_HALF_WIDTH + margin;
  const headHalf = HEAD_HALF_WIDTH + margin;

  const ox = tail.x + 0.5, oz = tail.z + 0.5;
  // Perpendicular (dz, -dx) — which side is "+v" does not matter, the shape is symmetric.
  const point = (u: number, v: number): THREE.Vector3 => {
    const x = ox + dir.dx * u + dir.dz * v;
    const z = oz + dir.dz * u - dir.dx * v;
    return new THREE.Vector3(x, sampler(x, z) + Y_OFFSET, z);
  };

  const positions: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  const steps = Math.max(1, Math.ceil((uHead - uStart) / SHAFT_STEP));
  for (let i = 0; i < steps; i++) {
    const u0 = uStart + ((uHead - uStart) * i) / steps;
    const u1 = uStart + ((uHead - uStart) * (i + 1)) / steps;
    const a = point(u0, -shaftHalf), b = point(u0, shaftHalf);
    const c = point(u1, shaftHalf), d = point(u1, -shaftHalf);
    tri(a, b, c);
    tri(a, c, d);
  }
  tri(point(uHead, -headHalf), point(uHead, headHalf), point(uEnd, 0));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = margin > 0 ? 'ramp-arrow-underlay' : 'ramp-arrow-body';
  mesh.renderOrder = RAMP_ARROW_RENDER_ORDER + orderOffset;
  return mesh;
}

/** The carved band's outline, one vertex per tile edge so it steps with the ground. */
function buildCorridorOutline(layout: RampArrowLayout, sampler: SurfaceHeightSampler, color: number): THREE.LineLoop {
  const { minX, maxX, minZ, maxZ } = layout.corridor;
  const x0 = minX, x1 = maxX + 1, z0 = minZ, z1 = maxZ + 1;
  const points: THREE.Vector3[] = [];
  const at = (x: number, z: number): void => { points.push(new THREE.Vector3(x, sampler(x, z) + Y_OFFSET, z)); };
  for (let x = x0; x < x1; x++) at(x, z0);
  for (let z = z0; z < z1; z++) at(x1, z);
  for (let x = x1; x > x0; x--) at(x, z1);
  for (let z = z1; z > z0; z--) at(x0, z);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({
    color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false,
  }));
  line.name = 'ramp-corridor-outline';
  line.renderOrder = RAMP_ARROW_RENDER_ORDER;
  return line;
}

/** Dispose every geometry and material under `root`. */
function disposeRampArrow(root: THREE.Object3D): void {
  root.traverse((child) => {
    const drawable = child as THREE.Mesh;
    if (drawable.geometry) drawable.geometry.dispose();
    const material = drawable.material;
    if (Array.isArray(material)) material.forEach(m => m.dispose());
    else if (material) material.dispose();
  });
}

/** A ramp order the layer draws an arrow for. */
interface PlannedRampArrow {
  id: number;
  def: RampArrowSpec;
  segments: ReadonlyArray<{ done: boolean }>;
}

/**
 * One arrow per ramp order still being dug. A ramp keeps its arrow until its
 * last segment is done; a finished ramp keeps none (the minimap tints it).
 */
export class RampArrowLayer {
  private readonly scene: THREE.Scene;
  private readonly sampler: SurfaceHeightSampler;
  private readonly arrows = new Map<number, THREE.Group>();

  constructor(scene: THREE.Scene, sampler: SurfaceHeightSampler) {
    this.scene = scene;
    this.sampler = sampler;
  }

  /**
   * Reconcile against the current ramp orders. `terrainChanged` rebuilds the
   * arrows that stay, so they re-sample the ground a dig just lowered.
   */
  sync(ramps: ReadonlyArray<PlannedRampArrow>, terrainChanged = false): void {
    const pending = ramps.filter(r => r.segments.some(s => !s.done));
    const keep = new Set(pending.map(r => r.id));
    for (const [id, group] of this.arrows) {
      if (!keep.has(id) || terrainChanged) this.remove(id, group);
    }
    for (const ramp of pending) {
      if (this.arrows.has(ramp.id)) continue;
      const group = buildRampArrow(ramp.def, this.sampler);
      if (!group) continue;
      this.scene.add(group);
      this.arrows.set(ramp.id, group);
    }
  }

  /** Number of ramp arrows currently drawn. */
  get count(): number {
    return this.arrows.size;
  }

  /** The drawn arrow for ramp order `id`, or null. */
  getArrow(id: number): THREE.Group | null {
    return this.arrows.get(id) ?? null;
  }

  dispose(): void {
    for (const [id, group] of this.arrows) this.remove(id, group);
  }

  private remove(id: number, group: THREE.Group): void {
    this.scene.remove(group);
    disposeRampArrow(group);
    this.arrows.delete(id);
  }
}
