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
  /** kg/m³. */
  readonly density: number;
  /** 0–1 scale. Affects water infiltration into drill holes. */
  readonly porosity: number;
  /** Map of ore_id → probability (0–1). Must sum to ≤ 1.0. */
  readonly oreProbabilities: Readonly<Record<string, number>>;
  /** Hex color for placeholder textures. */
  readonly color: string;
}

// Fracture threshold formula: tier² × 150 + base
// This gives a smooth curve from ~200 (tier 1) to ~4000 (tier 5).

const ROCKS: readonly RockType[] = [
  {
    id: 'cruite',
    nameKey: 'rock.cruite.name',
    descKey: 'rock.cruite.desc',
    hardnessTier: 1,
    fractureThreshold: 200,   // Soft chalk/marl, real ~2–5 MPa compressive strength
    density: 2100,             // Real chalk: ~2000–2200 kg/m³
    porosity: 0.35,            // Real chalk: ~30–40%
    oreProbabilities: { dirtite: 0.40, rustite: 0.15 },
    color: '#e8dcc8',
  },
  {
    id: 'sandite',
    nameKey: 'rock.sandite.name',
    descKey: 'rock.sandite.desc',
    hardnessTier: 1,
    fractureThreshold: 250,   // Sandstone, real ~20–50 MPa
    density: 2200,             // Real sandstone: ~2200–2400 kg/m³
    porosity: 0.30,            // Real sandstone: ~15–35%
    oreProbabilities: { dirtite: 0.30, rustite: 0.20 },
    color: '#d4b483',
  },
  {
    id: 'molite',
    nameKey: 'rock.molite.name',
    descKey: 'rock.molite.desc',
    hardnessTier: 2,
    fractureThreshold: 500,   // Limestone, real ~50–100 MPa
    density: 2400,             // Real limestone: ~2400–2600 kg/m³
    porosity: 0.20,            // Real limestone: ~10–25%
    oreProbabilities: { rustite: 0.25, blingite: 0.10, dirtite: 0.15 },
    color: '#c9bfa3',
  },
  {
    id: 'grumpite',
    nameKey: 'rock.grumpite.name',
    descKey: 'rock.grumpite.desc',
    hardnessTier: 2,
    fractureThreshold: 600,   // Dolomite, real ~80–120 MPa
    density: 2550,             // Real dolomite: ~2500–2600 kg/m³
    porosity: 0.18,            // Real dolomite: ~10–20%
    oreProbabilities: { rustite: 0.20, blingite: 0.15, gloomium: 0.05 },
    color: '#8a7f72',
  },
  {
    id: 'clunkite',
    nameKey: 'rock.clunkite.name',
    descKey: 'rock.clunkite.desc',
    hardnessTier: 3,
    fractureThreshold: 1100,  // Andesite, real ~100–150 MPa
    density: 2650,             // Real andesite: ~2500–2800 kg/m³
    porosity: 0.12,
    oreProbabilities: { blingite: 0.15, gloomium: 0.10, sparkium: 0.05 },
    color: '#6b6b6b',
  },
  {
    id: 'stubite',
    nameKey: 'rock.stubite.name',
    descKey: 'rock.stubite.desc',
    hardnessTier: 3,
    fractureThreshold: 1300,  // Granite, real ~130–200 MPa
    density: 2700,             // Real granite: ~2600–2800 kg/m³
    porosity: 0.10,            // Real granite: ~1–5% (boosted for gameplay)
    oreProbabilities: { blingite: 0.12, gloomium: 0.12, sparkium: 0.08 },
    color: '#9e8e7e',
  },
  {
    id: 'obstiite',
    nameKey: 'rock.obstiite.name',
    descKey: 'rock.obstiite.desc',
    hardnessTier: 4,
    fractureThreshold: 2200,  // Basalt, real ~150–300 MPa
    density: 2800,             // Real basalt: ~2800–3000 kg/m³
    porosity: 0.06,
    oreProbabilities: { sparkium: 0.12, craktonite: 0.08, absurdium: 0.03 },
    color: '#3d3d3d',
  },
  {
    id: 'gnarlite',
    nameKey: 'rock.gnarlite.name',
    descKey: 'rock.gnarlite.desc',
    hardnessTier: 4,
    fractureThreshold: 2600,  // Gabbro, real ~200–350 MPa
    density: 2900,             // Real gabbro: ~2900–3100 kg/m³
    porosity: 0.05,
    oreProbabilities: { sparkium: 0.10, craktonite: 0.10, absurdium: 0.05 },
    color: '#2a4a2a',
  },
  {
    id: 'absurdite',
    nameKey: 'rock.absurdite.name',
    descKey: 'rock.absurdite.desc',
    hardnessTier: 5,
    fractureThreshold: 3500,  // Quartzite, real ~200–350 MPa (game-scaled higher)
    density: 3100,             // Real quartzite: ~2600–2700 (game-inflated)
    porosity: 0.03,
    oreProbabilities: { craktonite: 0.08, absurdium: 0.08, treranium: 0.03 },
    color: '#c46bdb',
  },
  {
    id: 'titanite',
    nameKey: 'rock.titanite.name',
    descKey: 'rock.titanite.desc',
    hardnessTier: 5,
    fractureThreshold: 4000,  // Fantasy endgame, loosely based on peridotite
    density: 3300,             // Real peridotite: ~3200–3400 kg/m³
    porosity: 0.02,
    oreProbabilities: { absurdium: 0.10, treranium: 0.08 },
    color: '#1a1a3a',
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
