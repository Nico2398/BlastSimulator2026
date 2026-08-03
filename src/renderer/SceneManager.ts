// BlastSimulator2026 — Scene Manager
// Initializes and manages the Three.js rendering pipeline.
// Cartoon-style lighting: bright directional + ambient, minimal shadows.

import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { CameraController } from './CameraController.js';
import { PostPipeline } from './post/PostPipeline.js';

// Sky color for the default empty scene — cheerful daytime blue
const SKY_COLOR = 0x87ceeb;

// Camera initial position: an origin-centred placeholder for the brief window
// before any game loads. Every level size (#458 T6.1/D13) immediately
// replaces this via GameRenderer.frameCameraOnGrid()'s frame-on-grid call —
// no size-specific tuning belongs here.
const CAMERA_POSITION = new THREE.Vector3(0, 50, 80);
const CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
const CAMERA_NEAR = 0.5;
// 6000 clears the largest campaign level (160×160 grid + 1600m-half
// landscape extent) with room to spare; the aerial-perspective pass hides
// the far clip in haze rather than a hard pop (#458 T6.1/D13).
const CAMERA_FAR = 6000;
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
/**
 * How far, in metres, a surface is pushed along its own normal before being
 * tested against the shadow map. CSM leaves this at zero.
 *
 * Deliberately small. The terrain used to rule itself with fine acne lines at
 * its 1 m lattice spacing, and the first fix was to grow these biases until
 * the lines faded — which only "worked" by pushing the whole depth comparison
 * so far that contact shadows died with the acne. The real fix is structural:
 * the terrain material renders its shadow map from back faces
 * (TerrainMesh.ts), so a surface can never fail a depth test against itself,
 * and the bias only has to cover sampling noise.
 */
const CSM_NORMAL_BIAS = 0.15;
/** Depth-space nudge toward the light; tiny, for the same reason as above. */
const CSM_SHADOW_BIAS = -0.00005;

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
  /** False while a harness has suspended drawing — see `setDrawingEnabled`. */
  private drawingEnabled = true;

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
    // T5.1 set this to 1.8 purely to clear ACES's black-crush floor, deferring
    // real calibration to this task (T8.1). 1.8 turned out to overshoot: every
    // biome read pale and flat regardless of palette (screenshots, T8.1 art
    // pass) — ACES's shoulder was compressing everything into the same washed
    // highlight range. 1.3 keeps mid-tones comfortably above the 1.0
    // black-crush floor while leaving the curve's shoulder room to hold colour
    // and contrast.
    this.renderer.toneMappingExposure = 1.3;
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
    // Each cascade covers a larger slice of the view at the same map size, so
    // a texel is wider further out and needs a proportionally larger offset.
    this.csm.shadowBias = CSM_SHADOW_BIAS;
    this.csm.lights.forEach((light, i) => {
      light.shadow.normalBias = CSM_NORMAL_BIAS * (i + 1);
      light.shadow.bias = CSM_SHADOW_BIAS;
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
      if (this.drawingEnabled) this.drawFrame();
      // Counts frames the loop served, drawn or not, so a harness that waits
      // on rAF sees this advance whether or not drawing is suspended.
      this.frameCount++;
    };
    loop();
  }

  /**
   * Draw one frame. Split out of the loop so a suspended run can still force
   * a frame for a screenshot — see `setDrawingEnabled`.
   */
  private drawFrame(): void {
    // CSM reads the camera's world matrix — refresh it before update() in
    // case this frame's onUpdate moved the camera (#458 T5.1).
    this.camera.updateMatrixWorld();
    this.csm.update();
    this.postPipeline.aerial.update(this.camera);
    this.postPipeline.composer.render();
    // Force GPU to flush — ensures screenshot captures the latest frame
    const gl = this.renderer.getContext();
    if (gl) gl.finish();
  }

  /**
   * Suspend or resume drawing. The loop keeps running either way: `onUpdate`
   * still fires, rAF still resolves, the simulation still ticks — only the
   * draw is skipped.
   *
   * This exists for the browser-driven harnesses (#475). They read the DOM
   * and `__gameState`, and need pixels only when capturing a screenshot, but
   * every CDP call they make waits on the main thread. With the terrain
   * material costing seconds per frame under software rasterisation, that
   * wait is the whole cost of those suites — the game's own tick is under 2%
   * of a frame. Suspending the draw and forcing one via `renderFrame` at each
   * capture keeps the images identical and stops the harness paying for
   * frames nobody looks at.
   */
  setDrawingEnabled(enabled: boolean): void {
    this.drawingEnabled = enabled;
  }

  /** Whether the loop is currently drawing. */
  get isDrawingEnabled(): boolean {
    return this.drawingEnabled;
  }

  /** Draw exactly one frame, even while drawing is suspended. */
  renderFrame(): void {
    this.drawFrame();
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
