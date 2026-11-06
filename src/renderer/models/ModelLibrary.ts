// BlastSimulator2026 — Model library
// Holds one prototype per model id and hands out instances that share
// geometry with it. Pure THREE, no I/O: the browser fills it through
// ModelLoader before a level loads, tests fill it from disk, and anything
// asked for before it is loaded gets a plain stand-in box so the scene never
// has a hole in it.

import * as THREE from 'three';
import { clone as cloneWithSkeletons } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { MaterialSetup } from './CartoonMaterial.js';
import { buildPrototype, HULL_KEY, TINT_KEY, type ModelPrototype } from './ModelMerge.js';

/** One rendered copy of a model: its scene object and the per-instance recolourable materials. */
export interface ModelInstance {
  root: THREE.Group;
  /** Recolourable materials by their Blender name (`TintRole`, `TintBody`…). */
  tints: ReadonlyMap<string, THREE.MeshToonMaterial>;
  /** Local-space bounds of the prototype (unscaled). */
  bounds: THREE.Box3;
  /** Whether this instance is the stand-in box, not a loaded asset. */
  isFallback: boolean;
  /**
   * Whether the model is posed through bones: `node()` then answers bone
   * names (`Head`, `ThighL`), each instance owns its skeleton, and picking
   * goes through an invisible `<id>.pick` box tagged `PICK_KEY`.
   */
  skinned: boolean;
  /** A named animatable node (`Head`, `ArmL`, `WheelFL`…) or bone, or null. */
  node(name: string): THREE.Object3D | null;
  /** Release per-instance materials. Shared geometry stays with the prototype. */
  dispose(): void;
}

interface FallbackSpec {
  /** Stand-in box size, in game units. */
  size: readonly [number, number, number];
  /** Tint material name the stand-in exposes, so callers can still recolour it. */
  tint?: string;
}

const FALLBACK_COLOR = 0x9aa0a6;

/** userData key on a skinned instance's pick proxy, so traversals that restyle meshes can skip it. */
export const PICK_KEY = 'pickProxy';

/** Never drawn, still raycast: three's Raycaster does not look at material visibility. */
const PICK_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });
PICK_MATERIAL.name = 'pick';

function noRaycast(): void {}

/**
 * Clone a skinned prototype so the copy owns its bones. SkeletonUtils gives
 * every cloned SkinnedMesh a skeleton of its own; rebinding each armature's
 * meshes onto one means its bone texture is computed and uploaded once a
 * frame, not once per surface. Returns the root and the skeletons it owns.
 */
function cloneSkinned(source: THREE.Group): { root: THREE.Group; skeletons: THREE.Skeleton[] } {
  const root = cloneWithSkeletons(source) as THREE.Group;
  const byRootBone = new Map<THREE.Bone, THREE.Skeleton>();
  root.traverse(obj => {
    if (!(obj instanceof THREE.SkinnedMesh)) return;
    // An own-property override is not copied by clone(), and raycasting a
    // SkinnedMesh skins every vertex on the CPU: the pick proxy answers instead.
    obj.raycast = noRaycast;
    const first = obj.skeleton.bones[0];
    if (!first) return;
    const shared = byRootBone.get(first);
    if (shared) obj.bind(shared, obj.bindMatrix);
    else {
      // Skeleton.clone() hands every copy the same boneInverses array; give
      // this instance its own, so recomputing one worker's inverses can never
      // rewrite every other worker's (and the prototype's) bind pose.
      obj.skeleton.boneInverses = obj.skeleton.boneInverses.map(m => m.clone());
      byRootBone.set(first, obj.skeleton);
    }
  });
  return { root, skeletons: [...byRootBone.values()] };
}

/** One pick box per bone, in that bone's own bind space: the box rides the bone through any pose. */
interface BonePickBox {
  bone: string;
  geometry: THREE.BufferGeometry;
}

/** Slack added round every pick box, metres — a worker is a small target from the game camera. */
const PICK_PAD = 0.02;

/**
 * Pick boxes for a skinned prototype: every vertex goes to the bone that
 * weighs on it most, and each bone gets the box, in its own bind-space frame,
 * of the vertices it owns.
 */
function bonePickBoxes(proto: ModelPrototype): BonePickBox[] {
  const boxes = new Map<string, THREE.Box3>();
  const v = new THREE.Vector3();
  proto.root.updateMatrixWorld(true);
  proto.root.traverse(obj => {
    if (!(obj instanceof THREE.SkinnedMesh) || obj.userData[HULL_KEY]) return;
    const pos = obj.geometry.getAttribute('position');
    const idx = obj.geometry.getAttribute('skinIndex');
    const wts = obj.geometry.getAttribute('skinWeight');
    const range = obj.geometry.drawRange;
    const index = obj.geometry.index;
    const seen = new Set<number>();
    const count = index ? Math.min(index.count, range.count) : Math.min(pos.count, range.count);
    for (let k = range.start; k < range.start + count; k++) {
      const i = index ? index.getX(k) : k;
      if (seen.has(i)) continue;
      seen.add(i);
      let best = 0;
      let bestW = -1;
      for (let c = 0; c < 4; c++) {
        const w = wts.getComponent(i, c);
        if (w > bestW) { bestW = w; best = idx.getComponent(i, c); }
      }
      const bone = obj.skeleton.bones[best];
      const inverse = obj.skeleton.boneInverses[best];
      if (!bone || !inverse) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.bindMatrix).applyMatrix4(inverse);
      const box = boxes.get(bone.name) ?? new THREE.Box3();
      box.expandByPoint(v);
      boxes.set(bone.name, box);
    }
  });
  return [...boxes].map(([bone, box]) => {
    box.expandByScalar(PICK_PAD);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    return { bone, geometry: new THREE.BoxGeometry(size.x, size.y, size.z).translate(centre.x, centre.y, centre.z) };
  });
}

/** A single-box prototype built through the same merge path as a real asset. */
function fallbackPrototype(spec: FallbackSpec): ModelPrototype {
  const [w, h, d] = spec.size;
  const scene = new THREE.Group();
  const node = new THREE.Group();
  node.name = 'Body';
  const material = new THREE.MeshStandardMaterial({ color: FALLBACK_COLOR });
  material.name = spec.tint ?? 'Painted';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.y = h / 2;
  node.add(mesh);
  scene.add(node);
  return buildPrototype(scene);
}

export class ModelLibrary {
  private readonly prototypes = new Map<string, ModelPrototype>();
  private readonly fallbacks = new Map<string, ModelPrototype>();
  /** Pick-proxy box per skinned prototype, shared by all its instances. */
  private readonly pickBoxes = new Map<ModelPrototype, BonePickBox[]>();
  private materialSetup: MaterialSetup | null = null;
  /** Bumped on every register(); a scene compares it to know when stand-ins can be swapped for real models. */
  revision = 0;

  /** Register (or replace) the prototype for `id`. */
  register(id: string, prototype: ModelPrototype): void {
    // Instances of a replaced prototype may still be drawn and picked, so its
    // pick box is forgotten here rather than disposed: a stray 12-triangle
    // buffer costs less than a live worker that can no longer be clicked.
    const replaced = this.prototypes.get(id);
    if (replaced) this.pickBoxes.delete(replaced);
    this.prototypes.set(id, prototype);
    if (this.materialSetup) this.applySetup(prototype.root, this.materialSetup);
    this.revision++;
  }

  has(id: string): boolean {
    return this.prototypes.has(id);
  }

  /**
   * The registered prototype itself, for consumers that draw a model
   * instanced (vegetation, scenery) and need its merged geometry rather
   * than a scene-graph clone. Null when the asset is not loaded.
   */
  prototype(id: string): ModelPrototype | null {
    return this.prototypes.get(id) ?? null;
  }

  /** Run the scene's material hook on a material this library did not create (an instanced copy's). */
  applyMaterialSetup(material: THREE.Material): (() => void) | undefined {
    return this.materialSetup?.(material) ?? undefined;
  }

  get size(): number {
    return this.prototypes.size;
  }

  /**
   * Hook applied to every toon material the library creates — the scene
   * attaches its cascaded-shadow shader here. Applied retroactively to
   * prototypes already registered, and to every material cloned later.
   */
  setMaterialSetup(setup: MaterialSetup | null): void {
    this.materialSetup = setup;
    if (!setup) return;
    for (const proto of this.prototypes.values()) this.applySetup(proto.root, setup);
    for (const proto of this.fallbacks.values()) this.applySetup(proto.root, setup);
  }

  /** Clone `id` for the scene; a stand-in box of `fallback.size` when the asset is not loaded. */
  instantiate(id: string, fallback: FallbackSpec): ModelInstance {
    const proto = this.prototypes.get(id);
    const isFallback = !proto;
    const source = proto ?? this.fallbackFor(id, fallback);
    const { root, skeletons } = source.skinned
      ? cloneSkinned(source.root)
      : { root: source.root.clone(true), skeletons: [] };
    root.name = id;
    const tints = new Map<string, THREE.MeshToonMaterial>();
    const teardowns: Array<() => void> = [];
    root.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      const tintName = obj.userData[TINT_KEY] as string | undefined;
      if (!tintName) return;
      let material = tints.get(tintName);
      if (!material) {
        // A clone keeps the colour but not the setup hook's defines/uniforms,
        // so the hook runs again on it — and its teardown runs on dispose.
        material = (obj.material as THREE.MeshToonMaterial).clone();
        const teardown = this.materialSetup?.(material);
        if (teardown) teardowns.push(teardown);
        tints.set(tintName, material);
      }
      obj.material = material;
    });
    if (source.skinned) this.attachPickProxies(id, source, root);
    return {
      root,
      tints,
      bounds: source.bounds,
      isFallback,
      skinned: source.skinned,
      node: (name) => root.getObjectByName(name) ?? null,
      dispose: () => {
        for (const t of teardowns) t();
        for (const m of tints.values()) m.dispose();
        for (const s of skeletons) s.dispose();
      },
    };
  }

  /** Drop every prototype and dispose its geometry and materials. */
  clear(): void {
    for (const proto of [...this.prototypes.values(), ...this.fallbacks.values()]) {
      proto.root.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
        if (obj instanceof THREE.SkinnedMesh) obj.skeleton.dispose();
      });
    }
    for (const boxes of this.pickBoxes.values()) for (const b of boxes) b.geometry.dispose();
    this.pickBoxes.clear();
    this.prototypes.clear();
    this.fallbacks.clear();
    this.revision++;
  }

  /**
   * Invisible boxes a raycast hits in place of the skinned surfaces, one per
   * bone and parented to it, so ScenePicking lands on a worker in whatever
   * pose he is in — standing, bent over a job, or flat on his back.
   */
  private attachPickProxies(id: string, proto: ModelPrototype, root: THREE.Group): void {
    let boxes = this.pickBoxes.get(proto);
    if (!boxes) {
      boxes = bonePickBoxes(proto);
      this.pickBoxes.set(proto, boxes);
    }
    for (const { bone, geometry } of boxes) {
      const target = root.getObjectByName(bone);
      if (!target) continue;
      const proxy = new THREE.Mesh(geometry, PICK_MATERIAL);
      proxy.name = `${id}.pick.${bone}`;
      proxy.userData[PICK_KEY] = true;
      proxy.castShadow = false;
      proxy.receiveShadow = false;
      target.add(proxy);
    }
  }

  private fallbackFor(id: string, spec: FallbackSpec): ModelPrototype {
    let proto = this.fallbacks.get(id);
    if (!proto) {
      proto = fallbackPrototype(spec);
      if (this.materialSetup) this.applySetup(proto.root, this.materialSetup);
      this.fallbacks.set(id, proto);
    }
    return proto;
  }

  private applySetup(root: THREE.Object3D, setup: MaterialSetup): void {
    root.traverse(obj => {
      if (obj instanceof THREE.Mesh && !obj.userData[HULL_KEY]) setup(obj.material as THREE.Material);
    });
  }
}

/** The library the game renderer's mesh factories draw from by default. */
export const modelLibrary = new ModelLibrary();
