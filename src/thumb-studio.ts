// BlastSimulator2026 — Thumbnail studio (dev page, #2241)
// Renders one model asset onto a transparent square through the game's own
// toon materials, inked outlines and role tints, and hands it back as a WebP
// data URL. Served by Vite as /thumbs.html; driven by
// scripts/render-thumbnails.ts, which writes the results to public/thumbs/.
// Not part of the production build.

import * as THREE from 'three';
import { modelLibrary } from './renderer/models/ModelLibrary.js';
import { fetchModelBytes, preloadModels } from './renderer/models/ModelLoader.js';
import { OUTLINE_UNIFORMS } from './renderer/models/CartoonMaterial.js';
import { GARMENT_COLORS, GARMENT_TINT, HAIR_TINT, ROLE_COLORS, ROLE_TINT, SKIN_TINT } from './renderer/CharacterMesh.js';
import { THUMB_SIZE_PX, thumbnailShots, type ThumbShot } from './renderer/models/Thumbnails.js';

declare global {
  interface Window {
    /** Render one shot by id; resolves to a `data:image/webp` URL, or null when the asset failed to load. */
    __renderThumb?: (id: string) => Promise<string | null>;
    /** Every shot id the studio knows, in catalogue order. */
    __thumbIds?: string[];
  }
}

/** A warm, mid skin and a dark hair that read at thumbnail size, for every role's portrait. */
const PORTRAIT_SKIN = 0xeab98e;
const PORTRAIT_HAIR = 0x4a2f1f;
/** WebP quality: flat toon colour compresses well, so a high setting costs little. */
const WEBP_QUALITY = 0.9;
const FOV_DEG = 30;

const canvas = document.getElementById('thumb-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(THUMB_SIZE_PX, THUMB_SIZE_PX, false);
renderer.setClearColor(0x000000, 0);
// Same response curve as the game scene (SceneManager), so a portrait matches the model on the terrain.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
OUTLINE_UNIFORMS.viewportHeight.value = THUMB_SIZE_PX;

const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xcce8ff, 0.7));
const key = new THREE.DirectionalLight(0xfff4e0, 1.5);
key.position.set(60, 120, 90);
scene.add(key);
const fill = new THREE.DirectionalLight(0xd0e8ff, 0.45);
fill.position.set(-80, 40, -60);
scene.add(fill);
const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 500);

const shots = new Map(thumbnailShots().map(s => [s.id, s]));
window.__thumbIds = [...shots.keys()];

function tintWorker(tints: ReadonlyMap<string, THREE.MeshToonMaterial>, shot: ThumbShot): void {
  if (!shot.role) return;
  tints.get(ROLE_TINT)?.color.setHex(ROLE_COLORS[shot.role]);
  tints.get(GARMENT_TINT)?.color.setHex(GARMENT_COLORS[shot.role]);
  tints.get(SKIN_TINT)?.color.setHex(PORTRAIT_SKIN);
  tints.get(HAIR_TINT)?.color.setHex(PORTRAIT_HAIR);
}

/** Aim at `focusY` of the model's height and back off until its bounding sphere fills the frame, divided by `zoom`. */
function frame(bounds: THREE.Box3, shot: ThumbShot): void {
  const size = bounds.getSize(new THREE.Vector3());
  const target = bounds.getCenter(new THREE.Vector3());
  target.y = bounds.min.y + size.y * shot.focusY;
  const radius = size.length() / 2;
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(FOV_DEG / 2)) / shot.zoom;
  const yaw = THREE.MathUtils.degToRad(shot.yaw);
  const pitch = THREE.MathUtils.degToRad(shot.pitch);
  camera.position.set(
    target.x + distance * Math.cos(pitch) * Math.cos(yaw),
    target.y + distance * Math.sin(pitch),
    target.z + distance * Math.cos(pitch) * Math.sin(yaw),
  );
  camera.near = distance / 50;
  camera.far = distance * 4;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
}

async function renderThumb(id: string): Promise<string | null> {
  const shot = shots.get(id);
  if (!shot) return null;
  const result = await preloadModels(modelLibrary, fetchModelBytes, { ids: [id] });
  if (result.failed.length > 0) return null;
  const instance = modelLibrary.instantiate(id, { size: [1, 1, 1] });
  tintWorker(instance.tints, shot);
  scene.add(instance.root);
  instance.root.updateMatrixWorld(true);
  frame(new THREE.Box3().setFromObject(instance.root), shot);
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/webp', WEBP_QUALITY);
  scene.remove(instance.root);
  instance.dispose();
  return url;
}

window.__renderThumb = renderThumb;
