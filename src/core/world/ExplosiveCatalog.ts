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
  /** Minimum charge per hole in kg. */
  readonly minChargeKg: number;
  /** Maximum charge per hole in kg. */
  readonly maxChargeKg: number;
  /** Minimum rock hardness tier this explosive can fracture. */
  readonly minRockTier: number;
  /** Maximum rock hardness tier this explosive can fracture. */
  readonly maxRockTier: number;
  /** Multiplier on blast radius (1.0 = normal). */
  readonly blastRadiusMod: number;
  /** Multiplier on projection risk (1.0 = normal). Higher = more dangerous. */
  readonly projectionRiskMod: number;
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
    minChargeKg: 0.5,
    maxChargeKg: 3,
    minRockTier: 1,
    maxRockTier: 1,
    blastRadiusMod: 0.7,
    projectionRiskMod: 0.5,   // Low risk — gentle
    vibrationMod: 0.4,
  },
  {
    id: 'boomite',
    nameKey: 'explosive.boomite.name',
    descKey: 'explosive.boomite.desc',
    energyPerKg: 340,        // ANFO basis: ~3.4 MJ/kg × 100
    costPerKg: 12,
    waterSensitive: true,
    minChargeKg: 1,
    maxChargeKg: 8,
    minRockTier: 1,
    maxRockTier: 2,
    blastRadiusMod: 1.0,
    projectionRiskMod: 0.8,
    vibrationMod: 0.7,
  },
  {
    id: 'krackle',
    nameKey: 'explosive.krackle.name',
    descKey: 'explosive.krackle.desc',
    energyPerKg: 400,        // Emulsion basis: ~3.8 MJ/kg × 100, rounded
    costPerKg: 20,
    waterSensitive: false,    // Water-resistant emulsion
    minChargeKg: 1,
    maxChargeKg: 10,
    minRockTier: 2,
    maxRockTier: 3,
    blastRadiusMod: 0.9,
    projectionRiskMod: 0.7,
    vibrationMod: 0.8,
  },
  {
    id: 'big_bada_boom',
    nameKey: 'explosive.big_bada_boom.name',
    descKey: 'explosive.big_bada_boom.desc',
    energyPerKg: 550,        // Dynamite basis: ~7.5 MJ/kg × 70 (game-scaled)
    costPerKg: 35,
    waterSensitive: true,
    minChargeKg: 1,
    maxChargeKg: 12,
    minRockTier: 2,
    maxRockTier: 3,
    blastRadiusMod: 1.2,
    projectionRiskMod: 1.1,   // Bigger boom = more projection risk
    vibrationMod: 1.2,
  },
  {
    id: 'shatternite',
    nameKey: 'explosive.shatternite.name',
    descKey: 'explosive.shatternite.desc',
    energyPerKg: 700,        // C4-ish: ~5.9 MJ/kg × 120 (game-scaled)
    costPerKg: 55,
    waterSensitive: false,
    minChargeKg: 1,
    maxChargeKg: 15,
    minRockTier: 3,
    maxRockTier: 4,
    blastRadiusMod: 1.1,
    projectionRiskMod: 1.0,
    vibrationMod: 1.0,
  },
  {
    id: 'rumblox',
    nameKey: 'explosive.rumblox.name',
    descKey: 'explosive.rumblox.desc',
    energyPerKg: 850,        // Heavy ANFO boosted: ~4.5 MJ/kg × 190
    costPerKg: 80,
    waterSensitive: false,
    minChargeKg: 2,
    maxChargeKg: 20,
    minRockTier: 3,
    maxRockTier: 4,
    blastRadiusMod: 1.3,
    projectionRiskMod: 1.3,
    vibrationMod: 1.6,        // Defining trait: high vibration
  },
  {
    id: 'obliviax',
    nameKey: 'explosive.obliviax.name',
    descKey: 'explosive.obliviax.desc',
    energyPerKg: 1000,       // Military-grade shaped charge territory
    costPerKg: 120,
    waterSensitive: true,
    minChargeKg: 2,
    maxChargeKg: 20,
    minRockTier: 4,
    maxRockTier: 5,
    blastRadiusMod: 1.1,
    projectionRiskMod: 1.5,   // High projection risk
    vibrationMod: 1.2,
  },
  {
    id: 'dynatomics',
    nameKey: 'explosive.dynatomics.name',
    descKey: 'explosive.dynatomics.desc',
    energyPerKg: 1300,       // Fantasy endgame. Nuclear-adjacent.
    costPerKg: 200,
    waterSensitive: false,
    minChargeKg: 3,
    maxChargeKg: 25,
    minRockTier: 4,
    maxRockTier: 5,
    blastRadiusMod: 1.5,
    projectionRiskMod: 1.8,   // Extremely dangerous
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
