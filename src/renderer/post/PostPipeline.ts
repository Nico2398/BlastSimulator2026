// BlastSimulator2026 — Post-processing composer (#458 T5.1/T5.2/D11/A20)
// RenderPass → GTAOPass → AerialPerspectivePass → UnrealBloomPass →
// OutputPass → SMAAPass. Tonemapping and sRGB conversion happen in
// OutputPass, after bloom — AA runs last, on the final LDR output. Aerial
// perspective sits before bloom/tonemapping so it works in linear HDR-ish
// space (A21).

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { AerialPerspectivePass } from './AerialPerspectivePass.js';

// Low strength, high threshold — bloom should catch only the brightest
// highlights, not wash out the cartoon-flat terrain shading (#458 A20).
const BLOOM_STRENGTH = 0.25;
const BLOOM_RADIUS = 0.6;
const BLOOM_THRESHOLD = 0.9;

export class PostPipeline {
  readonly composer: EffectComposer;
  readonly gtao: GTAOPass;
  readonly aerial: AerialPerspectivePass;

  /**
   * Objects hidden while GTAO renders its depth/normal prepass.
   *
   * That prepass draws the whole scene with an override material, so
   * depthWrite:false on a transparent overlay does not keep it out — it lands
   * in the depth buffer like solid geometry. Everything behind it is then
   * treated as occluded and shaded black, and the aerial pass, which
   * reconstructs world position from the same depth texture, hazes it as if
   * the overlay were the surface. A see-through effect has no business in
   * either, so overlays are simply not present while that pass runs.
   */
  private readonly overlayObjects: THREE.Object3D[] = [];

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.gtao = new GTAOPass(scene, camera, width, height);
    const renderGtao = this.gtao.render.bind(this.gtao);
    this.gtao.render = ((...args: Parameters<GTAOPass['render']>) => {
      const wasVisible = this.overlayObjects.map((o) => o.visible);
      for (const o of this.overlayObjects) o.visible = false;
      try {
        renderGtao(...args);
      } finally {
        this.overlayObjects.forEach((o, i) => { o.visible = wasVisible[i]!; });
      }
    }) as GTAOPass['render'];
    this.composer.addPass(this.gtao);

    // AerialPerspectivePass needs a per-pixel depth texture to reconstruct
    // world position (#458 T5.2/A21). It reuses GTAOPass's own depthTexture
    // rather than attaching one to the composer's own renderTarget1/2:
    // those two buffers ping-pong as passes' write/read targets, and
    // RenderPass.render() writes into whichever one is passed as its
    // `readBuffer` argument — so a depthTexture attached to either of them
    // eventually collides with a later pass's *write* target on the same
    // frame (sampling a texture that's also the currently-bound
    // framebuffer's depth attachment: a WebGL "feedback loop" error,
    // verified by inspecting the actual GL warnings this produced,
    // corrupting AerialPerspectivePass's output to solid black). GTAOPass
    // avoids exactly this by rendering its own depth into a dedicated
    // `normalRenderTarget`, entirely outside the composer's ping-pong chain
    // (confirmed by reading GTAOPass.js) — reusing its `depthTexture` field
    // sidesteps the whole hazard instead of re-deriving a broken variant of
    // the same fix.
    this.aerial = new AerialPerspectivePass(this.gtao.depthTexture);
    this.composer.addPass(this.aerial);

    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(bloom);

    this.composer.addPass(new OutputPass());

    const dpr = renderer.getPixelRatio();
    this.composer.addPass(new SMAAPass(width * dpr, height * dpr));
  }

  /** Keep `object` out of the GTAO depth/normal prepass — see `overlayObjects`. */
  addOverlayObject(object: THREE.Object3D): void {
    if (!this.overlayObjects.includes(object)) this.overlayObjects.push(object);
  }

  removeOverlayObject(object: THREE.Object3D): void {
    const i = this.overlayObjects.indexOf(object);
    if (i >= 0) this.overlayObjects.splice(i, 1);
  }

  /**
   * `EffectComposer.setSize()` already iterates every pass (including GTAO
   * and SMAA) and re-derives device-pixel dimensions from `width * height *
   * pixelRatio` internally — no need to size each pass separately.
   */
  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
