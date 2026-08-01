// BlastSimulator2026 — Mini-Map canvas layers (10.10)
// Pure canvas painting for the mini-map: terrain shading, grid lines, surveyed
// ore and the NavGrid overlay. Split out of MiniMap.ts, which keeps the DOM
// panel and the update() orchestration.

import type { GameState } from '../core/state/GameState.js';
import type { NavGrid, NavCellType } from '../core/nav/NavGrid.js';

export const MAP_SIZE = 120; // px

/** Legend swatch colours — every one of these must actually be drawn. */
export const COLOR_ROCK = '#5080a0';
export const COLOR_ORE = '#e8b040';
export const COLOR_BUILDING = '#a06030';
export const COLOR_HOLE = '#4040d0';
export const COLOR_CREW = '#6ad0f0';
export const COLOR_VEHICLE = '#c0c040';

/** Base terrain tint before elevation shading, as RGB components. */
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

/** Multiply an RGB triplet by `factor` and return a CSS colour. */
function shadeRgb(rgb: readonly [number, number, number], factor: number): string {
  const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp255(rgb[0] * factor)},${clamp255(rgb[1] * factor)},${clamp255(rgb[2] * factor)})`;
}

/**
 * Shade each column by its bench level so the pit's relief reads at a glance.
 * Falls back to a flat rock tint before the NavGrid has been built.
 */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  scaleX: number,
  scaleZ: number,
): void {
  const nav = state.navGrid;
  if (!nav) {
    ctx.fillStyle = COLOR_ROCK;
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    return;
  }

  const cellW = Math.max(1, Math.ceil(scaleX));
  const cellH = Math.max(1, Math.ceil(scaleZ));
  const maxBench = Math.max(1, nav.maxSurfaceY);

  for (let z = 0; z < nav.height; z++) {
    for (let x = 0; x < nav.width; x++) {
      const cell = nav.cells[z]?.[x];
      if (!cell) continue;
      if (cell.type === 'void') {
        ctx.fillStyle = '#0a0e12';
      } else {
        const t01 = Math.max(0, Math.min(1, cell.benchLevel / maxBench));
        const shade = SHADE_MIN + (SHADE_MAX - SHADE_MIN) * t01;
        ctx.fillStyle = shadeRgb(ROCK_RGB, shade);
      }
      ctx.fillRect(Math.floor(x * scaleX), Math.floor(z * scaleZ), cellW, cellH);
    }
  }
}

/** Faint grid overlay so the player can judge distances. */
export function drawGridLines(
  ctx: CanvasRenderingContext2D,
  sizeX: number,
  sizeZ: number,
  scaleX: number,
  scaleZ: number,
): void {
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.5;
  const step = Math.max(1, Math.floor(sizeX / 8));
  for (let x = 0; x <= sizeX; x += step) {
    ctx.beginPath();
    ctx.moveTo(x * scaleX, 0);
    ctx.lineTo(x * scaleX, MAP_SIZE);
    ctx.stroke();
  }
  for (let z = 0; z <= sizeZ; z += step) {
    ctx.beginPath();
    ctx.moveTo(0, z * scaleZ);
    ctx.lineTo(MAP_SIZE, z * scaleZ);
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
  scaleX: number,
  scaleZ: number,
): void {
  const cellW = Math.max(1, Math.ceil(scaleX));
  const cellH = Math.max(1, Math.ceil(scaleZ));

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
      ctx.fillStyle = COLOR_ORE;
      ctx.fillRect(Math.floor(x * scaleX), Math.floor(z * scaleZ), cellW, cellH);
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
  scaleX: number,
  scaleZ: number,
): void {
  if (!navGrid) return;

  const cellW = Math.max(1, Math.floor(scaleX));
  const cellH = Math.max(1, Math.floor(scaleZ));

  for (let z = 0; z < navGrid.height; z++) {
    for (let x = 0; x < navGrid.width; x++) {
      const cell = navGrid.cells[z]?.[x];
      if (!cell) continue;
      const color = NAV_GRID_COLOR_MAP[cell.type];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(
        Math.floor(x * scaleX),
        Math.floor(z * scaleZ),
        cellW,
        cellH,
      );
    }
  }
}
