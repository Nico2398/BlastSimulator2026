// BlastSimulator2026 — WCAG contrast helpers (#1419)

import { describe, it, expect } from 'vitest';
import {
  parseRgba,
  composite,
  resolveBackground,
  relativeLuminance,
  contrastRatio,
  rgbToHex,
  analyzeElement,
  type RawElement,
  type Rgba,
} from '../../../../scripts/shared/a11y-contrast.js';

describe('relativeLuminance / contrastRatio', () => {
  it('luminance of white is 1 and black is 0', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('black on white is 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2);
  });

  it('same colour is 1', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });

  it('#000000 on #111111 is below 4.5', () => {
    expect(contrastRatio('#000000', '#111111')).toBeLessThan(4.5);
  });

  it('#767676 on white sits just above the 4.5 AA boundary', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });
});

describe('rgbToHex', () => {
  it('passes lowercase hex through and lowercases uppercase', () => {
    expect(rgbToHex('#aabbcc')).toBe('#aabbcc');
    expect(rgbToHex('#AABBCC')).toBe('#aabbcc');
  });

  it('converts rgb()', () => {
    expect(rgbToHex('rgb(255, 0, 16)')).toBe('#ff0010');
  });

  it('converts rgba() ignoring alpha', () => {
    expect(rgbToHex('rgba(0, 128, 255, 0.5)')).toBe('#0080ff');
  });

  it('returns null on garbage', () => {
    expect(rgbToHex('banana')).toBeNull();
    expect(rgbToHex('')).toBeNull();
    expect(rgbToHex('#12')).toBeNull();
  });
});

describe('parseRgba', () => {
  it('parses rgb() with implicit alpha 1', () => {
    expect(parseRgba('rgb(10, 20, 30)')).toEqual([10, 20, 30, 1]);
  });

  it('parses rgba() with fractional alpha', () => {
    expect(parseRgba('rgba(10, 20, 30, 0.25)')).toEqual([10, 20, 30, 0.25]);
  });

  it('parses transparent black rgba(0, 0, 0, 0)', () => {
    expect(parseRgba('rgba(0, 0, 0, 0)')).toEqual([0, 0, 0, 0]);
  });

  it('returns null on garbage', () => {
    expect(parseRgba('not-a-colour')).toBeNull();
    expect(parseRgba('')).toBeNull();
  });
});

describe('composite', () => {
  it('opaque foreground replaces the background', () => {
    expect(composite([10, 20, 30, 1], [200, 200, 200])).toEqual([10, 20, 30]);
  });

  it('fully transparent foreground leaves the background', () => {
    expect(composite([10, 20, 30, 0], [200, 100, 50])).toEqual([200, 100, 50]);
  });

  it('50% black over white is mid grey', () => {
    const [r, g, b] = composite([0, 0, 0, 0.5], [255, 255, 255]);
    for (const c of [r, g, b]) expect(Math.abs(c - 127.5)).toBeLessThanOrEqual(1);
  });
});

describe('resolveBackground', () => {
  const opaque = (r: number, g: number, b: number): Rgba => [r, g, b, 1];

  it('returns the first opaque layer unchanged', () => {
    expect(resolveBackground([opaque(10, 20, 30), opaque(255, 255, 255)], null))
      .toEqual({ color: [10, 20, 30], resolved: true });
  });

  it('composites translucent inner layers over the first opaque outer one', () => {
    const r = resolveBackground([[0, 0, 0, 0.5], opaque(255, 255, 255)], null);
    expect(r?.resolved).toBe(true);
    for (const c of r!.color) expect(Math.abs(c - 127.5)).toBeLessThanOrEqual(1);
  });

  it('skips fully transparent layers', () => {
    expect(resolveBackground([[0, 0, 0, 0], opaque(5, 6, 7)], null))
      .toEqual({ color: [5, 6, 7], resolved: true });
  });

  it('stacks several translucent layers over the opaque one', () => {
    const r = resolveBackground([[255, 0, 0, 0.5], [0, 0, 0, 0.5], opaque(255, 255, 255)], null);
    expect(r?.resolved).toBe(true);
    // black over white -> ~127.5 grey; red 50% over that -> r ~191, g/b ~64
    expect(r!.color[0]).toBeGreaterThan(r!.color[1]);
    expect(Math.abs(r!.color[0] - 191)).toBeLessThanOrEqual(2);
    expect(Math.abs(r!.color[1] - 64)).toBeLessThanOrEqual(2);
  });

  it('reports resolved:false when no layer is opaque and no fallback is given', () => {
    const r = resolveBackground([[0, 0, 0, 0.5], [0, 0, 0, 0]], null);
    expect(r?.resolved).toBe(false);
  });

  it('reports resolved:false for an empty layer list without fallback', () => {
    expect(resolveBackground([], null)?.resolved).toBe(false);
  });

  it('never silently falls back to white when unresolved', () => {
    const r = resolveBackground([[0, 0, 0, 0]], null);
    expect(r?.resolved).toBe(false);
    expect(r?.color).not.toEqual([255, 255, 255]);
  });

  it('uses an explicitly given fallback when no layer is opaque', () => {
    const r = resolveBackground([[0, 0, 0, 0]], [10, 10, 10]);
    expect(r).toEqual({ color: [10, 10, 10], resolved: true });
  });

  it('composites translucent layers over an explicit fallback', () => {
    const r = resolveBackground([[255, 255, 255, 0.5]], [0, 0, 0]);
    expect(r?.resolved).toBe(true);
    for (const c of r!.color) expect(Math.abs(c - 127.5)).toBeLessThanOrEqual(1);
  });

  it('ignores the fallback when an opaque layer exists', () => {
    expect(resolveBackground([opaque(1, 2, 3)], [200, 200, 200]))
      .toEqual({ color: [1, 2, 3], resolved: true });
  });
});

describe('analyzeElement', () => {
  const raw = (color: string, layers: string[]): RawElement => ({
    tag: 'span', text: 't', region: 'R', fontSize: '12px', fontWeight: '400', color, layers,
  });

  it('black text over an opaque #111111 layer fails AA', () => {
    const r = analyzeElement(raw('rgba(0, 0, 0, 1)', ['rgba(0, 0, 0, 0)', 'rgb(17, 17, 17)']));
    expect(r).not.toBeNull();
    expect(r!.background).toBe('#111111');
    expect(r!.wcagAANormal).toBe(false);
  });

  it('returns null (unresolved, not white) when every layer is transparent', () => {
    expect(analyzeElement(raw('rgb(255, 255, 255)', ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']))).toBeNull();
  });

  it('composites a translucent foreground over the background', () => {
    const r = analyzeElement(raw('rgba(255, 255, 255, 0.5)', ['rgb(0, 0, 0)']));
    expect(r!.foreground).toBe('#808080');
    expect(r!.background).toBe('#000000');
  });
});
