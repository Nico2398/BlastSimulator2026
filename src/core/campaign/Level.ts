// BlastSimulator2026 — Level definition system
// Each level represents a mine site with specific parameters and difficulty modifiers.
// 4 levels with progressive difficulty — Human approved names, descriptions, and curve.

// ── Types ──

export interface LevelDef {
  /** Unique identifier. */
  id: string;
  /** i18n key for the level name. */
  nameKey: string;
  /** i18n key for the level description. */
  descKey: string;
  /** Biome ID (BiomeCatalog) this level's terrain is biased toward. */
  biome: string;
  /**
   * Bias added to the raw climate fields so this level's own grid lands near
   * its intended biome's climate centre (#458 T1.2/A6) — authored once per
   * level, typically the target biome's own climateCenter.
   */
  climateBias: readonly [number, number];
  /** Deterministic terrain seed. */
  terrainSeed: number;
  /** Grid dimensions. */
  gridX: number;
  gridY: number;
  gridZ: number;
  /** Starting cash in dollars. */
  startingCash: number;
  /** Explosive IDs available at this level (subset of catalog). */
  availableExplosives: string[];
  /**
   * Cumulative profit needed to complete the level (unlock threshold).
   * Real open-pit quarry profitability: ~$1–10 per ton, we scale to game units.
   */
  unlockThreshold: number;
  /** Multiplier on event frequency (1 = normal, <1 = rare, >1 = frequent chaos). */
  eventFreqMultiplier: number;
  /** Multiplier on contract prices (>1 = generous, <1 = tight market). */
  contractPriceMultiplier: number;
  /** Per-tick score decay rate (higher = harder to maintain scores). */
  scoreDecayRate: number;
  /**
   * Whether this level features mixed rock hardness (hard + soft layers).
   * When true, terrain gen interleaves very hard and soft rock types,
   * making projection management more complex.
   */
  mixedRockHardness: boolean;
  /** Difficulty tier: 0 (tutorial) – 3 (hardest). Used for display and ordering. */
  difficultyTier: number;
}

// ── Level catalog ──

const LEVELS: readonly LevelDef[] = [
  {
    // ────────────────────────────────────────────────────────
    // Level 0 — Tutorial Pit
    // Tiny desert quarry. Very forgiving. Designed to teach core mechanics.
    // No events. Bonus contracts. Player-proof score decay.
    // ────────────────────────────────────────────────────────
    id: 'tutorial_pit',
    nameKey: 'level.tutorial_pit.name',
    descKey: 'level.tutorial_pit.desc',
    biome: 'desert_badlands',
    climateBias: [0.7, -0.6],
    terrainSeed: 42,
    gridX: 32,
    gridY: 20,
    gridZ: 32,
    // The tutorial scripts every purchase it teaches: four hires ($5,000), a
    // survey (up to $3,000), the scripted consultant ($3,000), a debris_hauler
    // ($25,000) and a freight_warehouse ($15,000) — about $52,000 before the
    // delivery step that first earns anything. At $20,000 the tutorial was
    // unfinishable: the hauler alone cost more than the whole purse.
    //
    // #553 then made drill_hole a queued, vehicle-gated action: a
    // driving_center ($12,000), training a driller on driving.drill_rig
    // ($2,500) and a drill_rig ($35,000) — $49,500 more — without which the
    // drill-plan step could never land a hole. #555 gated dig_ramp_segment
    // (the box-cut step, which now takes real ticks to excavate instead of
    // carving instantly) the same way: training a digger on driving.excavator
    // ($2,500) and a rock_digger ($50,000) — $52,500 more, plus the extra
    // payroll/fuel/maintenance drain of the ~130 ticks box-cut now spends
    // actually digging instead of completing in the same tick it was
    // ordered. Sandbox-measured (command mode, tutorial's own step order):
    // $150,000 still went negative mid-dig; $170,000 finished box-cut with
    // ~$4,600 left, no margin for drill-plan onward. $190,000 leaves ~$24,600
    // at box-cut completion — this leaves headroom for salaries, fuel and
    // maintenance across the run.
    startingCash: 190000,
    availableExplosives: ['pop_rock', 'boomite'],
    unlockThreshold: 5000,
    eventFreqMultiplier: 0,
    contractPriceMultiplier: 1.5,
    scoreDecayRate: 0.01,
    mixedRockHardness: false,
    difficultyTier: 0,
  },
  {
    // ────────────────────────────────────────────────────────
    // Level 1 — Dusty Hollow
    // Small desert quarry. Soft rocks. Basic explosives. Generous contracts.
    // Tutorial-friendly. Real quarry: ~$2/ton profit → low threshold.
    // ────────────────────────────────────────────────────────
    id: 'dusty_hollow',
    nameKey: 'level.dusty_hollow.name',
    descKey: 'level.dusty_hollow.desc',
    biome: 'desert_badlands',
    climateBias: [0.7, -0.6],
    terrainSeed: 1138,
    gridX: 96,
    gridY: 40,
    gridZ: 96,
    startingCash: 50000,
    availableExplosives: ['pop_rock', 'boomite', 'krackle'],
    // Unlock threshold: $80k. Reachable in ~10 good blasts.
    unlockThreshold: 80000,
    eventFreqMultiplier: 0.5,   // Rare events — forgiving tutorial
    contractPriceMultiplier: 1.2, // Generous buyers (easy to profit)
    scoreDecayRate: 0.03,        // Slow score decay — hard to ruin yourself
    mixedRockHardness: false,
    difficultyTier: 1,
  },
  {
    // ────────────────────────────────────────────────────────
    // Level 2 — Grumpstone Ridge
    // Mountain site. Mixed rock hardness. Mid-tier explosives. Moderate challenge.
    // Neighboring village adds nuisance penalties.
    // ────────────────────────────────────────────────────────
    id: 'grumpstone_ridge',
    nameKey: 'level.grumpstone_ridge.name',
    descKey: 'level.grumpstone_ridge.desc',
    biome: 'alpine_granite',
    climateBias: [-0.7, 0.1],
    terrainSeed: 2277,
    gridX: 128,
    gridY: 56,
    gridZ: 128,
    startingCash: 75000,
    availableExplosives: ['pop_rock', 'boomite', 'krackle', 'big_bada_boom', 'shatternite'],
    // Unlock threshold: $250k. Real mountain quarry margins are tighter.
    unlockThreshold: 250000,
    eventFreqMultiplier: 1.0,    // Normal event rate
    contractPriceMultiplier: 1.0, // Fair market prices
    scoreDecayRate: 0.05,         // Standard decay rate
    mixedRockHardness: false,
    difficultyTier: 2,
  },
  {
    // ────────────────────────────────────────────────────────
    // Level 3 — Treranium Depths
    // Large tropical site. All explosives. High event frequency.
    // Mixed hard + soft rock hardness = complex projection management.
    // Mafia presence. Multiple villages. Tight contracts.
    // Human note: "The rocks here didn't read the rulebook" difficulty.
    // ────────────────────────────────────────────────────────
    id: 'treranium_depths',
    nameKey: 'level.treranium_depths.name',
    descKey: 'level.treranium_depths.desc',
    biome: 'tropical_karst',
    climateBias: [0.6, 0.7],
    terrainSeed: 3666,
    gridX: 160,
    gridY: 64,
    gridZ: 160,
    startingCash: 100000,
    availableExplosives: [
      'pop_rock', 'boomite', 'krackle',
      'big_bada_boom', 'shatternite', 'rumblox',
      'obliviax', 'dynatomics',
    ],
    // Unlock threshold: $800k. Rare-earth margins are high but so are costs.
    unlockThreshold: 800000,
    eventFreqMultiplier: 2.0,    // Frequent chaos
    contractPriceMultiplier: 0.85, // Tight market — buyers lowball you
    scoreDecayRate: 0.08,          // Harsh — scores fall fast without upkeep
    mixedRockHardness: true,       // Hard+soft interleaved — unpredictable projections
    difficultyTier: 3,
  },
];

// ── Accessors ──

/** Get a level definition by ID. Returns undefined if not found. */
export function getLevel(id: string): LevelDef | undefined {
  return LEVELS.find(l => l.id === id);
}

/** Get all levels in difficulty order. */
export function getAllLevels(): readonly LevelDef[] {
  return LEVELS;
}
