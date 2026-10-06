// BlastSimulator2026 — Loading screen content (eyebrow/subtitle/briefing) builders.
// Pure: level data in, LoadingSiteInfo out, so the briefing rows are unit-testable.

import type { LevelDef } from '../core/campaign/Level.js';
import { sandboxLevelDef, type SandboxConfig } from '../core/campaign/Sandbox.js';
import { formatMoney } from '../core/economy/formatMoney.js';
import type { LoadingSiteInfo } from './LoadingScreen.js';

/**
 * Biome id (campaign LevelDef.biome / SandboxConfig.biome) → loading screen
 * eyebrow category key. Mirrors WorldMap's own BIOME_STYLE categorisation
 * (screens/WorldMap.ts) — small local duplication of a 3-entry map rather
 * than exporting WorldMap's private table for one caller (#493).
 */
const BIOME_CATEGORY_KEY: Record<string, string> = {
  desert_badlands: 'ui.portfolio.biome.desert',
  alpine_granite: 'ui.portfolio.biome.mountain',
  tropical_karst: 'ui.portfolio.biome.tropical',
};
const DEFAULT_BIOME_CATEGORY_KEY = 'ui.portfolio.biome.mountain';

/** Loading screen content for a campaign level entry. */
export function buildLoadingSiteInfo(level: LevelDef): LoadingSiteInfo {
  return {
    siteNumber: level.difficultyTier,
    biomeCategoryKey: BIOME_CATEGORY_KEY[level.biome] ?? DEFAULT_BIOME_CATEGORY_KEY,
    difficulty: level.difficultyTier,
    descriptionKey: level.descKey,
    briefing: [
      { labelKey: 'loading.brief.starting_cash', value: `$${formatMoney(level.startingCash)}` },
      { labelKey: 'loading.brief.target', value: `$${formatMoney(level.unlockThreshold)}` },
      { labelKey: 'loading.brief.explosives', value: String(level.availableExplosives.length) },
    ],
  };
}

/** Loading screen content for a sandbox site — no site number, no difficulty pips, no profit target (endless play). */
export function buildSandboxLoadingSiteInfo(config: SandboxConfig): LoadingSiteInfo {
  const level = sandboxLevelDef(config);
  return {
    siteNumber: null,
    biomeCategoryKey: BIOME_CATEGORY_KEY[config.biome] ?? DEFAULT_BIOME_CATEGORY_KEY,
    difficulty: 0,
    descriptionKey: 'loading.sandbox_subtitle',
    briefing: [
      { labelKey: 'loading.brief.starting_cash', value: `$${formatMoney(level.startingCash)}` },
      { labelKey: 'loading.brief.explosives', value: String(level.availableExplosives.length) },
    ],
  };
}
