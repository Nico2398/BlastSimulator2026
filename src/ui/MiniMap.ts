// BlastSimulator2026 — Mini-Map (10.10)
// Canvas-based overhead view of the mine: terrain elevation, buildings, vehicles, drill holes.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { NavGrid, NavCellType } from '../core/nav/NavGrid.js';

const MAP_SIZE = 120; // px
const LEGEND_HEIGHT = 16;

/** Legend swatch colours — every one of these must actually be drawn. */
const COLOR_ROCK = '#5080a0';
const COLOR_ORE = '#e8b040';
const COLOR_BUILDING = '#a06030';
const COLOR_HOLE = '#4040d0';
const COLOR_CREW = '#6ad0f0';
const COLOR_VEHICLE = '#c0c040';

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

export class MiniMap {
  private readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly title: HTMLElement;
  private _navGridVisible: boolean = false;
  private _navGrid: NavGrid | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-minimap';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.cssText = 'padding:6px;width:fit-content';

    this.title = document.createElement('div');
    this.title.className = 'bs-panel-title';
    this.title.style.fontSize = '10px';
    this.title.textContent = t('ui.minimap.title');

    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;
    // Centred: the legend row is wider than the map, so a left-aligned canvas
    // leaves a lopsided gap on the right of the panel.
    this.canvas.style.cssText = `display:block;margin:0 auto;width:${MAP_SIZE}px;height:${MAP_SIZE}px;cursor:crosshair`;
    this.canvas.title = t('ui.minimap.title');

    const legend = document.createElement('div');
    legend.style.cssText = `display:flex;gap:6px;margin-top:3px;height:${LEGEND_HEIGHT}px;font-size:9px;align-items:center`;

    const items: [string, string][] = [
      [COLOR_ROCK, t('ui.minimap.rock')],
      [COLOR_ORE, t('ui.minimap.ore')],
      [COLOR_BUILDING, t('ui.minimap.building')],
      [COLOR_HOLE, t('ui.minimap.hole')],
      [COLOR_CREW, t('ui.minimap.crew')],
    ];
    for (const [color, label] of items) {
      const swatch = document.createElement('span');
      swatch.style.cssText = `display:inline-block;width:8px;height:8px;background:${color};border-radius:1px`;
      const txt = document.createElement('span');
      txt.style.color = '#908070';
      txt.textContent = label;
      legend.append(swatch, txt);
    }

    this.ctx2d = this.canvas.getContext('2d')!;
    this.el.append(this.title, this.canvas, legend);
    container.appendChild(this.el);
  }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    const ctx = this.ctx2d;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);

    const world = state.world;
    if (!world) {
      ctx.fillStyle = '#2a1a0a';
      ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
      ctx.fillStyle = '#604030';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No map data', MAP_SIZE / 2, MAP_SIZE / 2);
      return;
    }

    const { sizeX, sizeZ } = world;
    const scaleX = MAP_SIZE / sizeX;
    const scaleZ = MAP_SIZE / sizeZ;

    this.drawTerrain(ctx, state, scaleX, scaleZ);
    this.drawGridLines(ctx, sizeX, sizeZ, scaleX, scaleZ);
    this.drawSurveyedOre(ctx, state, scaleX, scaleZ);

    // Draw buildings
    ctx.fillStyle = COLOR_BUILDING;
    for (const b of state.buildings.buildings) {
      ctx.fillRect(
        Math.floor(b.x * scaleX) - 2,
        Math.floor(b.z * scaleZ) - 2,
        4, 4,
      );
    }

    // Draw vehicles
    ctx.fillStyle = COLOR_VEHICLE;
    for (const v of state.vehicles.vehicles) {
      ctx.fillRect(
        Math.floor(v.x * scaleX) - 1,
        Math.floor(v.z * scaleZ) - 1,
        3, 3,
      );
    }

    // Draw crew
    ctx.fillStyle = COLOR_CREW;
    for (const e of state.employees.employees) {
      if (!e.alive) continue;
      ctx.beginPath();
      ctx.arc(e.x * scaleX, e.z * scaleZ, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw drill holes
    ctx.fillStyle = COLOR_HOLE;
    for (const h of state.drillHoles) {
      ctx.beginPath();
      ctx.arc(h.x * scaleX, h.z * scaleZ, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw NavGrid overlay when visible
    if (this._navGridVisible) {
      this.drawNavGridOverlay(ctx, scaleX, scaleZ);
    }
  }

  /**
   * Shade each column by its bench level so the pit's relief reads at a glance.
   * Falls back to a flat rock tint before the NavGrid has been built.
   */
  private drawTerrain(
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
  private drawGridLines(
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
  private drawSurveyedOre(
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

  dispose(): void { this.el.remove(); }

  get navGridVisible(): boolean { return this._navGridVisible; }

  setNavGridVisible(visible: boolean): void { this._navGridVisible = visible; }

  setNavGrid(navGrid: NavGrid | null): void { this._navGrid = navGrid; }

  get navGrid(): NavGrid | null { return this._navGrid; }

  /**
   * Draw semi-transparent colored overlays on the minimap for each NavGrid cell type.
   * - walkable: green tint
   * - blocked: red tint
   * - drill_hole: orange tint
   * - ramp: yellow tint
   * - void: dark tint
   */
  drawNavGridOverlay(ctx: CanvasRenderingContext2D, scaleX: number, scaleZ: number): void {
    const navGrid = this._navGrid;
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
}
