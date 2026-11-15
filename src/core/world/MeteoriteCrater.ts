// BlastSimulator2026 — Meteorite crater (#2287)
// One impact crater per progression world, far beyond the ore islands: a round depression with a raised rim,
// over a body of ultra-hard meteoritic rock that hosts treranium. Seeded and lazy.

import type { Rect } from './WorldGen.js';

/** The crater's placement: centre, outer radius and distance from spawn, in metres. */
export interface MeteoriteCraterInfo {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly distance: number;
}

/** What the crater body holds at one voxel. */
export interface CraterBody {
  readonly rockId: string;
  readonly oreDensities: Readonly<Record<string, number>>;
}

export class MeteoriteCrater {
  constructor(
    _seed: number,
    _spawn: { readonly x: number; readonly z: number },
    _isProtected?: (rect: Rect) => boolean,
  ) {
    throw new Error('not implemented');
  }

  /** The crater, or null when no free spot exists. */
  get info(): MeteoriteCraterInfo | null {
    throw new Error('not implemented');
  }

  /** Metres added to the natural ground at a column: negative in the bowl, positive on the rim, 0 elsewhere. */
  reliefAt(_x: number, _z: number): number {
    throw new Error('not implemented');
  }

  /** The body's rock and treranium at a column and depth below the (crater-modified) surface; null outside it. */
  bodyAt(_x: number, _z: number, _depth: number): CraterBody | null {
    throw new Error('not implemented');
  }
}
