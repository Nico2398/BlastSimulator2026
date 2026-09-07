// BlastSimulator2026 — Cartoon surface materials
// Every entity model renders with the same two-material recipe: a toon
// material (stepped diffuse ramp, no specular) for the surface, and an
// inverted-hull outline that keeps a constant on-screen thickness. Shared by
// the game renderer and the model viewer so both draw the same picture.

import * as THREE from 'three';

/** Diffuse ramp: three flat bands with a soft toe so shadow sides stay readable, not black. */
const TOON_RAMP = [0.34, 0.70, 1.0, 1.0];

/** Outline colour — a near-black plum, warmer than pure black under ACES. */
const OUTLINE_COLOR = 0x1c1420;
/** Outline thickness on screen, in render-target pixels. */
const OUTLINE_THICKNESS_PX = 1.7;
/** Outline thickness cap in world metres, so a distant entity is not swallowed by its line. */
const OUTLINE_MAX_WORLD = 0.035;

/**
 * Render-target height every outline material reads to convert pixels to
 * world units. One shared uniform: the scene owner updates it on resize.
 */
export const OUTLINE_UNIFORMS = {
  viewportHeight: { value: 720 },
};

/**
 * A hook run once per toon material the model library creates — the scene
 * attaches its cascaded shadows here. May return a teardown, run when the
 * material's owning instance is disposed.
 */
export type MaterialSetup = (material: THREE.Material) => (() => void) | void;

let gradient: THREE.DataTexture | null = null;

/** The stepped lighting ramp, built once and shared by every toon material. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array(TOON_RAMP.length * 4);
  TOON_RAMP.forEach((v, i) => {
    const byte = Math.round(v * 255);
    data[i * 4] = byte;
    data[i * 4 + 1] = byte;
    data[i * 4 + 2] = byte;
    data[i * 4 + 3] = 255;
  });
  gradient = new THREE.DataTexture(data, TOON_RAMP.length, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

interface ToonMaterialOptions {
  color?: THREE.Color;
  emissive?: THREE.Color;
  /** Colour comes from a per-vertex attribute (merged multi-colour meshes). */
  vertexColors?: boolean;
  name?: string;
}

export function createToonMaterial(options: ToonMaterialOptions = {}): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({
    color: options.color ?? new THREE.Color(0xffffff),
    gradientMap: toonGradient(),
    vertexColors: options.vertexColors ?? false,
  });
  if (options.emissive) material.emissive.copy(options.emissive);
  if (options.name) material.name = options.name;
  return material;
}

/**
 * Wind sway shared by vegetation surfaces and their outlines: bend grows with
 * height up to the canopy top, phased by the instance's world X so a forest
 * does not move in lockstep. `uTime`/`uWind` are the scene's ambient uniforms.
 */
export interface SwayOptions {
  uTime: THREE.IUniform<number>;
  uWind: THREE.IUniform<THREE.Vector2>;
  /** Model height (m) at which the bend reaches full strength. */
  canopyHeight: number;
}

/** GLSL applied to `transformed` in object space, before instancing/projection. Expects `instanceWorldX` in scope. */
export const SWAY_VERTEX_GLSL = /* glsl */ `
float bendT = pow(clamp(transformed.y, 0.0, uCanopyHeight) / max(uCanopyHeight, 0.001), 2.0);
float sway = bendT * 0.4 * sin(uTime * 1.7 + instanceWorldX * 0.35);
transformed.xz += uWind * sway;
`;

/**
 * Inverted-hull outline: the same geometry drawn back-face only, pushed out
 * along its normal in view space by a screen-constant width. Cheap (one extra
 * draw per node), needs no post pass, and ignores lighting entirely. Works
 * on an InstancedMesh too (three defines USE_INSTANCING and supplies
 * `instanceMatrix`), and can carry the vegetation sway so an outline bends
 * with its canopy.
 */
export function createOutlineMaterial(sway?: SwayOptions): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = {
    color: { value: new THREE.Color(OUTLINE_COLOR) },
    thicknessPx: { value: OUTLINE_THICKNESS_PX },
    maxWorld: { value: OUTLINE_MAX_WORLD },
    viewportHeight: OUTLINE_UNIFORMS.viewportHeight,
  };
  if (sway) {
    uniforms['uTime'] = sway.uTime;
    uniforms['uWind'] = sway.uWind;
    uniforms['uCanopyHeight'] = { value: sway.canopyHeight };
  }
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float thicknessPx;
      uniform float maxWorld;
      uniform float viewportHeight;
      ${sway ? 'uniform float uTime; uniform vec2 uWind; uniform float uCanopyHeight;' : ''}
      void main() {
        vec3 transformed = position;
        vec3 objectNormal = normal;
        #ifdef USE_INSTANCING
          float instanceWorldX = instanceMatrix[3].x;
        #else
          float instanceWorldX = 0.0;
        #endif
        ${sway ? SWAY_VERTEX_GLSL : ''}
        #ifdef USE_INSTANCING
          transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
          objectNormal = mat3(instanceMatrix) * objectNormal;
        #endif
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        vec3 n = normalize(normalMatrix * objectNormal);
        float worldPerPx = (-mv.z) * 2.0 / (projectionMatrix[1][1] * viewportHeight);
        float w = min(thicknessPx * worldPerPx, maxWorld);
        mv.xyz += n * w;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      void main() {
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
  });
}
