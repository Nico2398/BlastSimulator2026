// BlastSimulator2026 — Mini-Map canvas layers (10.10)
// Pure canvas painting for the mini-map: terrain shading, grid lines, surveyed
// ore and the NavGrid overlay. Split out of MiniMap.ts, which keeps the DOM
// panel and the update() orchestration.

import type { GameState } from '../core/state/GameState.js';
import type { NavGrid, NavCellType } from '../core/nav/NavGrid.js';

export const MAP_SIZE = 120; // px

/** Layer colours — MINIMAP_LAYERS derives the legend from these, and update() draws with them. */
const COLOR_ROCK = '#5080a0';
const COLOR_ORE = '#e8b040';
const COLOR_BUILDING = '#a06030';
const COLOR_HOLE = '#4040d0';
const COLOR_CREW = '#6ad0f0';
const COLOR_VEHICLE = '#c0c040';

/** One drawn mini-map layer: the single source for legend entries and draw fills. */
interface MiniMapLayer {
  id: 'rock' | 'ore' | 'building' | 'vehicle' | 'crew' | 'hole';
  color: string;
  /** i18n key of the legend label. */
  labelKey: string;
}

/** Every layer the mini-map draws, in legend order. */
export const MINIMAP_LAYERS: readonly MiniMapLayer[] = [
  { id: 'rock', color: COLOR_ROCK, labelKey: 'ui.minimap.rock' },
  { id: 'ore', color: COLOR_ORE, labelKey: 'ui.minimap.ore' },
  { id: 'building', color: COLOR_BUILDING, labelKey: 'ui.minimap.building' },
  { id: 'vehicle', color: COLOR_VEHICLE, labelKey: 'ui.minimap.vehicle' },
  { id: 'crew', color: COLOR_CREW, labelKey: 'ui.minimap.crew' },
  { id: 'hole', color: COLOR_HOLE, labelKey: 'ui.minimap.hole' },
];

/** Fill colour of the layer with the given id. */
export function layerColor(id: MiniMapLayer['id']): string {
  return MINIMAP_LAYERS.find((l) => l.id === id)!.color;
}

/** Base terrain tint before elevation shading, as RGB components (COLOR_ROCK #5080a0). */
const ROCK_RGB: readonly [number, number, number] = [80, 128, 160];
/** Elevation shading range: lowest bench this dark, highest this bright. */
const SHADE_MIN = 0.45;
const SHADE_MAX = 1.15;

/** Semi-transparent color overlay per NavCellType — shared across frames to avoid re-allocation. */
const NAV_GRID_COLOR_MAP: Record<NavCellType, string> = {
  walkable: 'rgba(0, 180, 0, 0.25)',
  blocked: 'rgba(180, 0, 0, 0.45)',
  drill_hole: 'rgba(180, 120, 0, 0.55)',
  ramp: 'rgba(180, 180, 0, 0.45)',
  void: 'rgba(0, 0, 0, 0.5)',
};

/**
 * Maps world XZ onto the mini-map's pixel square. The site no longer starts
 * at the origin — it grows in whatever direction play takes it (#473) — so
 * every layer projects through this rather than multiplying a world
 * coordinate by a scale and hoping the site starts at 0.
 */
export interface MapProjection {
  /** World x drawn at pixel 0. */
  originX: number;
  /** World z drawn at pixel 0. */
  originZ: number;
  scaleX: number;
  scaleZ: number;
}

/** Pixel x for a world x. */
export function projectX(proj: MapProjection, x: number): number {
  return (x - proj.originX) * proj.scaleX;
}

/** Pixel z for a world z. */
export function projectZ(proj: MapProjection, z: number): number {
  return (z - proj.originZ) * proj.scaleZ;
}

/** Multiply an RGB triplet by `factor` and return a CSS colour. */
function shadeRgb(rgb: readonly [number, number, number], factor: number): string {
  const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp255(rgb[0] * factor)},${clamp255(rgb[1] * factor)},${clamp255(rgb[2] * factor)})`;
}

/** Stable small code per cell type, for `StaticLayerInputs`'s flat buffer. */
const CELL_TYPE_CODE: Record<NavCellType, number> = {
  walkable: 0, blocked: 1, drill_hole: 2, ramp: 3, void: 4,
};

/**
 * Everything `drawTerrain` and `drawGridLines` read, kept as a flat buffer so
 * `MiniMap` can tell with one linear compare whether the layer it painted
 * last time is still what these would paint now. Painting them is ~10k
 * `fillRect` calls on a 96×96 site — ~10 ms, which `MiniMap.update()` used
 * to spend on every frame and again after every console command, for a
 * picture that changes only when the terrain does.
 */
export class StaticLayerInputs {
  private key = '';
  private cells = new Float64Array(0);

  /**
   * Record what the static layers would draw for `state` and `proj`.
   * Returns true when that differs from the previous capture — including the
   * first call — so the caller repaints exactly then.
   */
  capture(state: GameState, proj: MapProjection): boolean {
    const nav = state.navGrid;
    const world = state.world;
    const key = [
      nav ? `${nav.originX},${nav.originZ},${nav.maxX},${nav.maxZ},${nav.maxSurfaceY}` : 'no-nav',
      world ? `${world.sizeX},${world.sizeZ}` : 'no-world',
      `${proj.originX},${proj.originZ},${proj.scaleX},${proj.scaleZ}`,
    ].join('|');
    let changed = key !== this.key;
    this.key = key;

    const cellCount = nav ? (nav.maxX - nav.originX) * (nav.maxZ - nav.originZ) : 0;
    if (this.cells.length !== cellCount * 2) {
      this.cells = new Float64Array(cellCount * 2);
      changed = true;
    }
    if (!nav) return changed;

    let i = 0;
    for (let z = nav.originZ; z < nav.maxZ; z++) {
      for (let x = nav.originX; x < nav.maxX; x++) {
        const cell = nav.cellAt(x, z);
        const type = cell ? CELL_TYPE_CODE[cell.type] : -1;
        const bench = cell ? cell.benchLevel : -1;
        if (this.cells[i] !== type) { this.cells[i] = type; changed = true; }
        if (this.cells[i + 1] !== bench) { this.cells[i + 1] = bench; changed = true; }
        i += 2;
      }
    }
    return changed;
  }
}

/**
 * Shade each column by its bench level so the pit's relief reads at a glance.
 * Falls back to a flat rock tint before the NavGrid has been built.
 */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  proj: MapProjection,
): void {
  const { scaleX, scaleZ } = proj;
  const nav = state.navGrid;
  if (!nav) {
    ctx.fillStyle = layerColor('rock');
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    return;
  }

  const cellW = Math.max(1, Math.ceil(scaleX));
  const cellH = Math.max(1, Math.ceil(scaleZ));
  const maxBench = Math.max(1, nav.maxSurfaceY);
  const styles = new Map<number, string>();
  const styleOf = (benchLevel: number): string => {
    let style = styles.get(benchLevel);
    if (style === undefined) {
      const t01 = Math.max(0, Math.min(1, benchLevel / maxBench));
      style = shadeRgb(ROCK_RGB, SHADE_MIN + (SHADE_MAX - SHADE_MIN) * t01);
      styles.set(benchLevel, style);
    }
    return style;
  };

  // One rect per run of same-coloured cells in a row, not one per cell: a
  // repaint after a blast or a dig was ten thousand fillRects in one frame
  // (#1603). The run covers exactly the pixels its cells did, painted in the
  // same order, so the picture is unchanged.
  for (let z = nav.originZ; z < nav.maxZ; z++) {
    const py = Math.floor(projectZ(proj, z));
    let runStyle: string | null = null;
    let runStart = 0;
    let runEnd = 0;
    const flush = (): void => {
      if (runStyle === null) return;
      ctx.fillStyle = runStyle;
      const px = Math.floor(projectX(proj, runStart));
      ctx.fillRect(px, py, Math.floor(projectX(proj, runEnd)) + cellW - px, cellH);
      runStyle = null;
    };
    for (let x = nav.originX; x < nav.maxX; x++) {
      const cell = nav.cellAt(x, z);
      if (!cell) { flush(); continue; }
      const style = cell.type === 'void' ? '#0a0e12' : styleOf(cell.benchLevel);
      if (style !== runStyle) {
        flush();
        runStyle = style;
        runStart = x;
      }
      runEnd = x;
    }
    flush();
  }
}

/** Faint grid overlay so the player can judge distances. */
export function drawGridLines(
  ctx: CanvasRenderingContext2D,
  sizeX: number,
  sizeZ: number,
  proj: MapProjection,
): void {
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.5;
  const step = Math.max(1, Math.floor(sizeX / 8));
  for (let x = proj.originX; x <= proj.originX + sizeX; x += step) {
    const px = projectX(proj, x);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, MAP_SIZE);
    ctx.stroke();
  }
  for (let z = proj.originZ; z <= proj.originZ + sizeZ; z += step) {
    const pz = projectZ(proj, z);
    ctx.beginPath();
    ctx.moveTo(0, pz);
    ctx.lineTo(MAP_SIZE, pz);
    ctx.stroke();
  }
}

/**
 * Paint surveyed columns that came back with ore. Opacity tracks the richest
 * estimate in the column, so a survey visibly pays off on the map.
 */
export function drawSurveyedOre(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  proj: MapProjection,
): void {
  const cellW = Math.max(1, Math.ceil(proj.scaleX));
  const cellH = Math.max(1, Math.ceil(proj.scaleZ));

  for (const survey of state.surveyResults) {
    for (const [colKey, oreEstimates] of Object.entries(survey.estimates)) {
      const [xStr, zStr] = colKey.split(',');
      const x = Number(xStr);
      const z = Number(zStr);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;

      let richest = 0;
      for (const density of Object.values(oreEstimates)) {
        if (density > richest) richest = density;
      }
      if (richest <= 0) continue;

      ctx.globalAlpha = Math.max(0.25, Math.min(1, richest));
      ctx.fillStyle = layerColor('ore');
      ctx.fillRect(Math.floor(projectX(proj, x)), Math.floor(projectZ(proj, z)), cellW, cellH);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Draw semi-transparent colored overlays on the minimap for each NavGrid cell type.
 * - walkable: green tint
 * - blocked: red tint
 * - drill_hole: orange tint
 * - ramp: yellow tint
 * - void: dark tint
 */
export function drawNavGridOverlay(
  ctx: CanvasRenderingContext2D,
  navGrid: NavGrid | null,
  proj: MapProjection,
): void {
  if (!navGrid) return;

  const cellW = Math.max(1, Math.floor(proj.scaleX));
  const cellH = Math.max(1, Math.floor(proj.scaleZ));

  for (let z = navGrid.originZ; z < navGrid.maxZ; z++) {
    for (let x = navGrid.originX; x < navGrid.maxX; x++) {
      const cell = navGrid.cellAt(x, z);
      if (!cell) continue;
      const color = NAV_GRID_COLOR_MAP[cell.type];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(
        Math.floor(projectX(proj, x)),
        Math.floor(projectZ(proj, z)),
        cellW,
        cellH,
      );
    }
  }
}
