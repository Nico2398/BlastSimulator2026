// BlastSimulator2026 — Shared tile shading for TileSelectOverlay pickers
// Turns the picker's blank grid into a readable plan of the site.

import type { GameState } from '../core/state/GameState.js';

/** Base rock tint, shaded by bench level. */
const ROCK_RGB: readonly [number, number, number] = [72, 112, 140];
const SHADE_MIN = 0.5;
const SHADE_MAX = 1.2;

const COLOR_VOID = '#0a0e12';
const COLOR_BUILDING = '#a06030';
const COLOR_HOLE = '#4040d0';
const COLOR_RAMP = '#b8a63a';

/** Ore overlay drawn on surveyed columns — alpha scales with the estimate. */
function oreColor(density: number): string {
  const alpha = Math.max(0.3, Math.min(0.95, density));
  return `rgba(232, 176, 64, ${alpha})`;
}

function shade(factor: number): string {
  const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp255(ROCK_RGB[0] * factor)},${clamp255(ROCK_RGB[1] * factor)},${clamp255(ROCK_RGB[2] * factor)})`;
}

/**
 * Build a per-tile colour lookup for a tile picker.
 *
 * Layers, lowest priority first: bench-level relief, surveyed ore, ramps,
 * buildings, drill holes. Returns null for tiles with nothing to show so the
 * picker keeps its own background.
 */
export function makeSiteTileFill(state: GameState): (x: number, z: number) => string | null {
  const nav = state.navGrid;
  const maxBench = Math.max(1, nav?.maxSurfaceY ?? 1);

  // Flatten the survey estimates to the richest reading per column once, rather
  // than re-scanning every survey for each of the grid's tiles.
  const ore = new Map<string, number>();
  for (const survey of state.surveyResults) {
    for (const [colKey, estimates] of Object.entries(survey.estimates)) {
      for (const density of Object.values(estimates)) {
        if (density > (ore.get(colKey) ?? 0)) ore.set(colKey, density);
      }
    }
  }

  const buildings = new Set(state.buildings.buildings.map(b => `${Math.floor(b.x)},${Math.floor(b.z)}`));
  const holes = new Set(state.drillHoles.map(h => `${Math.floor(h.x)},${Math.floor(h.z)}`));

  return (x: number, z: number): string | null => {
    const key = `${x},${z}`;
    if (holes.has(key)) return COLOR_HOLE;
    if (buildings.has(key)) return COLOR_BUILDING;

    const cell = nav?.cells[z]?.[x];
    if (cell?.type === 'ramp') return COLOR_RAMP;

    const oreDensity = ore.get(key);
    if (oreDensity !== undefined) return oreColor(oreDensity);

    if (!cell) return null;
    if (cell.type === 'void') return COLOR_VOID;

    const t01 = Math.max(0, Math.min(1, cell.benchLevel / maxBench));
    return shade(SHADE_MIN + (SHADE_MAX - SHADE_MIN) * t01);
  };
}
