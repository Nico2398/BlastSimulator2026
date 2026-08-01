// BlastSimulator2026 — Terrain material: shared 3D procedural rock shading
// via onBeforeCompile (#458 T4.1/D9/A19)
//
// One MeshStandardMaterial instance shared by playable terrain chunks,
// landscape tiles, and blast fragments — this is what makes "landscape and
// playable zone read as one material" true (D9). Rock/ore identity comes in
// as per-vertex/per-instance attributes (aRockA, aRockB, aRockWeight, aOre —
// #458 A18); color and surface detail are computed entirely in the shader
// from those indices plus the world position.
//
// No triplanar projection: detail comes from solid 3D value-noise/FBM
// evaluated at the world position, which is UV-free and correct on
// arbitrary cut faces by construction (A19) — this satisfies the issue's
// "correct texture on every fracture face" intent without triplanar's
// seam-blending cost.

import * as THREE from 'three';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import { getAllRocks } from '../../core/world/RockCatalog.js';
import { getAllOres } from '../../core/world/OreCatalog.js';
import type { Rect } from '../../core/world/WorldGen.js';

/**
 * `@types/three`'s CSM declaration lags the shipped implementation: `camera`
 * is typed as the abstract `Camera` (no `near`/`far`) and `shaders` as
 * `Map<unknown, string>` (the real value is the onBeforeCompile shader
 * object, confirmed by reading node_modules/three/examples/jsm/csm/CSM.js
 * directly — `shaders.set(material, shader)`). This local type patches both
 * to match actual runtime behavior for the cast below.
 */
type CSMRuntime = Omit<CSM, 'camera' | 'shaders'> & {
  camera: THREE.PerspectiveCamera;
  shaders: Map<THREE.Material, THREE.WebGLProgramParametersWithUniforms | null>;
};

/** getAllRocks() has 10 entries today; sized with headroom (#458 A19.2). */
const ROCK_SLOTS = 12;
/** getAllOres() has 8 entries today; same headroom convention as rocks. */
const ORE_SLOTS = 10;

// ---------- A19.1 — GLSL noise library ----------
const NOISE_GLSL = `
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y),
    f.z);
}
float fbm3(vec3 p){ return (vnoise(p) * 0.5 + vnoise(p * 2.03) * 0.3 + vnoise(p * 4.09) * 0.2); }
`;

// ---------- A19.2 — uniforms, attributes, varyings ----------
const FRAGMENT_COMMON_EXTRA = `
${NOISE_GLSL}
uniform vec3 uRockColor[${ROCK_SLOTS}];
uniform vec4 uRockParams[${ROCK_SLOTS}];
uniform vec3 uOreColor[${ORE_SLOTS}];
uniform vec4 uPlayRect;
uniform vec2 uCloudOffset;
uniform float uCloudCoverage;
uniform float uBandStrength;
varying float vRockA;
varying float vRockB;
varying float vRockW;
varying float vOreId;
varying float vOreAmt;
varying vec3 vWorldPos;

float boundaryBand(vec2 p){
  vec2 dmin = uPlayRect.xy - p, dmax = p - uPlayRect.zw;
  float dOut = length(max(max(dmin, dmax), 0.0));
  float band = smoothstep(0.0, 0.5, dOut) * (1.0 - smoothstep(2.5, 5.0, dOut));
  return 1.0 - uBandStrength * band;
}

float cloudShadow(vec2 p){
  float c = fbm3(vec3((p + uCloudOffset) * 0.004, 17.0));
  return 1.0 - 0.25 * uCloudCoverage * smoothstep(0.55, 0.75, c);
}
`;

const VERTEX_COMMON_EXTRA = `
attribute float aRockA;
attribute float aRockB;
attribute float aRockWeight;
attribute vec2 aOre;
varying float vRockA;
varying float vRockB;
varying float vRockW;
varying float vOreId;
varying float vOreAmt;
varying vec3 vWorldPos;
`;

// Instanced meshes (FragmentMesh) apply their per-instance transform via
// `instanceMatrix`, but that transform is only ever folded into the local
// `transformed` variable inside <project_vertex>/<worldpos_vertex> — never
// inside <begin_vertex> itself, and <worldpos_vertex>'s body is compiled out
// entirely unless envmap/shadow/transmission features are active. Computing
// vWorldPos here needs its own explicit USE_INSTANCING branch or fragment
// debris would shade using their un-instanced local position.
const VERTEX_BEGIN_EXTRA = `
#ifdef USE_INSTANCING
  vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
vRockA = aRockA;
vRockB = aRockB;
vRockW = aRockWeight;
vOreId = aOre.x;
vOreAmt = aOre.y;
`;

// ---------- A19.3 — albedo (replaces <color_fragment>) ----------
const ALBEDO_GLSL = `
int ra = int(vRockA + 0.5); int rb = int(vRockB + 0.5);
vec3 base = mix(uRockColor[ra], uRockColor[rb], vRockW);
vec4 pa = mix(uRockParams[ra], uRockParams[rb], vRockW);
float macro = fbm3(vWorldPos * pa.x) - 0.5;
float detail = fbm3(vWorldPos * pa.y) - 0.5;
float vein = max(0.0, 1.0 - abs(vnoise(vWorldPos * 0.13) - 0.5) * 8.0);
float b = macro * pa.w + detail * 0.25 - vein * pa.z;
vec3 col = clamp(base * (1.0 + vec3(b, b * 0.92, b * 0.85)), 0.0, 1.0);
if (vOreId >= 0.0) col = mix(col, uOreColor[int(vOreId + 0.5)], vOreAmt * 0.35 * step(0.72, vnoise(vWorldPos * 3.1)));
diffuseColor.rgb = col * cloudShadow(vWorldPos.xz) * boundaryBand(vWorldPos.xz);
`;

export interface TerrainMaterialOptions {
  /** World-space XZ bounds of the playable rect — drives the boundary-shading band (#458 A19.4). */
  playRect: Rect;
}

/**
 * Shared terrain material. `customUniforms` holds the live uniform objects —
 * the same references get copied into the compiled shader's own uniforms,
 * so mutating e.g. `customUniforms.uCloudOffset.value` after first render
 * still reaches the GPU on the next frame (#458 A19 injection mechanics).
 *
 * uBandStrength and uCloudCoverage default to 0 (inert): the boundary band
 * and cloud-shadow terms are wired end-to-end here but produce no visible
 * effect until T5.3 (band tuning) and T7.1 (wind/clouds) turn them on.
 */
export class TerrainMaterial extends THREE.MeshStandardMaterial {
  readonly customUniforms: Record<string, THREE.IUniform>;

  constructor(options: TerrainMaterialOptions) {
    super({ roughness: 0.9, metalness: 0.0 });

    const rocks = getAllRocks();
    const rockColor: THREE.Color[] = [];
    const rockParams: THREE.Vector4[] = [];
    for (let i = 0; i < ROCK_SLOTS; i++) {
      const rock = rocks[i];
      rockColor.push(new THREE.Color(rock ? rock.color : '#888888'));
      rockParams.push(new THREE.Vector4(
        rock ? rock.macroFreq : 0.20,
        rock ? rock.detailFreq : 0.70,
        rock ? rock.veinStrength : 0.15,
        rock ? rock.contrast : 0.25,
      ));
    }

    const ores = getAllOres();
    const oreColor: THREE.Color[] = [];
    for (let i = 0; i < ORE_SLOTS; i++) {
      const ore = ores[i];
      oreColor.push(new THREE.Color(ore ? ore.color : '#000000'));
    }

    const { minX, minZ, maxX, maxZ } = options.playRect;

    this.customUniforms = {
      uRockColor: { value: rockColor },
      uRockParams: { value: rockParams },
      uOreColor: { value: oreColor },
      uPlayRect: { value: new THREE.Vector4(minX, minZ, maxX, maxZ) },
      uCloudOffset: { value: new THREE.Vector2(0, 0) },
      uCloudCoverage: { value: 0 },
      uBandStrength: { value: 0 },
    };

    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.customUniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_COMMON_EXTRA}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BEGIN_EXTRA}`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_COMMON_EXTRA}`)
        .replace('#include <color_fragment>', ALBEDO_GLSL);
    };
    this.customProgramCacheKey = () => 'terrain-material-v1';
  }

  /**
   * Wires this material into a CSM instance for cascaded shadow sampling
   * (#458 T5.1/D11). `CSM.setupMaterial()` sets `material.onBeforeCompile`
   * itself — calling it directly would clobber the A19 shader above
   * entirely. This replicates its two real effects (the USE_CSM/
   * CSM_CASCADES defines, and the CSM_cascades/cameraNear/shadowFar
   * uniforms CSMShader's injected lighting chunk reads) as an addition on
   * top of the existing onBeforeCompile instead of a replacement.
   */
  attachCSM(csmIn: CSM): void {
    const csm = csmIn as unknown as CSMRuntime;
    this.defines = this.defines ?? {};
    this.defines['USE_CSM'] = 1;
    this.defines['CSM_CASCADES'] = csm.cascades;

    const innerCompile = this.onBeforeCompile.bind(this);
    const breaks: THREE.Vector2[] = [];
    this.onBeforeCompile = (shader, renderer) => {
      innerCompile(shader, renderer);
      csm.getExtendedBreaks(breaks);
      shader.uniforms['CSM_cascades'] = { value: breaks };
      shader.uniforms['cameraNear'] = { value: csm.camera.near };
      shader.uniforms['shadowFar'] = { value: Math.min(csm.camera.far, csm.maxFar) };
      csm.shaders.set(this, shader);
    };
    this.needsUpdate = true;
  }
}
