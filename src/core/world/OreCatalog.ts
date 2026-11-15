// BlastSimulator2026 — Ore type catalog
// 8 fictional ores from bulk filler to legendary Treranium.

export interface OreType {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey: string;
  /** Base market value per kg in game dollars. */
  readonly valuePerKg: number;
  /** Rarity tier: 'common' | 'uncommon' | 'rare' | 'very_rare' | 'legendary'. */
  readonly rarity: string;
  /** Hex color for UI display and texture tinting. */
  readonly color: string;
  /** Depth window (metres below surface) an ore vein can appear in — rarer ores sit deeper (#458 T1.3/A12). */
  readonly depthMin: number;
  readonly depthMax: number;
  /** Permit grade (0-3) the ore belongs to: contracts name the current grade's ores, lower grades sell automatically, higher wait (#2278). */
  readonly permitGrade: number;
}

/** Highest permit grade an ore belongs to (G3). */
export const ORE_MAX_PERMIT_GRADE = 3;

/** depthMax sentinel for an ore with no lower depth limit. */
export const ORE_DEPTH_UNBOUNDED = 999;

const ORES: readonly OreType[] = [
  {
    id: 'dirtite',
    permitGrade: 0,
    nameKey: 'ore.dirtite.name',
    descKey: 'ore.dirtite.desc',
    valuePerKg: 2,
    rarity: 'common',
    color: '#8B6914',       // Brown
    depthMin: 0, depthMax: 10,
  },
  {
    id: 'rustite',
    permitGrade: 0,
    nameKey: 'ore.rustite.name',
    descKey: 'ore.rustite.desc',
    valuePerKg: 8,
    rarity: 'common',
    color: '#B7410E',       // Orange-red
    depthMin: 0, depthMax: 15,
  },
  {
    id: 'blingite',
    permitGrade: 1,
    nameKey: 'ore.blingite.name',
    descKey: 'ore.blingite.desc',
    valuePerKg: 25,
    rarity: 'uncommon',
    color: '#FFD700',       // Gold
    // Depth windows are global; biome coverage comes from which rocks host an ore (#1677).
    depthMin: 5, depthMax: 40,
  },
  {
    id: 'gloomium',
    permitGrade: 1,
    nameKey: 'ore.gloomium.name',
    descKey: 'ore.gloomium.desc',
    valuePerKg: 60,
    rarity: 'uncommon',
    color: '#4B0082',       // Dark purple
    depthMin: 8, depthMax: 28,
  },
  {
    id: 'sparkium',
    permitGrade: 1,
    nameKey: 'ore.sparkium.name',
    descKey: 'ore.sparkium.desc',
    valuePerKg: 150,
    rarity: 'rare',
    color: '#00BFFF',       // Electric blue
    depthMin: 15, depthMax: 38,
  },
  {
    id: 'craktonite',
    permitGrade: 2,
    nameKey: 'ore.craktonite.name',
    descKey: 'ore.craktonite.desc',
    valuePerKg: 350,
    rarity: 'rare',
    color: '#32CD32',       // Green
    depthMin: 18, depthMax: 45,
  },
  {
    id: 'absurdium',
    permitGrade: 2,
    nameKey: 'ore.absurdium.name',
    descKey: 'ore.absurdium.desc',
    valuePerKg: 800,
    rarity: 'very_rare',
    color: '#FF69B4',       // Pink
    depthMin: 25, depthMax: 55,
  },
  {
    id: 'treranium',
    permitGrade: 3,
    nameKey: 'ore.treranium.name',
    descKey: 'ore.treranium.desc',
    valuePerKg: 2000,
    rarity: 'legendary',
    color: '#E0B0FF',       // Iridescent / mauve
    depthMin: 32, depthMax: ORE_DEPTH_UNBOUNDED,
  },
] as const;

const ORE_MAP = new Map<string, OreType>(ORES.map(o => [o.id, o]));

/** Get an ore type by ID. Returns undefined if not found. */
export function getOre(id: string): OreType | undefined {
  return ORE_MAP.get(id);
}

/** Get all ore types. */
export function getAllOres(): readonly OreType[] {
  return ORES;
}

/** Stable index of an ore id into getAllOres()'s fixed order — the aOre vertex attribute's ore-id component (#458 T3.1/A18). -1 for none/unknown. */
export function oreIndexOf(id: string): number {
  return ORES.findIndex(o => o.id === id);
}

/** Permit grade of an ore; undefined for an unknown id (#2278). */
export function orePermitGrade(_id: string): number | undefined {
  throw new Error('not implemented');
}

/** The ids among `ids` whose permit grade is `grade` (a grade above G3 counts as G3), in input order (#2278). */
export function oresOfPermitGrade(_ids: readonly string[], _grade: number): string[] {
  throw new Error('not implemented');
}
