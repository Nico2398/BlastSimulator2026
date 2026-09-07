// BlastSimulator2026 — Instanced drawing of a library prototype
// Trees, bushes, rocks and houses are drawn hundreds of times per level, so
// they go through InstancedMesh rather than scene-graph clones: one
// InstancedMesh per surface of the prototype's single node plus one for its
// outline hull, all sharing a single instance-matrix buffer. Materials get
// the scene's cascaded-shadow hook through the library and, for vegetation,
// the wind sway both on the surface and on the outline.

import * as THREE from 'three';
import { createOutlineMaterial, SWAY_VERTEX_GLSL, type SwayOptions } from './CartoonMaterial.js';
import type { ModelLibrary } from './ModelLibrary.js';
import { HULL_KEY, TINT_KEY, type ModelPrototype } from './ModelMerge.js';

export interface InstancedPropOptions {
  /** Instances to allocate; set every matrix, then commit(). */
  count: number;
  /** Object name of the surface meshes (the hull gets `<name>-outline`). */
  name: string;
  /** Wind sway shared by surfaces and hull. */
  sway?: SwayOptions;
  /** Colour applied to the prototype's `Tint*` surfaces (rocks per biome). */
  tint?: THREE.Color;
  /** Draw the outline hull (default true); a distant LOD skips it — sub-pixel lines only darken. */
  outline?: boolean;
}

/** Splice the sway into a built-in material's vertex shader, after whatever hook (CSM) is already there. */
function attachSway(material: THREE.Material, sway: SwayOptions): void {
  const inner = material.onBeforeCompile;
  const innerKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    inner.call(material, shader, renderer);
    shader.uniforms['uTime'] = sway.uTime;
    shader.uniforms['uWind'] = sway.uWind;
    shader.uniforms['uCanopyHeight'] = { value: sway.canopyHeight };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uCanopyHeight;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n#ifdef USE_INSTANCING\nfloat instanceWorldX = instanceMatrix[3].x;\n#else\nfloat instanceWorldX = 0.0;\n#endif\n'
          + SWAY_VERTEX_GLSL,
      );
  };
  material.customProgramCacheKey = () => `${innerKey()}|sway-${sway.canopyHeight}`;
}

export class InstancedProp {
  readonly meshes: THREE.InstancedMesh[] = [];
  /** One buffer for every mesh of the prop — set a matrix once, every surface and the hull follow. */
  readonly instanceMatrix: THREE.InstancedBufferAttribute;
  private readonly teardowns: Array<() => void> = [];

  constructor(prototype: ModelPrototype, library: ModelLibrary, options: InstancedPropOptions) {
    this.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(options.count * 16), 16);
    this.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    prototype.root.updateMatrixWorld(true);
    prototype.root.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      const isHull = obj.userData[HULL_KEY] === true;
      if (isHull && options.outline === false) return;
      let material: THREE.Material;
      if (isHull) {
        material = createOutlineMaterial(options.sway);
      } else {
        const toon = (obj.material as THREE.MeshToonMaterial).clone();
        if (options.tint && obj.userData[TINT_KEY]) toon.color.copy(options.tint);
        const teardown = library.applyMaterialSetup(toon);
        if (teardown) this.teardowns.push(teardown);
        if (options.sway) attachSway(toon, options.sway);
        material = toon;
      }
      // The prototype's node transform is baked into each instance matrix
      // by the caller; props are single-node with an identity node, so the
      // mesh's own local matrix is what the geometry needs.
      const mesh = new THREE.InstancedMesh(obj.geometry, material, options.count);
      mesh.instanceMatrix = this.instanceMatrix;
      mesh.name = isHull ? `${options.name}-outline` : options.name;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      if (isHull) mesh.raycast = () => {};
      this.meshes.push(mesh);
    });
  }

  get count(): number {
    return this.meshes[0]?.count ?? 0;
  }

  setMatrixAt(index: number, matrix: THREE.Matrix4): void {
    matrix.toArray(this.instanceMatrix.array as Float32Array, index * 16);
  }

  /** Upload the matrices written so far. */
  commit(): void {
    this.instanceMatrix.needsUpdate = true;
  }

  addTo(scene: THREE.Object3D): void {
    for (const mesh of this.meshes) scene.add(mesh);
  }

  /** Remove from `scene` and release per-prop materials; geometry stays with the prototype. */
  dispose(scene: THREE.Object3D): void {
    for (const mesh of this.meshes) {
      scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    for (const t of this.teardowns) t();
    this.teardowns.length = 0;
  }
}
