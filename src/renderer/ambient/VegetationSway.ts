// BlastSimulator2026 — Vegetation: trees, bushes and rim grass, wind sway
// entirely in the vertex shader (#458 T7.2/D12/A26)
//
// Trees and bushes are the biome's prop models from the model library
// (assets/models/blender/props.py), drawn instanced with a toon surface and
// an outline hull that bend together. A tree asset that has not loaded
// falls back to a cone-and-trunk prototype built here, through the same
// path. Static once built — no per-frame CPU work at all. Sway comes from
// the shared {uTime, uWind} ambient uniforms, updated once per frame and
// read by every material that references the same uniform objects.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cellRand, subSeed } from '../../core/math/Hash.js';
import type { TreePoint } from '../../core/world/Structures.js';
import type { Rect } from '../../core/world/WorldGen.js';
import type { AmbientUniforms } from './AmbientUniforms.js';
import { modelLibrary, type ModelLibrary } from '../models/ModelLibrary.js';
import { buildPrototype, type ModelPrototype } from '../models/ModelMerge.js';
import { InstancedProp } from '../models/InstancedProp.js';
import { bushModelId, treeFarModelId, treeModelId, BUSH_VARIANTS, TREE_VARIANTS, type TreeFamily } from '../models/ModelIds.js';
import type { SwayOptions } from '../models/CartoonMaterial.js';

/** Which tree family a biome grows; biomes not listed get the deciduous set. */
export const TREE_FAMILY_BY_BIOME: Readonly<Record<string, TreeFamily>> = {
  green_foothills: 'deciduous',
  alpine_granite: 'conifer',
  tropical_karst: 'tropical',
  desert_badlands: 'desert',
  red_canyon: 'desert',
  volcanic_flats: 'volcanic',
};

export function treeFamilyForBiome(biomeId: string | undefined): TreeFamily {
  return (biomeId !== undefined ? TREE_FAMILY_BY_BIOME[biomeId] : undefined) ?? 'deciduous';
}

/** Trees beyond this distance from the landscape centre are never built — bounds the instance count regardless of how large the raw TreePoint list is. */
const TREE_DRAW_DISTANCE = 900;
/**
 * Within this distance of the landscape centre a tree is the detailed model
 * with its outline; beyond it, the decimated far copy without one. A
 * foothills level carries ~50k tree points inside TREE_DRAW_DISTANCE — at
 * ~900 triangles each that is a frame budget, at ~100 it is not.
 */
const TREE_DETAIL_DISTANCE = 200;
/** Fallback cone trees, one shape per TreePoint.variant. */
const CANOPY_HEIGHT_BY_VARIANT = [4.5, 5.5, 3.8];
const TRUNK_HEIGHT_BY_VARIANT = [1.5, 2.0, 1.2];

const GRASS_RIM_MARGIN = 60;
const GRASS_CELL = 3;
const GRASS_DENSITY = 0.4;
const GRASS_BLADE_HEIGHT = 0.6;
const GRASS_SCALE_MIN = 0.7;
const GRASS_SCALE_SPREAD = 0.6;

/** Bushes dot the same rim band as the grass, far sparser and bigger. */
const BUSH_CELL = 7;
const BUSH_DENSITY = 0.14;
const BUSH_SCALE_MIN = 0.8;
const BUSH_SCALE_SPREAD = 0.7;

/** Options beyond the level geometry: where the models come from and which biome's trees to grow. */
export interface VegetationModels {
  library?: ModelLibrary;
  biomeId?: string;
}

/** Cone canopy + cylinder trunk, canopy base sitting on top of the trunk — the stand-in when a tree asset is missing. */
function fallbackTreePrototype(variant: number): ModelPrototype {
  const trunkH = TRUNK_HEIGHT_BY_VARIANT[variant]!;
  const canopyH = CANOPY_HEIGHT_BY_VARIANT[variant]!;
  const trunk = new THREE.CylinderGeometry(0.15, 0.2, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  const canopy = new THREE.ConeGeometry(1.4, canopyH, 7);
  canopy.translate(0, trunkH + canopyH / 2, 0);
  const scene = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'Body';
  const bark = new THREE.MeshStandardMaterial({ color: 0x6b4a2e });
  bark.name = 'Trunk';
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3a5a35 });
  leaf.name = 'Canopy';
  body.add(new THREE.Mesh(trunk, bark), new THREE.Mesh(canopy, leaf));
  scene.add(body);
  return buildPrototype(scene);
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

/** Grass blades keep their own simple lit material; the sway is spliced in the same way as on props. */
function attachGrassSway(material: THREE.MeshStandardMaterial, ambient: AmbientUniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uTime'] = ambient.uTime;
    shader.uniforms['uWind'] = ambient.uWind;
    shader.uniforms['uCanopyHeight'] = { value: GRASS_BLADE_HEIGHT };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uCanopyHeight;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float instanceWorldX = instanceMatrix[3].x;
#else
  float instanceWorldX = 0.0;
#endif
float bendT = pow(clamp(position.y, 0.0, uCanopyHeight) / max(uCanopyHeight, 0.001), 2.0);
float sway = bendT * 0.4 * sin(uTime * 1.7 + instanceWorldX * 0.35);
transformed.xz += uWind * sway;`);
  };
  material.customProgramCacheKey = () => `vegetation-grass-sway-${GRASS_BLADE_HEIGHT}`;
}

export class VegetationSway {
  private readonly scene: THREE.Scene;
  private readonly props: InstancedProp[] = [];
  private treeCount = 0;
  private bushCount = 0;
  private grassMesh: THREE.InstancedMesh | null = null;
  private grassMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly fallbackPrototypes: ModelPrototype[] = [];
  /** Prop ids this build wanted and the library did not have — a rebuild once they load draws the real models. */
  readonly missingModelIds: string[] = [];

  constructor(
    scene: THREE.Scene,
    levelSeed: number,
    ambient: AmbientUniforms,
    trees: readonly TreePoint[],
    centerX: number,
    centerZ: number,
    playableRect: Rect,
    sampleGroundHeight: (x: number, z: number) => number,
    models: VegetationModels = {},
  ) {
    this.scene = scene;
    const library = models.library ?? modelLibrary;
    const family = treeFamilyForBiome(models.biomeId);
    const dummy = new THREE.Object3D();

    // ---- Trees: per variant, one instanced prop near (detailed) and one far (decimated) ----
    const near: TreePoint[][] = Array.from({ length: TREE_VARIANTS }, () => []);
    const far: TreePoint[][] = Array.from({ length: TREE_VARIANTS }, () => []);
    for (const t of trees) {
      const distSq = (t.x - centerX) ** 2 + (t.z - centerZ) ** 2;
      if (distSq > TREE_DRAW_DISTANCE * TREE_DRAW_DISTANCE) continue;
      const variant = Math.min(TREE_VARIANTS - 1, Math.max(0, t.variant));
      (distSq <= TREE_DETAIL_DISTANCE * TREE_DETAIL_DISTANCE ? near : far)[variant]!.push(t);
    }

    const treeSeed = subSeed(levelSeed, 'trees');
    const placeTrees = (points: TreePoint[], proto: ModelPrototype, outline: boolean): void => {
      const prop = new InstancedProp(proto, library, {
        count: points.length, name: 'vegetation-trees', sway: swayFor(ambient, proto), outline,
      });
      for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        // Sampled, not p.h: the generator's height is the raw field, which
        // the rendered landscape offsets — trees placed at p.h stood 11 m
        // underground, which is why no tree was ever seen near a site.
        dummy.position.set(p.x, sampleGroundHeight(p.x, p.z), p.z);
        dummy.rotation.set(0, cellRand(treeSeed, Math.round(p.x), Math.round(p.z), 1) * Math.PI * 2, 0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        prop.setMatrixAt(i, dummy.matrix);
      }
      prop.commit();
      prop.addTo(this.scene);
      this.props.push(prop);
      this.treeCount += points.length;
    };
    for (let v = 0; v < TREE_VARIANTS; v++) {
      if (near[v]!.length === 0 && far[v]!.length === 0) continue;
      let detailed = library.prototype(treeModelId(family, v));
      if (!detailed) {
        this.missingModelIds.push(treeModelId(family, v));
        detailed = fallbackTreePrototype(v);
        this.fallbackPrototypes.push(detailed);
      }
      if (near[v]!.length > 0) placeTrees(near[v]!, detailed, true);
      if (far[v]!.length > 0) {
        const farProto = library.prototype(treeFarModelId(family, v));
        if (!farProto) this.missingModelIds.push(treeFarModelId(family, v));
        placeTrees(far[v]!, farProto ?? detailed, false);
      }
    }

    // ---- Grass and bushes: seeded bands just outside the playable rect ----
    const outer = {
      minX: playableRect.minX - GRASS_RIM_MARGIN, maxX: playableRect.maxX + GRASS_RIM_MARGIN,
      minZ: playableRect.minZ - GRASS_RIM_MARGIN, maxZ: playableRect.maxZ + GRASS_RIM_MARGIN,
    };
    const insidePlayable = (x: number, z: number): boolean =>
      x >= playableRect.minX && x <= playableRect.maxX && z >= playableRect.minZ && z <= playableRect.maxZ;

    const grassSeed = subSeed(levelSeed, 'grass');
    const grassPoints = scatter(grassSeed, outer, GRASS_CELL, GRASS_DENSITY, GRASS_SCALE_MIN, GRASS_SCALE_SPREAD, insidePlayable);
    if (grassPoints.length > 0) {
      const geo = buildGrassGeometry();
      this.grassMaterial = new THREE.MeshStandardMaterial({ color: 0x5a8f3f, roughness: 0.9, side: THREE.DoubleSide });
      library.applyMaterialSetup(this.grassMaterial);
      attachGrassSway(this.grassMaterial, ambient);
      this.grassMesh = new THREE.InstancedMesh(geo, this.grassMaterial, grassPoints.length);
      this.grassMesh.name = 'vegetation-grass';
      this.grassMesh.castShadow = false;
      this.grassMesh.receiveShadow = false;
      for (let i = 0; i < grassPoints.length; i++) {
        const g = grassPoints[i]!;
        dummy.position.set(g.x, sampleGroundHeight(g.x, g.z), g.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(g.scale);
        dummy.updateMatrix();
        this.grassMesh.setMatrixAt(i, dummy.matrix);
      }
      this.grassMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(this.grassMesh);
    }

    const bushSeed = subSeed(levelSeed, 'bushes');
    const bushPoints = scatter(bushSeed, outer, BUSH_CELL, BUSH_DENSITY, BUSH_SCALE_MIN, BUSH_SCALE_SPREAD, insidePlayable);
    const byBush: Array<typeof bushPoints> = Array.from({ length: BUSH_VARIANTS }, () => []);
    for (const b of bushPoints) byBush[b.variant % BUSH_VARIANTS]!.push(b);
    for (let v = 0; v < BUSH_VARIANTS; v++) {
      const proto = library.prototype(bushModelId(v));
      const points = byBush[v]!;
      if (points.length === 0) continue;
      if (!proto) {
        this.missingModelIds.push(bushModelId(v));
        continue;
      }
      const prop = new InstancedProp(proto, library, { count: points.length, name: 'vegetation-bushes', sway: swayFor(ambient, proto) });
      for (let i = 0; i < points.length; i++) {
        const b = points[i]!;
        dummy.position.set(b.x, sampleGroundHeight(b.x, b.z), b.z);
        dummy.rotation.set(0, b.yaw, 0);
        dummy.scale.setScalar(b.scale);
        dummy.updateMatrix();
        prop.setMatrixAt(i, dummy.matrix);
      }
      prop.commit();
      prop.addTo(this.scene);
      this.props.push(prop);
      this.bushCount += points.length;
    }
  }

  /** Number of tree instances actually built (sum across variants) — for tests/diagnostics. */
  get treeInstanceCount(): number {
    return this.treeCount;
  }

  /** Number of bush instances built — zero until the bush assets are in the library. */
  get bushInstanceCount(): number {
    return this.bushCount;
  }

  /** Number of grass instances actually built — for tests/diagnostics. */
  get grassInstanceCount(): number {
    return this.grassMesh?.count ?? 0;
  }

  dispose(): void {
    for (const prop of this.props) prop.dispose(this.scene);
    this.props.length = 0;
    for (const proto of this.fallbackPrototypes) {
      proto.root.traverse(obj => { if (obj instanceof THREE.Mesh) obj.geometry.dispose(); });
    }
    this.fallbackPrototypes.length = 0;
    if (this.grassMesh) {
      this.scene.remove(this.grassMesh);
      this.grassMesh.geometry.dispose();
      this.grassMaterial!.dispose();
      this.grassMesh = null;
    }
  }
}

/** Sway tuned to a prototype: full bend at its own top. */
function swayFor(ambient: AmbientUniforms, proto: ModelPrototype): SwayOptions {
  return { uTime: ambient.uTime, uWind: ambient.uWind, canopyHeight: Math.max(0.5, proto.bounds.max.y) };
}

interface ScatterPoint { x: number; z: number; scale: number; yaw: number; variant: number }

/** Seeded jittered-grid scatter over `outer`, skipping cells `excluded` and those failing the density roll. */
function scatter(
  seed: number, outer: Rect, cell: number, density: number, scaleMin: number, scaleSpread: number,
  excluded: (x: number, z: number) => boolean,
): ScatterPoint[] {
  const out: ScatterPoint[] = [];
  const cellsX = Math.ceil((outer.maxX - outer.minX) / cell);
  const cellsZ = Math.ceil((outer.maxZ - outer.minZ) / cell);
  for (let cz = 0; cz < cellsZ; cz++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const x = outer.minX + cx * cell + cellRand(seed, cx, cz, 1) * cell;
      const z = outer.minZ + cz * cell + cellRand(seed, cx, cz, 2) * cell;
      if (excluded(x, z)) continue;
      if (cellRand(seed, cx, cz, 3) >= density) continue;
      out.push({
        x, z,
        scale: scaleMin + cellRand(seed, cx, cz, 4) * scaleSpread,
        yaw: cellRand(seed, cx, cz, 5) * Math.PI * 2,
        variant: Math.floor(cellRand(seed, cx, cz, 6) * 8),
      });
    }
  }
  return out;
}
