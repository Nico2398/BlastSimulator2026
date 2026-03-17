// BlastSimulator2026 — Mini-Map (10.10)
// Canvas-based overhead view of the mine: terrain elevation, buildings, vehicles, drill holes.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';

const MAP_SIZE = 120; // px
const LEGEND_HEIGHT = 16;

export class MiniMap {
  private readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly title: HTMLElement;

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
    this.canvas.style.cssText = `display:block;width:${MAP_SIZE}px;height:${MAP_SIZE}px;cursor:crosshair`;
    this.canvas.title = t('ui.minimap.title');

    const legend = document.createElement('div');
    legend.style.cssText = `display:flex;gap:6px;margin-top:3px;height:${LEGEND_HEIGHT}px;font-size:9px;align-items:center`;

    const items: [string, string][] = [
      ['#5080a0', t('ui.minimap.rock')],
      ['#e8b040', t('ui.minimap.ore')],
      ['#a06030', t('ui.minimap.building')],
      ['#4040d0', t('ui.minimap.hole')],
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

    // Draw background terrain
    ctx.fillStyle = '#2a3a20';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Draw a grid overlay to convey scale
    ctx.strokeStyle = '#1a2a10';
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

    // Draw buildings
    ctx.fillStyle = '#a06030';
    for (const b of state.buildings.buildings) {
      ctx.fillRect(
        Math.floor(b.x * scaleX) - 2,
        Math.floor(b.z * scaleZ) - 2,
        4, 4,
      );
    }

    // Draw vehicles
    ctx.fillStyle = '#c0c040';
    for (const v of state.vehicles.vehicles) {
      ctx.fillRect(
        Math.floor(v.x * scaleX) - 1,
        Math.floor(v.z * scaleZ) - 1,
        3, 3,
      );
    }

    // Draw drill holes
    ctx.fillStyle = '#4040d0';
    for (const h of state.drillHoles) {
      ctx.beginPath();
      ctx.arc(h.x * scaleX, h.z * scaleZ, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  dispose(): void { this.el.remove(); }
}
