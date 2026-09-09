// BlastSimulator2026 — Ground Tint shared unit (#1006)
// One conforming, sloped-terrain-following ground overlay primitive shared by
// every renderer call site that paints a tint/ring on the ground: survey
// confidence, selection/pinned-region/blocked-tile, survey radius ring, and
// blast energy heatmap. Each previously built its own flat, axis-aligned
// quad/circle lifted by a fixed Y offset — this samples the same smoothed
// marching-cubes surface height the terrain mesh renders, at each patch's own
// footprint, so painted colour follows the slope instead of floating above it.

import * as THREE from 'three';

/** A callback answering the smoothed (marching-cubes) terrain surface height at a world (x, z) column. */
export type SurfaceHeightSampler = (x: number, z: number) => number;

/**
 * Bilinear blend of the four grid-corner heights around (x, z), using
 * `cornerSampler` for the corner values — a conforming ground tint's shape
 * (cell or disc) samples through this at each of its own vertices rather
 * than the single flat height its corner cell would otherwise supply.
 *
 * At an exact integer (x, z), only that corner's own weight is non-zero, so
 * the other three corners are never sampled — returns `cornerSampler(x, z)`
 * exactly, and never risks pulling a NaN from a neighbour outside a caller's
 * valid range just because its weight would multiply out to zero anyway.
 */
export function bilinearSurfaceHeight(cornerSampler: SurfaceHeightSampler, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;

  let sum = 0;
  const accumulate = (dx: number, dz: number, weight: number): void => {
    if (weight <= 0) return;
    sum += cornerSampler(x0 + dx, z0 + dz) * weight;
  };
  accumulate(0, 0, (1 - fx) * (1 - fz));
  accumulate(1, 0, fx * (1 - fz));
  accumulate(0, 1, (1 - fx) * fz);
  accumulate(1, 1, fx * fz);
  return sum;
}

/** One ground-tint patch's footprint: a single grid cell, or a disc (survey radius rings, blast energy heatmap). */
type GroundTintShape =
  | { kind: 'cell'; x: number; z: number }
  | { kind: 'disc'; cx: number; cz: number; radius: number; segments?: number };

/** One colour-and-opacity patch a GroundTintLayer draws, conforming to the terrain surface under its shape. */
export interface GroundTintPatch {
  id: string;
  shape: GroundTintShape;
  color: THREE.Color | number;
  opacity: number;
}

/** Metres above the sampled surface a ground tint patch is drawn, to avoid z-fighting with the terrain mesh. */
export const GROUND_TINT_Y_EPSILON = 0.03;

/**
 * Shared ground-tint renderer: draws colour patches that conform to the
 * sloped marching-cubes surface instead of floating as flat axis-aligned
 * plates. Replaces the ad hoc quad/circle/ring geometry every overlay
 * (survey confidence, selection/pinned-region/blocked-tile, survey radius
 * ring, blast energy heatmap) previously built for itself.
 */
export class GroundTintLayer {
  private readonly scene: THREE.Scene;
  private readonly sampler: SurfaceHeightSampler;
  private readonly epsilon: number;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly patches = new Map<string, GroundTintPatch>();

  constructor(
    scene: THREE.Scene,
    sampler: SurfaceHeightSampler,
    opts?: { epsilon?: number; renderOrder?: number },
  ) {
    this.scene = scene;
    this.sampler = sampler;
    this.epsilon = opts?.epsilon ?? GROUND_TINT_Y_EPSILON;
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    if (opts?.renderOrder !== undefined) this.mesh.renderOrder = opts.renderOrder;
    this.scene.add(this.mesh);
  }

  /** Replace every currently-drawn patch with `patches`. */
  replace(patches: GroundTintPatch[]): void {
    this.patches.clear();
    for (const patch of patches) this.patches.set(patch.id, patch);
    this.rebuild();
  }

  /** Add (or, by id, replace) patches without touching the rest. */
  add(patches: GroundTintPatch[]): void {
    for (const patch of patches) this.patches.set(patch.id, patch);
    this.rebuild();
  }

  /** Remove patches by id. */
  remove(ids: string[]): void {
    for (const id of ids) this.patches.delete(id);
    this.rebuild();
  }

  /** Remove every patch. */
  clear(): void {
    this.patches.clear();
    this.rebuild();
  }

  /** Remove every patch and release GPU resources. */
  dispose(): void {
    this.patches.clear();
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  get patchCount(): number {
    return this.patches.size;
  }

  /** Show or hide the whole layer without discarding its patch set — mirrors THREE.Object3D.visible, for callers (survey/blast overlays) that toggle a built layer on and off. */
  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /** The sampled surface height at (x, z), plus this layer's Y epsilon — shared by cell and disc vertex emission. */
  private cornerY(x: number, z: number): number {
    return bilinearSurfaceHeight(this.sampler, x, z) + this.epsilon;
  }

  private rebuild(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    for (const patch of this.patches.values()) {
      const color = patch.color instanceof THREE.Color ? patch.color : new THREE.Color(patch.color);
      if (patch.shape.kind === 'cell') this.emitCell(patch.shape, color, patch.opacity, positions, colors);
      else this.emitDisc(patch.shape, color, patch.opacity, positions, colors);
    }

    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    // An empty patch set has no vertices to bound — computeBoundingSphere()
    // on a zero-length position attribute logs a "radius is NaN" warning for
    // no reason (nothing is drawn either way), so skip it in that case.
    if (positions.length > 0) this.geometry.computeBoundingSphere();
    else this.geometry.boundingSphere = new THREE.Sphere();
    this.geometry.setDrawRange(0, positions.length / 3);
  }

  private emitCell(
    shape: { x: number; z: number }, color: THREE.Color, opacity: number,
    positions: number[], colors: number[],
  ): void {
    const { x, z } = shape;
    const corners: readonly [number, number][] = [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]];
    const verts = corners.map(([cx, cz]): [number, number, number] => [cx, this.cornerY(cx, cz), cz]);
    // Fixed diagonal (corner 0 - corner 2) for every cell, so neighbouring
    // cells never disagree on which way a shared quad face bends.
    this.pushTri(verts[0]!, verts[1]!, verts[2]!, color, opacity, positions, colors);
    this.pushTri(verts[0]!, verts[2]!, verts[3]!, color, opacity, positions, colors);
  }

  private emitDisc(
    shape: { cx: number; cz: number; radius: number; segments?: number }, color: THREE.Color, opacity: number,
    positions: number[], colors: number[],
  ): void {
    const { cx, cz, radius } = shape;
    const segments = shape.segments ?? 32;
    const center: [number, number, number] = [cx, this.cornerY(cx, cz), cz];
    const rim: [number, number, number][] = [];
    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const rx = cx + radius * Math.cos(theta);
      const rz = cz + radius * Math.sin(theta);
      rim.push([rx, this.cornerY(rx, rz), rz]);
    }
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      this.pushTri(center, rim[i]!, rim[next]!, color, opacity, positions, colors);
    }
  }

  private pushTri(
    a: readonly [number, number, number], b: readonly [number, number, number], c: readonly [number, number, number],
    color: THREE.Color, opacity: number, positions: number[], colors: number[],
  ): void {
    for (const v of [a, b, c]) {
      positions.push(v[0], v[1], v[2]);
      colors.push(color.r, color.g, color.b, opacity);
    }
  }
}

/**
 * A ring of line segments following the terrain surface around (cx, cz) at
 * the given radius — the conforming replacement for a flat circle geometry
 * lifted by a fixed Y offset (survey radius ring).
 */
export function buildConformingRing(
  sampler: SurfaceHeightSampler,
  cx: number,
  cz: number,
  radius: number,
  segments: number,
  color: number,
  opacity: number,
): THREE.LineLoop {
  const positions: number[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const x = cx + radius * Math.cos(theta);
    const z = cz + radius * Math.sin(theta);
    positions.push(x, bilinearSurfaceHeight(sampler, x, z) + GROUND_TINT_Y_EPSILON, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color, opacity, transparent: true });
  return new THREE.LineLoop(geometry, material);
}
