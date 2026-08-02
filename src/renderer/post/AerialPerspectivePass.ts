// BlastSimulator2026 — Aerial perspective + per-biome grade pass (#458 T5.2/D11/A21)
// Full-screen pass reading depth to desaturate/haze distant, low-lying
// terrain (thicker in valleys, thinner on peaks), then applies a per-biome
// lift/gamma/gain grade. Replaces THREE.Fog (removed in T5.1) — sits between
// GTAOPass and UnrealBloomPass in the composer, working in linear HDR-ish
// space before tonemapping (A20).

import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Haze thickens with proximity to the ground; literal from A21. */
const DENSITY = 0.0016;
/**
 * How fast haze thins with altitude.
 *
 * A21's 60m made height dominate over distance at close range: an open pit is
 * tens of metres below the ridge around it, so at a few hundred metres out the
 * pit hazed roughly 40% harder than the ground immediately beside it and read
 * as a cold blue hole punched through warm terrain. Height should tint a
 * valley, not separate it from its own surroundings — at 220m the same drop is
 * a ~13% difference, which reads as depth rather than as a different material.
 */
const HEIGHT_FALLOFF = 220;
/** The playable pit stays haze-free up close — haze only kicks in past this distance. */
const NEAR_START = 150;

export interface BiomeGrade {
  gamma: number;
  gain: THREE.Vector3;
  lift: THREE.Vector3;
}

/** Neutral grade for biomes the art pass hasn't tuned yet (#458 A21: "starting points for the art pass"). */
export const NEUTRAL_GRADE: BiomeGrade = { gamma: 1.0, gain: new THREE.Vector3(1, 1, 1), lift: new THREE.Vector3(0, 0, 0) };

/** Per-biome grade defaults, verbatim from A21. Biomes not listed here (red_canyon, green_foothills) use NEUTRAL_GRADE. */
export const BIOME_GRADES: Record<string, BiomeGrade> = {
  desert_badlands: { gamma: 0.96, gain: new THREE.Vector3(1.05, 1.0, 0.92), lift: new THREE.Vector3(0.02, 0.01, 0.0) },
  alpine_granite: { gamma: 1.0, gain: new THREE.Vector3(0.96, 1.0, 1.06), lift: new THREE.Vector3(0, 0, 0) },
  tropical_karst: { gamma: 0.94, gain: new THREE.Vector3(0.98, 1.04, 0.98), lift: new THREE.Vector3(0, 0, 0) },
  volcanic_flats: { gamma: 1.02, gain: new THREE.Vector3(1.0, 0.96, 0.94), lift: new THREE.Vector3(0, 0, 0) },
};

const FRAGMENT_SHADER = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uHazeColor;
uniform float uDensity;
uniform float uHeightRef;
uniform float uHeightFalloff;
uniform float uNearStart;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uGamma;

varying vec2 vUv;

vec4 grade(vec4 c) {
  return vec4(pow(c.rgb, vec3(uGamma)) * uGain + uLift, c.a);
}

void main() {
  vec4 col = texture2D(tDiffuse, vUv);
  float depth = texture2D(tDepth, vUv).x;
  if (depth >= 1.0) { gl_FragColor = grade(col); return; } // sky: grade only, no haze

  vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uProjInv * clip; view /= view.w;
  vec3 world = (uViewInv * view).xyz;
  float dist = length(view.xyz);

  float density = uDensity * exp(-max(world.y - uHeightRef, 0.0) / uHeightFalloff); // thick in valleys, thin on peaks
  float f = 1.0 - exp(-density * max(dist - uNearStart, 0.0));
  f = min(f, 0.85); // never fully swallow the horizon

  vec3 desat = mix(col.rgb, vec3(dot(col.rgb, vec3(0.299, 0.587, 0.114))), f * 0.5);
  vec3 hazed = mix(desat, uHazeColor, f);
  gl_FragColor = grade(vec4(hazed, 1.0));
}
`;

const VERTEX_SHADER = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export class AerialPerspectivePass extends ShaderPass {
  constructor(depthTexture: THREE.DepthTexture) {
    super({
      name: 'AerialPerspectivePass',
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: depthTexture },
        uProjInv: { value: new THREE.Matrix4() },
        uViewInv: { value: new THREE.Matrix4() },
        uHazeColor: { value: new THREE.Color(0x87ceeb) },
        uDensity: { value: DENSITY },
        uHeightRef: { value: 0 },
        uHeightFalloff: { value: HEIGHT_FALLOFF },
        uNearStart: { value: NEAR_START },
        uLift: { value: NEUTRAL_GRADE.lift.clone() },
        uGain: { value: NEUTRAL_GRADE.gain.clone() },
        uGamma: { value: NEUTRAL_GRADE.gamma },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });

    // ShaderPass's plain-object constructor path runs every uniform through
    // UniformsUtils.clone(), which clones Texture values too (a new object,
    // new uuid) — not just Vector/Color/Matrix. Left alone, this pass would
    // sample a disconnected DepthTexture clone that the renderer never
    // writes into, since only the ORIGINAL object passed in here ever gets
    // attached to a render target's framebuffer. Reassign the real one.
    this.uniforms['tDepth']!.value = depthTexture;
  }

  /** Refresh the inverse camera matrices — call once per frame, after the camera's own matrices are up to date (#458 T5.2). */
  update(camera: THREE.Camera): void {
    (this.uniforms['uProjInv']!.value as THREE.Matrix4).copy(camera.projectionMatrix).invert();
    (this.uniforms['uViewInv']!.value as THREE.Matrix4).copy(camera.matrixWorld);
  }

  /** Ground mean world-y for this level — set once per game load from LandscapeHandle.groundLevelY (#458 T5.2). */
  setHeightRef(groundLevelY: number): void {
    this.uniforms['uHeightRef']!.value = groundLevelY;
  }

  /** Per-biome color grade — set once per game load (#458 T5.2). */
  setGrade(grade: BiomeGrade): void {
    this.uniforms['uGamma']!.value = grade.gamma;
    (this.uniforms['uGain']!.value as THREE.Vector3).copy(grade.gain);
    (this.uniforms['uLift']!.value as THREE.Vector3).copy(grade.lift);
  }

  /** Haze tint — weather-driven, refreshed every frame from SkyboxWeather's current sky color (#458 T5.2). */
  setHazeColor(color: THREE.Color): void {
    (this.uniforms['uHazeColor']!.value as THREE.Color).copy(color);
  }
}
