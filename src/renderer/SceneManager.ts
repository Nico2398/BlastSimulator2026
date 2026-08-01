// BlastSimulator2026 — Scene Manager
// Initializes and manages the Three.js rendering pipeline.
// Cartoon-style lighting: bright directional + ambient, minimal shadows.

import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { CameraController } from './CameraController.js';
import { PostPipeline } from './post/PostPipeline.js';

// Sky color for the default empty scene — cheerful daytime blue
const SKY_COLOR = 0x87ceeb;

// Camera initial position: elevated, looking down at the mine area
// Tutorial pit grid is 24×12×24 — camera stays close enough to see blast craters
const CAMERA_POSITION = new THREE.Vector3(12, 50, 60);
const CAMERA_TARGET = new THREE.Vector3(12, 0, 12);
const CAMERA_NEAR = 0.5;
const CAMERA_FAR = 4000;
const CAMERA_FOV = 55; // degrees — slightly narrow for cinematic feel

// Cartoon-style sunlight, from upper-right — retired as a plain
// DirectionalLight in favour of CSM's own cascaded lights (#458 T5.1/D11);
// kept as constants purely to derive CSM's lightDirection/lightIntensity.
const SUN_INTENSITY = 1.2;
const SUN_POSITION = new THREE.Vector3(100, 200, 80);

// Cascaded shadow maps (#458 A20)
const CSM_CASCADES = 3;
const CSM_MAX_FAR = 1200;
const CSM_SHADOW_MAP_SIZE = 2048;

// Ambient fill — prevents hard blacks in shadow areas (cartoon look)
const AMBIENT_INTENSITY = 0.55;
const AMBIENT_COLOR = 0xcce8ff; // cool sky bounce

// Softer fill from the opposite side (blue-sky bounce), weather-modulated
// by SkyboxWeather via the SunLightSource interface (#458 T5.1).
const FILL_COLOR = 0xd0e8ff;
const FILL_INTENSITY = 0.3;
const FILL_POSITION = new THREE.Vector3(-60, 80, -100);

/** Proxies SkyboxWeather's single-intensity writes across every CSM cascade light — "one truth" for what used to be `sun.intensity` (#458 T5.1/D11). */
class CSMSunLight {
  constructor(private readonly csm: CSM) {}

  get intensity(): number {
    return this.csm.lights[0]?.intensity ?? 0;
  }

  set intensity(value: number) {
    for (const light of this.csm.lights) light.intensity = value;
  }
}

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly cameraController: CameraController;
  readonly csm: CSM;
  readonly sunLight: CSMSunLight;
  readonly ambient: THREE.AmbientLight;
  readonly fill: THREE.DirectionalLight;
  readonly postPipeline: PostPipeline;

  private animFrameId = -1;
  private readonly resizeHandler: () => void;

  /** Number of frames rendered since start(). Exposed for diagnostics. */
  frameCount = 0;

  constructor(canvas: HTMLCanvasElement) {
    // --- Scene ---
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_COLOR);

    // --- Camera ---
    const aspect = canvas.clientWidth / canvas.clientHeight || 16 / 9;
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
    this.camera.position.copy(CAMERA_POSITION);
    this.camera.lookAt(CAMERA_TARGET);

    // --- Renderer ---
    // No `antialias: true` — useless behind a render target; SMAA runs on
    // the final composited output instead (#458 T5.1/D11).
    this.renderer = new THREE.WebGLRenderer({ canvas });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // ACES's curve is calibrated for scene radiance well above the existing
    // cartoon-lighting intensities (sun 1.2, ambient 0.55, fill 0.3) — at
    // exposure 1.0 those under-drive it, reading visibly black-crushed
    // (#458 T5.1 accept criterion). 1.8 keeps the same lights/materials but
    // brings the output back to a normally-exposed range; full recalibration
    // of every light/color is still the art pass's job (T8.1).
    this.renderer.toneMappingExposure = 1.8;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // --- Lighting ---
    this.ambient = new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY);
    this.scene.add(this.ambient);

    // Cascaded shadow maps replace the single sun DirectionalLight — same
    // direction the old light traveled (from SUN_POSITION toward the origin).
    const lightDirection = SUN_POSITION.clone().negate().normalize();
    this.csm = new CSM({
      maxFar: CSM_MAX_FAR,
      cascades: CSM_CASCADES,
      mode: 'practical',
      parent: this.scene,
      shadowMapSize: CSM_SHADOW_MAP_SIZE,
      lightDirection,
      lightIntensity: SUN_INTENSITY,
      camera: this.camera,
    });
    this.sunLight = new CSMSunLight(this.csm);

    this.fill = new THREE.DirectionalLight(FILL_COLOR, FILL_INTENSITY);
    this.fill.position.copy(FILL_POSITION);
    this.scene.add(this.fill);

    // --- Camera controller ---
    this.cameraController = new CameraController(this.camera, CAMERA_TARGET.clone(), canvas);

    // --- Post-processing composer ---
    this.postPipeline = new PostPipeline(this.renderer, this.scene, this.camera, canvas.clientWidth, canvas.clientHeight);

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
      // CSM reads the camera's world matrix — refresh it before update() in
      // case this frame's onUpdate moved the camera (#458 T5.1).
      this.camera.updateMatrixWorld();
      this.csm.update();
      this.postPipeline.aerial.update(this.camera);
      this.postPipeline.composer.render();
      // Force GPU to flush — ensures screenshot captures the latest frame
      const gl = this.renderer.getContext();
      if (gl) gl.finish();
      this.frameCount++;
    };
    loop();
  }

  /** Stop the render loop and release resources. */
  dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.resizeHandler);
    this.cameraController.dispose();
    this.csm.dispose();
    this.postPipeline.dispose();
    this.renderer.dispose();
  }

  private onResize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.postPipeline.setSize(w, h, pixelRatio);
  }
}
