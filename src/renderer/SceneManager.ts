// BlastSimulator2026 — Scene Manager
// Initializes and manages the Three.js rendering pipeline.
// Cartoon-style lighting: bright directional + ambient, minimal shadows.

import * as THREE from 'three';
import { CameraController } from './CameraController.js';

// Sky color for the default empty scene — cheerful daytime blue
const SKY_COLOR = 0x87ceeb;

// Camera initial position: elevated, looking down at the mine area
// Mine grid is ~100x100 units; camera pulls back to see the whole site
const CAMERA_POSITION = new THREE.Vector3(50, 120, 180);
const CAMERA_TARGET = new THREE.Vector3(50, 0, 50);
const CAMERA_NEAR = 0.5;
const CAMERA_FAR = 4000;
const CAMERA_FOV = 55; // degrees — slightly narrow for cinematic feel

// Cartoon-style directional light — warm sunlight from upper-right
const SUN_INTENSITY = 1.2;
const SUN_COLOR = 0xfffde7; // warm white
const SUN_POSITION = new THREE.Vector3(100, 200, 80);

// Ambient fill — prevents hard blacks in shadow areas (cartoon look)
const AMBIENT_INTENSITY = 0.55;
const AMBIENT_COLOR = 0xcce8ff; // cool sky bounce

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly cameraController: CameraController;
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.AmbientLight;

  private animFrameId = -1;
  private readonly resizeHandler: () => void;

  constructor(canvas: HTMLCanvasElement) {
    // --- Scene ---
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_COLOR);

    // Mild fog to hide far-clip pop-in
    this.scene.fog = new THREE.Fog(SKY_COLOR, 800, 3000);

    // --- Camera ---
    const aspect = canvas.clientWidth / canvas.clientHeight || 16 / 9;
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
    this.camera.position.copy(CAMERA_POSITION);
    this.camera.lookAt(CAMERA_TARGET);

    // --- Renderer ---
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // --- Lighting ---
    this.ambient = new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    this.sun.position.copy(SUN_POSITION);
    this.scene.add(this.sun);

    // Softer fill from the opposite side (blue-sky bounce)
    const fill = new THREE.DirectionalLight(0xd0e8ff, 0.3);
    fill.position.set(-60, 80, -100);
    this.scene.add(fill);

    // --- Camera controller ---
    this.cameraController = new CameraController(this.camera, CAMERA_TARGET.clone(), canvas);

    // --- Resize handler ---
    this.resizeHandler = () => this.onResize();
    window.addEventListener('resize', this.resizeHandler);
  }

  /** Start the 60fps render loop. Optional onUpdate callback fires each frame with delta-time. */
  start(onUpdate?: (dt: number) => void): void {
    let lastTime = performance.now();
    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
      lastTime = now;
      if (onUpdate) onUpdate(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  /** Stop the render loop and release resources. */
  dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.resizeHandler);
    this.cameraController.dispose();
    this.renderer.dispose();
  }

  private onResize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
}
