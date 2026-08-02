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
import { MaterialRecipe } from '../../core/world/SurfaceMaterialCatalog.js';
import { NOISE_GLSL } from './NoiseGLSL.js';
import { MATERIAL_RECIPES_GLSL } from './MaterialRecipesGLSL.js';
import {
  SURFACE_MATERIALS, SURFACE_MATERIAL_SLOTS, biomeAffinities,
} from '../../core/world/SurfaceMaterialCatalog.js';

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


// ---------- A19.2 — uniforms, attributes, varyings ----------
const SUPPORT_GLSL = /* glsl */`
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

/** 1 at the camera, 0 past DETAIL_FADE_DISTANCE. */
float detailLod(vec3 wp){
  float d = distance(wp, cameraPosition);
  return 1.0 - smoothstep(float(${DETAIL_FULL_DISTANCE}), float(${DETAIL_FADE_DISTANCE}), d);
}
`;

const SURFACE_SELECT_GLSL = /* glsl */`
/**
 * A material's fitness at this point, before normalisation.
 *
 * Every term is a smooth bell rather than a threshold, and the patch field
 * varies the score slowly across the world so materials form drifts instead of
 * uniform sheets. Nothing here is quantised and nothing is decided per-vertex,
 * which is why no seam exists for a hard edge to form along.
 */
float materialScore(int i, vec3 wp, float flatness, float altitude, float wetness, float lod){
  vec4 where = uMatWhere[i];
  vec2 bias = uMatBias[i];
  if (bias.y <= 0.001) return 0.0; // absent from this biome

  // Selection reads a SOFTENED flatness. The playable mesh is marching cubes
  // at 1m, so its normal alternates hard between level tops and vertical
  // risers; scoring off the raw value made the cover flip material facet by
  // facet and the ground broke into blocks. Easing it toward level keeps a
  // 1m step from being treated as a cliff.
  float softFlat = mix(flatness, 1.0, 0.4);
  float slopeFit = exp(-pow((softFlat - where.x) / max(where.y, 0.02), 2.0));
  float altFit   = exp(-pow((altitude - where.z) / max(where.w, 0.02), 2.0));
  float wetFit   = exp(-pow((wetness - bias.x) / 0.55, 2.0));

  // Slow, material-specific field: two materials that suit the same ground
  // still occupy different patches of it rather than averaging into mush.
  // ('patch' is a reserved word in GLSL ES.)
  // Budgeted by distance like everything else. Hardcoding full detail here
  // meant every material ran a full octave stack at every pixel purely to
  // decide who wins — thirteen of them, which dominated the whole frame.
  float drift = fbmValue(wp / max(uMatLook[i].w, 1.0) + float(i) * 17.3, lod * 0.3);

  return bias.y * slopeFit * altFit * wetFit * (0.55 + 0.55 * drift);
}

/** Shade material 'i' at 'wp', returning albedo and writing its relief and gloss. */
vec3 materialAlbedo(int i, vec3 wp, float lod, out float bumpAmt, out float roughAdj){
  vec4 shape = uMatShape[i];
  vec4 look = uMatLook[i];
  float n = evalRecipe(int(shape.x + 0.5), wp * shape.y, shape.z, shape.w, lod);
  // Contrast fades with distance along with everything else, so a distant
  // slope settles to its average colour instead of boiling.
  float t = clamp(0.5 + (n - 0.5) * look.x * 1.15 * mix(0.45, 1.0, lod), 0.0, 1.0);
  bumpAmt = look.y * n;
  roughAdj = look.z;
  return mix(uMatColor[i], uMatColorAlt[i], t);
}
`;

const FRAGMENT_COMMON_EXTRA = `
${NOISE_GLSL}
${SUPPORT_GLSL}
${MATERIAL_RECIPES_GLSL}
uniform vec3 uRockColor[${ROCK_SLOTS}];
uniform vec4 uRockParams[${ROCK_SLOTS}];
uniform vec4 uRockRecipe[${ROCK_SLOTS}];   // (recipe, freqAlt, warp, unused)
uniform vec3 uOreColor[${ORE_SLOTS}];

// ---- surface cover catalog ----
uniform vec3 uMatColor[${SURFACE_MATERIAL_SLOTS}];
uniform vec3 uMatColorAlt[${SURFACE_MATERIAL_SLOTS}];
uniform vec4 uMatShape[${SURFACE_MATERIAL_SLOTS}];  // (recipe, freq, freqAlt, warp)
uniform vec4 uMatLook[${SURFACE_MATERIAL_SLOTS}];   // (contrast, bump, roughness, patchScale)
uniform vec4 uMatWhere[${SURFACE_MATERIAL_SLOTS}];  // (slopeCentre, slopeWidth, altCentre, altWidth)
uniform vec2 uMatBias[${SURFACE_MATERIAL_SLOTS}];   // (moisture, biomeAffinity)
uniform int uMatCount;
/** Site height range, so altitude preferences read the same on every level. */
uniform vec2 uHeightRange;
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
${SURFACE_SELECT_GLSL}
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
vec3 wn = normalize(vWorldNormal);
// Deliberately a wide ramp. A narrow one snaps between "flat" and "steep"
// across a single voxel terrace, so cover switched on and off step by step and
// the benches read as banded blocks.
float flatness = smoothstep(0.15, 0.98, abs(wn.y));
float lod = detailLod(vWorldPos);

// ---- the rock this ground is made of ----
// Comes from the mesh, so a cut face shows the stratum it actually cut. Each
// rock has its own recipe, not a shared formula under a different tint.
int ra = int(vRockA + 0.5); int rb = int(vRockB + 0.5);
vec4 recA = uRockRecipe[ra];
vec4 pa = mix(uRockParams[ra], uRockParams[rb], vRockW);
float rockN = evalRecipe(int(recA.x + 0.5), vWorldPos * pa.x, recA.y, recA.z, lod);
vec3 rockBase = mix(uRockColor[ra], uRockColor[rb], vRockW);
// Warm on the crests of the field, cooler in the hollows — value modulation
// alone reads as one tinted sheet.
vec3 rockCol = mix(rockBase * vec3(0.80, 0.89, 1.06), rockBase * vec3(1.13, 0.99, 0.79),
                   clamp((rockN - 0.5) * 2.2 + 0.5, 0.0, 1.0));
float rockBump = 0.55;

// Bedding planes in world Y, revealed on cut faces — free legibility for
// benches and crater walls. Wobbled so they never look ruled.
float bed     = vnoise(vec3(vWorldPos.xz * 0.045, vWorldPos.y * 0.02));
float bedding = smoothstep(0.55, 1.0, abs(sin(vWorldPos.y * 1.55 + bed * 3.2))) * (1.0 - flatness);
rockCol *= 1.0 - bedding * 0.24 * lod;
rockCol *= 1.0 + (rockN - 0.5) * pa.w * mix(0.45, 1.0, lod);

// ---- the cover sitting on top of it ----
// Scored per pixel across the whole catalogue, then the two strongest are
// blended. Two is enough for a smooth field — a third contributor is always
// weaker than the gap between the first two and only greys the result.
float altitude = clamp((vWorldPos.y - uHeightRange.x) / max(uHeightRange.y - uHeightRange.x, 1.0), 0.0, 1.0);
// Wetness: low ground and hollows hold water, ridges shed it.
float wetness = clamp(0.75 - altitude * 0.6 + (vnoise(vWorldPos * 0.012) - 0.5) * 0.7, 0.0, 1.0);

// Scoring is cheap — bells and one slow noise, no recipe evaluation — so
// every material is scored and only the two strongest are actually shaded.
int bestI = -1, secondI = -1;
float bestW = 0.0, secondW = 0.0;
for (int i = 0; i < ${SURFACE_MATERIAL_SLOTS}; i++) {
  if (i >= uMatCount) break;
  float sc = materialScore(i, vWorldPos, flatness, altitude, wetness, lod);
  if (sc > bestW) { secondW = bestW; secondI = bestI; bestW = sc; bestI = i; }
  else if (sc > secondW) { secondW = sc; secondI = i; }
}

// Sharpen the runner-up's share against the winner's. Whichever material is
// third is not drawn, so it must already be contributing nothing by the time
// it would drop out — otherwise its colour vanishes abruptly along the line
// where the ranking changes, which is a seam in the middle of open ground.
// Raising the ratio to a power drives anything much below the winner to zero
// well before it leaves the top two.
float ratio = secondI >= 0 ? clamp(secondW / max(bestW, 1e-4), 0.0, 1.0) : 0.0;
float share = pow(ratio, 3.0) * 0.5;

vec3 coverCol = rockCol;
float coverBump = rockBump;
float coverRough = 0.0;
float coverAmount = 0.0;
if (bestI >= 0 && bestW > 0.0) {
  float b1, b2, r1, r2;
  vec3 c1 = materialAlbedo(bestI, vWorldPos, lod, b1, r1);
  vec3 c2 = c1; b2 = b1; r2 = r1;
  if (secondI >= 0) c2 = materialAlbedo(secondI, vWorldPos, lod, b2, r2);
  // Ratio blend, so the crossover between two covers is a gradient whose
  // width follows how close their scores are — never a step.
  coverCol = mix(c1, c2, share);
  coverBump = mix(b1, b2, share);
  coverRough = mix(r1, r2, share);
  // Smoothstep rather than a clamped scale: a linear ramp that saturates puts
  // a visible line wherever the score crosses the top of its range.
  coverAmount = smoothstep(0.04, 0.55, bestW);
}

// Cover clings to level ground and thins out on steep faces, where the rock
// beneath is exposed. Smoothstep on both ends, so there is no line anywhere
// along the transition.
// Wide and gentle: cover thins on steep faces rather than stopping at a line,
// so a bench riser shades from soil to bare rock over its whole height.
float cling = smoothstep(-0.15, 0.95, flatness);
float coverMix = coverAmount * cling;
vec3 col = mix(rockCol, coverCol, coverMix);
// Handed to the roughness and normal chunks below, which run later in the
// same main(). Relief and gloss belong to whichever material won here, so a
// mossy patch is not given gravel's bumpiness.
float surfaceBump = mix(rockBump, coverBump, coverMix);
float surfaceRough = coverRough * coverMix;

if (vOreId >= 0.0) col = mix(col, uOreColor[int(vOreId + 0.5)], vOreAmt * 0.35 * (1.0 - coverMix) * step(0.72, vnoise(vWorldPos * 3.1)));
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
  // surfaceRough carries the winning material's own gloss — ice and marble
  // are polished, ash and grass are not.
  roughnessFactor = clamp(roughnessFactor - gloss + wobble + surfaceRough, 0.2, 1.0);
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
    normal = normalize(normal - mat3(viewMatrix) * g * 0.45 * bumpLod * (0.55 + 0.5 * surfaceBump));
  }
}
`;

export interface TerrainMaterialOptions {
  /** World-space XZ bounds of the playable rect. Kept for callers and future shader use. */
  playRect: Rect;
  /** Biome id, which decides which surface covers can appear at all. */
  biomeId?: string;
  /** Lowest and highest ground on the site, so altitude preferences scale per level. */
  heightRange?: [number, number];
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

  constructor(options: TerrainMaterialOptions) {
    super({ roughness: 0.9, metalness: 0.0 });

    const rocks = getAllRocks();
    const rockColor: THREE.Color[] = [];
    const rockParams: THREE.Vector4[] = [];
    const rockRecipe: THREE.Vector4[] = [];
    for (let i = 0; i < ROCK_SLOTS; i++) {
      const rock = rocks[i];
      rockColor.push(new THREE.Color(rock ? rock.color : '#888888'));
      rockParams.push(new THREE.Vector4(
        rock ? rock.macroFreq : 0.20,
        rock ? rock.detailFreq : 0.70,
        rock ? rock.veinStrength : 0.15,
        rock ? rock.contrast : 0.25,
      ));
      rockRecipe.push(new THREE.Vector4(
        rock ? rock.recipe : MaterialRecipe.Sum,
        rock ? rock.freqAlt : 3.0,
        rock ? rock.warp : 0.0,
        0,
      ));
    }

    const ores = getAllOres();
    const oreColor: THREE.Color[] = [];
    for (let i = 0; i < ORE_SLOTS; i++) {
      const ore = ores[i];
      oreColor.push(new THREE.Color(ore ? ore.color : '#000000'));
    }

    // Surface covers. The biome decides which of them can appear here at all,
    // resolved once on the CPU because it never changes during play — the
    // shader only does the part that varies from pixel to pixel.
    const affinity = biomeAffinities(options.biomeId ?? '');
    const matColor: THREE.Color[] = [];
    const matColorAlt: THREE.Color[] = [];
    const matShape: THREE.Vector4[] = [];
    const matLook: THREE.Vector4[] = [];
    const matWhere: THREE.Vector4[] = [];
    const matBias: THREE.Vector2[] = [];
    for (let i = 0; i < SURFACE_MATERIAL_SLOTS; i++) {
      const m = SURFACE_MATERIALS[i];
      matColor.push(new THREE.Color(m ? m.color : '#000000'));
      matColorAlt.push(new THREE.Color(m ? m.colorAlt : '#000000'));
      matShape.push(new THREE.Vector4(m ? m.recipe : 0, m ? m.freq : 1, m ? m.freqAlt : 1, m ? m.warp : 0));
      matLook.push(new THREE.Vector4(m ? m.contrast : 0, m ? m.bump : 0, m ? m.roughness : 0, m ? m.patchScale : 30));
      matWhere.push(new THREE.Vector4(
        m ? m.slopeCenter : 1, m ? m.slopeWidth : 1,
        m ? m.altitudeCenter : 0.5, m ? m.altitudeWidth : 1,
      ));
      matBias.push(new THREE.Vector2(m ? m.moisture : 0.5, m ? (affinity[i] ?? 0) : 0));
    }

    const [minY, maxY] = options.heightRange ?? [0, 60];

    this.customUniforms = {
      uRockColor: { value: rockColor },
      uRockParams: { value: rockParams },
      uRockRecipe: { value: rockRecipe },
      uOreColor: { value: oreColor },
      uCloudOffset: { value: new THREE.Vector2(0, 0) },
      uCloudCoverage: { value: 0 },
      uMatColor: { value: matColor },
      uMatColorAlt: { value: matColorAlt },
      uMatShape: { value: matShape },
      uMatLook: { value: matLook },
      uMatWhere: { value: matWhere },
      uMatBias: { value: matBias },
      uMatCount: { value: SURFACE_MATERIALS.length },
      uHeightRange: { value: new THREE.Vector2(minY, maxY) },
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
    this.customProgramCacheKey = () => 'terrain-material-v5';
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
