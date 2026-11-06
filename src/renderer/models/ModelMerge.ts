// BlastSimulator2026 — glTF scene → renderable prototype
// A Blender export arrives as one Mesh per part and material. For drawing,
// each top-level node (the unit the renderer animates) is collapsed into as
// few meshes as possible: one vertex-coloured mesh for every fixed-colour
// part, one mesh per `Tint*` material (recoloured per instance), one per
// emissive material, plus a single outline hull over everything. A building
// goes from dozens of draws to 3 this way.
//
// A skinned export (any SkinnedMesh) keeps its armature node and bones
// instead: the renderer poses bones, so the armature is the one animatable
// node, and every primitive under it lands in the same buckets as skinned
// meshes sharing one skeleton (SkinnedMerge) — a worker draws in ~6 calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHARACTER_OUTLINE, createOutlineMaterial, createToonMaterial } from './CartoonMaterial.js';
import { mergeSkinnedArmature } from './SkinnedMerge.js';

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
  /** Local-space bounds of the whole model, from the merged geometry (bind pose for a skinned model). */
  bounds: THREE.Box3;
  /** Whether the model carries an armature: its surfaces are SkinnedMeshes posed through named bones. */
  skinned: boolean;
}

interface SourceMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Transform of the mesh relative to its top-level node. */
  matrix: THREE.Matrix4;
}

/** Bucket key of every fixed-colour part: the one mesh whose colours live in a vertex attribute. */
const PAINTED = 'painted';

/**
 * A skinned pose can carry a limb well outside the bind-pose bounds — arms
 * up, a body face-down after a collapse. Culling against the bind sphere
 * scaled by this keeps a posed character drawn without three recomputing a
 * sphere from whatever pose the first frame happened to hold.
 */
const POSE_COVER_SCALE = 1.6;

/** Bucket key: which merged mesh a part lands in. */
function bucketOf(material: THREE.MeshStandardMaterial): string {
  if (material.name.startsWith(TINT_PREFIX)) return `tint:${material.name}`;
  const e = material.emissive;
  if (e.r + e.g + e.b > 0) return `emissive:${material.emissive.getHexString()}:${material.color.getHexString()}`;
  return PAINTED;
}

/** The toon material a bucket draws with; a tint bucket registers its name, in first-seen order. */
function surfaceMaterial(key: string, first: THREE.MeshStandardMaterial, tintNames: string[]): THREE.MeshToonMaterial {
  if (key.startsWith('tint:')) {
    if (!tintNames.includes(first.name)) tintNames.push(first.name);
    return createToonMaterial({ color: first.color.clone(), name: first.name });
  }
  if (key.startsWith('emissive:')) {
    return createToonMaterial({ color: first.color.clone(), emissive: first.emissive.clone(), name: first.name });
  }
  return createToonMaterial({ vertexColors: true, name: PAINTED });
}

/** Name, tag and shadow flags every merged surface carries, rigid or skinned. */
function dressSurface(mesh: THREE.Mesh, nodeName: string, key: string, first: THREE.MeshStandardMaterial): void {
  if (key.startsWith('tint:')) mesh.userData[TINT_KEY] = first.name;
  mesh.name = `${nodeName}.${key.split(':')[0]}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}

function noRaycast(): void {}

/** Tag `mesh` as its node's outline hull: skipped by pickers, setup hooks and bounds. */
function dressHull<T extends THREE.Mesh>(mesh: T, nodeName: string): T {
  mesh.name = `${nodeName}.outline`;
  mesh.userData[HULL_KEY] = true;
  mesh.raycast = noRaycast;
  return mesh;
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
    const mesh = new THREE.Mesh(mergeBucket(list, key === PAINTED), surfaceMaterial(key, first, tintNames));
    dressSurface(mesh, source.name, key, first);
    node.add(mesh);
    surfaces.push(mesh.geometry);
  }

  // The hull is the union of the surfaces just built — merged from their
  // already-baked buffers (positions + normals shared, not copied) rather than
  // baking every part a second time. This runs at page boot for every model,
  // on the main thread, so its cost is what keeps the first frames responsive.
  node.add(dressHull(new THREE.Mesh(mergeSurfaces(surfaces), createOutlineMaterial()), source.name));
  return node;
}

/**
 * Collapse an armature (a top-level node holding bones) into skinned toon
 * meshes plus one skinned hull, all on one skeleton, under a copy of the
 * armature that keeps its bone hierarchy by name.
 */
function buildArmature(
  source: THREE.Object3D,
  tintNames: string[],
  sceneInverse: THREE.Matrix4,
): { node: THREE.Object3D; bindBox: THREE.Box3 } {
  const union = mergeSkinnedArmature(source, sceneInverse, { bucketOf, vertexColoured: key => key === PAINTED });
  const node = union.armature;
  // The merged meshes sit at the armature's origin, so their local space is
  // the scene's seen through the armature's own transform.
  node.updateMatrix();
  const localBox = union.bindBox.clone().applyMatrix4(node.matrix.clone().invert());
  const cullSphere = localBox.getBoundingSphere(new THREE.Sphere());
  cullSphere.radius *= POSE_COVER_SCALE;

  const meshes: THREE.SkinnedMesh[] = union.buckets.map(bucket => {
    const mesh = new THREE.SkinnedMesh(bucket.geometry, surfaceMaterial(bucket.key, bucket.material, tintNames));
    dressSurface(mesh, source.name, bucket.key, bucket.material);
    // Face details are a few centimetres across, under a hat brim, and the
    // shadow map is far coarser: they cast nothing, and the painted ones (eye
    // whites, irises, teeth) take no shadow either, which would only speckle
    // them with acne — a cartoon eye stays white. Skin- and hair-tinted ones
    // (lids, brows) still darken with the face around them.
    if (!bucket.lined) {
      mesh.castShadow = false;
      mesh.receiveShadow = bucket.key.startsWith('tint:');
    }
    return mesh;
  });
  meshes.push(dressHull(new THREE.SkinnedMesh(union.hull, createOutlineMaterial(undefined, CHARACTER_OUTLINE)), source.name));
  for (const mesh of meshes) {
    mesh.bind(union.skeleton, union.bindMatrix);
    // Set, never computed: SkinnedMesh computes both by skinning every vertex
    // on the CPU, from whatever pose it holds at that moment.
    mesh.boundingBox = localBox.clone();
    mesh.boundingSphere = cullSphere.clone();
    // Raycasting a SkinnedMesh skins every vertex on the CPU; instances pick
    // through a proxy box instead (ModelLibrary).
    mesh.raycast = noRaycast;
    node.add(mesh);
  }
  return { node, bindBox: union.bindBox };
}

function contains(root: THREE.Object3D, test: (obj: THREE.Object3D) => boolean): boolean {
  let found = false;
  root.traverse(obj => { found ||= test(obj); });
  return found;
}

/**
 * Build the renderable prototype for a parsed glTF scene. Each direct child
 * of the scene becomes one node of the result (name preserved, so a renderer
 * can find `ArmL` or `WheelFR` by name); everything beneath it is merged.
 * In a skinned scene, a child holding bones is kept as an armature whose
 * bones stay findable by name (`Head`, `ThighL`).
 */
export function buildPrototype(gltfScene: THREE.Object3D): ModelPrototype {
  const root = new THREE.Group();
  const tintNames: string[] = [];
  gltfScene.updateMatrixWorld(true);
  const skinned = contains(gltfScene, obj => obj instanceof THREE.SkinnedMesh);
  const sceneInverse = gltfScene.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  for (const child of gltfScene.children) {
    if (skinned && contains(child, obj => obj instanceof THREE.Bone || obj instanceof THREE.SkinnedMesh)) {
      const armature = buildArmature(child, tintNames, sceneInverse);
      root.add(armature.node);
      bounds.union(armature.bindBox);
    } else {
      root.add(buildNode(child, tintNames));
    }
  }
  root.updateMatrixWorld(true);
  root.traverse(obj => {
    // Skinned surfaces contributed their bind-pose bounds above: their
    // geometry is bind-space data, not mesh-local positions.
    if (obj instanceof THREE.Mesh && !(obj instanceof THREE.SkinnedMesh) && !obj.userData[HULL_KEY]) {
      obj.geometry.computeBoundingBox();
      const box = (obj.geometry.boundingBox as THREE.Box3).clone();
      box.applyMatrix4(obj.matrixWorld);
      bounds.union(box);
    }
  });
  return { root, tintNames, bounds, skinned };
}
