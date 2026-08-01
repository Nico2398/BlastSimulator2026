// BlastSimulator2026 — Post-processing composer (#458 T5.1/D11/A20)
// RenderPass → GTAOPass → UnrealBloomPass → OutputPass → SMAAPass.
// Tonemapping and sRGB conversion happen in OutputPass, after bloom — AA
// runs last, on the final LDR output. The aerial-perspective pass (A21)
// slots in between GTAOPass and UnrealBloomPass once T5.2 builds it.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

// Low strength, high threshold — bloom should catch only the brightest
// highlights, not wash out the cartoon-flat terrain shading (#458 A20).
const BLOOM_STRENGTH = 0.25;
const BLOOM_RADIUS = 0.6;
const BLOOM_THRESHOLD = 0.9;

export class PostPipeline {
  readonly composer: EffectComposer;
  readonly gtao: GTAOPass;

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
    this.composer.addPass(this.gtao);

    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(bloom);

    this.composer.addPass(new OutputPass());

    const dpr = renderer.getPixelRatio();
    this.composer.addPass(new SMAAPass(width * dpr, height * dpr));
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
