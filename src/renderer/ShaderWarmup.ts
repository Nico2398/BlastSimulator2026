// BlastSimulator2026 — Shader warmup (#1603)
// Compiles materials that only appear mid-game while the level loads, so the
// frame that first shows them does not stall on the driver compiling them.
//
// three.js compiles a material's shader program the first time an object
// wearing it is drawn, and caches the program by the material's parameters
// plus the scene's lights. A material held back until gameplay needs it (a
// ghost order appearing after a blast) therefore compiles mid-frame — tens of
// milliseconds on a GPU, seconds without one. Compiling it here, against the
// live scene's lights, puts the program in the cache before anyone looks.

import * as THREE from 'three';

/**
 * Compile `materials` for `scene` as it stands now — its lights, fog and
 * shadows — drawn into `target`, the render target the scene is really drawn
 * into: whether a program writes to a render target or to the canvas changes
 * its output colour space and tone mapping, so a program compiled for the
 * wrong one is a different program. Call once the scene's lights are final:
 * a light added afterwards changes every lit program and voids the warmup.
 * `instancedMaterials` are compiled again as an InstancedMesh draws them —
 * instancing is a program variant of its own — and `skinnedMaterials` as a
 * SkinnedMesh draws them (the worker crew), skinning being another.
 */
export function warmupShaders(
  renderer: Pick<THREE.WebGLRenderer, 'compile' | 'getRenderTarget' | 'setRenderTarget'>,
  camera: THREE.Camera,
  scene: THREE.Scene,
  materials: readonly THREE.Material[],
  target: THREE.WebGLRenderTarget | null,
  instancedMaterials: readonly THREE.Material[] = [],
  skinnedMaterials: readonly THREE.Material[] = [],
): void {
  if (materials.length === 0 && instancedMaterials.length === 0 && skinnedMaterials.length === 0) return;
  // A holder of throwaway meshes, never added to `scene`: compile() takes the
  // lights from `scene` and the materials from the holder.
  const holder = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  for (const material of materials) holder.add(new THREE.Mesh(geometry, material));
  for (const material of instancedMaterials) holder.add(new THREE.InstancedMesh(geometry, material, 1));
  const skinned = skinnedMaterials.length ? skinnedHolderGeometry(geometry) : null;
  if (skinned) {
    const bone = new THREE.Bone();
    const skeleton = new THREE.Skeleton([bone]);
    holder.add(bone);
    for (const material of skinnedMaterials) {
      const mesh = new THREE.SkinnedMesh(skinned, material);
      mesh.bind(skeleton, new THREE.Matrix4());
      holder.add(mesh);
    }
  }
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  try {
    renderer.compile(holder, camera, scene);
  } finally {
    renderer.setRenderTarget(previous);
    geometry.dispose();
    skinned?.dispose();
  }
}

/** `geometry` with every vertex bound wholly to joint 0 — enough for three to pick the skinning program. */
function skinnedHolderGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geometry.clone();
  const n = g.getAttribute('position').count;
  const weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) weights[i * 4] = 1;
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  return g;
}

/** Every material a skinned prototype in `roots` draws with — surfaces and outline hulls alike — once each. */
export function skinnedMaterialsOf(roots: readonly THREE.Object3D[]): THREE.Material[] {
  const out = new Set<THREE.Material>();
  for (const root of roots) {
    root.traverse(obj => {
      if (!(obj instanceof THREE.SkinnedMesh)) return;
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) out.add(m);
    });
  }
  return [...out];
}
