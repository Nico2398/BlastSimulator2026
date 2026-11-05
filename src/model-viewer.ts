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
import { WorkerAnimator, type WorkerSignals } from './renderer/character/WorkerAnimator.js';
import { workerRig } from './renderer/character/WorkerRig.js';

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
/** Height to aim at, as a fraction of the model's height (default: its centre) — 0.85 frames a worker's face. */
const focusY = params.has('fy') ? Number(params.get('fy')) : null;

/**
 * Worker models only: the motion to pose (`walk`, `run`, `idle`, `work`, `tired`,
 * `panic`, `collapse`; absent = bind pose), how many seconds of it to simulate
 * before the frame freezes, and the signals behind it.
 */
const pose = params.get('pose');
const poseTime = Number(params.get('t') ?? '1.5');
const poseSpeed = params.has('speed') ? Number(params.get('speed')) : null;
const poseSeed = Number(params.get('seed') ?? '1');
/** Simulation step for a posed capture — fixed, so a capture is reproducible. */
const POSE_STEP_S = 1 / 60;

function signalsFor(motion: string): WorkerSignals {
  const base: WorkerSignals = { speed: 0, turn: 0, working: false, collapsing: false, evacuating: false, injured: false, fatigue: 90 };
  switch (motion) {
    case 'walk': return { ...base, speed: poseSpeed ?? 2 };
    case 'run': return { ...base, speed: poseSpeed ?? 4.8 };
    case 'panic': return { ...base, speed: poseSpeed ?? 4, evacuating: true };
    case 'limp': return { ...base, speed: poseSpeed ?? 1.6, injured: true };
    case 'work': return { ...base, working: true };
    case 'tired': return { ...base, fatigue: 4, speed: poseSpeed ?? 0 };
    case 'collapse': return { ...base, collapsing: true, fatigue: 0 };
    default: return base;
  }
}

/** Simulate `seconds` of `motion` on a worker instance, so the capture shows that moment. */
function poseWorker(root: THREE.Object3D, role: string, motion: string, seconds: number): void {
  const rig = workerRig(root);
  if (!rig) return;
  const animator = new WorkerAnimator(rig, role, poseSeed);
  const signals = signalsFor(motion);
  for (let t = 0; t < seconds; t += POSE_STEP_S) animator.update(POSE_STEP_S, signals);
}

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
  if (pose && modelId.startsWith('worker_')) poseWorker(instance.root, modelId.slice('worker_'.length), pose, poseTime);

  const center = instance.bounds.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  if (focusY !== null) center.y = (instance.bounds.min.y + size.y * focusY) * scale;
  sm.cameraController.focus(center.x, center.y, center.z, (FRAME_EXTENT * 1.35) / zoom);
  sm.cameraController.setOrbit(yaw, pitch);
  window.__viewerReady = result.failed.length === 0;
}

sm.start();
void show();
