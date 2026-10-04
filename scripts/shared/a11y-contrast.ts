// BlastSimulator2026 — WCAG contrast helpers for the a11y check (#1419).

export type Rgba = readonly [number, number, number, number];
type Rgb = readonly [number, number, number];

interface ResolvedBackground {
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
  return rgbToHexColor([c[0], c[1], c[2]]);
}

/** Opaque RGB triple to `#rrggbb`. */
function rgbToHexColor(c: Rgb): string {
  return `#${c.map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('')}`;
}

export interface TextElement {
  tag: string;
  text: string;
  /** Region the element was measured in: TopBar, ToolRail or a panel id. */
  region: string;
  fontSize: string;
  fontWeight: string;
  foreground: string;
  background: string;
  contrastRatio: number;
  wcagAALarge: boolean;
  wcagAANormal: boolean;
  wcagAAALarge: boolean;
  wcagAAANormal: boolean;
}

/** Raw in-page measurement; colours resolved in Node by this module's pure logic. */
export interface RawElement {
  tag: string;
  text: string;
  region: string;
  fontSize: string;
  fontWeight: string;
  color: string;
  /** Ancestor background-color strings, innermost first. */
  layers: string[];
}

/** Contrast of one raw element, or null when its background is not opaque-resolvable. */
export function analyzeElement(raw: RawElement): TextElement | null {
  const fg = parseRgba(raw.color);
  if (!fg || fg[3] === 0) return null;
  const layers = raw.layers.map(parseRgba).filter((l): l is Rgba => l !== null);
  const bg = resolveBackground(layers, null);
  if (!bg || !bg.resolved) return null;
  const fgRgb: Rgb = fg[3] < 1 ? composite(fg, bg.color) : [fg[0], fg[1], fg[2]];
  const fgHex = rgbToHexColor(fgRgb);
  const bgHex = rgbToHexColor(bg.color);
  const ratio = contrastRatio(fgHex, bgHex);
  return {
    tag: raw.tag, text: raw.text, region: raw.region,
    fontSize: raw.fontSize, fontWeight: raw.fontWeight,
    foreground: fgHex, background: bgHex,
    contrastRatio: Math.round(ratio * 100) / 100,
    wcagAALarge: ratio >= 3.0,
    wcagAANormal: ratio >= 4.5,
    wcagAAALarge: ratio >= 4.5,
    wcagAAANormal: ratio >= 7.0,
  };
}
