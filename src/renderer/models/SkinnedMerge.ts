// BlastSimulator2026 — skinned armature → one shared set of skinned buffers
// A skinned character arrives as one SkinnedMesh per part and material, every
// one bound to the same skeleton: ~110 primitives for a worker, each a draw.
// This flattens an armature's primitives into ONE set of vertex buffers,
// written bucket by bucket so each bucket is a contiguous index range. The
// caller hands every bucket a SkinnedMesh drawing its own range and the
// outline hull the whole range, so surfaces and hull share the same GPU
// buffers and one skeleton. Bucketing and materials stay with ModelMerge
// (it passes `bucketOf`), so rigid and skinned parts sort identically.

import * as THREE from 'three';

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** One merge bucket of the union: a contiguous index range of the shared buffers. */
interface SkinnedBucket {
  key: string;
  /** First source material seen in this bucket — its colour, emission and name define the surface. */
  material: THREE.MeshStandardMaterial;
  /** View over the shared buffers drawing only this bucket's range. */
  geometry: THREE.BufferGeometry;
  /** Whether the outline hull covers this bucket; face details (`Face*` parts) are drawn without one. */
  lined: boolean;
}

interface SkinnedUnion {
  /** Copy of the armature node holding only its joint hierarchy; bones keep their names and rest transforms. */
  armature: THREE.Object3D;
  /** One skeleton over the copied bones; every primitive's joint slots are remapped onto it. */
  skeleton: THREE.Skeleton;
  /** Bind matrix every merged surface is bound with: the first source primitive's. */
  bindMatrix: THREE.Matrix4;
  buckets: SkinnedBucket[];
  /** Position, normal and skin view over every bucket — the outline hull's geometry. */
  hull: THREE.BufferGeometry;
  /** Bind-pose bounds, in the glTF scene's space. */
  bindBox: THREE.Box3;
}

/**
 * Parts whose Blender object name starts with this stay out of the outline
 * hull: a face's eyes, lids, lashes, mouths and glasses. Lined, every eyeball
 * gets its own black ring and a face at game distance fills with dark noise.
 */
const UNLINED_PREFIX = 'Face';
/** Suffix a bucket key carries when its parts are drawn without an outline. */
const UNLINED_MARK = '#unlined';

/** True when `mesh` (or the part node above it, up to the armature) is named for the unlined face. */
function isUnlined(mesh: THREE.Object3D, armature: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = mesh; o && o !== armature && !(o instanceof THREE.Bone); o = o.parent) {
    if (o.name.startsWith(UNLINED_PREFIX)) return true;
  }
  return false;
}

/** How a merge bucket is chosen for a part, and whether that bucket draws vertex colours. */
interface BucketPolicy {
  bucketOf(material: THREE.MeshStandardMaterial): string;
  vertexColoured(key: string): boolean;
}

interface Part {
  key: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Source vertex space → bind space (the glTF scene's space). */
  toBind: THREE.Matrix4;
  /** A skinned part's joint attributes and, per source joint slot, the merged skeleton's slot. */
  skin: { index: Attribute; weight: Attribute; slots: Int32Array } | null;
  /** A rigid part's one joint: the bone it hangs under, followed with full weight. */
  joint: number;
}

/**
 * Copy of `source` keeping only what leads to a bone. Part groups and meshes
 * are dropped — their geometry is merged — so the only names left beside the
 * bones are the armature's own and the merged meshes'.
 */
function copyJoints(source: THREE.Object3D, copies: Map<THREE.Object3D, THREE.Bone>): THREE.Object3D | null {
  const children = source.children
    .map(child => copyJoints(child, copies))
    .filter((child): child is THREE.Object3D => child !== null);
  const isBone = source instanceof THREE.Bone;
  if (!isBone && children.length === 0) return null;
  const copy = isBone ? new THREE.Bone() : new THREE.Object3D();
  copy.name = source.name;
  copy.position.copy(source.position);
  copy.quaternion.copy(source.quaternion);
  copy.scale.copy(source.scale);
  if (isBone) copies.set(source, copy as THREE.Bone);
  for (const child of children) copy.add(child);
  return copy;
}

/** The merged skeleton: one slot per bone, whichever primitive (or rigid part) first named it. */
class JointTable {
  readonly bones: THREE.Bone[] = [];
  readonly inverses: THREE.Matrix4[] = [];
  private readonly slots = new Map<THREE.Object3D, number>();

  constructor(private readonly copies: ReadonlyMap<THREE.Object3D, THREE.Bone>) {}

  /** A skin's joint. Two skins may share a slot only when they agree on its bind pose. */
  skinSlot(bone: THREE.Bone, inverse: THREE.Matrix4): number {
    const known = this.slots.get(bone);
    if (known === undefined) return this.add(bone, inverse);
    // One export has one skin, so a disagreement is a broken asset: merging
    // it anyway would tear the primitives apart the moment the bone moves.
    if (!nearlyEqual(this.inverses[known]!, inverse)) {
      throw new Error(`bone "${bone.name}" is bound with two different inverse bind matrices`);
    }
    return known;
  }

  /** The joint a rigid part follows: the skin's slot when there is one, else a new slot bound at rest. */
  followSlot(bone: THREE.Bone, restInverse: THREE.Matrix4): number {
    return this.slots.get(bone) ?? this.add(bone, restInverse);
  }

  private add(bone: THREE.Bone, inverse: THREE.Matrix4): number {
    const copy = this.copies.get(bone);
    if (!copy) throw new Error(`bone "${bone.name}" is not under the armature that holds its skin`);
    this.slots.set(bone, this.bones.length);
    this.bones.push(copy);
    this.inverses.push(inverse.clone());
    return this.bones.length - 1;
  }
}

function nearlyEqual(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  return a.elements.every((v, i) => Math.abs(v - b.elements[i]!) < 1e-5);
}

/** The nearest bone above `mesh`, inside `armature`. */
function boneAbove(mesh: THREE.Object3D, armature: THREE.Object3D): THREE.Bone | null {
  for (let node = mesh.parent; node; node = node === armature ? null : node.parent) {
    if (node instanceof THREE.Bone) return node;
  }
  return null;
}

function collectParts(
  armature: THREE.Object3D,
  sceneInverse: THREE.Matrix4,
  table: JointTable,
  policy: BucketPolicy,
): Part[] {
  const meshes: Array<{ mesh: THREE.Mesh; material: THREE.MeshStandardMaterial }> = [];
  armature.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    if (material instanceof THREE.MeshStandardMaterial) meshes.push({ mesh: child, material });
  });
  // Seed the table from skinned primitives first, so the merged skeleton
  // keeps the exported joint order and their slots map one to one.
  const ordered = [
    ...meshes.filter(m => m.mesh instanceof THREE.SkinnedMesh),
    ...meshes.filter(m => !(m.mesh instanceof THREE.SkinnedMesh)),
  ];
  return ordered.map(({ mesh, material }): Part => {
    const key = policy.bucketOf(material) + (isUnlined(mesh, armature) ? UNLINED_MARK : '');
    const geometry = mesh.geometry as THREE.BufferGeometry;
    if (mesh instanceof THREE.SkinnedMesh) {
      const index = geometry.getAttribute('skinIndex') as Attribute | undefined;
      const weight = geometry.getAttribute('skinWeight') as Attribute | undefined;
      if (!index || !weight) throw new Error(`skinned mesh "${mesh.name}" has no skinIndex/skinWeight`);
      const { bones, boneInverses } = mesh.skeleton;
      const slots = Int32Array.from(bones, (bone, i) => table.skinSlot(bone, boneInverses[i]!));
      // Attached bind mode ignores the mesh's own transform: the bind matrix
      // alone carries its vertices into the space the inverse bind matrices expect.
      return { key, geometry, material, toBind: mesh.bindMatrix.clone(), skin: { index, weight, slots }, joint: 0 };
    }
    // A rigid mesh parented to a bone (a tool in a hand) rides that bone.
    const bone = boneAbove(mesh, armature);
    if (!bone) throw new Error(`rigid mesh "${mesh.name}" inside armature "${armature.name}" has no bone to follow`);
    // Its vertices are expressed in bind space so that, with the bone at
    // rest, they land exactly where the export placed them — even when the
    // skin's bind pose differs from the rest pose.
    const boneRest = sceneInverse.clone().multiply(bone.matrixWorld);
    const joint = table.followSlot(bone, boneRest.clone().invert());
    const toBind = table.inverses[joint]!.clone().invert()
      .multiply(boneRest.invert())
      .multiply(sceneInverse.clone().multiply(mesh.matrixWorld));
    return { key, geometry, material, toBind, skin: null, joint };
  });
}

type WeightArray = Float32ArrayConstructor | Uint16ArrayConstructor | Uint8ArrayConstructor;

/**
 * Weight storage for the union. glTF allows float or normalized byte/short
 * weights, and one export may mix them across primitives (merging needs one
 * type): keep the shared type when every primitive agrees, else widen to float.
 */
function weightType(parts: readonly Part[]): { array: WeightArray; normalized: boolean } {
  const float = { array: Float32Array, normalized: false };
  let shared: { array: WeightArray; normalized: boolean } | null = null;
  for (const part of parts) {
    if (!part.skin) continue;
    const { array, normalized } = part.skin.weight;
    const type: WeightArray | null = array instanceof Float32Array ? Float32Array
      : array instanceof Uint16Array && normalized ? Uint16Array
        : array instanceof Uint8Array && normalized ? Uint8Array : null;
    if (!type) return float;
    if (shared && shared.array !== type) return float;
    shared = { array: type, normalized: type !== Float32Array };
  }
  return shared ?? float;
}

function normalsOf(geometry: THREE.BufferGeometry): Attribute {
  const normal = geometry.getAttribute('normal') as Attribute | undefined;
  if (normal) return normal;
  const scratch = new THREE.BufferGeometry();
  scratch.setAttribute('position', geometry.getAttribute('position'));
  if (geometry.index) scratch.setIndex(geometry.index);
  scratch.computeVertexNormals();
  return scratch.getAttribute('normal');
}

/** The armature node and its joint tree, copied; `copies` maps each source bone to its copy. */
function copyArmature(armature: THREE.Object3D): { node: THREE.Object3D; copies: Map<THREE.Object3D, THREE.Bone> } {
  const copies = new Map<THREE.Object3D, THREE.Bone>();
  const node = armature instanceof THREE.Bone ? new THREE.Bone() : new THREE.Group();
  node.name = armature.name;
  node.position.copy(armature.position);
  node.quaternion.copy(armature.quaternion);
  node.scale.copy(armature.scale);
  if (node instanceof THREE.Bone) copies.set(armature, node);
  for (const child of armature.children) {
    const copy = copyJoints(child, copies);
    if (copy) node.add(copy);
  }
  return { node, copies };
}

/** The union's vertex buffers; every bucket view and the hull reference these same attributes. */
interface UnionBuffers {
  position: THREE.BufferAttribute;
  normal: THREE.BufferAttribute;
  color: THREE.BufferAttribute;
  skinIndex: THREE.BufferAttribute;
  skinWeight: THREE.BufferAttribute;
  index: Uint16Array | Uint32Array;
}

function allocate(parts: readonly Part[], boneCount: number): UnionBuffers {
  let vertices = 0;
  let indices = 0;
  for (const part of parts) {
    const count = part.geometry.getAttribute('position').count;
    vertices += count;
    indices += part.geometry.index ? part.geometry.index.count : count;
  }
  const weights = weightType(parts);
  return {
    position: new THREE.BufferAttribute(new Float32Array(vertices * 3), 3),
    normal: new THREE.BufferAttribute(new Float32Array(vertices * 3), 3),
    color: new THREE.BufferAttribute(new Float32Array(vertices * 3), 3),
    skinIndex: new THREE.BufferAttribute(boneCount <= 256 ? new Uint8Array(vertices * 4) : new Uint16Array(vertices * 4), 4),
    skinWeight: new THREE.BufferAttribute(new weights.array(vertices * 4), 4, weights.normalized),
    index: vertices <= 65536 ? new Uint16Array(indices) : new Uint32Array(indices),
  };
}

/**
 * Write `part` into the union at the given offsets: vertices re-expressed for
 * the union's bind matrix, joint slots remapped onto the merged skeleton, its
 * material colour per vertex. Grows `bindBox` by its bind-pose positions.
 */
function writePart(
  part: Part, out: UnionBuffers, vertexBase: number, indexBase: number, bindInverse: THREE.Matrix4, bindBox: THREE.Box3,
): { vertices: number; indices: number } {
  const src = part.geometry;
  const srcPosition = src.getAttribute('position');
  const srcNormal = normalsOf(src);
  const toUnion = bindInverse.clone().multiply(part.toBind);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(toUnion);
  const { r, g, b } = part.material.color;
  const v = new THREE.Vector3();
  const count = srcPosition.count;
  for (let i = 0; i < count; i++) {
    const at = vertexBase + i;
    bindBox.expandByPoint(v.fromBufferAttribute(srcPosition, i).applyMatrix4(part.toBind));
    v.fromBufferAttribute(srcPosition, i).applyMatrix4(toUnion);
    out.position.setXYZ(at, v.x, v.y, v.z);
    v.fromBufferAttribute(srcNormal, i).applyNormalMatrix(normalMatrix);
    out.normal.setXYZ(at, v.x, v.y, v.z);
    out.color.setXYZ(at, r, g, b);
    if (part.skin) {
      const { index, weight, slots } = part.skin;
      out.skinIndex.setXYZW(at,
        slots[index.getX(i)] ?? 0, slots[index.getY(i)] ?? 0, slots[index.getZ(i)] ?? 0, slots[index.getW(i)] ?? 0);
      // setXYZW quantizes into a byte/short target and widens into a float one.
      out.skinWeight.setXYZW(at, weight.getX(i), weight.getY(i), weight.getZ(i), weight.getW(i));
    } else {
      out.skinIndex.setXYZW(at, part.joint, 0, 0, 0);
      out.skinWeight.setXYZW(at, 1, 0, 0, 0);
    }
  }
  const srcIndex = src.index;
  const indices = srcIndex ? srcIndex.count : count;
  for (let j = 0; j < indices; j++) out.index[indexBase + j] = vertexBase + (srcIndex ? srcIndex.getX(j) : j);
  return { vertices: count, indices };
}

/**
 * Merge every mesh under `armature` (a direct child of the glTF scene that
 * holds bones) into one skinned union. `sceneInverse` maps world space back
 * to the scene's own, where bind poses are expressed.
 */
export function mergeSkinnedArmature(
  armature: THREE.Object3D,
  sceneInverse: THREE.Matrix4,
  policy: BucketPolicy,
): SkinnedUnion {
  const { node, copies } = copyArmature(armature);
  const table = new JointTable(copies);
  const parts = collectParts(armature, sceneInverse, table, policy);
  // Skinned parts come first, so this is the first skinned primitive's.
  const bindMatrix = parts[0]?.skin ? parts[0].toBind.clone() : new THREE.Matrix4();
  const bindInverse = bindMatrix.clone().invert();

  // Lined buckets first, so the hull is one prefix of the index buffer.
  const byKey = new Map<string, Part[]>();
  for (const lined of [true, false]) {
    for (const part of parts) {
      if (part.key.endsWith(UNLINED_MARK) === lined) continue;
      const list = byKey.get(part.key) ?? [];
      list.push(part);
      byKey.set(part.key, list);
    }
  }

  const buffers = allocate(parts, table.bones.length);
  const bindBox = new THREE.Box3();
  const ranges: Array<{ key: string; material: THREE.MeshStandardMaterial; start: number; count: number }> = [];
  let vertexBase = 0;
  let indexBase = 0;
  let linedCount = 0;
  for (const [key, list] of byKey) {
    const start = indexBase;
    for (const part of list) {
      const written = writePart(part, buffers, vertexBase, indexBase, bindInverse, bindBox);
      vertexBase += written.vertices;
      indexBase += written.indices;
    }
    ranges.push({ key, material: list[0]!.material, start, count: indexBase - start });
    if (!key.endsWith(UNLINED_MARK)) linedCount = indexBase;
  }

  const index = new THREE.BufferAttribute(buffers.index, 1);
  const view = (start: number, count: number, withColor: boolean): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', buffers.position);
    geometry.setAttribute('normal', buffers.normal);
    geometry.setAttribute('skinIndex', buffers.skinIndex);
    geometry.setAttribute('skinWeight', buffers.skinWeight);
    if (withColor) geometry.setAttribute('color', buffers.color);
    geometry.setIndex(index);
    geometry.setDrawRange(start, count);
    return geometry;
  };

  return {
    armature: node,
    skeleton: new THREE.Skeleton(table.bones, table.inverses),
    bindMatrix,
    buckets: ranges.map(r => ({
      key: r.key, material: r.material, geometry: view(r.start, r.count, policy.vertexColoured(r.key.replace(UNLINED_MARK, ''))),
      lined: !r.key.endsWith(UNLINED_MARK),
    })),
    hull: view(0, linedCount, false),
    bindBox,
  };
}
