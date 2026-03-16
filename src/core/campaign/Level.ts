// BlastSimulator2026 — Level definition system
// Each level represents a mine site with specific parameters and difficulty modifiers.
// 3 levels with progressive difficulty — Human approved names, descriptions, and curve.

// ── Types ──

export interface LevelDef {
  /** Unique identifier. */
  id: string;
  /** i18n key for the level name. */
  nameKey: string;
  /** i18n key for the level description. */
  descKey: string;
  /** Mine type preset to use. */
  mineType: string;
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
  /** Difficulty tier: 1–3. Used for display and ordering. */
  difficultyTier: number;
}

// ── Level catalog ──

const LEVELS: readonly LevelDef[] = [
  {
    // ────────────────────────────────────────────────────────
    // Level 1 — Dusty Hollow
    // Small desert quarry. Soft rocks. Basic explosives. Generous contracts.
    // Tutorial-friendly. Real quarry: ~$2/ton profit → low threshold.
    // ────────────────────────────────────────────────────────
    id: 'dusty_hollow',
    nameKey: 'level.dusty_hollow.name',
    descKey: 'level.dusty_hollow.desc',
    mineType: 'desert',
    terrainSeed: 1138,
    gridX: 40,
    gridY: 20,
    gridZ: 40,
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
    mineType: 'mountain',
    terrainSeed: 2277,
    gridX: 60,
    gridY: 30,
    gridZ: 60,
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
    mineType: 'tropical',
    terrainSeed: 3666,
    gridX: 80,
    gridY: 40,
    gridZ: 80,
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
