// BlastSimulator2026 — Sandbox mode
//
// Free play on a site the player configures, rather than one of the authored
// campaign levels. Reduced to three controls (#504, #1891) — biome, starting
// kit and seed — everything else a LevelDef needs is either a fixed constant
// (site extents) or derived from the named kit (starting cash, crew, fleet).
//
// SANDBOX_FIELDS is the single description of what is configurable. The
// console command parses against it and the UI builds its form from it, so
// the two can't drift apart — adding a field here surfaces it in both places
// at once.

import { getAllBiomes, getBiome } from '../world/BiomeCatalog.js';
import { getRock } from '../world/RockCatalog.js';
import { sandboxOresYieldedByRocks, sandboxOreWindow } from '../world/SandboxDeepOre.js';
import { getOre } from '../world/OreCatalog.js';
import { getAllExplosives } from '../world/ExplosiveCatalog.js';
import { SCORE_DECAY_RATE, SANDBOX_STARTING_SITES, SANDBOX_STARTING_CASH, type SandboxKitId, type StartingSiteComposition, DEFAULT_GRID_SIZE, SANDBOX_DATUM, SANDBOX_RUGGEDNESS_ROLLING_PV, SANDBOX_RUGGEDNESS_STEEP_PV, SANDBOX_PIT_MASK, SANDBOX_MARKET, SANDBOX_ORE_GRADE_SCALE } from '../config/balance.js';
import { climateBiasLandingOn } from '../world/TerrainGen.js';
import type { EmployeeRole } from '../entities/Employee.js';
import type { VehicleRole, VehicleTier } from '../entities/Vehicle.js';
import type { BuildingType, BuildingTier } from '../entities/Building.js';
import type { LevelDef } from './Level.js';

/** Level id a sandbox site runs under. Deliberately not in the campaign catalog. */
export const SANDBOX_LEVEL_ID = 'sandbox';

export type { SandboxKitId };

export interface SandboxKitDef {
  id: SandboxKitId;
  /** i18n key for the kit's label. */
  labelKey: string;
  startingCash: number;
  /** Free opening crew, fleet and buildings (#1671). */
  startingSite: StartingSiteComposition;
}

/**
 * Named starting kits — opening cash and the free crew, fleet and buildings
 * vary (#1671, #1891). Cash rationale beside SANDBOX_STARTING_CASH in balance.ts.
 */
export const SANDBOX_KITS: Record<SandboxKitId, SandboxKitDef> = {
  digger: { id: 'digger', labelKey: 'sandbox.kit.digger', startingSite: SANDBOX_STARTING_SITES.digger, startingCash: SANDBOX_STARTING_CASH.digger },
  full: { id: 'full', labelKey: 'sandbox.kit.full', startingSite: SANDBOX_STARTING_SITES.full, startingCash: SANDBOX_STARTING_CASH.full },
};

export const SANDBOX_KIT_ORDER: readonly SandboxKitId[] = ['digger', 'full'];

/**
 * Retired difficulty names still accepted by the console `difficulty:` arg:
 * easy -> full, normal/hard -> digger. Null-prototype so 'constructor' etc. miss.
 */
const SANDBOX_LEGACY_DIFFICULTY_ALIASES: Readonly<Record<string, SandboxKitId>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, SandboxKitId>, { easy: 'full', normal: 'digger', hard: 'digger' }),
);

/** Resolve a kit id or legacy difficulty alias (case and edge whitespace ignored); undefined when unknown. */
export function resolveSandboxKitId(raw: string): SandboxKitId | undefined {
  const key = raw.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SANDBOX_KITS, key)) return key as SandboxKitId;
  return SANDBOX_LEGACY_DIFFICULTY_ALIASES[key];
}

export interface SandboxConfig {
  /** Biome id from BiomeCatalog — drives climate, rock mix and colour grade. */
  biome: string;
  /** Named starting kit — sets starting cash and the free crew, fleet and buildings. */
  kit: SandboxKitId;
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
    key: 'kit', labelKey: 'sandbox.field.kit', kind: 'choice',
    options: () => SANDBOX_KIT_ORDER.map(id => ({ id, labelKey: SANDBOX_KITS[id].labelKey })),
  },
  { key: 'seed', labelKey: 'sandbox.field.seed', kind: 'number', min: 0, max: SANDBOX_SEED_MAX, step: 1 },
];

export const SANDBOX_DEFAULTS: SandboxConfig = {
  biome: 'desert_badlands',
  kit: 'digger',
  seed: 12345,
};

// Fixed LevelDef fields (#504) — preserved from the pre-#504 SANDBOX_DEFAULTS
// so removing the corresponding controls doesn't change site behaviour.
const SANDBOX_FIXED_EVENT_FREQ_MULTIPLIER = 1;
const SANDBOX_FIXED_CONTRACT_PRICE_MULTIPLIER = 1;
const SANDBOX_FIXED_MIXED_ROCK_HARDNESS = false;
/** Sandbox ore forms localized deposits separated by barren ground (#1682). */
const SANDBOX_FIXED_ORE_DEPOSITS = true;
// Inert LevelDef filler: the sandbox has no activeLevelId, so no profit goal is ever evaluated
// against it — sandbox is endless free play (#1321).
const SANDBOX_FIXED_UNLOCK_THRESHOLD = 100000;

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

  const seedField = SANDBOX_FIELDS.find(f => f.key === 'seed')!;
  out.seed = Math.round(clampNumber(Number(out.seed), seedField, SANDBOX_DEFAULTS.seed));

  if (!getBiome(out.biome)) out.biome = SANDBOX_DEFAULTS.biome;
  if (!SANDBOX_KIT_ORDER.includes(out.kit)) out.kit = SANDBOX_DEFAULTS.kit;

  return out;
}

/** A fresh random seed for the randomise control. `rand` is injectable so tests stay deterministic. */
export function randomSandboxSeed(rand: () => number = Math.random): number {
  return Math.floor(rand() * (SANDBOX_SEED_MAX + 1));
}

/**
 * Build the LevelDef a sandbox site runs as.
 *
 * climateBias is solved per seed (climateBiasLandingOn) so the generator
 * lands in the biome the player picked on every seed, not wherever the raw
 * climate fields happen to fall.
 * Grid extents are fixed constants (#504) rather than player-configurable.
 */
export function sandboxLevelDef(config: SandboxConfig): LevelDef {
  const clamped = clampSandboxConfig(config);
  const biome = getBiome(clamped.biome)!;

  return {
    id: SANDBOX_LEVEL_ID,
    nameKey: 'sandbox.level.name',
    descKey: 'sandbox.level.desc',
    biome: clamped.biome,
    climateBias: climateBiasLandingOn(clamped.seed, DEFAULT_GRID_SIZE, DEFAULT_GRID_SIZE, biome),
    terrainSeed: clamped.seed,
    gridX: DEFAULT_GRID_SIZE,
    datum: SANDBOX_DATUM,
    gridZ: DEFAULT_GRID_SIZE,
    startingCash: SANDBOX_KITS[clamped.kit].startingCash,
    startingSite: SANDBOX_KITS[clamped.kit].startingSite,
    availableExplosives: getAllExplosives().map(e => e.id),
    unlockThreshold: SANDBOX_FIXED_UNLOCK_THRESHOLD,
    eventFreqMultiplier: SANDBOX_FIXED_EVENT_FREQ_MULTIPLIER,
    contractPriceMultiplier: SANDBOX_FIXED_CONTRACT_PRICE_MULTIPLIER,
    scoreDecayRate: SCORE_DECAY_RATE,
    mixedRockHardness: SANDBOX_FIXED_MIXED_ROCK_HARDNESS,
    oreDeposits: SANDBOX_FIXED_ORE_DEPOSITS,
    // Tier 0 keeps it off the campaign world map, which lists tier > 0 only.
    difficultyTier: 0,
    pitMask: SANDBOX_PIT_MASK,
    oreGradeScale: SANDBOX_ORE_GRADE_SCALE,
    market: SANDBOX_MARKET,
    progression: true,
  };
}

type SandboxRuggedness = 'flat' | 'rolling' | 'steep';

/** Player-facing traits of a biome, shown in the sandbox picker (#1686). */
interface SandboxBiomeTraits {
  descKey: string;
  /** Hardness tier range over the biome's dominant rocks. */
  hardnessTierMin: number;
  hardnessTierMax: number;
  /** Ores the biome's dominant rocks can yield. */
  ores: readonly { oreId: string; nameKey: string; depthMin: number; depthMax: number }[];
  oreDepthMin: number;
  oreDepthMax: number;
  ruggedness: SandboxRuggedness;
  pvAmplitude: number;
}

/** Traits for a biome id; an unknown id resolves to the default biome. */
export function sandboxBiomeTraits(biomeId: string): SandboxBiomeTraits {
  const biome = getBiome(biomeId) ?? getBiome(SANDBOX_DEFAULTS.biome)!;

  const tiers = biome.dominantRocks.flatMap(id => getRock(id)?.hardnessTier ?? []);
  const ores = sandboxOresYieldedByRocks(biome.dominantRocks).flatMap(id => {
    const ore = getOre(id);
    if (!ore) return [];
    const [depthMin, depthMax] = sandboxOreWindow(ore);
    return [{ oreId: id, nameKey: ore.nameKey, depthMin, depthMax }];
  });

  const ruggedness: SandboxRuggedness =
    biome.pvAmplitude < SANDBOX_RUGGEDNESS_ROLLING_PV ? 'flat'
      : biome.pvAmplitude < SANDBOX_RUGGEDNESS_STEEP_PV ? 'rolling' : 'steep';

  return {
    descKey: biome.descKey,
    hardnessTierMin: tiers.length ? Math.min(...tiers) : 0,
    hardnessTierMax: tiers.length ? Math.max(...tiers) : 0,
    ores,
    oreDepthMin: ores.length ? Math.min(...ores.map(o => o.depthMin)) : 0,
    oreDepthMax: ores.length ? Math.max(...ores.map(o => o.depthMax)) : 0,
    ruggedness,
    pvAmplitude: biome.pvAmplitude,
  };
}

/** What a kit hands the player at the start (#1686). */
export interface SandboxKitDetails {
  id: SandboxKitId;
  labelKey: string;
  startingCash: number;
  crew: readonly { role: EmployeeRole; count: number }[];
  vehicles: readonly { role: VehicleRole; tier: VehicleTier; count: number }[];
  buildings: readonly { type: BuildingType; tier: BuildingTier; count: number }[];
  /** Explosive stock the kit's starting buildings hold, summed per explosive (#2118). */
  stock: readonly { explosiveId: string; kg: number }[];
}

/** Collapse a list of slots into one entry per distinct key, counting repeats in first-seen order. */
function groupSlots<S extends object>(slots: readonly S[], keyOf: (slot: S) => string): (S & { count: number })[] {
  const groups = new Map<string, S & { count: number }>();
  for (const slot of slots) {
    const key = keyOf(slot);
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { ...slot, count: 1 });
  }
  return [...groups.values()];
}

/**
 * What a kit hands the player at the start: cash plus its starting
 * site's crew, vehicles and buildings, each grouped into counted entries.
 */
export function sandboxKitDetails(id: SandboxKitId): SandboxKitDetails {
  const def = SANDBOX_KITS[id];
  const { employees, vehicles, buildings } = def.startingSite;
  return {
    id: def.id,
    labelKey: def.labelKey,
    startingCash: def.startingCash,
    crew: groupSlots(employees.map(e => ({ role: e.role })), e => e.role),
    vehicles: groupSlots(vehicles.map(v => ({ role: v.role, tier: v.tier })), v => `${v.role}:${v.tier}`),
    buildings: groupSlots(buildings.map(b => ({ type: b.type, tier: b.tier })), b => `${b.type}:${b.tier}`),
    stock: [], // TODO skeleton: summed from the buildings' stock slots
  };
}
