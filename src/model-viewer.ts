// BlastSimulator2026 — Model viewer (dev page)
// Renders a single model asset through the real SceneManager (same lights,
// cascaded shadows, tone mapping and post pipeline as the game) so a model
// can be judged as the player will see it, without loading a level.
// Served by Vite as /model-viewer.html; screenshotted by scripts/model-preview.ts.

import * as THREE from 'three';
import { SceneManager } from './renderer/SceneManager.js';
import { modelLibrary } from './renderer/models/ModelLibrary.js';
import { fetchModelBytes, preloadModels } from './renderer/models/ModelLoader.js';
import { createToonMaterial } from './renderer/models/CartoonMaterial.js';

declare global {
  interface Window {
    /** True once the model is on screen; false when its asset failed to load. */
    __viewerReady?: boolean;
  }
}

/** Models are scaled so their largest extent fills this many metres — the camera cannot get closer than 5 m. */
const FRAME_EXTENT = 8;

const params = new URLSearchParams(window.location.search);
const modelId = params.get('model') ?? 'worker_driller';
const yaw = Number(params.get('yaw') ?? '35');
const pitch = Number(params.get('pitch') ?? '20');
const zoom = Number(params.get('zoom') ?? '1');

const canvas = document.getElementById('viewer-canvas') as HTMLCanvasElement;
const sm = new SceneManager(canvas);

// Ground: a sandy disc that receives the model's shadow.
const groundMaterial = createToonMaterial({ color: new THREE.Color(0xd2b784) });
sm.csm.setupMaterial(groundMaterial);
const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
sm.scene.add(ground);

modelLibrary.setMaterialSetup(m => {
  sm.csm.setupMaterial(m);
  return () => { sm.csm.shaders.delete(m); };
});

async function show(): Promise<void> {
  const result = await preloadModels(modelLibrary, fetchModelBytes, { ids: [modelId] });
  const instance = modelLibrary.instantiate(modelId, { size: [1, 1, 1] });
  const size = instance.bounds.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z) || 1;
  const scale = FRAME_EXTENT / extent;
  instance.root.scale.setScalar(scale);
  sm.scene.add(instance.root);

  const center = instance.bounds.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  sm.cameraController.focus(center.x, center.y, center.z, (FRAME_EXTENT * 1.35) / zoom);
  sm.cameraController.setOrbit(yaw, pitch);
  window.__viewerReady = result.failed.length === 0;
}

sm.start();
void show();
