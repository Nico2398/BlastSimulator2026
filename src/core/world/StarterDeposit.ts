// BlastSimulator2026 — Sandbox starter deposit (#2116)
// Every sandbox site (ore deposits on) gets one shallow, close, breakable, sellable deposit placed by
// world-gen, so no seed or biome opens without something to blast and sell.

import type { TerrainConfig } from './TerrainGen.js';

/** Where the starter deposit sits and what it holds; x/z are the centre cell, radius the pocket radius in metres. */
export interface StarterDeposit {
  readonly x: number;
  readonly z: number;
  readonly oreId: string;
  readonly radius: number;
}

/** The starter deposit of a site, or null when the site has ore deposits off (campaign levels). */
export function resolveStarterDeposit(_config: TerrainConfig): StarterDeposit | null {
  return null; // skeleton (#2116)
}
