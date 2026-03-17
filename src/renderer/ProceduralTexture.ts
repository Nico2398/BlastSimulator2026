// BlastSimulator2026 — Procedural Rock Textures
// Generates 3D-coherent colors for rock types using simplex noise.
// "3D coherent" means the color at world position (x,y,z) is stable regardless
// of which mesh the fragment came from — rock fractures reveal matching interior texture.
//
// Usage:
//   sampleRockColor('sandite', wx, wy, wz)   → THREE.Color
//   applyProceduralColors(geometry, rockId, worldOffset)  → modifies vertex colors
//   createRockMaterial(rockId)               → THREE.MeshPhongMaterial with vertex color

import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { getRock } from '../core/world/RockCatalog.js';

// ---------- Per-rock-type noise configuration ----------

interface RockNoiseConfig {
  /** Primary octave frequency scale. */
  freqA: number;
  /** Secondary detail frequency scale. */
  freqB: number;
  /** How much the secondary octave darkens/lightens the primary (0–1). */
  detailStrength: number;
  /** Vein probability 0–1 (draws thin dark veins through rock). */
  veinFreq: number;
  veinStrength: number;
  /** Brightness contrast: 0 = flat, 1 = strong contrast. */
  contrast: number;
}

// Rock-type-specific noise parameters.
// Softer rocks (tier 1) tend to be more uniform; hard rocks (tier 4-5) have strong veins.
const ROCK_NOISE: Record<string, RockNoiseConfig> = {
  cruite:    { freqA: 0.18, freqB: 0.60, detailStrength: 0.12, veinFreq: 0.04, veinStrength: 0.08, contrast: 0.15 },
  sandite:   { freqA: 0.25, freqB: 0.90, detailStrength: 0.18, veinFreq: 0.03, veinStrength: 0.06, contrast: 0.22 },
  molite:    { freqA: 0.15, freqB: 0.55, detailStrength: 0.20, veinFreq: 0.06, veinStrength: 0.12, contrast: 0.18 },
  grumpite:  { freqA: 0.12, freqB: 0.45, detailStrength: 0.22, veinFreq: 0.08, veinStrength: 0.16, contrast: 0.24 },
  clunkite:  { freqA: 0.20, freqB: 0.70, detailStrength: 0.25, veinFreq: 0.10, veinStrength: 0.20, contrast: 0.28 },
  stubite:   { freqA: 0.22, freqB: 0.80, detailStrength: 0.28, veinFreq: 0.12, veinStrength: 0.22, contrast: 0.30 },
  obstiite:  { freqA: 0.30, freqB: 1.10, detailStrength: 0.30, veinFreq: 0.14, veinStrength: 0.28, contrast: 0.35 },
  gnarlite:  { freqA: 0.28, freqB: 1.00, detailStrength: 0.32, veinFreq: 0.16, veinStrength: 0.30, contrast: 0.38 },
  absurdite: { freqA: 0.35, freqB: 1.20, detailStrength: 0.35, veinFreq: 0.20, veinStrength: 0.35, contrast: 0.45 },
  titanite:  { freqA: 0.40, freqB: 1.40, detailStrength: 0.40, veinFreq: 0.22, veinStrength: 0.40, contrast: 0.50 },
};

const DEFAULT_NOISE_CONFIG: RockNoiseConfig = {
  freqA: 0.20, freqB: 0.70, detailStrength: 0.20,
  veinFreq: 0.08, veinStrength: 0.15, contrast: 0.25,
};

// Stable seeded noise instances per rock (different salt offsets)
const noiseA = createNoise3D(() => 0.1337);
const noiseB = createNoise3D(() => 0.7171);
const noiseVein = createNoise3D(() => 0.3141);

// ---------- Color sample cache ----------
// Quantise to 0.5-unit grid to avoid recalculating identical nearby positions.
// At a typical terrain mesh resolution this yields a >4× cache hit rate.
const COLOR_SAMPLE_CACHE = new Map<string, THREE.Color>();
// Clear cache before each chunk rebuild to avoid unbounded growth
let cacheHits = 0;
let cacheMisses = 0;

/** Clear the sample cache. Call before rebuilding a chunk to prevent unbounded growth. */
export function clearColorSampleCache(): void {
  COLOR_SAMPLE_CACHE.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

/** Return cache hit/miss stats (for performance monitoring). */
export function getColorCacheStats(): { hits: number; misses: number } {
  return { hits: cacheHits, misses: cacheMisses };
}

// ---------- Public API ----------

/**
 * Sample the procedural color for a rock type at a world position.
 * Coherent in 3D — rock fragments cut from this position show matching color.
 *
 * @param rockId   - Rock type ID from RockCatalog
 * @param wx, wy, wz - World-space position (voxel units)
 * @returns THREE.Color (new instance each call)
 */
export function sampleRockColor(
  rockId: string,
  wx: number, wy: number, wz: number,
): THREE.Color {
  // Quantise to 0.5-unit grid for caching — visually imperceptible at vertex density
  const qx = Math.round(wx * 2) / 2;
  const qy = Math.round(wy * 2) / 2;
  const qz = Math.round(wz * 2) / 2;
  const cacheKey = `${rockId}:${qx},${qy},${qz}`;
  const cached = COLOR_SAMPLE_CACHE.get(cacheKey);
  if (cached) {
    cacheHits++;
    return cached;
  }
  cacheMisses++;

  const cfg = ROCK_NOISE[rockId] ?? DEFAULT_NOISE_CONFIG;
  const baseColor = getRockBaseColor(rockId);

  // Primary macro variation
  const na = noiseA(qx * cfg.freqA, qy * cfg.freqA, qz * cfg.freqA); // [-1, 1]
  // Secondary detail variation
  const nb = noiseB(qx * cfg.freqB, qy * cfg.freqB, qz * cfg.freqB);
  // Vein — sharp (abs of noise gives vein-like ridges)
  const nv = Math.abs(noiseVein(qx * cfg.veinFreq, qy * cfg.veinFreq, qz * cfg.veinFreq));
  const vein = Math.max(0, 1 - nv * 5); // thin white/dark streaks

  // Combined brightness modifier
  const brightness =
    na * cfg.contrast
    + nb * cfg.detailStrength
    - vein * cfg.veinStrength;

  // Apply brightness adjustment to base color (clamp to valid range)
  const r = Math.max(0, Math.min(1, baseColor.r + brightness));
  const g = Math.max(0, Math.min(1, baseColor.g + brightness * 0.9));
  const b = Math.max(0, Math.min(1, baseColor.b + brightness * 0.85));

  const color = new THREE.Color(r, g, b);
  COLOR_SAMPLE_CACHE.set(cacheKey, color);
  return color;
}

/**
 * Apply procedural vertex colors to a BufferGeometry.
 * Geometry must already have a 'position' attribute.
 * worldOffset shifts the sampling origin (use mesh's world position).
 *
 * @param geometry    - Three.js BufferGeometry with position attribute
 * @param rockId      - Rock type for texture parameters
 * @param worldOffset - (optional) world-space origin of the geometry
 */
export function applyProceduralColors(
  geometry: THREE.BufferGeometry,
  rockId: string,
  worldOffset: THREE.Vector3 = new THREE.Vector3(),
): void {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  if (!posAttr) return;

  const count = posAttr.count;
  const colorData = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const wx = posAttr.getX(i) + worldOffset.x;
    const wy = posAttr.getY(i) + worldOffset.y;
    const wz = posAttr.getZ(i) + worldOffset.z;
    const c = sampleRockColor(rockId, wx, wy, wz);
    colorData[i * 3]     = c.r;
    colorData[i * 3 + 1] = c.g;
    colorData[i * 3 + 2] = c.b;
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorData, 3));
}

/**
 * Create a MeshPhongMaterial suitable for rock meshes with vertex colors.
 * Shininess is low for a matte, natural rock look.
 */
export function createRockMaterial(): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    vertexColors: true,
    shininess: 10,
    side: THREE.FrontSide,
  });
}

// ---------- Helpers ----------

const baseColorCache = new Map<string, THREE.Color>();

function getRockBaseColor(rockId: string): THREE.Color {
  let cached = baseColorCache.get(rockId);
  if (!cached) {
    const rock = getRock(rockId);
    cached = rock ? new THREE.Color(rock.color) : new THREE.Color(0x888888);
    baseColorCache.set(rockId, cached);
  }
  return cached;
}
