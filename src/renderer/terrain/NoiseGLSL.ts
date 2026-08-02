// BlastSimulator2026 — Shared 3D noise library (GLSL source)
//
// Every material in the game is a solid 3D texture: colour is a function of
// world position, with no UVs and no image maps. That is what makes a freshly
// blasted face show the same rock the interior was made of, without any
// unwrapping — the texture exists everywhere in space, and geometry merely
// samples it.
//
// Until now there was exactly one noise here, a hashed-lattice value noise,
// and every rock was that same noise under a different tint. Real materials do
// not share a signature: marble is banding pushed around by a second field,
// gravel is packed cells, snow is drifted ridges. Those need genuinely
// different generators, so this module provides four:
//
//   vnoise  value noise      — cheap, soft, good as a modulator
//   pnoise  Perlin gradient  — the classic; zero at lattice points, no blockiness
//   snoise  simplex          — fewer corners than Perlin, less axis bias
//   worley  cellular         — distance to scattered points; grain, cracks, cells
//
// plus FBM / ridged / turbulence built over them. Materials compose these
// rather than picking one: f + f', f(f'), and f(p + f'(p)) domain warping are
// what separate one surface from another.

/** Hashes and the four base generators. */
export const NOISE_BASE_GLSL = /* glsl */`
// Three distinct multipliers, one per component. A single shared multiplier
// makes the hash symmetric in x/y/z, so every point on a diagonal hashes alike
// and the noise carries a visible diagonal weave.
float hash13(vec3 p){
  p = fract(p * vec3(0.1031, 0.11369, 0.13787));
  p += dot(p, p.yxz + 19.19);
  return fract((p.x + p.y) * p.z);
}

/** Vector hash — gradients for Perlin, feature-point offsets for Worley. */
vec3 hash33(vec3 p){
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}

// ---- value noise ----
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y),
    f.z);
}

// ---- Perlin gradient noise ----
// Quintic fade, so the second derivative is continuous and the result does not
// show the lattice under a bump/normal derivation the way a cubic fade does.
vec3 fade3(vec3 t){ return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float perlinGrad(vec3 cell, vec3 d){
  return dot(normalize(hash33(cell) * 2.0 - 1.0), d);
}

/** Perlin noise remapped to 0..1. */
float pnoise(vec3 p){
  vec3 i = floor(p), f = p - i;
  vec3 u = fade3(f);
  float n000 = perlinGrad(i + vec3(0,0,0), f - vec3(0,0,0));
  float n100 = perlinGrad(i + vec3(1,0,0), f - vec3(1,0,0));
  float n010 = perlinGrad(i + vec3(0,1,0), f - vec3(0,1,0));
  float n110 = perlinGrad(i + vec3(1,1,0), f - vec3(1,1,0));
  float n001 = perlinGrad(i + vec3(0,0,1), f - vec3(0,0,1));
  float n101 = perlinGrad(i + vec3(1,0,1), f - vec3(1,0,1));
  float n011 = perlinGrad(i + vec3(0,1,1), f - vec3(0,1,1));
  float n111 = perlinGrad(i + vec3(1,1,1), f - vec3(1,1,1));
  float v = mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
                mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
  // Normalized gradients cap |v| near 0.87; scale into 0..1 with headroom.
  return clamp(v * 0.65 + 0.5, 0.0, 1.0);
}

// ---- simplex noise ----
// Skewed tetrahedral lattice: four corners per sample instead of Perlin's
// eight, and no axis alignment for the artefacts to line up along.
float snoise(vec3 p){
  const float F3 = 0.3333333;
  const float G3 = 0.1666667;
  vec3 s = floor(p + dot(p, vec3(F3)));
  vec3 x = p - s + dot(s, vec3(G3));

  vec3 e = step(vec3(0.0), x - x.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);

  vec3 x1 = x - i1 + G3;
  vec3 x2 = x - i2 + 2.0 * G3;
  vec3 x3 = x - 1.0 + 3.0 * G3;

  vec4 w = max(0.6 - vec4(dot(x, x), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  w = w * w * w * w;

  vec4 d = vec4(
    dot(normalize(hash33(s) * 2.0 - 1.0), x),
    dot(normalize(hash33(s + i1) * 2.0 - 1.0), x1),
    dot(normalize(hash33(s + i2) * 2.0 - 1.0), x2),
    dot(normalize(hash33(s + 1.0) * 2.0 - 1.0), x3));

  return clamp(dot(d, w) * 26.0 + 0.5, 0.0, 1.0);
}

// ---- cellular / Worley ----
// Returns (F1, F2): distance to the nearest feature point and to the second
// nearest. F1 alone gives packed grains; F2 - F1 gives the seams between them,
// which is what cracked clay, ice and columnar basalt are made of.
vec2 worley(vec3 p){
  vec3 i = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = hash33(i + g);
        float d = length(g + o - f);
        if (d < f1) { f2 = f1; f1 = d; }
        else if (d < f2) { f2 = d; }
      }
    }
  }
  return vec2(f1, f2);
}
`;

/**
 * Octave stacks.
 *
 * `lod` is the distance budget: 1 at the camera, 0 far away. Octaves switch
 * off as it falls and the running total is divided by the weight actually
 * used, so dropping detail never slides the mean and shifts distant colour.
 * The branches depend only on distance, so neighbouring pixels take the same
 * one and the work is genuinely skipped.
 */
export const NOISE_FBM_GLSL = /* glsl */`
#define FBM_BODY(NOISEFN)                                              \\
  float v = NOISEFN(p) * 0.5;                                          \\
  float w = 0.5;                                                       \\
  float w2 = smoothstep(0.02, 0.25, lod);                              \\
  if (w2 > 0.001) { v += NOISEFN(p * 2.03) * 0.30 * w2; w += 0.30 * w2; } \\
  float w3 = smoothstep(0.30, 0.55, lod);                              \\
  if (w3 > 0.001) { v += NOISEFN(p * 4.09) * 0.20 * w3; w += 0.20 * w3; } \\
  float w4 = smoothstep(0.60, 0.80, lod);                              \\
  if (w4 > 0.001) { v += NOISEFN(p * 8.17) * 0.12 * w4; w += 0.12 * w4; } \\
  float w5 = smoothstep(0.85, 0.97, lod);                              \\
  if (w5 > 0.001) { v += NOISEFN(p * 16.31) * 0.07 * w5; w += 0.07 * w5; } \\
  return v / w;

float fbmValue(vec3 p, float lod){ FBM_BODY(vnoise) }
float fbmPerlin(vec3 p, float lod){ FBM_BODY(pnoise) }
float fbmSimplex(vec3 p, float lod){ FBM_BODY(snoise) }

/** Sharp-crested stack — the shape of eroded strata and wind-drifted snow. */
float ridged(vec3 p, float lod){
  float v = 0.0, w = 0.0, amp = 0.5, freq = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i > 0 && lod < float(i) * 0.22) break;
    float n = 1.0 - abs(pnoise(p * freq) * 2.0 - 1.0);
    v += n * n * amp;
    w += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return v / max(w, 1e-4);
}

/** Absolute-value stack — billowy, cloud-like; good for clay and mud. */
float turbulence(vec3 p, float lod){
  float v = 0.0, w = 0.0, amp = 0.5, freq = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i > 0 && lod < float(i) * 0.22) break;
    v += abs(snoise(p * freq) * 2.0 - 1.0) * amp;
    w += amp;
    amp *= 0.5;
    freq *= 2.11;
  }
  return v / max(w, 1e-4);
}
`;

/** Everything, in dependency order. */
export const NOISE_GLSL = `${NOISE_BASE_GLSL}\n${NOISE_FBM_GLSL}`;
