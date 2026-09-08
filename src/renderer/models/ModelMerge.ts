// BlastSimulator2026 — glTF scene → renderable prototype
// A Blender export arrives as one Mesh per part and material. For drawing,
// each top-level node (the unit the renderer animates) is collapsed into as
// few meshes as possible: one vertex-coloured mesh for every fixed-colour
// part, one mesh per `Tint*` material (recoloured per instance), one per
// emissive material, plus a single outline hull over everything. A worker
// goes from ~40 draws to ~14 this way; a building to 3.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createOutlineMaterial, createToonMaterial } from './CartoonMaterial.js';

/** Materials named with this prefix are recoloured per game instance. */
const TINT_PREFIX = 'Tint';
/** userData key on a mesh whose material must be cloned per instance. */
export const TINT_KEY = 'tint';
/** userData key marking the outline hull, so pickers and dispose can skip it. */
export const HULL_KEY = 'outlineHull';

export interface ModelPrototype {
  /** Node hierarchy with merged meshes and hulls, ready to clone. */
  root: THREE.Group;
  /** Tint material names present, in first-seen order. */
  tintNames: string[];
  /** Local-space bounds of the whole model, from the merged geometry. */
  bounds: THREE.Box3;
}

interface SourceMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Transform of the mesh relative to its top-level node. */
  matrix: THREE.Matrix4;
}

/** Bucket key: which merged mesh a part lands in. */
function bucketOf(material: THREE.MeshStandardMaterial): string {
  if (material.name.startsWith(TINT_PREFIX)) return `tint:${material.name}`;
  const e = material.emissive;
  if (e.r + e.g + e.b > 0) return `emissive:${material.emissive.getHexString()}:${material.color.getHexString()}`;
  return 'painted';
}

function bakeGeometry(src: SourceMesh, withColor: boolean): THREE.BufferGeometry {
  const geo = src.geometry.clone();
  geo.applyMatrix4(src.matrix);
  // Merging needs identical attribute sets; a Blender export without UVs or
  // colours carries exactly position + normal.
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  }
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  if (withColor) {
    const count = geo.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    const { r, g, b } = src.material.color;
    for (let i = 0; i < count; i++) {
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return geo;
}

function mergeBucket(parts: SourceMesh[], withColor: boolean): THREE.BufferGeometry {
  const baked = parts.map(p => bakeGeometry(p, withColor));
  const merged = baked.length === 1 ? baked[0]! : mergeGeometries(baked, false);
  if (!merged) throw new Error('mergeGeometries failed: attribute sets differ');
  if (baked.length > 1) baked.forEach(g => g.dispose());
  return merged;
}

/** Position + normal view of already-merged surfaces, concatenated into the hull geometry. */
function mergeSurfaces(surfaces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const views = surfaces.map(src => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', src.getAttribute('position'));
    g.setAttribute('normal', src.getAttribute('normal'));
    if (src.index) g.setIndex(src.index);
    return g;
  });
  if (views.length === 1) return views[0]!;
  const merged = mergeGeometries(views, false);
  if (!merged) throw new Error('mergeGeometries failed: surface attribute sets differ');
  return merged;
}

/** Collect every mesh under `node`, with its transform relative to `node`. */
function collectMeshes(node: THREE.Object3D): SourceMesh[] {
  const out: SourceMesh[] = [];
  node.updateMatrixWorld(true);
  const inverse = node.matrixWorld.clone().invert();
  node.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    out.push({
      geometry: child.geometry as THREE.BufferGeometry,
      material,
      matrix: inverse.clone().multiply(child.matrixWorld),
    });
  });
  return out;
}

/** Collapse one animatable node's parts into merged toon meshes + one hull. */
function buildNode(source: THREE.Object3D, tintNames: string[]): THREE.Group {
  const node = new THREE.Group();
  node.name = source.name;
  node.position.copy(source.position);
  node.quaternion.copy(source.quaternion);
  node.scale.copy(source.scale);

  const parts = collectMeshes(source);
  if (parts.length === 0) return node;

  const buckets = new Map<string, SourceMesh[]>();
  for (const part of parts) {
    const key = bucketOf(part.material);
    const list = buckets.get(key) ?? [];
    list.push(part);
    buckets.set(key, list);
  }

  const surfaces: THREE.BufferGeometry[] = [];
  for (const [key, list] of buckets) {
    const first = list[0]!.material;
    let mesh: THREE.Mesh;
    if (key.startsWith('tint:')) {
      const geo = mergeBucket(list, false);
      mesh = new THREE.Mesh(geo, createToonMaterial({ color: first.color.clone(), name: first.name }));
      mesh.userData[TINT_KEY] = first.name;
      if (!tintNames.includes(first.name)) tintNames.push(first.name);
    } else if (key.startsWith('emissive:')) {
      const geo = mergeBucket(list, false);
      mesh = new THREE.Mesh(geo, createToonMaterial({
        color: first.color.clone(), emissive: first.emissive.clone(), name: first.name,
      }));
    } else {
      const geo = mergeBucket(list, true);
      mesh = new THREE.Mesh(geo, createToonMaterial({ vertexColors: true, name: 'painted' }));
    }
    mesh.name = `${source.name}.${key.split(':')[0]}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    node.add(mesh);
    surfaces.push(mesh.geometry);
  }

  // The hull is the union of the surfaces just built — merged from their
  // already-baked buffers (positions + normals shared, not copied) rather than
  // baking every part a second time. This runs at page boot for every model,
  // on the main thread, so its cost is what keeps the first frames responsive.
  const hull = new THREE.Mesh(mergeSurfaces(surfaces), createOutlineMaterial());
  hull.name = `${source.name}.outline`;
  hull.userData[HULL_KEY] = true;
  hull.raycast = () => {};
  node.add(hull);
  return node;
}

/**
 * Build the renderable prototype for a parsed glTF scene. Each direct child
 * of the scene becomes one node of the result (name preserved, so a renderer
 * can find `ArmL` or `WheelFR` by name); everything beneath it is merged.
 */
export function buildPrototype(gltfScene: THREE.Object3D): ModelPrototype {
  const root = new THREE.Group();
  const tintNames: string[] = [];
  gltfScene.updateMatrixWorld(true);
  for (const child of gltfScene.children) {
    root.add(buildNode(child, tintNames));
  }
  const bounds = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse(obj => {
    if (obj instanceof THREE.Mesh && !obj.userData[HULL_KEY]) {
      obj.geometry.computeBoundingBox();
      const box = (obj.geometry.boundingBox as THREE.Box3).clone();
      box.applyMatrix4(obj.matrixWorld);
      bounds.union(box);
    }
  });
  return { root, tintNames, bounds };
}
