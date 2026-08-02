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
//
// Detail is budgeted by view distance. The high-frequency octaves are the
// expensive part and the least useful far away, where a whole octave can land
// inside one pixel and alias into shimmer rather than texture. Every octave
// past the first is therefore gated on distance: close surfaces get the full
// stack, distant ones collapse to the macro shape.
const DETAIL_FULL_DISTANCE = 40;   // metres — everything on
// Detail is gone by here. The playable mesh is marching cubes at 1m against a
// 4m landscape grid, so it carries far more geometric frequency; letting its
// fine octaves run at range made the site fizz against smooth ground around
// it. 550m left plenty of grain alive at the distances a zoomed-out player
// actually looks from.
const DETAIL_FADE_DISTANCE = 320;

const NOISE_GLSL = `
// Three distinct multipliers, one per component. The original used 0.1031 for
// all three, which made the hash symmetric in x/y/z: every point on a diagonal
// hashed to the same value, and the noise carried a regular diagonal weave
// that showed through the terrain at every zoom level as fine straight lines.
float hash13(vec3 p){
  p = fract(p * vec3(0.1031, 0.11369, 0.13787));
  p += dot(p, p.yxz + 19.19);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y),
    f.z);
}

/** 1 at the camera, 0 past DETAIL_FADE_DISTANCE. */
float detailLod(vec3 wp){
  float d = distance(wp, cameraPosition);
  return 1.0 - smoothstep(float(${DETAIL_FULL_DISTANCE}), float(${DETAIL_FADE_DISTANCE}), d);
}

// Distance-budgeted FBM. Octaves switch off with range, and the running total
// is divided by the weight actually used — without that the mean would slide
// as octaves drop out and distant ground would visibly change brightness.
// The branches are coherent across neighbouring pixels (they depend only on
// distance), so the GPU really does skip the work rather than executing both
// sides of each one.
float fbm3lod(vec3 p, float lod){
  float v = vnoise(p) * 0.5;
  float w = 0.5;
  float w2 = smoothstep(0.02, 0.25, lod);
  if (w2 > 0.001) { v += vnoise(p * 2.03) * 0.30 * w2; w += 0.30 * w2; }
  float w3 = smoothstep(0.30, 0.55, lod);
  if (w3 > 0.001) { v += vnoise(p * 4.09) * 0.20 * w3; w += 0.20 * w3; }
  float w4 = smoothstep(0.60, 0.80, lod);
  if (w4 > 0.001) { v += vnoise(p * 8.17) * 0.12 * w4; w += 0.12 * w4; }
  float w5 = smoothstep(0.85, 0.97, lod);
  if (w5 > 0.001) { v += vnoise(p * 16.31) * 0.07 * w5; w += 0.07 * w5; }
  return v / w;
}

/** Full-detail FBM, for terms that are not view dependent (cloud shadows). */
float fbm3(vec3 p){ return (vnoise(p) * 0.5 + vnoise(p * 2.03) * 0.3 + vnoise(p * 4.09) * 0.2); }

// Tetrahedral gradient of vnoise — four taps instead of the six a central
// difference needs. Used for surface bump, so the cost matters.
vec3 vnoiseGrad(vec3 p, float e){
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * vnoise(p + k.xyy * e) + k.yyx * vnoise(p + k.yyx * e) +
    k.yxy * vnoise(p + k.yxy * e) + k.xxx * vnoise(p + k.xxx * e) + 1e-6);
}
`;

// ---------- A19.2 — uniforms, attributes, varyings ----------
const FRAGMENT_COMMON_EXTRA = `
${NOISE_GLSL}
uniform vec3 uRockColor[${ROCK_SLOTS}];
uniform vec4 uRockParams[${ROCK_SLOTS}];
uniform vec3 uOreColor[${ORE_SLOTS}];
uniform vec2 uCloudOffset;
uniform float uCloudCoverage;
varying float vRockA;
varying float vRockB;
varying float vRockW;
varying float vOreId;
varying float vOreAmt;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

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
varying vec3 vWorldNormal;
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
  vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
#endif
vRockA = aRockA;
vRockB = aRockB;
vRockW = aRockWeight;
vOreId = aOre.x;
vOreAmt = aOre.y;
`;

// ---------- A19.3 — albedo (replaces <color_fragment>) ----------
//
// The first version modulated one flat rock colour by a single noise value,
// so every surface was the same hue and only got lighter or darker. Read as
// painted noise rather than ground, and the regular grid triangulation showed
// straight through it. Four things carry the surface now:
//
//   flatness  Loose weathered material settles on level ground; steep faces
//             expose the rock underneath. Drives colour, contrast and grain.
//   hue       Warm/cool drift across the macro field instead of pure value
//             modulation — what stops it reading as a single tinted sheet.
//   strata    Bedding planes in world Y, revealed on cut faces. Free
//             legibility for benches and crater walls in a mining game.
//   grain     A fine octave that survives close-up, plus the bump below.
const ALBEDO_GLSL = `
int ra = int(vRockA + 0.5); int rb = int(vRockB + 0.5);
vec3 base = mix(uRockColor[ra], uRockColor[rb], vRockW);
vec4 pa = mix(uRockParams[ra], uRockParams[rb], vRockW);

vec3 wn = normalize(vWorldNormal);
float flatness = smoothstep(0.45, 0.9, abs(wn.y));

float lod = detailLod(vWorldPos);

float macro  = fbm3lod(vWorldPos * pa.x, lod) - 0.5;
float detail = fbm3lod(vWorldPos * pa.y, lod) - 0.5;
// Grain is the finest thing here and the first to go: past a few tens of
// metres an octave this tight is sub-pixel, so it stops reading as texture
// and starts reading as noise crawling over the distance.
float grain = 0.0;
if (lod > 0.001) {
  grain = ((vnoise(vWorldPos * 3.7) - 0.5)
        + (vnoise(vWorldPos * 11.9) - 0.5) * 0.6 * smoothstep(0.45, 0.75, lod)) * lod;
}
float vein   = max(0.0, 1.0 - abs(vnoise(vWorldPos * 0.13) - 0.5) * 8.0);

// Bedding planes wobble with a low-frequency field so they never look ruled.
float bed     = vnoise(vec3(vWorldPos.xz * 0.045, vWorldPos.y * 0.02));
float strata  = abs(sin(vWorldPos.y * 1.55 + bed * 3.2));
float bedding = smoothstep(0.55, 1.0, strata) * (1.0 - flatness);

// Warm on the crests of the macro field, cooler in the hollows.
vec3 warm = base * vec3(1.13, 0.99, 0.79);
vec3 cool = base * vec3(0.80, 0.89, 1.06);
vec3 col  = mix(cool, warm, clamp(macro * 2.2 + 0.5, 0.0, 1.0));

// Loose surface material is paler and flatter; exposed rock is deeper and
// keeps more of its noise contrast.
// Shading contrast is a near-field feature. The playable mesh is marching
// cubes at 1m, so at range its triangles fall below a pixel and every
// contrast term turns into speckle rather than texture — which is what made
// the site read as a crunchy patch against smooth landscape. Fading the
// contrast-carrying terms with distance lets the two converge.
float contrast = mix(1.35, 0.75, flatness) * mix(0.45, 1.0, lod);
float b = (macro * pa.w + detail * 0.30 + grain * 0.12) * contrast - vein * pa.z * mix(0.4, 1.0, lod);
col *= 1.0 + vec3(b, b * 0.94, b * 0.86);
col *= mix(0.84, 1.05, flatness);
col *= 1.0 - bedding * 0.24 * lod;

if (vOreId >= 0.0) col = mix(col, uOreColor[int(vOreId + 0.5)], vOreAmt * 0.35 * step(0.72, vnoise(vWorldPos * 3.1)));
diffuseColor.rgb = clamp(col, 0.0, 1.0) * cloudShadow(vWorldPos.xz);
`;

// Rock reads glossier than settled dust, and letting roughness wander with the
// grain keeps large lit areas from turning into one even sheen.
const ROUGHNESS_GLSL = `
#include <roughnessmap_fragment>
{
  float rlod = detailLod(vWorldPos);
  // Both the slope-driven gloss and its noise wobble are near-field: distant
  // terrain goes uniformly matte, which is the cheapest way to stop specular
  // speckle aliasing across sub-pixel triangles.
  float gloss = 0.18 * (1.0 - smoothstep(0.45, 0.9, abs(normalize(vWorldNormal).y))) * rlod;
  float wobble = rlod > 0.01 ? (vnoise(vWorldPos * 2.1) - 0.5) * 0.12 * rlod : 0.0;
  roughnessFactor = clamp(roughnessFactor - gloss + wobble, 0.35, 1.0);
}
`;

// A shallow bump derived from the same noise the albedo uses. This is what
// actually breaks up the mesh triangulation — the regular grid's diagonal
// split was legible straight through the old flat shading. The gradient is
// projected onto the surface's tangent plane, then carried into view space by
// viewMatrix, so it stays correct on rotated instances (blast fragments) as
// well as on world-aligned terrain.
// Eight vnoise taps if both gradients run, which makes this the most
// expensive thing in the shader — and the least worthwhile far away, where
// the bump it adds is smaller than a pixel. Both gradients are gated on
// distance and the whole block is skipped once nothing would show.
const NORMAL_BUMP_GLSL = `
#include <normal_fragment_begin>
{
  float bumpLod = detailLod(vWorldPos);
  if (bumpLod > 0.01) {
    vec3 wn = normalize(vWorldNormal);
    vec3 g = vnoiseGrad(vWorldPos * 1.6, 0.4);
    float fine = smoothstep(0.35, 0.7, bumpLod);
    if (fine > 0.001) g += vnoiseGrad(vWorldPos * 5.3, 0.12) * 0.5 * fine;
    g -= wn * dot(g, wn);
    normal = normalize(normal - mat3(viewMatrix) * g * 0.45 * bumpLod);
  }
}
`;

export interface TerrainMaterialOptions {
  /** World-space XZ bounds of the playable rect. Kept for callers and future shader use. */
  playRect: Rect;
}

/**
 * Shared terrain material. `customUniforms` holds the live uniform objects —
 * the same references get copied into the compiled shader's own uniforms,
 * so mutating e.g. `customUniforms.uCloudOffset.value` after first render
 * still reaches the GPU on the next frame (#458 A19 injection mechanics).
 *
 * uCloudCoverage defaults to 0 (inert) — the cloud-shadow term is wired
 * end-to-end here but produces no visible effect until T7.1 (wind/clouds)
 * turns it on.
 *
 * The site edge is no longer marked by darkening the ground here; that reads
 * as a smudge rather than a boundary. WorldBorderWall draws it instead.
 */
export class TerrainMaterial extends THREE.MeshStandardMaterial {
  readonly customUniforms: Record<string, THREE.IUniform>;

  constructor(_options: TerrainMaterialOptions) {
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

    this.customUniforms = {
      uRockColor: { value: rockColor },
      uRockParams: { value: rockParams },
      uOreColor: { value: oreColor },
      uCloudOffset: { value: new THREE.Vector2(0, 0) },
      uCloudCoverage: { value: 0 },
    };

    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.customUniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_COMMON_EXTRA}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BEGIN_EXTRA}`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_COMMON_EXTRA}`)
        .replace('#include <color_fragment>', ALBEDO_GLSL)
        .replace('#include <roughnessmap_fragment>', ROUGHNESS_GLSL)
        .replace('#include <normal_fragment_begin>', NORMAL_BUMP_GLSL);
    };
    this.customProgramCacheKey = () => 'terrain-material-v4';
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
