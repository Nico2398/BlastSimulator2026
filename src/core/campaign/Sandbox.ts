// BlastSimulator2026 — Sandbox mode
//
// Free play on a site the player configures, rather than one of the authored
// campaign levels. Reduced to three controls (#504) — biome, difficulty and
// seed — everything else a LevelDef needs is either a fixed constant
// (site extents) or derived from the named difficulty (starting cash).
//
// SANDBOX_FIELDS is the single description of what is configurable. The
// console command parses against it and the UI builds its form from it, so
// the two can't drift apart — adding a field here surfaces it in both places
// at once.

import { getAllBiomes, getBiome } from '../world/BiomeCatalog.js';
import { getAllExplosives } from '../world/ExplosiveCatalog.js';
import { SCORE_DECAY_RATE, DEFAULT_GRID_SIZE, SANDBOX_GRID_DEPTH } from '../config/balance.js';
import type { LevelDef } from './Level.js';

/** Level id a sandbox site runs under. Deliberately not in the campaign catalog. */
export const SANDBOX_LEVEL_ID = 'sandbox';

export type SandboxDifficultyId = 'easy' | 'normal' | 'hard';

export interface SandboxDifficultyDef {
  id: SandboxDifficultyId;
  /** i18n key for the difficulty's label. */
  labelKey: string;
  startingCash: number;
}

/** Named difficulty presets — the only thing that varies between them is starting cash (#504). */
export const SANDBOX_DIFFICULTIES: Record<SandboxDifficultyId, SandboxDifficultyDef> = {
  easy: { id: 'easy', labelKey: 'sandbox.difficulty.easy', startingCash: 250_000 },
  normal: { id: 'normal', labelKey: 'sandbox.difficulty.normal', startingCash: 100_000 },
  hard: { id: 'hard', labelKey: 'sandbox.difficulty.hard', startingCash: 50_000 },
} as const;

export const SANDBOX_DIFFICULTY_ORDER: readonly SandboxDifficultyId[] = ['easy', 'normal', 'hard'];

export interface SandboxConfig {
  /** Biome id from BiomeCatalog — drives climate, rock mix and colour grade. */
  biome: string;
  /** Named difficulty — currently only varies starting cash. */
  difficulty: SandboxDifficultyId;
  /** Terrain seed. The same seed and parameters always rebuild the same map. */
  seed: number;
}

export type SandboxFieldKind = 'number' | 'choice';

export interface SandboxField {
  readonly key: keyof SandboxConfig;
  /** i18n key for the control's label. */
  readonly labelKey: string;
  readonly kind: SandboxFieldKind;
  /** Numeric fields only. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** choice fields only — resolved lazily so catalogs stay the source of truth. */
  readonly options?: () => readonly { id: string; labelKey: string }[];
}

/** Seeds are stored and displayed as plain integers so a player can copy one down. */
export const SANDBOX_SEED_MAX = 999999;

export const SANDBOX_FIELDS: readonly SandboxField[] = [
  {
    key: 'biome', labelKey: 'sandbox.field.biome', kind: 'choice',
    options: () => getAllBiomes().map(b => ({ id: b.id, labelKey: b.nameKey })),
  },
  {
    key: 'difficulty', labelKey: 'sandbox.field.difficulty', kind: 'choice',
    options: () => SANDBOX_DIFFICULTY_ORDER.map(id => ({ id, labelKey: SANDBOX_DIFFICULTIES[id].labelKey })),
  },
  { key: 'seed', labelKey: 'sandbox.field.seed', kind: 'number', min: 0, max: SANDBOX_SEED_MAX, step: 1 },
];

export const SANDBOX_DEFAULTS: SandboxConfig = {
  biome: 'desert_badlands',
  difficulty: 'normal',
  seed: 12345,
};

/**
 * Fill in and bound a partial config.
 *
 * Anything missing, out of range or not a real catalog id falls back to the
 * default rather than failing — the UI clamps as you type and the console
 * accepts a partial parameter list, so both want a total function here.
 */
export function clampSandboxConfig(partial: Partial<SandboxConfig>): SandboxConfig {
  void partial; void getBiome;
  // TODO: implement
  throw new Error('not implemented');
}

/** A fresh random seed for the randomise control. `rand` is injectable so tests stay deterministic. */
export function randomSandboxSeed(rand: () => number = Math.random): number {
  void rand;
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Build the LevelDef a sandbox site runs as.
 *
 * climateBias comes from the chosen biome's own climate centre, the same way
 * the authored levels set theirs, so the generator lands in the biome the
 * player picked instead of wherever the raw climate fields happen to fall.
 * Grid extents are fixed constants (#504) rather than player-configurable.
 */
export function sandboxLevelDef(config: SandboxConfig): LevelDef {
  void config; void SCORE_DECAY_RATE; void DEFAULT_GRID_SIZE; void SANDBOX_GRID_DEPTH; void getAllExplosives;
  // TODO: implement
  throw new Error('not implemented');
}
