// miniMapLayers — terrain painted as row runs lands exactly the pixels the
// one-rect-per-cell paint did (#1603).

import { describe, it, expect } from 'vitest';
import { drawTerrain, projectX, projectZ, MAP_SIZE, type MapProjection } from '../../../src/ui/miniMapLayers.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import type { GameState } from '../../../src/core/state/GameState.js';

/** A fake 2D context that rasterises fillRect into a MAP_SIZE² grid of style strings. */
function rasterContext() {
  const pixels: (string | null)[] = new Array(MAP_SIZE * MAP_SIZE).fill(null);
  let rects = 0;
  const ctx = {
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      rects++;
      for (let py = Math.max(0, y); py < Math.min(MAP_SIZE, y + h); py++) {
        for (let px = Math.max(0, x); px < Math.min(MAP_SIZE, x + w); px++) pixels[py * MAP_SIZE + px] = ctx.fillStyle;
      }
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, pixels, rects: () => rects };
}

/** The per-cell paint drawTerrain used to do, kept here as the reference picture. */
function perCellReference(state: GameState, proj: MapProjection, styleAt: (x: number, z: number) => string | null) {
  const ref = rasterContext();
  const nav = state.navGrid!;
  const cellW = Math.max(1, Math.ceil(proj.scaleX));
  const cellH = Math.max(1, Math.ceil(proj.scaleZ));
  for (let z = nav.originZ; z < nav.maxZ; z++) {
    for (let x = nav.originX; x < nav.maxX; x++) {
      const style = styleAt(x, z);
      if (style === null) continue;
      (ref.ctx as unknown as { fillStyle: string }).fillStyle = style;
      ref.ctx.fillRect(Math.floor(projectX(proj, x)), Math.floor(projectZ(proj, z)), cellW, cellH);
    }
  }
  return ref;
}

describe('drawTerrain', () => {
  for (const size of [32, 48, 96]) {
    it(`paints the same pixels as one rect per cell, in far fewer rects (${size}×${size} site)`, () => {
      const state = makeGameContext({ seed: 42, size }).state!;
      const nav = state.navGrid!;
      // A void cell and a hole in the grid break runs mid-row.
      nav.cellAt(nav.originX + 3, nav.originZ + 3)!.type = 'void';
      const world = state.world!;
      const proj: MapProjection = { originX: world.minX, originZ: world.minZ, scaleX: MAP_SIZE / world.sizeX, scaleZ: MAP_SIZE / world.sizeZ };

      const runs = rasterContext();
      drawTerrain(runs.ctx, state, proj);
      // Learn each cell's colour from the run paint itself, then repaint per cell.
      const styleAt = (x: number, z: number): string | null =>
        nav.cellAt(x, z) ? runs.pixels[Math.floor(projectZ(proj, z)) * MAP_SIZE + Math.floor(projectX(proj, x))] ?? null : null;
      const ref = perCellReference(state, proj, styleAt);

      expect(runs.pixels).toEqual(ref.pixels);
      expect(runs.pixels.filter(p => p === '#0a0e12').length).toBeGreaterThan(0);
      expect(runs.rects()).toBeLessThan(ref.rects() / 2);
    });
  }

  it('falls back to a flat rock tint with no nav grid', () => {
    const state = makeGameContext({ seed: 42, size: 32 }).state!;
    state.navGrid = null;
    const raster = rasterContext();
    drawTerrain(raster.ctx, state, { originX: 0, originZ: 0, scaleX: 1, scaleZ: 1 });
    expect(raster.rects()).toBe(1);
    expect(raster.pixels.every(p => p === raster.pixels[0] && p !== null)).toBe(true);
  });
});
