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
 */
export function warmupShaders(
  renderer: Pick<THREE.WebGLRenderer, 'compile' | 'getRenderTarget' | 'setRenderTarget'>,
  camera: THREE.Camera,
  scene: THREE.Scene,
  materials: readonly THREE.Material[],
  target: THREE.WebGLRenderTarget | null,
): void {
  if (materials.length === 0) return;
  // A holder of throwaway meshes, never added to `scene`: compile() takes the
  // lights from `scene` and the materials from the holder.
  const holder = new THREE.Scene();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  for (const material of materials) holder.add(new THREE.Mesh(geometry, material));
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  try {
    renderer.compile(holder, camera, scene);
  } finally {
    renderer.setRenderTarget(previous);
    geometry.dispose();
  }
}
