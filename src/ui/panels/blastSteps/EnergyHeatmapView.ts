// BlastSimulator2026 — Blast Workshop: energy heatmap (#2200)
// A toggle that paints the armed plan's fragmentation bands over the terrain (renderer) and, here,
// a legend plus a vertical section through the selected hole's row. Available at every software
// tier: the data is the blast's own energy field, classified by the shared band classifier.

import { t } from '../../../core/i18n/I18n.js';
import { el, paintToggleButton } from '../../dom.js';
import { LocaleTextRegistry } from '../../localeText.js';
import type { GameState } from '../../../core/state/GameState.js';
import type { VoxelGrid } from '../../../core/world/VoxelGrid.js';
import { assembleBlastPlan } from '../../../core/mining/BlastPlan.js';
import { wetHoleIdsFor } from '../../../core/mining/WetHoles.js';
import { planHeatmap, sectionAtZ } from '../../../core/mining/EnergyHeatmap.js';
import { FRAGMENTATION_BANDS, FRAGMENTATION_BAND_COLORS, type FragmentationBand } from '../../../core/mining/FragmentationBand.js';
import type { PlanBandCell } from '../../../core/mining/SoftwarePreview.js';

const cssColor = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
const bandName = (band: FragmentationBand): string => t(`blast.band.${band}`);

/** Text naming a cell's band and exact intensity, shared by the cell tooltip and the readout. */
export function heatmapCellText(band: FragmentationBand, intensity: number): string {
  return t('ui.blast_workshop.heatmap.cell', { band: bandName(band), intensity: intensity.toFixed(2) });
}

export class EnergyHeatmapView {
  readonly root: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly detail: HTMLElement;
  private readonly holeSelect: HTMLSelectElement;
  private readonly sectionEl: HTMLElement;
  private readonly readoutEl: HTMLElement;
  private readonly locale = new LocaleTextRegistry();
  private gridProvider: () => VoxelGrid | null = () => null;
  private onToggle: ((visible: boolean) => void) | null = null;
  private visible = false;
  private holeIdsKey = '';
  private renderedKey = '';
  private lastBands: unknown = null;
  private lastState: GameState | null = null;

  constructor(container: HTMLElement) {
    this.root = el('div', { attrs: { 'data-role': 'heatmap' } });
    this.root.style.cssText = 'flex:0 0 auto;padding:8px 12px 0;display:flex;flex-direction:column;gap:8px';

    this.toggleBtn = el('button', { attrs: { 'data-action': 'toggle-energy-heatmap', type: 'button' } });
    this.toggleBtn.style.cssText = 'align-self:flex-start;padding:5px 10px;border-radius:5px;border:1px solid transparent;cursor:pointer;font:700 10px/1 var(--bsx-font-ui);letter-spacing:.08em';
    this.locale.bindText(this.toggleBtn, 'ui.blast_workshop.heatmap.toggle');
    this.toggleBtn.addEventListener('click', () => {
      this.setVisible(!this.visible);
      this.onToggle?.(this.visible);
    });
    paintToggleButton(this.toggleBtn, false, 'var(--bsx-hairline-strong)');

    this.detail = el('div');
    this.detail.style.cssText = 'display:none;flex-direction:column;gap:8px';

    const legend = el('div', { attrs: { 'data-role': 'heatmap-legend' } });
    legend.style.cssText = 'display:flex;flex-direction:column;gap:3px';
    legend.appendChild(this.locale.bindText(
      el('div', { attrs: { style: 'font:700 10px/1 var(--bsx-font-ui);letter-spacing:.08em;color:var(--bsx-text-muted)' } }),
      'ui.blast_workshop.heatmap.legend_title',
    ));
    for (const band of FRAGMENTATION_BANDS) {
      const row = el('div', { attrs: { 'data-band': band } });
      row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px';
      const swatch = el('span');
      swatch.style.cssText = `flex:0 0 12px;height:12px;border-radius:2px;background:${cssColor(FRAGMENTATION_BAND_COLORS[band])}`;
      const name = this.locale.bindText(el('b'), `blast.band.${band}`);
      const effect = this.locale.bindText(el('span', { attrs: { style: 'color:var(--bsx-text-secondary)' } }), `blast.band.${band}.effect`);
      row.append(swatch, name, effect);
      legend.appendChild(row);
    }

    const selectRow = el('label');
    selectRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px';
    selectRow.appendChild(this.locale.bindText(el('span'), 'ui.blast_workshop.heatmap.section_hole'));
    this.holeSelect = el('select', { attrs: { 'data-role': 'heatmap-section-hole' } });
    this.holeSelect.addEventListener('change', () => this.render(true));
    selectRow.appendChild(this.holeSelect);

    this.sectionEl = el('div', { attrs: { 'data-role': 'heatmap-section' } });
    this.sectionEl.style.cssText = 'display:flex;gap:1px;overflow-x:auto;align-items:flex-start;min-height:12px';

    this.readoutEl = el('div', { attrs: { 'data-role': 'heatmap-readout' } });
    this.readoutEl.style.cssText = 'font:500 11px/1.3 var(--bsx-font-mono);color:var(--bsx-text-secondary);min-height:14px';
    this.readoutEl.textContent = t('ui.blast_workshop.heatmap.readout_hint');

    this.detail.append(legend, selectRow, this.sectionEl, this.readoutEl);
    this.root.append(this.toggleBtn, this.detail);
    container.appendChild(this.root);
  }

  setGridProvider(fn: () => VoxelGrid | null): void { this.gridProvider = fn; }

  setToggleHandler(cb: (visible: boolean) => void): void { this.onToggle = cb; }

  get isVisible(): boolean { return this.visible; }

  /** Reflect the heatmap preference without firing the toggle handler. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    paintToggleButton(this.toggleBtn, visible, 'var(--bsx-hairline-strong)');
    this.detail.style.display = visible ? 'flex' : 'none';
    this.renderedKey = '';
    this.lastBands = null;
  }

  update(state: GameState): void {
    if (!this.visible) return;
    this.syncHoleOptions(state);
    this.render(false, state);
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.readoutEl.textContent = t('ui.blast_workshop.heatmap.readout_hint');
    this.renderedKey = '';
  }

  dispose(): void {
    this.root.remove();
  }

  private syncHoleOptions(state: GameState): void {
    const key = state.drillHoles.map(h => h.id).join('|');
    if (key === this.holeIdsKey) return;
    this.holeIdsKey = key;
    const prev = this.holeSelect.value;
    this.holeSelect.replaceChildren(...state.drillHoles.map(h => {
      const opt = el('option', { text: `${h.id} (${h.x}, ${h.z})` });
      opt.value = h.id;
      return opt;
    }));
    // Keep the selection while the hole lives; otherwise fall back to the first hole.
    this.holeSelect.value = state.drillHoles.some(h => h.id === prev) ? prev : (state.drillHoles[0]?.id ?? '');
  }

  private render(force: boolean, state: GameState | null = this.lastState): void {
    if (!state) return;
    this.lastState = state;
    const grid = this.gridProvider();
    if (!grid) { this.sectionEl.replaceChildren(); return; }
    const plan = assembleBlastPlan(state.drillHoles, state.chargesByHole);
    const heat = planHeatmap(plan, grid, wetHoleIdsFor(state));
    const selected = state.drillHoles.find(h => h.id === this.holeSelect.value) ?? state.drillHoles[0];
    const key = `${selected?.id ?? ''}`;
    if (!force && heat.bands === this.lastBands && key === this.renderedKey) return;
    this.lastBands = heat.bands;
    this.renderedKey = key;

    if (!selected || heat.bands.cells.size === 0) {
      this.sectionEl.replaceChildren(el('span', {
        text: t('ui.blast_workshop.heatmap.section_empty'),
        attrs: { style: 'font-size:11px;color:var(--bsx-text-muted)' },
      }));
      return;
    }
    const { minX, maxX, minY, maxY } = heat.bands.bbox;
    const cellsByXY = new Map<string, PlanBandCell>();
    for (const c of sectionAtZ(heat.bands, selected.z)) cellsByXY.set(`${c.x},${c.y}`, c);
    const rowHoles = new Map<number, string>();
    for (const h of state.drillHoles) if (h.z === selected.z) rowHoles.set(h.x, h.id);

    const columns: HTMLElement[] = [];
    for (let x = minX; x <= maxX; x++) {
      const col = el('div', { attrs: { 'data-x': String(x) } });
      col.style.cssText = 'display:flex;flex-direction:column;gap:1px';
      const holeId = rowHoles.get(x);
      if (holeId) { col.dataset['hole'] = holeId; col.style.outline = '1px solid var(--bsx-amber)'; }
      for (let y = maxY; y >= minY; y--) {
        const cell = cellsByXY.get(`${x},${y}`);
        const box = el('div');
        box.style.cssText = 'width:8px;height:8px';
        if (cell) {
          const text = heatmapCellText(cell.band, cell.intensity);
          box.dataset['band'] = cell.band;
          box.dataset['intensity'] = cell.intensity.toFixed(2);
          box.title = text;
          box.style.background = cssColor(FRAGMENTATION_BAND_COLORS[cell.band]);
          if (holeId) box.dataset['hole'] = holeId;
          box.addEventListener('mouseenter', () => { this.readoutEl.textContent = text; });
        }
        col.appendChild(box);
      }
      columns.push(col);
    }
    this.sectionEl.replaceChildren(...columns);
  }
}
