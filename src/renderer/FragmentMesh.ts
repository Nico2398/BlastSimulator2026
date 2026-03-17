// BlastSimulator2026 — Fragment Meshes
// Renders each blast fragment as a rough-shaped low-poly mesh.
// Fragment mesh size is proportional to fragment volume (cube-root → half-extent).
// Fragments with high ore density show a brighter or distinctly tinted surface.
// During physics simulation, positions are updated in real-time.
//
// Fragment shape: irregular box (BoxGeometry with slight random vertex jitter)
// so they look like rough rock chunks rather than perfect cubes.

import * as THREE from 'three';
import type { FragmentData } from '../core/mining/BlastExecution.js';
import { sampleRockColor, createRockMaterial } from './ProceduralTexture.js';

// ---------- Config ----------

// Scale: 1 voxel ≈ 1 metre. Fragments are in m³.
// Real mine fragments: 0.001 m³ (fines) to 2 m³ (oversized blocks)
// Scale cube-root to get half-extent in game units.
const FRAGMENT_SCALE = 0.5; // visual scale factor on top of cube-root

// Ore density sum threshold above which fragment is "ore-rich"
const ORE_RICH_THRESHOLD = 0.15;

// How much to shift ore-rich fragment colors toward gold
const ORE_TINT_STRENGTH = 0.25;
const ORE_GOLD = new THREE.Color(0xffd700);

// Projection fragments (fly far) are rendered red-orange to warn player
const PROJECTION_COLOR = new THREE.Color(0xff4400);

// Maximum fragments rendered simultaneously (performance guard)
const MAX_RENDERED_FRAGMENTS = 2000;

// ---------- Geometry pool ----------
// Reuse a small set of irregular geometry shapes to avoid creating thousands of unique meshes

const SHAPE_VARIANTS = 8;
let sharedGeometries: THREE.BufferGeometry[] | null = null;

function getSharedGeometries(): THREE.BufferGeometry[] {
  if (!sharedGeometries) {
    sharedGeometries = [];
    for (let i = 0; i < SHAPE_VARIANTS; i++) {
      // Create a slightly irregular box by jittering vertices of a unit box
      const geo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const jitter = 0.15 + (i % 4) * 0.05;
      for (let v = 0; v < pos.count; v++) {
        pos.setX(v, pos.getX(v) + (Math.sin(v * 7 + i * 13) * jitter));
        pos.setY(v, pos.getY(v) + (Math.sin(v * 11 + i * 7) * jitter));
        pos.setZ(v, pos.getZ(v) + (Math.sin(v * 13 + i * 5) * jitter));
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      sharedGeometries.push(geo);
    }
  }
  return sharedGeometries;
}

// ---------- Main class ----------

export class FragmentMesh {
  private readonly scene: THREE.Scene;
  private readonly fragments = new Map<number, THREE.Mesh>();
  private readonly material: THREE.MeshPhongMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.material = createRockMaterial();
  }

  /**
   * Spawn meshes for a set of blast fragments.
   * Call after executeBlast() returns a BlastResult.
   */
  spawnFragments(fragments: FragmentData[]): void {
    const geos = getSharedGeometries();
    const toRender = fragments.slice(0, MAX_RENDERED_FRAGMENTS);

    for (const frag of toRender) {
      // Half-extent: cube root of volume × scale factor
      const halfExtent = Math.cbrt(frag.volume) * FRAGMENT_SCALE;

      // Pick a geometry variant deterministically from fragment id
      const geoIdx = frag.id % SHAPE_VARIANTS;
      const geo = geos[geoIdx]!;

      // Determine color
      let color: THREE.Color;
      if (frag.isProjection) {
        color = PROJECTION_COLOR.clone();
      } else {
        // Sample 3D procedural color at the fragment's origin voxel position
        color = sampleRockColor(frag.rockId, frag.position.x, frag.position.y, frag.position.z);

        // Tint ore-rich fragments toward gold
        const oreSum = Object.values(frag.oreDensities).reduce((a, b) => a + b, 0);
        if (oreSum > ORE_RICH_THRESHOLD) {
          const t = Math.min(1, (oreSum - ORE_RICH_THRESHOLD) / 0.3) * ORE_TINT_STRENGTH;
          color.lerp(ORE_GOLD, t);
        }
      }

      // Create a per-fragment material clone with the correct color
      const mat = this.material.clone();
      mat.color = color;
      mat.vertexColors = false; // use flat color for fragments (faster)

      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(halfExtent * 2);
      mesh.position.set(frag.position.x, frag.position.y, frag.position.z);

      // Stable deterministic rotation so fragments don't all look identical
      mesh.rotation.set(
        (frag.id * 1.3) % (Math.PI * 2),
        (frag.id * 2.7) % (Math.PI * 2),
        (frag.id * 0.9) % (Math.PI * 2),
      );

      this.scene.add(mesh);
      this.fragments.set(frag.id, mesh);
    }
  }

  /**
   * Update fragment positions during physics simulation.
   * Call on each physics step with the current body positions.
   */
  updatePositions(positions: Map<number, { x: number; y: number; z: number }>): void {
    for (const [id, pos] of positions) {
      const mesh = this.fragments.get(id);
      if (mesh) {
        mesh.position.set(pos.x, pos.y, pos.z);
      }
    }
  }

  /**
   * Remove a specific fragment from the scene (e.g. when collected by excavator).
   */
  removeFragment(fragmentId: number): void {
    const mesh = this.fragments.get(fragmentId);
    if (mesh) {
      this.scene.remove(mesh);
      (mesh.material as THREE.MeshPhongMaterial).dispose();
      this.fragments.delete(fragmentId);
    }
  }

  /** Remove all fragment meshes from the scene. */
  clearAll(): void {
    for (const mesh of this.fragments.values()) {
      this.scene.remove(mesh);
      (mesh.material as THREE.MeshPhongMaterial).dispose();
    }
    this.fragments.clear();
  }

  /** Get count of currently rendered fragments. */
  get count(): number {
    return this.fragments.size;
  }

  /** Release shared geometry and material resources. */
  dispose(): void {
    this.clearAll();
    this.material.dispose();
    // Don't dispose shared geometries — they may be reused
  }
}
