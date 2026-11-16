// BlastSimulator2026 — Mini-map layers for prospected ore islands (#2286, C10).

import { describe, it, expect } from 'vitest';
import {
  MAP_SIZE, miniMapProjection, drawProspectedIslands, projectX, projectZ, type MapProjection,
} from '../../../src/ui/miniMapLayers.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';
import { getOre } from '../../../src/core/world/OreCatalog.js';

const WORLD = { minX: 0, minZ: 0, sizeX: 64, sizeZ: 64 };
const EPS = 1e-6;

type Island = { x: number; z: number; radius: number };

/** World coordinates at the left, right, top and bottom edges of the projection. */
function extent(proj: MapProjection): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: proj.originX,
    maxX: proj.originX + MAP_SIZE / proj.scaleX,
    minZ: proj.originZ,
    maxZ: proj.originZ + MAP_SIZE / proj.scaleZ,
  };
}

describe('miniMapProjection', () => {
  it('with no islands equals the world box projection', () => {
    expect(miniMapProjection(WORLD, [])).toEqual({
      originX: 0, originZ: 0, scaleX: MAP_SIZE / 64, scaleZ: MAP_SIZE / 64,
    });
  });

  it('with no islands follows a world that does not start at the origin', () => {
    const world = { minX: -20, minZ: 12, sizeX: 80, sizeZ: 50 };
    expect(miniMapProjection(world, [])).toEqual({
      originX: -20, originZ: 12, scaleX: MAP_SIZE / 80, scaleZ: MAP_SIZE / 50,
    });
  });

  it('holds the world box when islands are far away', () => {
    const e = extent(miniMapProjection(WORLD, [{ x: 300, z: -260, radius: 18 }]));
    expect(e.minX).toBeLessThanOrEqual(WORLD.minX + EPS);
    expect(e.maxX).toBeGreaterThanOrEqual(WORLD.minX + WORLD.sizeX - EPS);
    expect(e.minZ).toBeLessThanOrEqual(WORLD.minZ + EPS);
    expect(e.maxZ).toBeGreaterThanOrEqual(WORLD.minZ + WORLD.sizeZ - EPS);
  });

  it('holds every island disc, in every direction', () => {
    const islands: Island[] = [
      { x: 300, z: 20, radius: 18 },
      { x: -280, z: 40, radius: 14 },
      { x: 30, z: 310, radius: 26 },
      { x: 20, z: -290, radius: 12 },
    ];
    const e = extent(miniMapProjection(WORLD, islands));
    for (const i of islands) {
      expect(e.minX).toBeLessThanOrEqual(i.x - i.radius + EPS);
      expect(e.maxX).toBeGreaterThanOrEqual(i.x + i.radius - EPS);
      expect(e.minZ).toBeLessThanOrEqual(i.z - i.radius + EPS);
      expect(e.maxZ).toBeGreaterThanOrEqual(i.z + i.radius - EPS);
    }
  });

  it('projects the edges of every disc and the world box onto the canvas', () => {
    const islands: Island[] = [{ x: 310, z: -250, radius: 20 }, { x: -240, z: 280, radius: 16 }];
    const proj = miniMapProjection(WORLD, islands);
    const inCanvas = (p: number): boolean => p >= -EPS && p <= MAP_SIZE + EPS;
    for (const i of islands) {
      for (const dx of [-i.radius, i.radius]) expect(inCanvas(projectX(proj, i.x + dx))).toBe(true);
      for (const dz of [-i.radius, i.radius]) expect(inCanvas(projectZ(proj, i.z + dz))).toBe(true);
    }
    for (const x of [WORLD.minX, WORLD.minX + WORLD.sizeX]) expect(inCanvas(projectX(proj, x))).toBe(true);
    for (const z of [WORLD.minZ, WORLD.minZ + WORLD.sizeZ]) expect(inCanvas(projectZ(proj, z))).toBe(true);
  });

  it('keeps the world box and a nearby island inside the canvas', () => {
    const proj = miniMapProjection(WORLD, [{ x: 40, z: 40, radius: 10 }]);
    const e = extent(proj);
    expect(e.minX).toBeLessThanOrEqual(30 + EPS);
    expect(e.maxX).toBeGreaterThanOrEqual(64 - EPS);
    expect(proj.scaleX).toBeGreaterThan(0);
    expect(proj.scaleZ).toBeGreaterThan(0);
  });

  it('shrinks the scale as islands move farther out', () => {
    const near = miniMapProjection(WORLD, [{ x: 150, z: 32, radius: 10 }]);
    const far = miniMapProjection(WORLD, [{ x: 320, z: 32, radius: 10 }]);
    expect(far.scaleX).toBeLessThan(near.scaleX);
  });
});

// ── drawProspectedIslands ─────────────────────────────────────────────────────

interface FilledArc { args: number[]; fillStyle: unknown }

/** A recording 2D context: remembers which arc each fill painted, and the fillStyle it painted with. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; filled: FilledArc[]; arcs: number[][] } {
  const props: Record<string, unknown> = {};
  const filled: FilledArc[] = [];
  const arcs: number[][] = [];
  let lastArc: number[] | null = null;
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop in props) return props[prop];
      if (prop === 'arc') return (...args: number[]) => { arcs.push(args); lastArc = args; };
      if (prop === 'beginPath') return () => { lastArc = null; };
      if (prop === 'fill') return () => { if (lastArc) filled.push({ args: lastArc, fillStyle: props['fillStyle'] }); };
      return () => undefined;
    },
    set(_t, prop: string, value) { props[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, filled, arcs };
}

function result(id: number, method: SurveyResult['method'], islands?: SurveyResult['islands']): SurveyResult {
  return {
    id, method, centerX: 32, centerZ: 32, completedTick: 0, surveyorId: 1, estimates: {}, confidence: 0.7,
    ...(islands ? { islands } : {}),
  };
}

function stateWith(results: SurveyResult[]): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.surveyResults = results;
  return state;
}

const PROJ: MapProjection = { originX: -300, originZ: -300, scaleX: 0.2, scaleZ: 0.2 };

describe('drawProspectedIslands', () => {
  it('paints each island as a filled disc at its projected centre in its ore colour', () => {
    const islands = [
      { x: 300, z: 20, radius: 16, oreId: 'craktonite' },
      { x: -240, z: 60, radius: 24, oreId: 'absurdium' },
    ];
    const { ctx, filled } = recordingCtx();
    drawProspectedIslands(ctx, stateWith([result(1, 'prospection', islands)]), PROJ);
    expect(filled).toHaveLength(2);
    for (const island of islands) {
      const hit = filled.find(f => Math.abs(f.args[0]! - projectX(PROJ, island.x)) < EPS && Math.abs(f.args[1]! - projectZ(PROJ, island.z)) < EPS);
      expect(hit, `island ${island.oreId}`).toBeDefined();
      expect(hit!.fillStyle).toBe(getOre(island.oreId)!.color);
      expect(hit!.args[2]!).toBeGreaterThan(0);
    }
  });

  it('draws the islands of every prospection result', () => {
    const { ctx, filled } = recordingCtx();
    drawProspectedIslands(ctx, stateWith([
      result(1, 'prospection', [{ x: 300, z: 20, radius: 16, oreId: 'craktonite' }]),
      result(2, 'prospection', [{ x: -240, z: 60, radius: 24, oreId: 'absurdium' }, { x: 10, z: -280, radius: 8, oreId: 'craktonite' }]),
    ]), PROJ);
    expect(filled).toHaveLength(3);
  });

  it('ignores results of other methods', () => {
    const { ctx, arcs } = recordingCtx();
    drawProspectedIslands(ctx, stateWith([result(1, 'seismic'), result(2, 'aerial'), result(3, 'core_sample')]), PROJ);
    expect(arcs).toHaveLength(0);
  });

  it('draws nothing without survey results', () => {
    const { ctx, arcs } = recordingCtx();
    drawProspectedIslands(ctx, stateWith([]), PROJ);
    expect(arcs).toHaveLength(0);
  });

  it('draws nothing for a prospection result with no island', () => {
    const { ctx, arcs } = recordingCtx();
    drawProspectedIslands(ctx, stateWith([result(1, 'prospection', [])]), PROJ);
    expect(arcs).toHaveLength(0);
  });

  it('uses the ore colour of each island, not one colour for all', () => {
    const { ctx, filled } = recordingCtx();
    drawProspectedIslands(ctx, stateWith([result(1, 'prospection', [
      { x: 300, z: 20, radius: 16, oreId: 'craktonite' },
      { x: -240, z: 60, radius: 24, oreId: 'absurdium' },
    ])]), PROJ);
    expect(new Set(filled.map(f => f.fillStyle)).size).toBe(2);
  });
});
