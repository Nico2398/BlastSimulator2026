// BlastSimulator2026 — Tile Select Overlay (1.0)
// Full-screen 2D top-down interactive overlay for selecting rectangular tile regions.
// Replaces browser prompt() calls for building placement and drill grid creation.

export interface ExtraField {
  id: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
}

export interface TileSelectResult {
  /** Top-left tile X (world space). */
  x: number;
  /** Top-left tile Z (world space). */
  z: number;
  /** Bottom-right tile X (area mode only). */
  x2?: number;
  /** Bottom-right tile Z (area mode only). */
  z2?: number;
  /** Extra form field values by id. */
  fields: Record<string, number>;
}

export type SelectMode = 'point' | 'area';

export interface TileSelectConfig {
  mode: SelectMode;
  worldSizeX: number;
  worldSizeZ: number;
  title: string;
  extraFields?: ExtraField[];
  onConfirm: (result: TileSelectResult) => void;
  onCancel?: () => void;
}

const CANVAS_W = 640;
const CANVAS_H = 480;

export class TileSelectOverlay {
  private readonly overlay: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private config: TileSelectConfig | null = null;

  // Drag state
  private dragStart: { tx: number; tz: number } | null = null;
  private dragEnd: { tx: number; tz: number } | null = null;
  private hoverTile: { tx: number; tz: number } | null = null;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'bs-tile-select-overlay';
    this.overlay.style.display = 'none';

    const panel = document.createElement('div');
    panel.className = 'bs-tile-select-panel';

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.canvas.className = 'bs-tile-select-canvas';

    this.ctx = this.canvas.getContext('2d');

    panel.appendChild(this.canvas);
    this.overlay.appendChild(panel);
    container.appendChild(this.overlay);

    this.bindEvents();
  }

  open(config: TileSelectConfig): void {
    this.config = config;
    this.dragStart = null;
    this.dragEnd = null;
    this.hoverTile = null;

    // Rebuild form controls
    const existingForm = this.overlay.querySelector('.bs-tile-select-form');
    if (existingForm) existingForm.remove();

    const panel = this.overlay.querySelector('.bs-tile-select-panel') as HTMLElement;

    const form = document.createElement('div');
    form.className = 'bs-tile-select-form';

    const titleEl = document.createElement('div');
    titleEl.className = 'bs-tile-select-title';
    titleEl.textContent = config.title;
    form.appendChild(titleEl);

    const hint = document.createElement('div');
    hint.className = 'bs-tile-select-hint';
    hint.textContent = config.mode === 'area'
      ? 'Click and drag to select a rectangular area'
      : 'Click a tile to select it';
    form.appendChild(hint);

    const selectionInfo = document.createElement('div');
    selectionInfo.className = 'bs-tile-select-info';
    selectionInfo.id = 'bs-tile-select-info';
    selectionInfo.textContent = 'No selection';
    form.appendChild(selectionInfo);

    // Extra fields
    if (config.extraFields?.length) {
      const fieldsRow = document.createElement('div');
      fieldsRow.className = 'bs-tile-select-fields';
      for (const field of config.extraFields) {
        const label = document.createElement('label');
        label.className = 'bs-tile-select-field-label';
        label.textContent = field.label;
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'bs-input bs-tile-select-field';
        input.id = `bs-tsf-${field.id}`;
        input.value = String(field.defaultValue);
        input.min = String(field.min);
        input.max = String(field.max);
        input.step = String(field.step);
        fieldsRow.append(label, input);
      }
      form.appendChild(fieldsRow);
    }

    const btnRow = document.createElement('div');
    btnRow.className = 'bs-tile-select-btns';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'bs-btn bs-btn-primary';
    confirmBtn.id = 'bs-tile-select-confirm';
    confirmBtn.textContent = 'Confirm';
    confirmBtn.disabled = true;
    confirmBtn.addEventListener('click', () => this.confirm());

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'bs-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.cancel());

    btnRow.append(confirmBtn, cancelBtn);
    form.appendChild(btnRow);

    panel.appendChild(form);

    this.overlay.style.display = 'flex';
    this.render();
  }

  close(): void {
    this.overlay.style.display = 'none';
    this.config = null;
    this.dragStart = null;
    this.dragEnd = null;
    this.hoverTile = null;
  }

  dispose(): void {
    this.overlay.remove();
  }

  private bindEvents(): void {
    this.canvas.addEventListener('mousemove', (e) => {
      const tile = this.canvasToTile(e);
      if (!tile) return;
      this.hoverTile = tile;
      if (this.dragStart && e.buttons === 1 && this.config?.mode === 'area') {
        this.dragEnd = tile;
        this.updateSelectionInfo();
      }
      this.render();
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const tile = this.canvasToTile(e);
      if (!tile) return;
      this.dragStart = tile;
      this.dragEnd = this.config?.mode === 'area' ? tile : null;
      this.render();
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      const tile = this.canvasToTile(e);
      if (!tile || !this.dragStart) return;
      if (this.config?.mode === 'area') {
        this.dragEnd = tile;
      }
      this.updateSelectionInfo();
      this.enableConfirm();
      this.render();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverTile = null;
      this.render();
    });
  }

  private canvasToTile(e: MouseEvent): { tx: number; tz: number } | null {
    if (!this.config) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const pz = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    const tx = Math.floor(px / (CANVAS_W / this.config.worldSizeX));
    const tz = Math.floor(pz / (CANVAS_H / this.config.worldSizeZ));
    if (tx < 0 || tx >= this.config.worldSizeX || tz < 0 || tz >= this.config.worldSizeZ) return null;
    return { tx, tz };
  }

  private tileToCanvas(tx: number, tz: number): { px: number; pz: number } {
    const c = this.config!;
    const tileW = CANVAS_W / c.worldSizeX;
    const tileH = CANVAS_H / c.worldSizeZ;
    return { px: tx * tileW, pz: tz * tileH };
  }

  private render(): void {
    if (!this.config || !this.ctx) return;
    const ctx = this.ctx;
    const c = this.config;
    const tileW = CANVAS_W / c.worldSizeX;
    const tileH = CANVAS_H / c.worldSizeZ;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Background
    ctx.fillStyle = '#0c0a06';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid
    ctx.strokeStyle = 'rgba(200,160,60,0.15)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= c.worldSizeX; x++) {
      ctx.beginPath();
      ctx.moveTo(x * tileW, 0);
      ctx.lineTo(x * tileW, CANVAS_H);
      ctx.stroke();
    }
    for (let z = 0; z <= c.worldSizeZ; z++) {
      ctx.beginPath();
      ctx.moveTo(0, z * tileH);
      ctx.lineTo(CANVAS_W, z * tileH);
      ctx.stroke();
    }

    // Chunk guides (every 10 tiles)
    ctx.strokeStyle = 'rgba(200,160,60,0.35)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= c.worldSizeX; x += 10) {
      ctx.beginPath();
      ctx.moveTo(x * tileW, 0);
      ctx.lineTo(x * tileW, CANVAS_H);
      ctx.stroke();
    }
    for (let z = 0; z <= c.worldSizeZ; z += 10) {
      ctx.beginPath();
      ctx.moveTo(0, z * tileH);
      ctx.lineTo(CANVAS_W, z * tileH);
      ctx.stroke();
    }

    // Axis labels every 10 tiles
    ctx.fillStyle = 'rgba(200,160,60,0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (let x = 0; x <= c.worldSizeX; x += 10) {
      ctx.fillText(String(x), x * tileW + (x < c.worldSizeX ? tileW * 5 : -4), 10);
    }
    ctx.textAlign = 'left';
    for (let z = 0; z <= c.worldSizeZ; z += 10) {
      ctx.fillText(String(z), 3, z * tileH + (z < c.worldSizeZ ? tileH * 5 : -3));
    }

    // Hover highlight
    if (this.hoverTile && !this.dragStart) {
      const { px, pz } = this.tileToCanvas(this.hoverTile.tx, this.hoverTile.tz);
      ctx.fillStyle = 'rgba(255,200,64,0.18)';
      ctx.fillRect(px, pz, tileW, tileH);
    }

    // Selection
    const sel = this.getSelectionRect();
    if (sel) {
      const { px: sx, pz: sz } = this.tileToCanvas(sel.x1, sel.z1);
      const { px: ex, pz: ez } = this.tileToCanvas(sel.x2 + 1, sel.z2 + 1);
      const selW = ex - sx;
      const selH = ez - sz;
      const r = Math.min(8, tileW, tileH);

      // Fill
      ctx.fillStyle = 'rgba(255,180,0,0.18)';
      this.roundRect(ctx, sx, sz, selW, selH, r);
      ctx.fill();

      // Border
      ctx.strokeStyle = '#ffc840';
      ctx.lineWidth = 2;
      this.roundRect(ctx, sx, sz, selW, selH, r);
      ctx.stroke();

      // Corner dots
      ctx.fillStyle = '#ffc840';
      for (const [cx, cz] of [[sx, sz], [ex, sz], [sx, ez], [ex, ez]] as [number,number][]) {
        ctx.beginPath();
        ctx.arc(cx, cz, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (this.dragStart && this.config.mode === 'area') {
      // Dragging in progress (before mouseup)
      const { px, pz } = this.tileToCanvas(this.dragStart.tx, this.dragStart.tz);
      ctx.fillStyle = 'rgba(255,200,64,0.12)';
      ctx.fillRect(px, pz, tileW, tileH);
    }
  }

  private roundRect(ctx: CanvasRenderingContext2D | null, x: number, y: number, w: number, h: number, r: number): void {
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private getSelectionRect(): { x1: number; z1: number; x2: number; z2: number } | null {
    if (!this.dragStart) return null;
    if (this.config?.mode === 'point') {
      return { x1: this.dragStart.tx, z1: this.dragStart.tz, x2: this.dragStart.tx, z2: this.dragStart.tz };
    }
    if (!this.dragEnd) return null;
    return {
      x1: Math.min(this.dragStart.tx, this.dragEnd.tx),
      z1: Math.min(this.dragStart.tz, this.dragEnd.tz),
      x2: Math.max(this.dragStart.tx, this.dragEnd.tx),
      z2: Math.max(this.dragStart.tz, this.dragEnd.tz),
    };
  }

  private updateSelectionInfo(): void {
    const el = document.getElementById('bs-tile-select-info');
    if (!el) return;
    const sel = this.getSelectionRect();
    if (!sel) { el.textContent = 'No selection'; return; }
    if (this.config?.mode === 'point') {
      el.textContent = `Selected: (${sel.x1}, ${sel.z1})`;
    } else {
      const w = sel.x2 - sel.x1 + 1;
      const h = sel.z2 - sel.z1 + 1;
      el.textContent = `Selected: (${sel.x1}, ${sel.z1}) → (${sel.x2}, ${sel.z2})  [${w} × ${h} tiles]`;
    }
  }

  private enableConfirm(): void {
    const btn = document.getElementById('bs-tile-select-confirm') as HTMLButtonElement | null;
    if (btn) btn.disabled = false;
  }

  private confirm(): void {
    const sel = this.getSelectionRect();
    if (!sel || !this.config) return;
    const fields: Record<string, number> = {};
    for (const field of this.config.extraFields ?? []) {
      const input = document.getElementById(`bs-tsf-${field.id}`) as HTMLInputElement | null;
      fields[field.id] = input ? (parseFloat(input.value) || field.defaultValue) : field.defaultValue;
    }
    const result: TileSelectResult = {
      x: sel.x1,
      z: sel.z1,
      fields,
    };
    if (this.config.mode === 'area') {
      result.x2 = sel.x2;
      result.z2 = sel.z2;
    }
    const cb = this.config.onConfirm;
    this.close();
    cb(result);
  }

  private cancel(): void {
    const cb = this.config?.onCancel;
    this.close();
    cb?.();
  }
}
