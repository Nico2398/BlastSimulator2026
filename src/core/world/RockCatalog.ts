// BlastSimulator2026 — Rock type catalog
// 10 fictional rock types spanning hardness tiers 1–5.
// Real-world basis documented per entry.

export interface RockType {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey: string;
  /** Hardness tier 1 (softest) to 5 (hardest). */
  readonly hardnessTier: number;
  /** Energy threshold to fracture, in game energy units. */
  readonly fractureThreshold: number;
  /** Energy absorption coefficient for energy propagation (matches fractureThreshold for now; refined in 5.2). */
  readonly energyAbsorption: number;
  /** kg/m³. */
  readonly density: number;
  /** 0–1 scale. Affects water infiltration into drill holes. */
  readonly porosity: number;
  /** Map of ore_id → probability (0–1). Must sum to ≤ 1.0. */
  readonly oreProbabilities: Readonly<Record<string, number>>;
  /** Hex color for placeholder textures. */
  readonly color: string;
  /** Frequency for 3D Simplex noise in terrain generation. Higher = more detail. */
  readonly noiseFreq: number;
  /** Level bias for terrain generation. Higher = more common. Range ~[-1, 1]. */
  readonly levelBias: number;
}

// Fracture threshold formula: tier² × 150 + base
// This gives a smooth curve from ~200 (tier 1) to ~4000 (tier 5).
//
// Noise frequency: softer rocks (tier 1) → higher freq (more chaotic);
// harder rocks (tier 5) → lower freq (more uniform).
// Level bias: softer rocks → lower bias (rarer); harder → higher bias (more common).

const ROCKS: readonly RockType[] = [
  {
    id: 'cruite',
    nameKey: 'rock.cruite.name',
    descKey: 'rock.cruite.desc',
    hardnessTier: 1,
    fractureThreshold: 200,
    energyAbsorption: 200,
    density: 2100,
    porosity: 0.35,
    oreProbabilities: { dirtite: 0.40, rustite: 0.15 },
    color: '#e8dcc8',
    noiseFreq: 0.08,
    levelBias: -0.3,
  },
  {
    id: 'sandite',
    nameKey: 'rock.sandite.name',
    descKey: 'rock.sandite.desc',
    hardnessTier: 1,
    fractureThreshold: 250,
    energyAbsorption: 250,
    density: 2200,
    porosity: 0.30,
    oreProbabilities: { dirtite: 0.30, rustite: 0.20 },
    color: '#d4b483',
    noiseFreq: 0.10,
    levelBias: -0.2,
  },
  {
    id: 'molite',
    nameKey: 'rock.molite.name',
    descKey: 'rock.molite.desc',
    hardnessTier: 2,
    fractureThreshold: 500,
    energyAbsorption: 500,
    density: 2400,
    porosity: 0.20,
    oreProbabilities: { rustite: 0.25, blingite: 0.10, dirtite: 0.15 },
    color: '#c9bfa3',
    noiseFreq: 0.07,
    levelBias: 0.0,
  },
  {
    id: 'grumpite',
    nameKey: 'rock.grumpite.name',
    descKey: 'rock.grumpite.desc',
    hardnessTier: 2,
    fractureThreshold: 600,
    energyAbsorption: 600,
    density: 2550,
    porosity: 0.18,
    oreProbabilities: { rustite: 0.20, blingite: 0.15, gloomium: 0.05 },
    color: '#8a7f72',
    noiseFreq: 0.06,
    levelBias: 0.1,
  },
  {
    id: 'clunkite',
    nameKey: 'rock.clunkite.name',
    descKey: 'rock.clunkite.desc',
    hardnessTier: 3,
    fractureThreshold: 1100,
    energyAbsorption: 1100,
    density: 2650,
    porosity: 0.12,
    oreProbabilities: { blingite: 0.15, gloomium: 0.10, sparkium: 0.05 },
    color: '#6b6b6b',
    noiseFreq: 0.05,
    levelBias: 0.2,
  },
  {
    id: 'stubite',
    nameKey: 'rock.stubite.name',
    descKey: 'rock.stubite.desc',
    hardnessTier: 3,
    fractureThreshold: 1300,
    energyAbsorption: 1300,
    density: 2700,
    porosity: 0.10,
    oreProbabilities: { blingite: 0.12, gloomium: 0.12, sparkium: 0.08 },
    color: '#9e8e7e',
    noiseFreq: 0.05,
    levelBias: 0.3,
  },
  {
    id: 'obstiite',
    nameKey: 'rock.obstiite.name',
    descKey: 'rock.obstiite.desc',
    hardnessTier: 4,
    fractureThreshold: 2200,
    energyAbsorption: 2200,
    density: 2800,
    porosity: 0.06,
    oreProbabilities: { sparkium: 0.12, craktonite: 0.08, absurdium: 0.03 },
    color: '#3d3d3d',
    noiseFreq: 0.04,
    levelBias: 0.4,
  },
  {
    id: 'gnarlite',
    nameKey: 'rock.gnarlite.name',
    descKey: 'rock.gnarlite.desc',
    hardnessTier: 4,
    fractureThreshold: 2600,
    energyAbsorption: 2600,
    density: 2900,
    porosity: 0.05,
    oreProbabilities: { sparkium: 0.10, craktonite: 0.10, absurdium: 0.05 },
    color: '#2a4a2a',
    noiseFreq: 0.03,
    levelBias: 0.5,
  },
  {
    id: 'absurdite',
    nameKey: 'rock.absurdite.name',
    descKey: 'rock.absurdite.desc',
    hardnessTier: 5,
    fractureThreshold: 3500,
    energyAbsorption: 3500,
    density: 3100,
    porosity: 0.03,
    oreProbabilities: { craktonite: 0.08, absurdium: 0.08, treranium: 0.03 },
    color: '#c46bdb',
    noiseFreq: 0.03,
    levelBias: 0.6,
  },
  {
    id: 'titanite',
    nameKey: 'rock.titanite.name',
    descKey: 'rock.titanite.desc',
    hardnessTier: 5,
    fractureThreshold: 4000,
    energyAbsorption: 4000,
    density: 3300,
    porosity: 0.02,
    oreProbabilities: { absurdium: 0.10, treranium: 0.08 },
    color: '#1a1a3a',
    noiseFreq: 0.02,
    levelBias: 0.7,
  },
] as const;

const ROCK_MAP = new Map<string, RockType>(ROCKS.map(r => [r.id, r]));

/** Get a rock type by ID. Returns undefined if not found. */
export function getRock(id: string): RockType | undefined {
  return ROCK_MAP.get(id);
}

/** Get all rock types. */
export function getAllRocks(): readonly RockType[] {
  return ROCKS;
}
