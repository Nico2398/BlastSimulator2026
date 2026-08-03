// BlastSimulator2026 — Mini-Map (10.10, chrome redesigned P1)
// Canvas-based overhead view of the mine: terrain elevation, buildings, vehicles, drill holes.
// Canvas layer painting lives in ./miniMapLayers.ts; this file owns the DOM panel.

import { t } from '../core/i18n/I18n.js';
import { LocaleTextRegistry } from './localeText.js';
import { iconEl } from './icons.js';
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
  private readonly navToggleBtn: HTMLButtonElement;
  private _navGridVisible: boolean = false;
  private _navGrid: NavGrid | null = null;
  /** Last projection used, so an out-of-band overlay draw lines up with the terrain already painted. */
  private projection: MapProjection = { originX: 0, originZ: 0, scaleX: 1, scaleZ: 1 };
  private readonly locale = new LocaleTextRegistry();
  private onFocus?: (x: number, z: number) => void;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-minimap';
    this.el.classList.add('bs-ui', 'bs-panel', 'bsx-root');
    this.el.style.cssText = 'padding:0;width:fit-content;overflow:hidden;border-radius:var(--bsx-r-card);background:rgba(16,20,26,.95)';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:7px;height:26px;padding:0 8px;border-bottom:1px solid var(--bsx-hairline)';
    header.appendChild(iconEl('map', 11, 0.55));
    this.title = document.createElement('div');
    this.title.className = 'bs-panel-title';
    this.title.style.cssText = 'font:700 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-tinted);margin:0;border:0;padding:0';
    this.locale.bindText(this.title, 'ui.minimap.title');
    header.appendChild(this.title);

    const layersWrap = document.createElement('div');
    layersWrap.style.cssText = 'margin-left:auto;display:flex;gap:2px';
    const navBtn = document.createElement('button');
    navBtn.style.cssText = 'width:20px;height:18px;display:flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:3px;background:transparent;color:var(--bsx-text-muted);cursor:pointer;padding:0;pointer-events:all';
    navBtn.title = t('shell.minimap.nav_tip');
    navBtn.appendChild(iconEl('layers', 10));
    navBtn.addEventListener('click', () => this.setNavGridVisible(!this._navGridVisible));
    layersWrap.appendChild(navBtn);
    this.navToggleBtn = navBtn;
    header.appendChild(layersWrap);

    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;
    // Centred: the legend row is wider than the map, so a left-aligned canvas
    // leaves a lopsided gap on the right of the panel.
    this.canvas.style.cssText = `display:block;margin:6px auto 0;width:${MAP_SIZE}px;height:${MAP_SIZE}px;cursor:pointer`;
    this.locale.bindTitle(this.canvas, 'ui.minimap.title');
    this.canvas.addEventListener('click', (e) => this.handleClick(e));

    const legend = document.createElement('div');
    legend.style.cssText = `display:flex;gap:6px;padding:3px 6px 6px;height:${LEGEND_HEIGHT}px;font-size:9px;align-items:center`;

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
    this.el.append(header, this.canvas, legend);
    container.appendChild(this.el);
    this.syncLayerButton(navBtn);
  }

  /** Focus the 3D camera on the world point under a minimap click. */
  private handleClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (MAP_SIZE / rect.width);
    const pz = (e.clientY - rect.top) * (MAP_SIZE / rect.height);
    const worldX = this.projection.originX + px / this.projection.scaleX;
    const worldZ = this.projection.originZ + pz / this.projection.scaleZ;
    this.onFocus?.(worldX, worldZ);
  }

  private syncLayerButton(btn: HTMLButtonElement): void {
    const active = this._navGridVisible;
    btn.style.borderColor = active ? 'var(--bsx-amber)' : 'transparent';
    btn.style.color = active ? 'var(--bsx-amber)' : 'var(--bsx-text-muted)';
    btn.style.background = active ? 'rgba(255,176,46,.12)' : 'transparent';
  }

  /** Register a handler for clicking the map: called with the world (x, z) under the cursor. */
  setFocusHandler(cb: (x: number, z: number) => void): void {
    this.onFocus = cb;
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

  setNavGridVisible(visible: boolean): void {
    this._navGridVisible = visible;
    this.syncLayerButton(this.navToggleBtn);
  }

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
