// BlastSimulator2026 — Per-ore market saturation: selling an ore floods its market and cuts its price (#1930).

/** One ore's saturation as last recorded: `level` in 0..1 at `tick`; it decays lazily. */
export interface OreSaturationEntry {
  level: number;
  tick: number;
}

/** Saturation entries keyed by ore id. */
export type OreSaturationState = Record<string, OreSaturationEntry>;

/** Current saturation (0..1) of an ore; pricing code takes this instead of the game state. */
export type SaturationReader = (oreId: string) => number;

/** Sales volume (kg) that fully saturates an ore's market at the given mine grade. */
export function marketDepthKg(_oreId: string, _buyerGrade: number): number {
  return undefined as unknown as number;
}

/** Saturation of an entry at `tick`, after half-life decay. */
export function saturationAt(_entry: OreSaturationEntry | undefined, _tick: number): number {
  return undefined as unknown as number;
}

/** Price multiplier for a saturation level. */
export function saturationFactor(_saturation: number): number {
  return undefined as unknown as number;
}

/** Record a sale of `kg` of an ore; mutates `state`. `crossed` is true when the toast level was crossed upward. */
export function recordOreSale(
  _state: OreSaturationState,
  _oreId: string,
  _kg: number,
  _tick: number,
  _buyerGrade: number,
): { before: number; after: number; crossed: boolean } {
  return undefined as unknown as { before: number; after: number; crossed: boolean };
}

/** A reader over `state` as of `tick`; reads 0 for every ore when `state` is absent. */
export function saturationReader(_state: OreSaturationState | undefined, _tick: number): SaturationReader {
  return undefined as unknown as SaturationReader;
}

/** Validate a loaded save value; undefined when absent or unusable. */
export function sanitizeOreSaturation(_raw: unknown): OreSaturationState | undefined {
  return undefined;
}

/** Price trend of an ore for display: percent change from base and the discounted price. */
export function oreSaturationTrend(_oreId: string, _saturation: number, _basePrice: number): { pct: number; price: number } {
  return undefined as unknown as { pct: number; price: number };
}
