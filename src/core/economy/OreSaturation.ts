// BlastSimulator2026 — Per-ore market saturation: selling an ore floods its market and cuts its price (#1930).

/** One ore's saturation as last recorded: `level` in 0..1 at `tick`; it decays lazily. */
interface OreSaturationEntry {
  level: number;
  tick: number;
}

/** Saturation entries keyed by ore id. */
export type OreSaturationState = Record<string, OreSaturationEntry>;

/** Current saturation (0..1) of an ore; pricing code takes this instead of the game state. */
export type SaturationReader = (oreId: string) => number;

import {
  ORE_SATURATION_HALF_LIFE_TICKS, ORE_SATURATION_MAX_DISCOUNT, ORE_SATURATION_TOAST_LEVEL,
  ORE_MARKET_DEPTH_KG, ORE_DEPTH_TIER_MULT,
} from '../config/balance.js';
import { unlockedBuyerTiers } from './BuyerTiers.js';

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Sales volume (kg) that fully saturates an ore's market at the given mine grade; 0 for an unknown ore. */
export function marketDepthKg(oreId: string, buyerGrade: number): number {
  const base = (ORE_MARKET_DEPTH_KG as Record<string, number | undefined>)[oreId];
  if (base === undefined) return 0;
  const tiers = unlockedBuyerTiers(buyerGrade);
  return base * ORE_DEPTH_TIER_MULT[tiers[tiers.length - 1]!.id];
}

/** Saturation of an entry at `tick`, after half-life decay. */
export function saturationAt(entry: OreSaturationEntry | undefined, tick: number): number {
  if (!entry) return 0;
  const elapsed = Math.max(0, tick - entry.tick);
  return entry.level * Math.pow(0.5, elapsed / ORE_SATURATION_HALF_LIFE_TICKS);
}

/** Price multiplier for a saturation level. */
export function saturationFactor(saturation: number): number {
  return 1 - ORE_SATURATION_MAX_DISCOUNT * clamp01(saturation);
}

/** Record a sale of `kg` of an ore; mutates `state`. `crossed` is true when the toast level was crossed upward. */
export function recordOreSale(
  state: OreSaturationState,
  oreId: string,
  kg: number,
  tick: number,
  buyerGrade: number,
): { before: number; after: number; crossed: boolean } {
  const before = saturationAt(state[oreId], tick);
  const depth = marketDepthKg(oreId, buyerGrade);
  if (!(kg > 0) || !Number.isFinite(kg) || !(depth > 0)) return { before, after: before, crossed: false };
  const after = Math.min(1, before + kg / depth);
  state[oreId] = { level: after, tick };
  return { before, after, crossed: before < ORE_SATURATION_TOAST_LEVEL && ORE_SATURATION_TOAST_LEVEL <= after };
}

/** A reader over `state` as of `tick`; reads 0 for every ore when `state` is absent. */
export function saturationReader(state: OreSaturationState | undefined, tick: number): SaturationReader {
  return oreId => (state ? saturationAt(state[oreId], tick) : 0);
}

/** Validate a loaded save value; undefined when absent or unusable. */
export function sanitizeOreSaturation(raw: unknown): OreSaturationState | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: OreSaturationState = {};
  for (const [oreId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const { level, tick } = v as Record<string, unknown>;
    if (typeof level !== 'number' || !Number.isFinite(level)) continue;
    if (typeof tick !== 'number' || !Number.isFinite(tick)) continue;
    out[oreId] = { level: clamp01(level), tick: Math.max(0, tick) };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Percent with an explicit plus sign when positive ("+12", "0", "-20"). */
export function formatTrendPct(pct: number): string {
  return pct > 0 ? `+${pct}` : `${pct === 0 ? 0 : pct}`;
}

/** Price trend of an ore for display: percent change from base and the discounted price. */
export function oreSaturationTrend(_oreId: string, saturation: number, basePrice: number): { pct: number; price: number } {
  const factor = saturationFactor(saturation);
  return { pct: Math.round((factor - 1) * 100), price: basePrice * factor };
}
