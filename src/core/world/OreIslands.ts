// BlastSimulator2026 — Ore islands (#2284)
// G2 ores (craktonite, absurdium) are not in ordinary ground. On progression sites they sit in discrete
// patches scattered beyond a minimum distance from spawn, shallow, and clear of villages, rivers and landmarks.
// Placement is per grid cell, lazy and seeded: a cell nobody generates costs nothing.

import type { Rect } from './WorldGen.js';

/** One island: centre cell, radius in metres, the ores it holds and its distance from spawn. */
export interface OreIsland {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly oreIds: readonly string[];
  readonly distance: number;
}

export class OreIslands {
  /** `isProtected` vetoes an island whose bounding square touches ground a site may never claim. */
  constructor(
    _seed: number,
    _spawn: { readonly x: number; readonly z: number },
    _isProtected?: (rect: Rect) => boolean,
  ) {
    throw new Error('not implemented');
  }

  /** Every island of the world, nearest spawn first. */
  list(): OreIsland[] {
    throw new Error('not implemented');
  }

  /** Stored ore density per island ore at a column and depth below the surface; empty outside islands. */
  densitiesAt(_x: number, _z: number, _depth: number): Record<string, number> {
    throw new Error('not implemented');
  }
}
