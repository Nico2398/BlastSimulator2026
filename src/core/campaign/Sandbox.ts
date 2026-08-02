// BlastSimulator2026 — Sandbox mode
//
// Free play on a site the player configures, rather than one of the authored
// campaign levels. Every parameter a LevelDef fixes is exposed, seed included,
// so a map can be written down and replayed exactly.
//
// SANDBOX_FIELDS is the single description of what is configurable and within
// what bounds. The console command parses against it and the UI builds its
// form from it, so the two can't drift apart — adding a field here surfaces it
// in both places at once.

import { getAllBiomes, getBiome } from '../world/BiomeCatalog.js';
import { getAllExplosives } from '../world/ExplosiveCatalog.js';
import type { LevelDef } from './Level.js';

/** Level id a sandbox site runs under. Deliberately not in the campaign catalog. */
export const SANDBOX_LEVEL_ID = 'sandbox';

export interface SandboxConfig {
  /** Biome id from BiomeCatalog — drives climate, rock mix and colour grade. */
  biome: string;
  /** Terrain seed. The same seed and parameters always rebuild the same map. */
  seed: number;
  /** Playable grid extent, in metres, on X and Z. */
  size: number;
  /** Playable grid depth, in metres. */
  depth: number;
  startingCash: number;
  /** Cumulative profit that counts as "finished". */
  unlockThreshold: number;
  /** Random-event frequency: 0 disables events entirely. */
  eventFreqMultiplier: number;
  /** Contract price multiplier: above 1 is a generous market. */
  contractPriceMultiplier: number;
  scoreDecayRate: number;
  /** Interleave hard and soft rock layers, making projection harder to manage. */
  mixedRockHardness: boolean;
  /** Explosive ids available on site. Empty means "every explosive". */
  availableExplosives: readonly string[];
}

export type SandboxFieldKind = 'number' | 'choice' | 'boolean' | 'multi';

export interface SandboxField {
  readonly key: keyof SandboxConfig;
  /** i18n key for the control's label. */
  readonly labelKey: string;
  readonly kind: SandboxFieldKind;
  /** Numeric fields only. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** choice/multi fields only — resolved lazily so catalogs stay the source of truth. */
  readonly options?: () => readonly { id: string; labelKey: string }[];
}

/**
 * Grid extents are bounded by what the rest of the engine was sized for: the
 * largest authored level is 160 per axis (#458 T6.1/D13), and pathfinding,
 * physics region scoping and the landscape mesher were all tuned against that
 * ceiling. Below 16 there isn't enough room to lay out a drill pattern.
 */
export const SANDBOX_SIZE_MIN = 16;
export const SANDBOX_SIZE_MAX = 160;
export const SANDBOX_DEPTH_MIN = 12;
export const SANDBOX_DEPTH_MAX = 60;
/** Seeds are stored and displayed as plain integers so a player can copy one down. */
export const SANDBOX_SEED_MAX = 999999;

export const SANDBOX_FIELDS: readonly SandboxField[] = [
  {
    key: 'biome', labelKey: 'sandbox.field.biome', kind: 'choice',
    options: () => getAllBiomes().map(b => ({ id: b.id, labelKey: b.nameKey })),
  },
  { key: 'seed', labelKey: 'sandbox.field.seed', kind: 'number', min: 0, max: SANDBOX_SEED_MAX, step: 1 },
  { key: 'size', labelKey: 'sandbox.field.size', kind: 'number', min: SANDBOX_SIZE_MIN, max: SANDBOX_SIZE_MAX, step: 8 },
  { key: 'depth', labelKey: 'sandbox.field.depth', kind: 'number', min: SANDBOX_DEPTH_MIN, max: SANDBOX_DEPTH_MAX, step: 4 },
  { key: 'startingCash', labelKey: 'sandbox.field.cash', kind: 'number', min: 0, max: 10000000, step: 5000 },
  { key: 'unlockThreshold', labelKey: 'sandbox.field.goal', kind: 'number', min: 0, max: 10000000, step: 5000 },
  { key: 'eventFreqMultiplier', labelKey: 'sandbox.field.events', kind: 'number', min: 0, max: 5, step: 0.1 },
  { key: 'contractPriceMultiplier', labelKey: 'sandbox.field.prices', kind: 'number', min: 0.1, max: 5, step: 0.1 },
  { key: 'scoreDecayRate', labelKey: 'sandbox.field.decay', kind: 'number', min: 0, max: 1, step: 0.01 },
  { key: 'mixedRockHardness', labelKey: 'sandbox.field.mixed_rock', kind: 'boolean' },
  {
    key: 'availableExplosives', labelKey: 'sandbox.field.explosives', kind: 'multi',
    options: () => getAllExplosives().map(e => ({ id: e.id, labelKey: e.nameKey })),
  },
];

export const SANDBOX_DEFAULTS: SandboxConfig = {
  biome: 'desert_badlands',
  seed: 12345,
  size: 64,
  depth: 32,
  startingCash: 100000,
  unlockThreshold: 100000,
  eventFreqMultiplier: 1,
  contractPriceMultiplier: 1,
  scoreDecayRate: 0.05,
  mixedRockHardness: false,
  availableExplosives: [],
};

function clampNumber(value: number, field: SandboxField, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, value));
}

/**
 * Fill in and bound a partial config.
 *
 * Anything missing, out of range or not a real catalog id falls back to the
 * default rather than failing — the UI clamps as you type and the console
 * accepts a partial parameter list, so both want a total function here.
 */
export function clampSandboxConfig(partial: Partial<SandboxConfig>): SandboxConfig {
  const out: SandboxConfig = { ...SANDBOX_DEFAULTS, ...partial };

  for (const field of SANDBOX_FIELDS) {
    if (field.kind !== 'number') continue;
    const key = field.key as 'seed' | 'size' | 'depth' | 'startingCash' | 'unlockThreshold'
      | 'eventFreqMultiplier' | 'contractPriceMultiplier' | 'scoreDecayRate';
    out[key] = clampNumber(Number(out[key]), field, SANDBOX_DEFAULTS[key]);
  }
  // A seed is an identity, not a measurement — it has to survive a round trip
  // through the UI's number input exactly or "replay this map" breaks.
  out.seed = Math.round(out.seed);
  out.size = Math.round(out.size);
  out.depth = Math.round(out.depth);

  if (!getBiome(out.biome)) out.biome = SANDBOX_DEFAULTS.biome;

  const known = new Set(getAllExplosives().map(e => e.id));
  out.availableExplosives = (out.availableExplosives ?? []).filter(id => known.has(id));

  return out;
}

/** A fresh random seed for the randomise control. `rand` is injectable so tests stay deterministic. */
export function randomSandboxSeed(rand: () => number = Math.random): number {
  return Math.floor(rand() * (SANDBOX_SEED_MAX + 1));
}

/**
 * Build the LevelDef a sandbox site runs as.
 *
 * climateBias comes from the chosen biome's own climate centre, the same way
 * the authored levels set theirs, so the generator lands in the biome the
 * player picked instead of wherever the raw climate fields happen to fall.
 */
export function sandboxLevelDef(config: SandboxConfig): LevelDef {
  const clamped = clampSandboxConfig(config);
  const biome = getBiome(clamped.biome)!;
  const explosives = clamped.availableExplosives.length > 0
    ? [...clamped.availableExplosives]
    : getAllExplosives().map(e => e.id);

  return {
    id: SANDBOX_LEVEL_ID,
    nameKey: 'sandbox.level.name',
    descKey: 'sandbox.level.desc',
    biome: clamped.biome,
    climateBias: biome.climateCenter,
    terrainSeed: clamped.seed,
    gridX: clamped.size,
    gridY: clamped.depth,
    gridZ: clamped.size,
    startingCash: clamped.startingCash,
    availableExplosives: explosives,
    unlockThreshold: clamped.unlockThreshold,
    eventFreqMultiplier: clamped.eventFreqMultiplier,
    contractPriceMultiplier: clamped.contractPriceMultiplier,
    scoreDecayRate: clamped.scoreDecayRate,
    mixedRockHardness: clamped.mixedRockHardness,
    // Tier 0 keeps it off the campaign world map, which lists tier > 0 only.
    difficultyTier: 0,
  };
}
