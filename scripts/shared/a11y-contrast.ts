// BlastSimulator2026 — WCAG contrast helpers for the a11y check (#1419).

export type Rgba = readonly [number, number, number, number];
export type Rgb = readonly [number, number, number];

export interface ResolvedBackground {
  color: Rgb;
  /** false when no opaque layer was found and no fallback was given. */
  resolved: boolean;
}

/** Parse a CSS `rgb()`/`rgba()` colour string; null when unparseable. */
export function parseRgba(_css: string): Rgba | null {
  throw new Error('not implemented');
}

/** Composite a translucent foreground over an opaque background. */
export function composite(_fg: Rgba, _bg: Rgb): Rgb {
  throw new Error('not implemented');
}

/**
 * Resolve the effective background from layers ordered innermost to outermost.
 * Translucent layers composite over the first opaque one. `resolved:false` when
 * none is opaque; `fallback` is used only when explicitly given.
 */
export function resolveBackground(
  _layers: readonly Rgba[],
  _fallback: Rgb | null,
): ResolvedBackground | null {
  throw new Error('not implemented');
}

export function relativeLuminance(_hex: string): number {
  throw new Error('not implemented');
}

export function contrastRatio(_hex1: string, _hex2: string): number {
  throw new Error('not implemented');
}

/** Hex, rgb() or rgba() input to `#rrggbb`; null on garbage. */
export function rgbToHex(_css: string): string | null {
  throw new Error('not implemented');
}
