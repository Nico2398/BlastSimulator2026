/**
 * BlastSimulator2026 — Model manifest
 *
 * What a model is made of, read back from the exported asset rather than from
 * the generator that wrote it. Editing a model otherwise starts by reading
 * several hundred lines of Python to find out which node owns the hard hat and
 * how tall the thing ended up; the manifest answers that in one file.
 *
 * Everything here is derived: `npm run models:manifest` regenerates it from
 * public/models/*.glb, and a unit test rebuilds it in memory and compares, so a
 * model rebuilt without regenerating the manifest fails rather than drifting.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MODELS_DIR = resolve(ROOT, 'public', 'models');
const BLENDER_DIR = resolve(ROOT, 'assets', 'models', 'blender');
export const MANIFEST_PATH = resolve(ROOT, 'assets', 'models', 'manifest.json');

/** One animatable node: what the renderer can rotate, and the parts merged into it. */
interface ManifestNode {
  triangles: number;
  /** Blender object names of the parts under this node, deduplicated. */
  parts: string[];
}

interface ManifestModel {
  /** Generator module that writes this id, per build.py's routing. */
  builder: string;
  triangles: number;
  glbKb: number;
  /** Bounding-box size in game units, [x, y, z]. */
  size: [number, number, number];
  /** Lowest point — 0 for anything that stands on the ground. */
  groundY: number;
  /** Materials recoloured per instance at runtime. */
  tints: string[];
  /** Materials that glow (they stay on their own mesh through the merge). */
  emissive: string[];
  materials: string[];
  nodes: Record<string, ManifestNode>;
}

interface ModelManifest {
  note: string;
  models: Record<string, ManifestModel>;
}

const MANIFEST_NOTE =
  'Generated from public/models/*.glb by `npm run models:manifest`. Edit a builder under assets/models/blender/, rebuild, regenerate.';

/** Blender's duplicate suffix (`HeadEye001`) and glTF's own (`Mesh_1`) carry no meaning here. */
function baseName(name: string): string {
  return name.replace(/\d{3}$/, '').replace(/_\d+$/, '');
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  // `+ 0` collapses -0, which JSON writes as 0 but a strict comparison sees as
  // a different value — the staleness check would fail on a fresh manifest.
  return Math.round(value * f) / f + 0;
}

/**
 * Which generator module writes `id`, following build.py: a tier module owns
 * the tier it caricatures when it exists, and the plain module owns the rest.
 */
function builderModule(id: string): string {
  const defines = (file: string, fn: string): boolean => {
    const path = resolve(BLENDER_DIR, file);
    return existsSync(path) && readFileSync(path, 'utf8').includes(`def ${fn}(`);
  };
  if (id.startsWith('worker_')) return 'workers.py';
  if (id.startsWith('prop_')) return 'props.py';
  const vehicle = /^vehicle_.+_t([123])$/.exec(id);
  if (vehicle) {
    const tier = vehicle[1];
    if (tier === '2') return 'vehicles.py';
    const module = `vehicles_t${tier}.py`;
    return defines(module, 'build_vehicle') ? module : 'vehicles.py';
  }
  const building = /^building_.+_t([123])$/.exec(id);
  if (building) {
    const tier = building[1];
    if (tier === '2') return 'buildings.py';
    const module = `buildings_t${tier}.py`;
    return defines(module, 'build_building') ? module : 'buildings.py';
  }
  return 'buildings.py';
}

const loader = new GLTFLoader();

function parse(bytes: ArrayBuffer): Promise<THREE.Object3D> {
  return new Promise((res, rej) => loader.parse(bytes, '', gltf => res(gltf.scene), rej));
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const count = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
  return count / 3;
}

/** Read one exported asset into its manifest entry. */
async function describeModel(id: string, dir = MODELS_DIR): Promise<ManifestModel> {
  const file = resolve(dir, `${id}.glb`);
  const buffer = readFileSync(file);
  const scene = await parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  scene.updateMatrixWorld(true);

  const nodes: Record<string, ManifestNode> = {};
  const materials = new Set<string>();
  const tints = new Set<string>();
  const emissive = new Set<string>();
  const bounds = new THREE.Box3();
  let triangles = 0;

  for (const node of scene.children) {
    const parts = new Set<string>();
    let nodeTriangles = 0;
    node.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      parts.add(baseName(child.name));
      nodeTriangles += triangleCount(child.geometry);
      const material = Array.isArray(child.material) ? child.material[0] : child.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        materials.add(material.name);
        if (material.name.startsWith('Tint')) tints.add(material.name);
        const e = material.emissive;
        if (e.r + e.g + e.b > 0) emissive.add(material.name);
      }
      child.geometry.computeBoundingBox();
      bounds.union((child.geometry.boundingBox as THREE.Box3).clone().applyMatrix4(child.matrixWorld));
    });
    triangles += nodeTriangles;
    nodes[node.name] = { triangles: Math.round(nodeTriangles), parts: [...parts].sort() };
  }

  const size = bounds.getSize(new THREE.Vector3());
  return {
    builder: builderModule(id),
    triangles: Math.round(triangles),
    glbKb: Math.round(buffer.byteLength / 1024),
    size: [round(size.x), round(size.y), round(size.z)],
    groundY: round(bounds.min.y),
    tints: [...tints].sort(),
    emissive: [...emissive].sort(),
    materials: [...materials].sort(),
    nodes,
  };
}

/** Every exported asset, in id order. */
export async function buildModelManifest(dir = MODELS_DIR): Promise<ModelManifest> {
  const ids = readdirSync(dir).filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4)).sort();
  const models: Record<string, ManifestModel> = {};
  for (const id of ids) models[id] = await describeModel(id, dir);
  return { note: MANIFEST_NOTE, models };
}

/** The manifest as committed, or null when it has never been generated. */
export function readModelManifest(path = MANIFEST_PATH): ModelManifest | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ModelManifest) : null;
}
