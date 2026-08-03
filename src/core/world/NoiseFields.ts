// BlastSimulator2026 — Named, independently-seeded 2D noise fields for world generation
// Replaces TerrainGen's old single 3-octave stack. Coordinates are always
// absolute world metres — never normalized by grid size — so a feature's
// wavelength stays constant regardless of how large a level's grid is
// (#458 T1.1 / A2). Each field draws from its own sub-seeded PRNG (Hash.ts)
// so adding, removing, or reordering a field never re-rolls the others.

import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { Random } from '../math/Random.js';
import { subSeed } from '../math/Hash.js';

/** Fractal Brownian motion over a 2D simplex field. Output ~[-1, 1]. */
export function fbm2(
  noise: NoiseFunction2D,
  x: number,
  z: number,
  octaves: number,
  baseFreq: number,
  gain = 0.5,
  lacunarity = 2.0,
): number {
  let sum = 0, amp = 1, freq = baseFreq, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Ridged variant: sharp crests instead of smooth hills. Output [0, 1]. */
export function ridged2(
  noise: NoiseFunction2D,
  x: number,
  z: number,
  octaves: number,
  baseFreq: number,
  gain = 0.5,
  lacunarity = 2.0,
): number {
  let sum = 0, amp = 1, freq = baseFreq, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise(x * freq, z * freq));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

function makeField(seed: number, label: string): NoiseFunction2D {
  const rng = new Random(subSeed(seed, label));
  return createNoise2D(() => rng.next());
}

/** Domain warp amplitude (metres) applied to continentalness/erosion/peaksValleys. */
const WARP_AMPLITUDE = 120;

/**
 * All named noise fields for one world/level seed. Field labels are
 * world-breaking to change — every existing seed's terrain depends on them.
 */
export class WorldNoiseFields {
  private readonly continentalnessNoise: NoiseFunction2D;
  private readonly erosionNoise: NoiseFunction2D;
  private readonly peaksValleysNoise: NoiseFunction2D;
  private readonly warpXNoise: NoiseFunction2D;
  private readonly warpZNoise: NoiseFunction2D;
  private readonly temperatureNoise: NoiseFunction2D;
  private readonly humidityNoise: NoiseFunction2D;
  private readonly detailNoise: NoiseFunction2D;
  private readonly forestNoise: NoiseFunction2D;
  private readonly riverSpringNoise: NoiseFunction2D;

  constructor(seed: number) {
    this.continentalnessNoise = makeField(seed, 'continentalness');
    this.erosionNoise = makeField(seed, 'erosion');
    this.peaksValleysNoise = makeField(seed, 'peaksValleys');
    this.warpXNoise = makeField(seed, 'warpX');
    this.warpZNoise = makeField(seed, 'warpZ');
    this.temperatureNoise = makeField(seed, 'temperature');
    this.humidityNoise = makeField(seed, 'humidity');
    this.detailNoise = makeField(seed, 'detail');
    this.forestNoise = makeField(seed, 'forest');
    this.riverSpringNoise = makeField(seed, 'riverSpring');
  }

  /** Domain-warped (x, z) — used internally by continentalness/erosion/peaksValleys only. */
  warpedCoords(x: number, z: number): { x: number; z: number } {
    const wx = x + WARP_AMPLITUDE * fbm2(this.warpXNoise, x, z, 3, 1 / 600);
    const wz = z + WARP_AMPLITUDE * fbm2(this.warpZNoise, x, z, 3, 1 / 600);
    return { x: wx, z: wz };
  }

  /** Macro elevation: plains vs highlands vs ranges. Warped. ~[-1, 1]. */
  continentalness(x: number, z: number): number {
    const w = this.warpedCoords(x, z);
    return fbm2(this.continentalnessNoise, w.x, w.z, 4, 1 / 800);
  }

  /** Flattens or sharpens relief; valley width. Warped. ~[-1, 1]. */
  erosion(x: number, z: number): number {
    const w = this.warpedCoords(x, z);
    return fbm2(this.erosionNoise, w.x, w.z, 4, 1 / 400);
  }

  /** Local ridges, hills, gullies. Warped. [0, 1]. */
  peaksValleys(x: number, z: number): number {
    const w = this.warpedCoords(x, z);
    return ridged2(this.peaksValleysNoise, w.x, w.z, 5, 1 / 150);
  }

  /** Climate: biome selection. Not warped. ~[-1, 1]. */
  temperature(x: number, z: number): number {
    return fbm2(this.temperatureNoise, x, z, 3, 1 / 1200);
  }

  /** Climate: biome selection. Not warped. ~[-1, 1]. */
  humidity(x: number, z: number): number {
    return fbm2(this.humidityNoise, x, z, 3, 1 / 1100);
  }

  /** Metre-scale surface roughness. Not warped. ~[-1, 1]. */
  detail(x: number, z: number): number {
    return fbm2(this.detailNoise, x, z, 3, 1 / 24);
  }

  /** Forest placement density. Not warped. ~[-1, 1]. */
  forest(x: number, z: number): number {
    return fbm2(this.forestNoise, x, z, 3, 1 / 90);
  }

  /** River spring candidacy. Not warped. ~[-1, 1]. */
  riverSpring(x: number, z: number): number {
    return fbm2(this.riverSpringNoise, x, z, 2, 1 / 300);
  }
}
