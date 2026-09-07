// BlastSimulator2026 — Model library
// Holds one prototype per model id and hands out instances that share
// geometry with it. Pure THREE, no I/O: the browser fills it through
// ModelLoader before a level loads, tests fill it from disk, and anything
// asked for before it is loaded gets a plain stand-in box so the scene never
// has a hole in it.

import * as THREE from 'three';
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
  /** A named animatable node (`Head`, `ArmL`, `WheelFL`…), or null. */
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
  private materialSetup: MaterialSetup | null = null;
  /** Bumped on every register(); a scene compares it to know when stand-ins can be swapped for real models. */
  revision = 0;

  /** Register (or replace) the prototype for `id`. */
  register(id: string, prototype: ModelPrototype): void {
    this.prototypes.set(id, prototype);
    if (this.materialSetup) this.applySetup(prototype.root, this.materialSetup);
    this.revision++;
  }

  has(id: string): boolean {
    return this.prototypes.has(id);
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
    const root = source.root.clone(true);
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
    return {
      root,
      tints,
      bounds: source.bounds,
      isFallback,
      node: (name) => root.getObjectByName(name) ?? null,
      dispose: () => {
        for (const t of teardowns) t();
        for (const m of tints.values()) m.dispose();
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
      });
    }
    this.prototypes.clear();
    this.fallbacks.clear();
    this.revision++;
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
