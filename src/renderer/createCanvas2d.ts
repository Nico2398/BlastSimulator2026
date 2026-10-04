// BlastSimulator2026 — Shared 2D-canvas factory for renderer text/glyph textures.

interface Canvas2d {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * Sized canvas + 2D context, or null when none exists: `document` is undefined
 * in Node-only Vitest workers, and some workers provide a `document` without the
 * `canvas` npm package, so `getContext('2d')` returns null. Callers fall back to
 * a flat-colour material on null.
 */
export function createCanvas2d(width: number, height: number): Canvas2d | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  return ctx === null ? null : { canvas, ctx };
}
