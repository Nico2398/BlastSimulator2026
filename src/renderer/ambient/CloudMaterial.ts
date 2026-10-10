// BlastSimulator2026 — Cartoon cloud surface (#1602)
// Clouds sit outside the model library's toon recipe on purpose: a stock
// MeshToonMaterial that skips CSM.setupMaterial() sums every cascade light
// and blows out, and a sky layer should not carry cascade/shadow plumbing it
// never uses. This shader draws the same look by hand — flat colour bands
// against the scene's sun direction, a soft cool belly underneath — and pairs
// with the shared inverted-hull outline (CartoonMaterial) like every model.

import * as THREE from 'three';
import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import { SUN_POSITION } from '../SceneManager.js';

/** The three bands a cloud is painted in, top to underside, and the line around it. */
export interface CloudPalette {
  /** Sun-facing side. */
  lit: THREE.Color;
  /** Turned away from the sun. */
  shade: THREE.Color;
  /** Flat underside. */
  belly: THREE.Color;
  /**
   * Outline. A deep shade of the cloud's own blue rather than the models'
   * near-black: a cloud is drawn against open sky, where a black line reads
   * as a sticker pasted on it rather than as the edge of something soft.
   */
  outline: THREE.Color;
}

function palette(lit: number, shade: number, belly: number, outline: number): CloudPalette {
  return {
    lit: new THREE.Color(lit),
    shade: new THREE.Color(shade),
    belly: new THREE.Color(belly),
    outline: new THREE.Color(outline),
  };
}

const FAIR = palette(0xfffef9, 0xd3def4, 0xaebde0, 0x4a5878);
const OVERCAST = palette(0xf0f2f6, 0xc4cddd, 0x9ea9c0, 0x434c60);
const RAIN = palette(0xc4cad5, 0x9da6b6, 0x7b8597, 0x353b48);
const STORM = palette(0x6e7686, 0x535a68, 0x3c414d, 0x1c1420);

/** Cloud paint per weather state — darker as the weather worsens, storm the darkest. */
export const CLOUD_PALETTE: Record<WeatherState, CloudPalette> = {
  sunny: FAIR,
  heat_wave: FAIR,
  cold_snap: FAIR,
  cloudy: OVERCAST,
  light_rain: RAIN,
  heavy_rain: RAIN,
  storm: STORM,
};

/** Width of the anti-aliased step between two bands, in units of the shading term. */
const BAND_SOFTNESS = 0.04;

const VERTEX_SHADER = /* glsl */ `
varying vec3 vNormalW;
void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #ifdef USE_INSTANCING
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    objectNormal = mat3(instanceMatrix) * objectNormal;
  #endif
  vNormalW = normalize(mat3(modelMatrix) * objectNormal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uBelly;
uniform vec3 uSunDir;
uniform float uSoftness;
varying vec3 vNormalW;

float band(float edge, float x) {
  float w = max(fwidth(x), uSoftness);
  return smoothstep(edge - w, edge + w, x);
}

void main() {
  vec3 n = normalize(vNormalW);
  vec3 col = mix(uShade, uLit, band(0.15, dot(n, uSunDir)));
  col = mix(col, uBelly, band(0.55, -n.y));
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Unlit-by-scene toon surface for the cloud clusters; recolour it with `setPalette`. */
export function createCloudMaterial(initial: CloudPalette = FAIR): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'cloud',
    uniforms: {
      uLit: { value: initial.lit.clone() },
      uShade: { value: initial.shade.clone() },
      uBelly: { value: initial.belly.clone() },
      uSunDir: { value: SUN_POSITION.clone().normalize() },
      uSoftness: { value: BAND_SOFTNESS },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
}

/**
 * Move the surface's bands and the outline hull's colour (a
 * `createOutlineMaterial` hull) a fraction `t` of the way toward `target`
 * (t = 1 snaps).
 */
export function lerpCloudPalette(
  surface: THREE.ShaderMaterial,
  outline: THREE.ShaderMaterial,
  target: CloudPalette,
  t: number,
): void {
  (surface.uniforms['uLit']!.value as THREE.Color).lerp(target.lit, t);
  (surface.uniforms['uShade']!.value as THREE.Color).lerp(target.shade, t);
  (surface.uniforms['uBelly']!.value as THREE.Color).lerp(target.belly, t);
  (outline.uniforms['color']!.value as THREE.Color).lerp(target.outline, t);
}
