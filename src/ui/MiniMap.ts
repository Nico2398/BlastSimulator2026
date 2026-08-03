// BlastSimulator2026 — Mini-Map (10.10)
// Canvas-based overhead view of the mine: terrain elevation, buildings, vehicles, drill holes.
// Canvas layer painting lives in ./miniMapLayers.ts; this file owns the DOM panel.

import { t } from '../core/i18n/I18n.js';
import { LocaleTextRegistry } from './localeText.js';
import {
  MAP_SIZE,
  COLOR_ROCK,
  COLOR_ORE,
  COLOR_BUILDING,
  COLOR_HOLE,
  COLOR_CREW,
  COLOR_VEHICLE,
  drawTerrain,
  drawGridLines,
  drawSurveyedOre,
  drawNavGridOverlay,
  projectX,
  projectZ,
  type MapProjection,
} from './miniMapLayers.js';
import type { GameState } from '../core/state/GameState.js';
import type { NavGrid } from '../core/nav/NavGrid.js';

const LEGEND_HEIGHT = 16;

export class MiniMap {
  private readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly title: HTMLElement;
  private _navGridVisible: boolean = false;
  private _navGrid: NavGrid | null = null;
  /** Last projection used, so an out-of-band overlay draw lines up with the terrain already painted. */
  private projection: MapProjection = { originX: 0, originZ: 0, scaleX: 1, scaleZ: 1 };
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-minimap';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.cssText = 'padding:6px;width:fit-content';

    this.title = document.createElement('div');
    this.title.className = 'bs-panel-title';
    this.title.style.fontSize = '10px';
    this.locale.bindText(this.title, 'ui.minimap.title');

    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;
    // Centred: the legend row is wider than the map, so a left-aligned canvas
    // leaves a lopsided gap on the right of the panel.
    this.canvas.style.cssText = `display:block;margin:0 auto;width:${MAP_SIZE}px;height:${MAP_SIZE}px;cursor:crosshair`;
    this.locale.bindTitle(this.canvas, 'ui.minimap.title');

    const legend = document.createElement('div');
    legend.style.cssText = `display:flex;gap:6px;margin-top:3px;height:${LEGEND_HEIGHT}px;font-size:9px;align-items:center`;

    const items: [string, string][] = [
      [COLOR_ROCK, 'ui.minimap.rock'],
      [COLOR_ORE, 'ui.minimap.ore'],
      [COLOR_BUILDING, 'ui.minimap.building'],
      [COLOR_HOLE, 'ui.minimap.hole'],
      [COLOR_CREW, 'ui.minimap.crew'],
    ];
    for (const [color, labelKey] of items) {
      const swatch = document.createElement('span');
      swatch.style.cssText = `display:inline-block;width:8px;height:8px;background:${color};border-radius:1px`;
      const txt = document.createElement('span');
      txt.style.color = '#908070';
      this.locale.bindText(txt, labelKey);
      legend.append(swatch, txt);
    }

    this.ctx2d = this.canvas.getContext('2d')!;
    this.el.append(this.title, this.canvas, legend);
    container.appendChild(this.el);
  }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  /** Re-render locale-dependent text (title, legend) after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    // The canvas placeholder is painted by update(), which runs every tick.
  }

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
      ctx.fillText(t('ui.minimap.no_data'), MAP_SIZE / 2, MAP_SIZE / 2);
      return;
    }

    const { sizeX, sizeZ, minX, minZ } = world;
    // The site's bounding box, not a square at the origin: a site claimed
    // westward starts at a negative x (#473 P5).
    const proj: MapProjection = {
      originX: minX,
      originZ: minZ,
      scaleX: MAP_SIZE / sizeX,
      scaleZ: MAP_SIZE / sizeZ,
    };
    this.projection = proj;

    drawTerrain(ctx, state, proj);
    drawGridLines(ctx, sizeX, sizeZ, proj);
    drawSurveyedOre(ctx, state, proj);

    // Draw buildings
    ctx.fillStyle = COLOR_BUILDING;
    for (const b of state.buildings.buildings) {
      ctx.fillRect(
        Math.floor(projectX(proj, b.x)) - 2,
        Math.floor(projectZ(proj, b.z)) - 2,
        4, 4,
      );
    }

    // Draw vehicles
    ctx.fillStyle = COLOR_VEHICLE;
    for (const v of state.vehicles.vehicles) {
      ctx.fillRect(
        Math.floor(projectX(proj, v.x)) - 1,
        Math.floor(projectZ(proj, v.z)) - 1,
        3, 3,
      );
    }

    // Draw crew
    ctx.fillStyle = COLOR_CREW;
    for (const e of state.employees.employees) {
      if (!e.alive) continue;
      ctx.beginPath();
      ctx.arc(projectX(proj, e.x), projectZ(proj, e.z), 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw drill holes
    ctx.fillStyle = COLOR_HOLE;
    for (const h of state.drillHoles) {
      ctx.beginPath();
      ctx.arc(projectX(proj, h.x), projectZ(proj, h.z), 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw NavGrid overlay when visible
    if (this._navGridVisible) {
      this.drawNavGridOverlay(ctx, proj.scaleX, proj.scaleZ);
    }
  }

  dispose(): void { this.el.remove(); }

  get navGridVisible(): boolean { return this._navGridVisible; }

  setNavGridVisible(visible: boolean): void { this._navGridVisible = visible; }

  setNavGrid(navGrid: NavGrid | null): void { this._navGrid = navGrid; }

  get navGrid(): NavGrid | null { return this._navGrid; }

  /**
   * Paint the NavGrid cell-type overlay for the currently attached grid.
   * The origin comes from the last `update` — a caller supplying only a
   * scale gets the site's current position, which is the only one that can
   * line up with the terrain already painted underneath.
   */
  drawNavGridOverlay(ctx: CanvasRenderingContext2D, scaleX: number, scaleZ: number): void {
    drawNavGridOverlay(ctx, this._navGrid, {
      originX: this.projection.originX,
      originZ: this.projection.originZ,
      scaleX,
      scaleZ,
    });
  }
}
