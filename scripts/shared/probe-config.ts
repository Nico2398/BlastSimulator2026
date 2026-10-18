import type { SandboxKitId } from '../../src/core/config/balance.js';

export type StrategyId = 'opening' | 'reinvest';
export type KitId = SandboxKitId;

export interface ProbeRunConfig {
  seed: number;
  biome: string;
  kit: KitId;
  strategy: StrategyId;
  horizon: number;
}

export interface ProbeOptions {
  seeds: number[];
  biomes: string[];
  kits: KitId[];
  strategies: StrategyId[];
  horizon: number;
  quick: boolean;
  jsonPath: string | null;
}

export const QUICK_HORIZON = 3000;

export const PROBE_DEFAULTS: ProbeOptions = {
  seeds: [42, 7, 13],
  biomes: ['desert_badlands', 'green_foothills'],
  kits: ['digger', 'full'],
  strategies: ['opening', 'reinvest'],
  horizon: 10000,
  quick: false,
  jsonPath: null,
};

export function parseArgs(_argv: readonly string[]): ProbeOptions {
  throw new Error('not implemented');
}

/** Order: biome, kit, seed, strategy. */
export function expandMatrix(_opts: ProbeOptions): ProbeRunConfig[] {
  throw new Error('not implemented');
}
