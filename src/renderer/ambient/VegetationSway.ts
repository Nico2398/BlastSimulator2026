// BlastSimulator2026 — Vegetation: trees + rim grass, wind sway entirely in
// the vertex shader (#458 T7.2/D12/A26)
//
// Trees are static once built — no per-frame CPU work at all. Sway comes
// from the shared {uTime, uWind} ambient uniforms (see AmbientUniforms in
// GameRenderer), updated once per frame and read by every material that
// references the same uniform objects — one update reaches every blade and
// canopy without VegetationSway's update() needing to do anything itself.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cellRand, subSeed } from '../../core/math/Hash.js';
import type { TreePoint } from '../../core/world/Structures.js';
import type { Rect } from '../../core/world/WorldGen.js';
import type { AmbientUniforms } from './AmbientUniforms.js';

const TREE_VARIANT_COUNT = 3;
/** Trees beyond this distance from the landscape centre are never built — bounds the instance count regardless of how large the raw TreePoint list is. */
const TREE_DRAW_DISTANCE = 900;
const CANOPY_HEIGHT_BY_VARIANT = [4.5, 5.5, 3.8];
const TRUNK_HEIGHT_BY_VARIANT = [1.5, 2.0, 1.2];

const GRASS_RIM_MARGIN = 60;
const GRASS_CELL = 3;
const GRASS_DENSITY = 0.4;
const GRASS_BLADE_HEIGHT = 0.6;
const GRASS_SCALE_MIN = 0.7;
const GRASS_SCALE_SPREAD = 0.6;

const SWAY_VERTEX_EXTRA = `
uniform float uTime;
uniform vec2 uWind;
uniform float uCanopyHeight;
`;

const SWAY_BEGIN_VERTEX_EXTRA = `
#ifdef USE_INSTANCING
  float instanceWorldX = instanceMatrix[3].x;
#else
  float instanceWorldX = 0.0;
#endif
float bendT = pow(clamp(position.y, 0.0, uCanopyHeight) / max(uCanopyHeight, 0.001), 2.0);
float sway = bendT * 0.4 * sin(uTime * 1.7 + instanceWorldX * 0.35);
transformed.xz += uWind * sway;
`;

function attachSway(material: THREE.MeshStandardMaterial, ambient: AmbientUniforms, canopyHeight: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uTime'] = ambient.uTime;
    shader.uniforms['uWind'] = ambient.uWind;
    shader.uniforms['uCanopyHeight'] = { value: canopyHeight };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_VERTEX_EXTRA}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_BEGIN_VERTEX_EXTRA}`);
  };
  material.customProgramCacheKey = () => `vegetation-sway-${canopyHeight}`;
}

/** Cone canopy + cylinder trunk, canopy base sitting on top of the trunk. */
function buildTreeGeometry(variant: number): THREE.BufferGeometry {
  const trunkH = TRUNK_HEIGHT_BY_VARIANT[variant]!;
  const canopyH = CANOPY_HEIGHT_BY_VARIANT[variant]!;
  const trunk = new THREE.CylinderGeometry(0.15, 0.2, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  const canopy = new THREE.ConeGeometry(1.4, canopyH, 7);
  canopy.translate(0, trunkH + canopyH / 2, 0);
  const merged = mergeGeometries([trunk, canopy], false) ?? trunk;
  merged.computeVertexNormals();
  trunk.dispose();
  canopy.dispose();
  return merged;
}

/** Two crossed quads ("star" cross-section), the classic cheap grass-blade billboard. */
function buildGrassGeometry(): THREE.BufferGeometry {
  const quadA = new THREE.PlaneGeometry(0.4, GRASS_BLADE_HEIGHT);
  quadA.translate(0, GRASS_BLADE_HEIGHT / 2, 0);
  const quadB = quadA.clone();
  quadB.rotateY(Math.PI / 2);
  const merged = mergeGeometries([quadA, quadB], false) ?? quadA;
  merged.computeVertexNormals();
  quadA.dispose();
  quadB.dispose();
  return merged;
}

export class VegetationSway {
  private readonly scene: THREE.Scene;
  private readonly treeMeshes: THREE.InstancedMesh[] = [];
  private readonly treeMaterials: THREE.MeshStandardMaterial[] = [];
  private grassMesh: THREE.InstancedMesh | null = null;
  private grassMaterial: THREE.MeshStandardMaterial | null = null;

  constructor(
    scene: THREE.Scene,
    levelSeed: number,
    ambient: AmbientUniforms,
    trees: readonly TreePoint[],
    centerX: number,
    centerZ: number,
    playableRect: Rect,
    sampleGroundHeight: (x: number, z: number) => number,
  ) {
    this.scene = scene;
    const dummy = new THREE.Object3D();

    // ---- Trees: static InstancedMesh per variant, built once ----
    const byVariant: TreePoint[][] = Array.from({ length: TREE_VARIANT_COUNT }, () => []);
    for (const t of trees) {
      const distSq = (t.x - centerX) ** 2 + (t.z - centerZ) ** 2;
      if (distSq > TREE_DRAW_DISTANCE * TREE_DRAW_DISTANCE) continue;
      const variant = Math.min(TREE_VARIANT_COUNT - 1, Math.max(0, t.variant));
      byVariant[variant]!.push(t);
    }

    for (let v = 0; v < TREE_VARIANT_COUNT; v++) {
      const points = byVariant[v]!;
      if (points.length === 0) continue;
      const geo = buildTreeGeometry(v);
      const material = new THREE.MeshStandardMaterial({ color: 0x3a5a35, roughness: 0.85 });
      attachSway(material, ambient, CANOPY_HEIGHT_BY_VARIANT[v]!);
      const mesh = new THREE.InstancedMesh(geo, material, points.length);
      mesh.name = 'vegetation-trees';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        dummy.position.set(p.x, p.h, p.z);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.treeMeshes.push(mesh);
      this.treeMaterials.push(material);
    }

    // ---- Grass: seeded band just outside the playable rect ----
    const seed = subSeed(levelSeed, 'grass');
    const grassPoints: Array<{ x: number; z: number; scale: number }> = [];
    const outerMinX = playableRect.minX - GRASS_RIM_MARGIN;
    const outerMaxX = playableRect.maxX + GRASS_RIM_MARGIN;
    const outerMinZ = playableRect.minZ - GRASS_RIM_MARGIN;
    const outerMaxZ = playableRect.maxZ + GRASS_RIM_MARGIN;
    const cellsX = Math.ceil((outerMaxX - outerMinX) / GRASS_CELL);
    const cellsZ = Math.ceil((outerMaxZ - outerMinZ) / GRASS_CELL);

    for (let cz = 0; cz < cellsZ; cz++) {
      for (let cx = 0; cx < cellsX; cx++) {
        const x = outerMinX + cx * GRASS_CELL + cellRand(seed, cx, cz, 1) * GRASS_CELL;
        const z = outerMinZ + cz * GRASS_CELL + cellRand(seed, cx, cz, 2) * GRASS_CELL;
        // Only the rim band — inside the playable rect itself has no grass.
        const insidePlayable = x >= playableRect.minX && x <= playableRect.maxX
          && z >= playableRect.minZ && z <= playableRect.maxZ;
        if (insidePlayable) continue;
        if (cellRand(seed, cx, cz, 3) >= GRASS_DENSITY) continue;
        grassPoints.push({
          x, z,
          scale: GRASS_SCALE_MIN + cellRand(seed, cx, cz, 4) * GRASS_SCALE_SPREAD,
        });
      }
    }

    if (grassPoints.length > 0) {
      const geo = buildGrassGeometry();
      this.grassMaterial = new THREE.MeshStandardMaterial({ color: 0x5a8f3f, roughness: 0.9, side: THREE.DoubleSide });
      attachSway(this.grassMaterial, ambient, GRASS_BLADE_HEIGHT);
      this.grassMesh = new THREE.InstancedMesh(geo, this.grassMaterial, grassPoints.length);
      this.grassMesh.name = 'vegetation-grass';
      this.grassMesh.castShadow = false;
      this.grassMesh.receiveShadow = false;
      for (let i = 0; i < grassPoints.length; i++) {
        const g = grassPoints[i]!;
        const y = sampleGroundHeight(g.x, g.z);
        dummy.position.set(g.x, y, g.z);
        dummy.scale.setScalar(g.scale);
        dummy.updateMatrix();
        this.grassMesh.setMatrixAt(i, dummy.matrix);
      }
      this.grassMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(this.grassMesh);
    }
  }

  /** Number of tree instances actually built (sum across variants) — for tests/diagnostics. */
  get treeInstanceCount(): number {
    return this.treeMeshes.reduce((s, m) => s + m.count, 0);
  }

  /** Number of grass instances actually built — for tests/diagnostics. */
  get grassInstanceCount(): number {
    return this.grassMesh?.count ?? 0;
  }

  dispose(): void {
    for (let i = 0; i < this.treeMeshes.length; i++) {
      this.scene.remove(this.treeMeshes[i]!);
      this.treeMeshes[i]!.geometry.dispose();
      this.treeMaterials[i]!.dispose();
    }
    if (this.grassMesh) {
      this.scene.remove(this.grassMesh);
      this.grassMesh.geometry.dispose();
      this.grassMaterial!.dispose();
    }
  }
}
