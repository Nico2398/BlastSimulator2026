// @vitest-environment jsdom
// BlastSimulator2026 — Mini-map cones for meteorite-detector readings (#2291, C7).

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MAP_SIZE, miniMapProjection, drawDetectorCones, detectorReadingsOf, projectX, projectZ, type MapProjection,
} from '../../../src/ui/miniMapLayers.js';
import { MiniMap } from '../../../src/ui/MiniMap.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';
import type { DetectorReading } from '../../../src/core/mining/SurveyDetector.js';
import { makeGameContext } from '../../helpers/gameContext.js';

type Readings = ReturnType<typeof detectorReadingsOf>;
type World = { minX: number; minZ: number; sizeX: number; sizeZ: number };
type Island = { x: number; z: number; radius: number };

/**
 * `miniMapProjection(world, islands, readings?)`. The skeleton still declares two parameters
 * (CONTRACT GAP reported to the lead), so the three-argument form goes through this alias.
 */
const project = miniMapProjection as unknown as (world: World, islands: readonly Island[], readings?: Readings) => MapProjection;

const WORLD = { minX: 0, minZ: 0, sizeX: 64, sizeZ: 64 };
const EPS = 1e-6;
const TAU = Math.PI * 2;

const READING: DetectorReading = { bearing: 0.6, halfAngle: 0.3, minDistance: 300, maxDistance: 450 };

function detectorResult(id: number, x: number, z: number, reading?: DetectorReading): SurveyResult {
  return {
    id, method: 'meteorite_detector', centerX: x, centerZ: z, completedTick: 0, surveyorId: 1, estimates: {}, confidence: 0.8,
    ...(reading ? { reading } : {}),
  };
}

function otherResult(id: number, method: SurveyResult['method']): SurveyResult {
  return { id, method, centerX: 20, centerZ: 20, completedTick: 0, surveyorId: 1, estimates: {}, confidence: 0.7 };
}

function stateWith(results: SurveyResult[]): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.surveyResults = results;
  return state;
}

/** World coordinates at the left, right, top and bottom edges of the projection. */
function extent(proj: MapProjection): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: proj.originX,
    maxX: proj.originX + MAP_SIZE / proj.scaleX,
    minZ: proj.originZ,
    maxZ: proj.originZ + MAP_SIZE / proj.scaleZ,
  };
}

/** The points of a cone that bound it: the origin and, at the far distance, both edges and the bearing. */
function coneExtremes(o: { originX: number; originZ: number; reading: DetectorReading }): { x: number; z: number }[] {
  const { originX, originZ, reading: r } = o;
  const at = (angle: number, d: number) => ({ x: originX + Math.cos(angle) * d, z: originZ + Math.sin(angle) * d });
  return [
    { x: originX, z: originZ },
    at(r.bearing - r.halfAngle, r.maxDistance),
    at(r.bearing, r.maxDistance),
    at(r.bearing + r.halfAngle, r.maxDistance),
  ];
}

// ── detectorReadingsOf ────────────────────────────────────────────────────────

describe('detectorReadingsOf (#2291, C7)', () => {
  it('is empty without survey results', () => {
    expect(detectorReadingsOf(stateWith([]))).toEqual([]);
  });

  it('returns every reading with the point it was taken from', () => {
    const a: DetectorReading = { bearing: 0.5, halfAngle: 0.2, minDistance: 310, maxDistance: 460 };
    const b: DetectorReading = { bearing: 0.9, halfAngle: 0.1, minDistance: 240, maxDistance: 390 };
    const out = detectorReadingsOf(stateWith([detectorResult(1, 30, 40, a), detectorResult(2, 150, -20, b)]));
    expect(out).toEqual([
      { originX: 30, originZ: 40, reading: a },
      { originX: 150, originZ: -20, reading: b },
    ]);
  });

  it('skips a detector result that found no crater', () => {
    const out = detectorReadingsOf(stateWith([detectorResult(1, 30, 40), detectorResult(2, 5, 6, READING)]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ originX: 5, originZ: 6 });
  });

  it('ignores results of other methods', () => {
    const out = detectorReadingsOf(stateWith([
      otherResult(1, 'seismic'), otherResult(2, 'aerial'), otherResult(3, 'core_sample'), otherResult(4, 'prospection'),
    ]));
    expect(out).toEqual([]);
  });
});

// ── miniMapProjection with readings ───────────────────────────────────────────

describe('miniMapProjection with readings (#2291, C7)', () => {
  const origin = { originX: 32, originZ: 32, reading: READING };

  it('without readings it is the projection it always was', () => {
    expect(project(WORLD, [], [])).toEqual(project(WORLD, []));
    expect(project(WORLD, [], undefined)).toEqual(project(WORLD, []));
  });

  it('keeps the world box when a cone reaches far away', () => {
    const e = extent(project(WORLD, [], [origin]));
    expect(e.minX).toBeLessThanOrEqual(WORLD.minX + EPS);
    expect(e.maxX).toBeGreaterThanOrEqual(WORLD.sizeX - EPS);
    expect(e.minZ).toBeLessThanOrEqual(WORLD.minZ + EPS);
    expect(e.maxZ).toBeGreaterThanOrEqual(WORLD.sizeZ - EPS);
  });

  it('holds the origin and the far edge of the cone', () => {
    const e = extent(project(WORLD, [], [origin]));
    for (const p of coneExtremes(origin)) {
      expect(e.minX).toBeLessThanOrEqual(p.x + EPS);
      expect(e.maxX).toBeGreaterThanOrEqual(p.x - EPS);
      expect(e.minZ).toBeLessThanOrEqual(p.z + EPS);
      expect(e.maxZ).toBeGreaterThanOrEqual(p.z - EPS);
    }
  });

  it('holds every cone, in every direction', () => {
    const readings = [
      { originX: 32, originZ: 32, reading: { bearing: 0, halfAngle: 0.3, minDistance: 300, maxDistance: 450 } },
      { originX: 32, originZ: 32, reading: { bearing: Math.PI, halfAngle: 0.3, minDistance: 300, maxDistance: 450 } },
      { originX: 32, originZ: 32, reading: { bearing: Math.PI / 2, halfAngle: 0.3, minDistance: 300, maxDistance: 450 } },
      { originX: 32, originZ: 32, reading: { bearing: -Math.PI / 2, halfAngle: 0.3, minDistance: 300, maxDistance: 450 } },
    ];
    const e = extent(project(WORLD, [], readings));
    for (const r of readings) {
      for (const p of coneExtremes(r)) {
        expect(e.minX).toBeLessThanOrEqual(p.x + EPS);
        expect(e.maxX).toBeGreaterThanOrEqual(p.x - EPS);
        expect(e.minZ).toBeLessThanOrEqual(p.z + EPS);
        expect(e.maxZ).toBeGreaterThanOrEqual(p.z - EPS);
      }
    }
  });

  it('projects the whole cone onto the canvas', () => {
    const proj = project(WORLD, [], [origin]);
    const inCanvas = (p: number): boolean => p >= -EPS && p <= MAP_SIZE + EPS;
    for (const p of coneExtremes(origin)) {
      expect(inCanvas(projectX(proj, p.x))).toBe(true);
      expect(inCanvas(projectZ(proj, p.z))).toBe(true);
    }
  });

  it('uses one scale on both axes so a cone keeps its bearing, whatever the bearing', () => {
    const proj = project(WORLD, [], [{ originX: 32, originZ: 32, reading: { ...READING, bearing: 0.3 } }]);
    expect(proj.scaleZ).toBeCloseTo(proj.scaleX, 12);
  });

  it('shrinks the scale as a cone reaches farther', () => {
    const near = project(WORLD, [], [{ ...origin, reading: { ...READING, minDistance: 100, maxDistance: 150 } }]);
    const far = project(WORLD, [], [origin]);
    expect(far.scaleX).toBeLessThan(near.scaleX);
  });

  it('holds islands and cones together', () => {
    const island = { x: -280, z: 40, radius: 14 };
    const e = extent(project(WORLD, [island], [origin]));
    expect(e.minX).toBeLessThanOrEqual(island.x - island.radius + EPS);
    for (const p of coneExtremes(origin)) expect(e.maxX).toBeGreaterThanOrEqual(p.x - EPS);
  });

  it('a nearby cone that fits the world box leaves the world box projection', () => {
    const tiny = { originX: 32, originZ: 32, reading: { bearing: 0, halfAngle: 0.1, minDistance: 1, maxDistance: 10 } };
    expect(project(WORLD, [], [tiny])).toEqual(project(WORLD, []));
  });
});

// ── drawDetectorCones ─────────────────────────────────────────────────────────

interface Recorded { arcs: number[][]; fills: number; strokes: number }

/** A recording 2D context: every method is a no-op that remembers arcs, fills and strokes. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; rec: Recorded } {
  const props: Record<string, unknown> = {};
  const rec: Recorded = { arcs: [], fills: 0, strokes: 0 };
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop in props) return props[prop];
      if (prop === 'arc') return (...args: number[]) => { rec.arcs.push(args); };
      if (prop === 'fill') return () => { rec.fills++; };
      if (prop === 'stroke') return () => { rec.strokes++; };
      return () => undefined;
    },
    set(_t, prop: string, value) { props[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}

const PROJ: MapProjection = { originX: -300, originZ: -300, scaleX: 0.2, scaleZ: 0.2 };
const norm = (a: number): number => ((a % TAU) + TAU) % TAU;
const sameAngle = (a: number, b: number): boolean => {
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, TAU - d) < 1e-6;
};

/** The arcs centred on the projected origin, with the given projected radius. */
function arcsAt(rec: Recorded, originX: number, originZ: number, radiusPx: number): number[][] {
  return rec.arcs.filter(a =>
    Math.abs(a[0]! - projectX(PROJ, originX)) < EPS &&
    Math.abs(a[1]! - projectZ(PROJ, originZ)) < EPS &&
    Math.abs(a[2]! - radiusPx) < 1e-6);
}

describe('drawDetectorCones (#2291, C7)', () => {
  it('draws nothing without survey results', () => {
    const { ctx, rec } = recordingCtx();
    drawDetectorCones(ctx, stateWith([]), PROJ);
    expect(rec.arcs).toHaveLength(0);
    expect(rec.fills + rec.strokes).toBe(0);
  });

  it('draws nothing for a detector result with no crater', () => {
    const { ctx, rec } = recordingCtx();
    drawDetectorCones(ctx, stateWith([detectorResult(1, 32, 32)]), PROJ);
    expect(rec.arcs).toHaveLength(0);
    expect(rec.fills + rec.strokes).toBe(0);
  });

  it('ignores results of other methods', () => {
    const { ctx, rec } = recordingCtx();
    drawDetectorCones(ctx, stateWith([otherResult(1, 'seismic'), otherResult(2, 'aerial'), otherResult(3, 'prospection')]), PROJ);
    expect(rec.arcs).toHaveLength(0);
    expect(rec.fills + rec.strokes).toBe(0);
  });

  it('paints a reading as a filled sector from its origin', () => {
    const { ctx, rec } = recordingCtx();
    drawDetectorCones(ctx, stateWith([detectorResult(1, 32, 32, READING)]), PROJ);
    expect(rec.fills).toBeGreaterThanOrEqual(1);
    expect(rec.arcs.length).toBeGreaterThanOrEqual(1);
  });

  it('bounds the sector at the far distance, from bearing minus to bearing plus the half angle', () => {
    const { ctx, rec } = recordingCtx();
    drawDetectorCones(ctx, stateWith([detectorResult(1, 32, 32, READING)]), PROJ);
    const far = arcsAt(rec, 32, 32, READING.maxDistance * PROJ.scaleX);
    expect(far.length).toBeGreaterThanOrEqual(1);
    const lo = READING.bearing - READING.halfAngle;
    const hi = READING.bearing + READING.halfAngle;
    expect(far.some(a => (sameAngle(a[3]!, lo) && sameAngle(a[4]!, hi)) || (sameAngle(a[3]!, hi) && sameAngle(a[4]!, lo)))).toBe(true);
  });

  it('clips the sector at the near distance, over the same angles', () => {
    const { ctx, rec } = recordingCtx();
    drawDetectorCones(ctx, stateWith([detectorResult(1, 32, 32, READING)]), PROJ);
    const near = arcsAt(rec, 32, 32, READING.minDistance * PROJ.scaleX);
    expect(near.length).toBeGreaterThanOrEqual(1);
    const lo = READING.bearing - READING.halfAngle;
    const hi = READING.bearing + READING.halfAngle;
    expect(near.some(a => (sameAngle(a[3]!, lo) && sameAngle(a[4]!, hi)) || (sameAngle(a[3]!, hi) && sameAngle(a[4]!, lo)))).toBe(true);
  });

  it('draws every reading from its own origin, in its own band', () => {
    const second: DetectorReading = { bearing: 2.0, halfAngle: 0.15, minDistance: 220, maxDistance: 370 };
    const { ctx, rec } = recordingCtx();
    drawDetectorCones(ctx, stateWith([
      detectorResult(1, 32, 32, READING),
      detectorResult(2, 150, 40, second),
    ]), PROJ);
    expect(arcsAt(rec, 32, 32, READING.maxDistance * PROJ.scaleX).length).toBeGreaterThanOrEqual(1);
    expect(arcsAt(rec, 150, 40, second.maxDistance * PROJ.scaleX).length).toBeGreaterThanOrEqual(1);
    expect(rec.fills).toBeGreaterThanOrEqual(2);
  });

  it('centres every arc on the reading origin, never on the crater', () => {
    const { ctx, rec } = recordingCtx();
    drawDetectorCones(ctx, stateWith([detectorResult(1, 32, 32, READING)]), PROJ);
    for (const a of rec.arcs) {
      expect(a[0]).toBeCloseTo(projectX(PROJ, 32), 6);
      expect(a[1]).toBeCloseTo(projectZ(PROJ, 32), 6);
    }
  });
});

// ── The mini-map draws them ───────────────────────────────────────────────────

describe('MiniMap draws the cones (#2291, C7)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('paints a sector at the projected origin of a reading, in the widened projection', () => {
    const arcs: number[][] = [];
    const props: Record<string, unknown> = {};
    const ctx = new Proxy({}, {
      get(_t, prop: string) {
        if (prop in props) return props[prop];
        if (prop === 'arc') return (...args: number[]) => { arcs.push(args); };
        return () => undefined;
      },
      set(_t, prop: string, value) { props[prop] = value; return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);

    const minimap = new MiniMap(document.body);
    const state = makeGameContext({ seed: 42, size: 32, staffed: true }).state!;
    // Bearing along the diagonal: the widened box is square, so one scale serves both axes.
    const diagonal: DetectorReading = { ...READING, bearing: Math.PI / 4 };
    state.surveyResults.push(detectorResult(1, 16, 16, diagonal));
    const world = state.world!;
    const proj = project(
      { minX: world.minX, minZ: world.minZ, sizeX: world.sizeX, sizeZ: world.sizeZ },
      [],
      detectorReadingsOf(state),
    );
    minimap.update(state);

    const hit = arcs.find(a =>
      Math.abs(a[0]! - projectX(proj, 16)) < 1e-6 &&
      Math.abs(a[1]! - projectZ(proj, 16)) < 1e-6 &&
      Math.abs(a[2]! - diagonal.maxDistance * proj.scaleX) < 1e-6);
    expect(hit, 'a far arc centred on the reading origin').toBeDefined();
    minimap.dispose();
  });
});
