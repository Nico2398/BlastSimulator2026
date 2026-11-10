// BlastSimulator2026 — Explosive catalog
// 8 fictional explosives from party-popper to endgame monster.
// Energy in game units: real MJ/kg × ~100, then tuned for gameplay.
// Real-world references: ANFO ~3.4 MJ/kg, dynamite ~7.5 MJ/kg,
// emulsion ~3.8 MJ/kg, C4 ~5.9 MJ/kg, black powder ~0.3 MJ/kg.

export interface ExplosiveType {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey: string;
  /** Energy per kg in game units. Higher = more fracturing power. */
  readonly energyPerKg: number;
  /** Cost per kg in game dollars. */
  readonly costPerKg: number;
  /** If true, loses effectiveness in wet/flooded holes. */
  readonly waterSensitive: boolean;
  /**
   * Loaded density (g/cm³). A charge fills its hole from the bottom up to the stemming, so
   * density is what sets how many kilograms — and how much energy — one metre of hole holds
   * (`chargeKgPerMetre`): a light explosive suits soft rock, a dense one hard rock.
   */
  readonly density: number;
  /** Multiplier on ground vibration (1.0 = normal). Higher = more vibration. */
  readonly vibrationMod: number;
}

const EXPLOSIVES: readonly ExplosiveType[] = [
  {
    id: 'pop_rock',
    nameKey: 'explosive.pop_rock.name',
    descKey: 'explosive.pop_rock.desc',
    energyPerKg: 200,        // Black powder basis: ~0.3 MJ/kg × 100, boosted for playability
    costPerKg: 5,
    waterSensitive: true,
    density: 0.55,           // Fluffy black-powder knockoff: mostly air
    vibrationMod: 0.4,
  },
  {
    id: 'boomite',
    nameKey: 'explosive.boomite.name',
    descKey: 'explosive.boomite.desc',
    energyPerKg: 340,        // ANFO basis: ~3.4 MJ/kg × 100
    costPerKg: 12,
    waterSensitive: true,
    density: 0.8,            // ANFO
    vibrationMod: 0.7,
  },
  {
    id: 'krackle',
    nameKey: 'explosive.krackle.name',
    descKey: 'explosive.krackle.desc',
    energyPerKg: 400,        // Emulsion basis: ~3.8 MJ/kg × 100, rounded
    costPerKg: 20,
    waterSensitive: false,    // Water-resistant emulsion
    density: 1.15,           // Emulsion
    vibrationMod: 0.8,
  },
  {
    id: 'big_bada_boom',
    nameKey: 'explosive.big_bada_boom.name',
    descKey: 'explosive.big_bada_boom.desc',
    energyPerKg: 550,        // Dynamite basis: ~7.5 MJ/kg × 70 (game-scaled)
    costPerKg: 35,
    waterSensitive: true,
    density: 1.3,            // Dynamite
    vibrationMod: 1.2,
  },
  {
    id: 'shatternite',
    nameKey: 'explosive.shatternite.name',
    descKey: 'explosive.shatternite.desc',
    energyPerKg: 700,        // C4-ish: ~5.9 MJ/kg × 120 (game-scaled)
    costPerKg: 55,
    waterSensitive: false,
    density: 1.55,           // Plastic
    vibrationMod: 1.0,
  },
  {
    id: 'rumblox',
    nameKey: 'explosive.rumblox.name',
    descKey: 'explosive.rumblox.desc',
    energyPerKg: 850,        // Heavy ANFO boosted: ~4.5 MJ/kg × 190
    costPerKg: 80,
    waterSensitive: false,
    density: 1.2,            // Heavy ANFO
    vibrationMod: 1.6,        // Defining trait: high vibration
  },
  {
    id: 'obliviax',
    nameKey: 'explosive.obliviax.name',
    descKey: 'explosive.obliviax.desc',
    energyPerKg: 1000,       // Military-grade shaped charge territory
    costPerKg: 120,
    waterSensitive: true,
    density: 1.4,
    vibrationMod: 1.2,
  },
  {
    id: 'dynatomics',
    nameKey: 'explosive.dynatomics.name',
    descKey: 'explosive.dynatomics.desc',
    energyPerKg: 1300,       // Fantasy endgame. Nuclear-adjacent.
    costPerKg: 200,
    waterSensitive: false,
    density: 1.6,
    vibrationMod: 2.0,        // Village-shaking
  },
] as const;

const EXPLOSIVE_MAP = new Map<string, ExplosiveType>(
  EXPLOSIVES.map(e => [e.id, e])
);

/** Get an explosive type by ID. Returns undefined if not found. */
export function getExplosive(id: string): ExplosiveType | undefined {
  return EXPLOSIVE_MAP.get(id);
}

/** Get all explosive types. */
export function getAllExplosives(): readonly ExplosiveType[] {
  return EXPLOSIVES;
}
