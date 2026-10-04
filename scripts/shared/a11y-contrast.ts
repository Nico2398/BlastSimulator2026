// BlastSimulator2026 — WCAG contrast helpers for the a11y check (#1419).

export type Rgba = readonly [number, number, number, number];
export type Rgb = readonly [number, number, number];

export interface ResolvedBackground {
  color: Rgb;
  /** false when no opaque layer was found and no fallback was given. */
  resolved: boolean;
}

/** Parse a CSS `rgb()`/`rgba()` colour string; null when unparseable. */
export function parseRgba(css: string): Rgba | null {
  const m = css.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!m) return null;
  return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]!];
}

/** Composite a translucent foreground over an opaque background. */
export function composite(fg: Rgba, bg: Rgb): Rgb {
  const a = fg[3];
  return [
    Math.round(fg[0] * a + bg[0] * (1 - a)),
    Math.round(fg[1] * a + bg[1] * (1 - a)),
    Math.round(fg[2] * a + bg[2] * (1 - a)),
  ];
}

/**
 * Resolve the effective background from layers ordered innermost to outermost.
 * Translucent layers composite over the first opaque one. `resolved:false` when
 * none is opaque; `fallback` is used only when explicitly given.
 */
export function resolveBackground(
  layers: readonly Rgba[],
  fallback: Rgb | null,
): ResolvedBackground | null {
  const visible = layers.filter(l => l[3] > 0);
  const opaqueAt = visible.findIndex(l => l[3] >= 1);
  let base: Rgb;
  let resolved = true;
  let stack: readonly Rgba[];
  if (opaqueAt >= 0) {
    const o = visible[opaqueAt]!;
    base = [o[0], o[1], o[2]];
    stack = visible.slice(0, opaqueAt);
  } else if (fallback) {
    base = fallback;
    stack = visible;
  } else {
    return { color: [0, 0, 0], resolved: false };
  }
  for (let i = stack.length - 1; i >= 0; i--) base = composite(stack[i]!, base);
  return { color: base, resolved };
}

export function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const linearize = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Hex, rgb() or rgba() input to `#rrggbb`; null on garbage. */
export function rgbToHex(css: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  const c = parseRgba(css);
  if (!c) return null;
  return `#${c.slice(0, 3).map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('')}`;
}
