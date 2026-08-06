// BlastSimulator2026 — Blast Workshop: Drill step (redesign P4)
// Grid tool (rect placement) + Add Hole (point placement), both via the P3
// placement kit; a live pattern/spacing/depth/diameter strip; the hole list
// with a WET/TUBED/DRY status chip per row and a per-hole delete button.

import { t } from '../../../core/i18n/I18n.js';
import { el, chip, emptyState, type ChipTone } from '../../dom.js';
import { iconEl } from '../../icons.js';
import { LocaleTextRegistry } from '../../localeText.js';
import type { GameState } from '../../../core/state/GameState.js';
import type { WeatherState } from '../../../core/weather/WeatherCycle.js';
import type { DrillHole } from '../../../core/mining/DrillPlan.js';
import { hasTubing } from '../../../core/mining/Tubing.js';
import { wetHoles } from '../../../core/mining/WetHoles.js';
import { placementRefusalReason, type PlacementKit } from '../../scene/PlacementKit.js';
import type { CommandResult } from '../../../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

const DEFAULT_SPACING_M = 3;
const DEFAULT_DEPTH_M = 6;
const DEFAULT_DIAMETER_M = 0.089; // 89mm, matches the design's sample pattern

export class DrillStep {
  private readonly el: HTMLElement;
  private readonly patternValueEl: HTMLElement;
  private readonly spacingValueEl: HTMLElement;
  private readonly depthValueEl: HTMLElement;
  private readonly diameterValueEl: HTMLElement;
  private readonly holesNoteEl: HTMLElement;
  private readonly holeListEl: HTMLElement;
  private readonly clearRowEl: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;

  private gameConsole?: GameConsoleFn;
  private placementKit: PlacementKit | null = null;

  private gridSpacing = DEFAULT_SPACING_M;
  private gridDepth = DEFAULT_DEPTH_M;
  private gridDiameter = DEFAULT_DIAMETER_M;
  private lastGridPattern: { rows: number; cols: number } | null = null;

  private confirmingClear = false;
  private lastSignature = '';
  private lastHoleCount = 0;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div');
    this.el.style.cssText = 'display:flex;flex-direction:column;gap:10px';

    const gridBtn = el('button', { className: 'bsx-btn bsx-btn-warn' });
    gridBtn.style.cssText = 'height:40px;justify-content:flex-start;gap:10px;padding:0 13px';
    gridBtn.dataset['action'] = 'grid-tool';
    gridBtn.append(
      iconEl('grid', 16),
      this.locale.bindText(el('span', { attrs: { style: 'font:700 11px/1 var(--bsx-font-ui);letter-spacing:.1em' } }), 'ui.blast_workshop.drill.grid_tool'),
      this.locale.bindText(
        el('span', { attrs: { style: 'margin-left:auto;font:500 10px/1 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }),
        'ui.blast_workshop.drill.grid_tool_hint',
      ),
    );
    gridBtn.addEventListener('click', () => this.armGridTool());

    const addHoleBtn = el('button', { className: 'bsx-btn' });
    addHoleBtn.style.cssText = 'flex:1';
    addHoleBtn.dataset['action'] = 'add-hole-tool';
    addHoleBtn.append(iconEl('plus', 12), this.locale.bindText(el('span'), 'ui.blast_workshop.drill.add_hole'));
    addHoleBtn.addEventListener('click', () => this.armAddHoleTool());

    this.clearBtn = el('button', { className: 'bsx-btn bsx-btn-danger' });
    this.clearBtn.style.cssText = 'flex:1';
    this.clearBtn.dataset['action'] = 'clear-holes';
    this.clearBtn.append(iconEl('trash', 12), this.locale.bindText(el('span'), 'ui.blast_workshop.drill.clear_plan'));
    this.clearBtn.addEventListener('click', () => this.onClearClick());

    const toolRow = el('div', { children: [addHoleBtn, this.clearBtn] });
    toolRow.style.cssText = 'display:flex;gap:7px';

    this.clearRowEl = el('div');
    this.clearRowEl.style.cssText = 'display:none;flex-direction:column;gap:6px;padding:8px 10px;border:1px solid rgba(255,91,76,.32);border-radius:4px;background:rgba(255,91,76,.08)';

    // Stat strip
    const stripCell = (labelKey: string, borderRight: boolean): { wrap: HTMLElement; value: HTMLElement } => {
      const wrap = el('div');
      wrap.style.cssText = `flex:1;padding:9px 10px;display:flex;flex-direction:column;gap:4px${borderRight ? ';border-right:1px solid var(--bsx-hairline)' : ''}`;
      const label = this.locale.bindText(el('span', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-text-micro)' } }), labelKey);
      const value = el('span', { className: 'bsx-mono', attrs: { style: 'font:600 12px/1 var(--bsx-font-mono);color:var(--bsx-text-primary)' } });
      wrap.append(label, value);
      return { wrap, value };
    };
    const pattern = stripCell('ui.blast_workshop.drill.pattern', true);
    const spacing = stripCell('ui.blast_workshop.drill.spacing', true);
    const depth = stripCell('ui.blast_workshop.drill.depth', true);
    const diameter = stripCell('ui.blast_workshop.drill.diameter', false);
    this.patternValueEl = pattern.value;
    this.spacingValueEl = spacing.value;
    this.depthValueEl = depth.value;
    this.diameterValueEl = diameter.value;
    const statStrip = el('div', { children: [pattern.wrap, spacing.wrap, depth.wrap, diameter.wrap] });
    statStrip.style.cssText = 'display:flex;border:1px solid var(--bsx-hairline);border-radius:5px;background:var(--bsx-well);overflow:hidden';

    this.holesNoteEl = el('span', { className: 'bsx-section-note' });
    const holesHeader = el('div', { className: 'bsx-section' });
    const holesLabelEl = this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.drill.holes_section');
    holesHeader.append(holesLabelEl, el('span', { className: 'bsx-section-rule' }), this.holesNoteEl);

    this.holeListEl = el('div');
    this.holeListEl.style.cssText = 'display:flex;flex-direction:column;gap:3px';

    this.el.append(gridBtn, toolRow, this.clearRowEl, statStrip, holesHeader, this.holeListEl);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setPlacementKit(kit: PlacementKit): void { this.placementKit = kit; }

  update(state: GameState, weather: WeatherState | undefined): void {
    const holes = state.drillHoles;
    this.lastHoleCount = holes.length;
    const wet = new Set(weather ? wetHoles(state, weather) : []);

    const signature = JSON.stringify({
      holes: holes.map(h => [h.id, h.x, h.z, h.depth, h.diameter]),
      tubed: [...state.tubingState.installedHoles].sort(),
      wet: [...wet].sort(),
      pattern: this.lastGridPattern,
      spacing: this.gridSpacing, depth: this.gridDepth, diameter: this.gridDiameter,
      confirmingClear: this.confirmingClear,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.patternValueEl.textContent = this.lastGridPattern ? `${this.lastGridPattern.cols} × ${this.lastGridPattern.rows}` : '—';
    this.spacingValueEl.textContent = `${this.gridSpacing.toFixed(1)} m`;
    this.depthValueEl.textContent = `${this.gridDepth.toFixed(1)} m`;
    this.diameterValueEl.textContent = `${Math.round(this.gridDiameter * 1000)} mm`;

    this.holesNoteEl.textContent = t('ui.blast_workshop.drill.planned', { count: holes.length });
    this.clearBtn.disabled = holes.length === 0;

    this.renderClearRow(holes.length);

    if (holes.length === 0) {
      this.holeListEl.replaceChildren(emptyState(t('ui.blast_workshop.drill.no_holes')));
      return;
    }
    this.holeListEl.replaceChildren(...holes.map(h => this.makeHoleRow(h, state, wet)));
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = ''; // forces the next update() to re-t() the hole-status chips and empty state
  }

  dispose(): void { this.el.remove(); }

  private renderClearRow(holeCount: number): void {
    if (!this.confirmingClear) {
      this.clearRowEl.style.display = 'none';
      this.clearRowEl.replaceChildren(); // drop the stale prompt+buttons, not just hide them — display:none alone would leave their text in .textContent and their listeners live
      return;
    }
    this.clearRowEl.style.display = 'flex';
    const msg = el('span', {
      text: t('ui.blast_workshop.drill.clear_confirm', { count: holeCount }),
      attrs: { style: 'font:500 11px/1.4 var(--bsx-font-ui);color:var(--bsx-critical-text)' },
    });
    const yesBtn = el('button', { className: 'bsx-btn bsx-btn-danger-solid', text: t('ui.blast_workshop.drill.clear_confirm_yes') });
    yesBtn.style.cssText = 'height:28px';
    yesBtn.addEventListener('click', () => this.doClear());
    const noBtn = el('button', { className: 'bsx-btn', text: t('ui.blast_workshop.drill.clear_confirm_no') });
    noBtn.style.cssText = 'height:28px';
    noBtn.addEventListener('click', () => { this.confirmingClear = false; this.lastSignature = ''; this.renderClearRow(holeCount); });
    const actions = el('div', { children: [yesBtn, noBtn] });
    actions.style.cssText = 'display:flex;gap:7px';
    this.clearRowEl.replaceChildren(msg, actions);
  }

  private onClearClick(): void {
    if (this.clearBtn.disabled) return;
    this.confirmingClear = true;
    this.lastSignature = '';
    this.renderClearRow(this.lastHoleCount); // render now — don't wait for the caller's next update() tick
  }

  private doClear(): void {
    this.confirmingClear = false;
    this.lastSignature = '';
    this.renderClearRow(this.lastHoleCount);
    this.gameConsole?.('drill_plan clear');
  }

  private makeHoleRow(hole: DrillHole, state: GameState, wet: Set<string>): HTMLElement {
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;gap:9px;height:32px;padding:0 10px;border:1px solid var(--bsx-hairline);border-radius:4px;background:var(--bsx-card)';

    const tag = el('span', { text: hole.id, attrs: { style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-ore);width:24px' } });
    const at = el('span', { text: `(${hole.x}, ${hole.z})`, attrs: { style: 'font:400 11px/1 var(--bsx-font-mono);color:var(--bsx-text-muted)' } });
    const depth = el('span', { text: `${hole.depth.toFixed(1)} m`, attrs: { style: 'font:400 11px/1 var(--bsx-font-mono);color:var(--bsx-text-muted)' } });

    const status = this.holeStatus(hole, state, wet);
    const statusChip = chip(status.label, status.tone);
    statusChip.style.marginLeft = 'auto';

    const deleteBtn = el('button');
    deleteBtn.style.cssText = 'width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--bsx-text-micro);cursor:pointer;padding:0';
    deleteBtn.dataset['action'] = 'remove-hole';
    deleteBtn.appendChild(iconEl('x', 10));
    deleteBtn.addEventListener('click', () => this.gameConsole?.(`drill_plan remove hole:${hole.id}`));

    row.append(tag, at, depth, statusChip, deleteBtn);
    return row;
  }

  private holeStatus(hole: DrillHole, state: GameState, wet: Set<string>): { label: string; tone: ChipTone } {
    if (hasTubing(state.tubingState, hole.id)) return { label: t('ui.blast_workshop.drill.status_tubed'), tone: 'positive' };
    if (wet.has(hole.id)) return { label: t('ui.blast_workshop.drill.status_wet'), tone: 'info' };
    return { label: t('ui.blast_workshop.drill.status_dry'), tone: 'neutral' };
  }

  private armGridTool(): void {
    const kit = this.placementKit;
    if (!kit) return;
    const { controller, overlay, strip } = kit;
    if (controller.isArmed) { controller.cancel(); return; }

    const refresh = (): void => {
      if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
      const sel = controller.selection;
      const region = controller.activeRegion;
      overlay.update(sel ? {
        shape: 'rect', x1: sel.x1, z1: sel.z1, x2: sel.x2, z2: sel.z2,
        region: region ? { x1: region.x1, z1: region.z1, x2: region.x2, z2: region.z2 } : null,
        holeSpacing: this.gridSpacing,
      } : null);

      const cols = sel ? Math.max(1, Math.round((sel.x2 - sel.x1) / this.gridSpacing) + 1) : 0;
      const rows = sel ? Math.max(1, Math.round((sel.z2 - sel.z1) / this.gridSpacing) + 1) : 0;
      strip.show({
        icon: 'grid',
        title: t('ui.blast_workshop.drill.grid_tool'),
        subtitle: sel ? `${cols} × ${rows}` : '',
        fields: [
          { key: 'spacing', label: t('ui.blast_workshop.drill.spacing'), value: this.gridSpacing, format: v => `${v} m`, onDec: () => { this.gridSpacing = Math.max(1, this.gridSpacing - 1); this.lastSignature = ''; refresh(); }, onInc: () => { this.gridSpacing = Math.min(20, this.gridSpacing + 1); this.lastSignature = ''; refresh(); } },
          { key: 'depth', label: t('ui.blast_workshop.drill.depth'), value: this.gridDepth, format: v => `${v} m`, onDec: () => { this.gridDepth = Math.max(1, this.gridDepth - 1); this.lastSignature = ''; refresh(); }, onInc: () => { this.gridDepth = Math.min(40, this.gridDepth + 1); this.lastSignature = ''; refresh(); } },
        ],
        result: sel ? `${cols} × ${rows} ${t('ui.blast_workshop.drill.holes_section')}` : '—',
        confirmEnabled: controller.canConfirm,
        confirmDisabledReason: placementRefusalReason(controller),
        instruction: t('ui.blast_workshop.drill.grid_tool_hint'),
      });
    };

    controller.setConfirmHandler((sel) => {
      const cols = Math.max(1, Math.round((sel.x2 - sel.x1) / this.gridSpacing) + 1);
      const rows = Math.max(1, Math.round((sel.z2 - sel.z1) / this.gridSpacing) + 1);
      this.gameConsole?.(`drill_plan grid rows:${rows} cols:${cols} spacing:${this.gridSpacing} depth:${this.gridDepth} diameter:${this.gridDiameter} start:${sel.x1},${sel.z1}`);
      this.lastGridPattern = { rows, cols };
      this.lastSignature = '';
      overlay.flashConfirm();
    });
    controller.setChangeHandler(refresh);
    controller.arm({ shape: 'rect' });
    refresh();
  }

  private armAddHoleTool(): void {
    const kit = this.placementKit;
    if (!kit) return;
    const { controller, overlay, strip } = kit;
    if (controller.isArmed) { controller.cancel(); return; }

    const refresh = (): void => {
      if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
      const sel = controller.selection;
      overlay.update(sel ? { shape: 'point', x: sel.x1, z: sel.z1 } : null);

      strip.show({
        icon: 'hole',
        title: t('ui.blast_workshop.drill.add_hole'),
        subtitle: sel ? `(${sel.x1}, ${sel.z1})` : '',
        fields: [
          { key: 'depth', label: t('ui.blast_workshop.drill.depth'), value: this.gridDepth, format: v => `${v} m`, onDec: () => { this.gridDepth = Math.max(1, this.gridDepth - 1); this.lastSignature = ''; refresh(); }, onInc: () => { this.gridDepth = Math.min(40, this.gridDepth + 1); this.lastSignature = ''; refresh(); } },
        ],
        result: sel ? '1' : '—',
        confirmEnabled: controller.canConfirm,
        confirmDisabledReason: placementRefusalReason(controller),
        instruction: t('ui.blast_workshop.drill.add_hole_hint'),
      });
    };

    controller.setConfirmHandler((sel) => {
      this.gameConsole?.(`drill_plan add x:${sel.x1} z:${sel.z1} depth:${this.gridDepth} diameter:${this.gridDiameter}`);
      this.lastSignature = '';
      overlay.flashConfirm();
    });
    controller.setChangeHandler(refresh);
    controller.arm({ shape: 'point' });
    refresh();
  }
}
