// BlastSimulator2026 — Blast Workshop: Drill step (redesign P4)
// Grid tool (rect placement) + Add Hole (point placement), both via the P3
// placement kit; a live spacing/burden/layout/depth/diameter strip with what the
// placement costs (metres, rig time, cash, permit area); the hole list
// with a WET/TUBED/DRY status chip per row and a per-hole delete button; and
// the Saved Plans block (gap G6, `blast_plan save|load`) below it — the plan is
// built here, so this is where it is banked and brought back.

import { t } from '../../../core/i18n/I18n.js';
import type { EntityOpener } from '../../entityLinks.js';
import { el, chip, emptyState, scrollBoundedSection, type ChipTone } from '../../dom.js';
import { iconEl } from '../../icons.js';
import { LocaleTextRegistry } from '../../localeText.js';
import { SavedPlansList, savedPlansSignature } from './SavedPlansList.js';
import type { WeatherState } from '../../../core/weather/WeatherCycle.js';
import type { GameState } from '../../../core/state/GameState.js';
import {
  gridCellPositions, fleetDrillReachM, fleetDrillDiameterM, holeNumericId, drillHoleCost, estimateDrillWorkTicks,
} from '../../../core/mining/DrillPlan.js';
import type { DrillHole, GridLayout, PlannedHole } from '../../../core/mining/DrillPlan.js';
import type { VehicleTier } from '../../../core/entities/Vehicle.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { formatGameDuration } from '../../formatGameDuration.js';
import { hasTubing } from '../../../core/mining/Tubing.js';
import { buriedHolesOf } from '../../../core/mining/BuriedHoles.js';
import { wetHoleIdsFor } from '../../../core/mining/WetHoles.js';
import { hoverRefusal, type PlacementKit } from '../../scene/PlacementKit.js';
import { coveredByFootprint, partitionByFootprint } from '../../../core/mining/BlastPlan.js';
import { buildingFootprintOccupants } from '../../../core/nav/NavGridSync.js';
import type { GameConsoleFn } from '../../gameConsole.js';
import type { ConfirmModalConfig } from '../ConfirmModal.js';
import { planReplacementLoss } from '../../../core/mining/ChargeOrder.js';
import { gridAreaLimitWarning, permitPreview } from '../permitPreview.js';
import { defaultGridDepthM } from '../../../core/economy/PermitDefaults.js';
import { holeStatusExplain, drillFieldExplain } from '../../blastWorkshopExplain.js';
import { buildReplacePatternConfirm } from '../../replacePatternConfirm.js';
import {
  DRILL_HOLE_DEFAULT_DIAMETER_M, DRILL_GRID_DEFAULT_SPACING_M, MAX_DRILL_GRID_HOLES, DRILL_GRID_DEFAULT_DEPTH_M,
  DRILL_HOLE_MIN_DEPTH_M, DRILL_HOLE_DIAMETER_OPTIONS_M, DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M,
} from '../../../core/config/balance.js';


const DEFAULT_SPACING_M = DRILL_GRID_DEFAULT_SPACING_M;
const DEFAULT_DEPTH_M = DRILL_GRID_DEFAULT_DEPTH_M;
const DEFAULT_DIAMETER_M = DRILL_HOLE_DEFAULT_DIAMETER_M;

export class DrillStep {
  private readonly el: HTMLElement;
  private readonly patternValueEl: HTMLElement;
  private readonly meshValueEl: HTMLElement;
  private readonly depthValueEl: HTMLElement;
  private readonly holesNoteEl: HTMLElement;
  /** "used / limit m²" of pattern area against the permit, always visible (#2167). */
  private readonly permitAreaEl: HTMLElement;
  private readonly holeListEl: HTMLElement;
  private readonly clearRowEl: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly savedPlans: SavedPlansList;
  private readonly commandNoticeEl: HTMLElement;
  private lastState: GameState | null = null;

  private gameConsole?: GameConsoleFn;
  private placementKit: PlacementKit | null = null;
  private onConfirmRequestCb?: (config: ConfirmModalConfig) => void;

  private gridSpacing = DEFAULT_SPACING_M;
  /** Distance between the grid's rows; follows the spacing (a square mesh) until the player steps it. */
  private gridBurden = DEFAULT_SPACING_M;
  private playerAdjustedBurden = false;
  private gridLayout: GridLayout = 'square';
  private gridDepth = DEFAULT_DEPTH_M;
  /** False until the player steps the depth: until then it follows the permit grade (#2101). */
  private playerAdjustedDepth = false;
  private gridDiameter = DEFAULT_DIAMETER_M;
  private lastGridPattern: { rows: number; cols: number; layout: GridLayout } | null = null;

  private confirmingClear = false;
  private lastSignature = '';
  private opener: EntityOpener | undefined;
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
    const stripCell = (labelKey: string, borderRight: boolean, explainKey?: string): { wrap: HTMLElement; value: HTMLElement } => {
      const wrap = el('div');
      wrap.style.cssText = `flex:1;padding:9px 10px;display:flex;flex-direction:column;gap:4px${borderRight ? ';border-right:1px solid var(--bsx-hairline)' : ''}`;
      const label = this.locale.bindText(el('span', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-text-micro)' } }), labelKey);
      const value = el('span', { className: 'bsx-mono', attrs: { style: 'font:600 12px/1 var(--bsx-font-mono);color:var(--bsx-text-primary)' } });
      if (explainKey) this.locale.bindExplain(label, explainKey);
      wrap.append(label, value);
      return { wrap, value };
    };
    const pattern = stripCell('ui.blast_workshop.drill.pattern', true, 'ui.explain.drill_field_pattern');
    const mesh = stripCell('ui.blast_workshop.drill.mesh', true, 'ui.explain.drill_field_mesh');
    const depth = stripCell('ui.blast_workshop.drill.depth', false, 'ui.explain.drill_field_depth');
    this.patternValueEl = pattern.value;
    this.meshValueEl = mesh.value;
    this.meshValueEl.dataset['role'] = 'drill-mesh';
    this.depthValueEl = depth.value;
    const statStrip = el('div', { children: [pattern.wrap, mesh.wrap, depth.wrap] });
    statStrip.style.cssText = 'display:flex;border:1px solid var(--bsx-hairline);border-radius:5px;background:var(--bsx-well);overflow:hidden';

    this.holesNoteEl = el('span', { className: 'bsx-section-note' });
    const holesHeader = el('div', { className: 'bsx-section' });
    const holesLabelEl = this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.drill.holes_section');
    this.permitAreaEl = el('span', { className: 'bsx-section-note' });
    this.permitAreaEl.dataset['role'] = 'permit-area';
    holesHeader.append(holesLabelEl, el('span', { className: 'bsx-section-rule' }), this.permitAreaEl, this.holesNoteEl);

    // Bounded + independently scrollable, same reasoning as Charge's product
    // list: a full tutorial-sized plan (16 holes) would otherwise push saved
    // plans past the panel's fold.
    this.holeListEl = scrollBoundedSection([], 200, { gap: 3 });

    this.savedPlans = new SavedPlansList(
      name => this.gameConsole?.(`blast_plan save name:${name}`),
      name => this.gameConsole?.(`blast_plan load name:${name}`),
    );

    this.commandNoticeEl = el('div');
    this.commandNoticeEl.style.cssText = 'display:none;font:500 11px/1.3 var(--bsx-font-ui);color:var(--bsx-text-muted);white-space:pre-line';
    this.commandNoticeEl.setAttribute('role', 'status');
    this.commandNoticeEl.dataset['role'] = 'drill-notice';

    this.el.append(gridBtn, toolRow, this.commandNoticeEl, this.clearRowEl, statStrip, holesHeader, this.holeListEl, this.savedPlans.root);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  /** Wire the generic entity opener so rows and names become links (#2168). */
  setEntityOpener(opener: EntityOpener | undefined): void {
    this.opener = opener;
    this.lastSignature = ''; // rebuild the rows so they pick up (or drop) the click-through
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setPlacementKit(kit: PlacementKit): void { this.placementKit = kit; }

  update(state: GameState, _weather?: WeatherState): void {
    this.lastState = state;
    if (!this.playerAdjustedDepth) this.gridDepth = Math.min(defaultGridDepthM(state.grade?.grade), this.reachM());
    const holes = state.drillHoles;
    const ordered = state.plannedDrillHoles;
    const totalCount = holes.length + ordered.length;
    this.lastHoleCount = totalCount;
    const wet = wetHoleIdsFor(state);
    const buried = buriedHolesOf(state);

    const signature = JSON.stringify({
      holes: holes.map(h => [h.id, h.x, h.z, h.depth, h.diameter, h.spacingM, h.burdenM]),
      ordered: ordered.map(h => [h.id, h.x, h.z, h.depth, h.diameter, h.spacingM, h.burdenM]),
      tubed: [...state.tubingState.installedHoles].sort(),
      wet: [...wet].sort(),
      buried: [...buried].sort(),
      pattern: this.lastGridPattern,
      spacing: this.gridSpacing, burden: this.gridBurden, layout: this.gridLayout, depth: this.gridDepth, diameter: this.gridDiameter,
      confirmingClear: this.confirmingClear,
      savedPlans: savedPlansSignature(state.savedPlans),
      permitGrade: state.grade?.grade ?? null,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    const last = this.lastGridPattern;
    this.patternValueEl.textContent = last
      ? `${last.cols} × ${last.rows}${last.layout === 'staggered' ? ` · ${t('ui.blast_workshop.drill.layout_staggered')}` : ''}`
      : '—';
    this.meshValueEl.textContent = `${this.gridSpacing} × ${this.gridBurden} m`;
    this.depthValueEl.textContent = `${this.gridDepth.toFixed(1)} m`;

    this.holesNoteEl.textContent = buried.size > 0
      ? t('ui.blast_workshop.drill.planned_buried', { count: totalCount, buried: buried.size })
      : t('ui.blast_workshop.drill.planned', { count: totalCount });
    this.clearBtn.disabled = totalCount === 0;
    this.renderPermitArea(state);

    this.renderClearRow(totalCount);
    this.savedPlans.render(state.savedPlans);

    if (totalCount === 0) {
      this.holeListEl.replaceChildren(emptyState(t('ui.blast_workshop.drill.no_holes')));
      return;
    }
    this.holeListEl.replaceChildren(
      ...ordered.map(h => this.makeOrderedHoleRow(h, buried.has(h.id))),
      ...holes.map(h => this.makeHoleRow(h, state, wet)),
    );
  }

  private renderPermitArea(state: GameState): void {
    const preview = permitPreview(state.grade, { holes: this.planHoles(state), charges: {} }, state.tickCount);
    this.permitAreaEl.textContent = preview ? preview.areaText : '';
    this.permitAreaEl.dataset['over'] = String(preview?.areaOver ?? false);
  }

  /** Every hole of the plan, drilled or still ordered. */
  private planHoles(state: GameState): (DrillHole | PlannedHole)[] {
    return [...state.drillHoles, ...state.plannedDrillHoles];
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.savedPlans.refreshLocale();
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
    const status = this.holeStatus(hole, state, wet);
    return this.buildHoleRow(hole, chip(status.label, status.tone, holeStatusExplain(status.kind)), '');
  }

  /**
   * Row for a hole still in `state.plannedDrillHoles` — ordered but not yet
   * drilled (#553). No wet/tubed/dry status applies to a hole that hasn't
   * been drilled, so it always shows the ORDERED chip; no charge
   * affordance either, since neither exists yet for it — only the remove
   * button (which cancels its queued `drill_hole` action).
   */
  private makeOrderedHoleRow(hole: PlannedHole, isBuried: boolean): HTMLElement {
    const status = isBuried
      ? chip(t('ui.blast_workshop.drill.status_buried'), 'warn', holeStatusExplain('buried'))
      : chip(t('ui.blast_workshop.drill.status_ordered'), 'neutral', holeStatusExplain('ordered'));
    return this.buildHoleRow(hole, status, ';opacity:.7');
  }

  private buildHoleRow(hole: Pick<DrillHole, 'id' | 'x' | 'z' | 'depth'>, statusChip: HTMLElement, extraStyle: string): HTMLElement {
    const row = el('div');
    row.style.cssText = `display:flex;align-items:center;gap:9px;height:32px;padding:0 10px;border:1px solid var(--bsx-hairline);border-radius:4px;background:var(--bsx-card)${extraStyle}`;

    const tag = el('span', { text: hole.id, attrs: { style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-ore);width:24px' } });
    const at = el('span', { text: `(${hole.x}, ${hole.z})`, attrs: { style: 'font:400 11px/1 var(--bsx-font-mono);color:var(--bsx-text-muted)' } });
    const depth = el('span', { text: `${hole.depth.toFixed(1)} m`, attrs: { style: 'font:400 11px/1 var(--bsx-font-mono);color:var(--bsx-text-muted)' } });
    statusChip.style.marginLeft = 'auto';

    const deleteBtn = el('button');
    deleteBtn.style.cssText = 'width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--bsx-text-micro);cursor:pointer;padding:0';
    deleteBtn.dataset['action'] = 'remove-hole';
    deleteBtn.appendChild(iconEl('x', 10));
    deleteBtn.addEventListener('click', ev => {
      ev.stopPropagation(); // removing a hole must not also open its inspector
      this.gameConsole?.(`drill_plan remove hole:${hole.id}`);
    });
    const opener = this.opener;
    if (opener) {
      row.style.cursor = 'pointer';
      row.dataset['selectKind'] = 'hole';
      row.dataset['selectId'] = String(holeNumericId(hole.id));
      row.addEventListener('click', () => opener.open('hole', holeNumericId(hole.id)));
    }

    row.append(tag, at, depth, statusChip, deleteBtn);
    return row;
  }

  private holeStatus(hole: DrillHole, state: GameState, wet: Set<string>): { label: string; tone: ChipTone; kind: 'wet' | 'tubed' | 'dry' } {
    // Water already inside wins over tubing: tubing keeps new water out but does not drain (#1350).
    if (wet.has(hole.id)) return { label: t('ui.blast_workshop.drill.status_wet'), tone: 'info', kind: 'wet' };
    if (hasTubing(state.tubingState, hole.id)) return { label: t('ui.blast_workshop.drill.status_tubed'), tone: 'positive', kind: 'tubed' };
    return { label: t('ui.blast_workshop.drill.status_dry'), tone: 'neutral', kind: 'dry' };
  }

  /** UIManager wires this to its shared ConfirmModal's show(). */
  setConfirmHandler(cb: (config: ConfirmModalConfig) => void): void { this.onConfirmRequestCb = cb; }

  /** Run a console command and show its output, so a refusal is never silent. */
  private runAndNotify(cmd: string): void {
    const res = this.gameConsole?.(cmd);
    this.commandNoticeEl.textContent = res?.output ?? '';
    this.commandNoticeEl.style.display = res?.output ? 'block' : 'none';
    this.commandNoticeEl.style.color = res && !res.success ? 'var(--bsx-danger, #ff5b4c)' : 'var(--bsx-text-muted)';
  }

  /** Columns × rows the selection lays out at the current spacing (along x) and burden (along z). */
  private gridShape(sel: { x1: number; z1: number; x2: number; z2: number }): { rows: number; cols: number } {
    return {
      cols: Math.max(1, Math.round((sel.x2 - sel.x1) / this.gridSpacing) + 1),
      rows: Math.max(1, Math.round((sel.z2 - sel.z1) / this.gridBurden) + 1),
    };
  }

  /**
   * Cells the selection's grid would drill, those under a building footprint dropped (and counted);
   * null past MAX_DRILL_GRID_HOLES, which the command refuses whole.
   */
  private gridCells(sel: { x1: number; z1: number }, rows: number, cols: number): { clear: { x: number; z: number }[]; skipped: number } | null {
    if (rows * cols > MAX_DRILL_GRID_HOLES) return null;
    const cells = gridCellPositions({ x: sel.x1, z: sel.z1 }, rows, cols, this.gridSpacing, this.gridBurden, this.gridLayout);
    return this.lastState ? partitionByFootprint(cells, buildingFootprintOccupants(this.lastState)) : { clear: cells, skipped: 0 };
  }

  /** Highest drill-rig tier the fleet owns; tier 1 with none. */
  private bestRigTier(): VehicleTier {
    let best: VehicleTier = 1;
    for (const v of this.lastState?.vehicles.vehicles ?? []) if (v.type === 'drill_rig' && v.tier > best) best = v.tier;
    return best;
  }

  /**
   * What drilling `holeCount` holes at the current depth and bore costs — metres, rig work and cash —
   * and, when the mine holds a permit, the pattern area of the plan once they land against it.
   */
  private drillReadout(holeCount: number, holesAfter: readonly (DrillHole | PlannedHole)[]): string[] {
    if (holeCount <= 0) return [];
    const holes = Array.from({ length: holeCount }, () => ({ depth: this.gridDepth, diameter: this.gridDiameter }));
    const lines = [t('ui.blast_workshop.drill.drill_readout', {
      holes: holeCount,
      metres: Math.round(holeCount * this.gridDepth * 10) / 10,
      time: formatGameDuration(estimateDrillWorkTicks(holes, this.bestRigTier())),
      cost: formatMoney(holeCount * drillHoleCost(this.gridDepth, this.gridDiameter)),
    })];
    const preview = permitPreview(this.lastState?.grade, { holes: holesAfter, charges: {} }, this.lastState?.tickCount ?? 0);
    // Over the permit, the placement's warning (result notes) already names the area and the limit.
    if (preview && !preview.areaOver) lines.push(t('ui.blast_workshop.drill.permit_area', { area: preview.areaText }));
    return lines;
  }

  private coveredCount(cells: { id: string; x: number; z: number }[]): number {
    return this.lastState ? coveredByFootprint(cells, buildingFootprintOccupants(this.lastState)).size : 0;
  }

  /** Deepest hole the owned fleet can drill; tier-1 reach before any state arrives. */
  private reachM(): number {
    return fleetDrillReachM(this.lastState?.vehicles.vehicles ?? []);
  }

  /** Pull the depth setting back inside the fleet's reach (a rig may have been lost). */
  private clampDepthToReach(): void {
    this.gridDepth = Math.min(this.gridDepth, this.reachM());
  }

  /** Pull the diameter setting back to the widest option the fleet can bore (a rig may have been lost). */
  private clampDiameterToFleet(): void {
    this.gridDiameter = Math.min(this.gridDiameter, this.maxDiameterM());
  }

  private maxDiameterM(): number {
    return fleetDrillDiameterM(this.lastState?.vehicles.vehicles ?? []);
  }

  /** Diameter options the fleet can bore, narrowest first. */
  private diameterOptions(): number[] {
    const max = this.maxDiameterM() + DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M;
    return DRILL_HOLE_DIAMETER_OPTIONS_M.filter(o => o <= max);
  }

  /** Diameter stepper (mm): hops between allowed options, skipping those above the fleet's rigs. */
  private diameterField(refresh: () => void) {
    const options = this.diameterOptions();
    const idx = Math.max(0, options.findIndex(o => Math.abs(o - this.gridDiameter) <= DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M));
    const go = (to: number) => () => {
      const next = options[Math.max(0, Math.min(options.length - 1, to))];
      if (next !== undefined) this.gridDiameter = next;
      this.lastSignature = '';
      refresh();
    };
    return {
      key: 'diameter', label: t('ui.blast_workshop.drill.diameter'), explain: drillFieldExplain('diameter'),
      value: Math.round(this.gridDiameter * 1000), format: (v: number) => `${v} mm`,
      onDec: go(idx - 1), onInc: go(idx + 1),
    };
  }

  /** Strip field stepping a clamped grid setting; re-renders the strip on change. */
  private stepField(
    key: 'spacing' | 'burden' | 'depth', label: string, prop: 'gridSpacing' | 'gridBurden' | 'gridDepth',
    min: number, max: number, refresh: () => void,
  ) {
    const step = (delta: number, bound: (a: number, b: number) => number, limit: number) => () => {
      if (prop === 'gridDepth') this.playerAdjustedDepth = true;
      if (prop === 'gridBurden') this.playerAdjustedBurden = true;
      this[prop] = bound(limit, this[prop] + delta);
      // Until the player sets a burden of their own, rows sit as far apart as the holes in them.
      if (prop === 'gridSpacing' && !this.playerAdjustedBurden) this.gridBurden = this.gridSpacing;
      this.lastSignature = ''; refresh();
    };
    return {
      key, label, explain: drillFieldExplain(key), value: this[prop], format: (v: number) => `${v} m`,
      onDec: step(-1, Math.max, min), onInc: step(1, Math.min, max),
    };
  }

  /** Confirm handler tail shared by both tools: notify, reset signature, flash. */
  private afterConfirm(overlay: PlacementKit['overlay'], cmd: string, onRan?: () => void): void {
    this.runAndNotify(cmd);
    onRan?.();
    this.lastSignature = '';
    overlay.flashConfirm();
  }

  /**
   * Shared arm/cancel/refresh wiring of both placement tools: `render` draws the
   * overlay + strip for a live selection (the idle case is handled here),
   * `onConfirm` runs the player's confirmed selection.
   */
  private armTool(
    shape: 'rect' | 'point',
    render: (kit: PlacementKit, refresh: () => void) => void,
    onConfirm: (sel: { x1: number; z1: number; x2: number; z2: number }, overlay: PlacementKit['overlay']) => void,
  ): void {
    const kit = this.placementKit;
    if (!kit) return;
    const { controller, overlay, strip } = kit;
    if (controller.isArmed) { controller.cancel(); return; }
    const refresh = (): void => {
      if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
      render(kit, refresh);
    };
    controller.setConfirmHandler(sel => onConfirm(sel, overlay));
    controller.setChangeHandler(refresh);
    controller.arm({ shape });
    refresh();
  }

  /** Toggle on the grid strip between holes in line and every other row shifted half a spacing. */
  private layoutAction(refresh: () => void) {
    return {
      key: 'grid-layout',
      label: t('ui.blast_workshop.drill.layout_button', {
        layout: t(this.gridLayout === 'staggered' ? 'ui.blast_workshop.drill.layout_staggered' : 'ui.blast_workshop.drill.layout_square'),
      }),
      onClick: () => {
        this.gridLayout = this.gridLayout === 'staggered' ? 'square' : 'staggered';
        this.lastSignature = '';
        refresh();
      },
    };
  }

  /** The console command laying out the grid: burden and layout only when they differ from a square, aligned mesh. */
  private gridCommand(sel: { x1: number; z1: number }, rows: number, cols: number): string {
    const burden = this.gridBurden !== this.gridSpacing ? ` burden:${this.gridBurden}` : '';
    const layout = this.gridLayout === 'staggered' ? ' pattern:staggered' : '';
    return `drill_plan grid rows:${rows} cols:${cols} spacing:${this.gridSpacing}${burden}${layout} depth:${this.gridDepth} diameter:${this.gridDiameter} start:${sel.x1},${sel.z1}`;
  }

  private armGridTool(): void {
    this.armTool('rect', (kit, refresh) => {
      const { controller, overlay, strip } = kit;
      this.clampDepthToReach();
      this.clampDiameterToFleet();
      const sel = controller.selection;
      const region = controller.activeRegion;
      const { rows, cols } = sel ? this.gridShape(sel) : { rows: 0, cols: 0 };
      const cells = sel ? this.gridCells(sel, rows, cols) : null;
      overlay.update(sel ? {
        shape: 'rect', x1: sel.x1, z1: sel.z1, x2: sel.x2, z2: sel.z2,
        region: region ? { x1: region.x1, z1: region.z1, x2: region.x2, z2: region.z2 } : null,
        holeCells: cells?.clear ?? [],
      } : null);

      const coveredCount = cells?.skipped ?? 0;
      const allCovered = sel !== null && rows * cols > 0 && coveredCount >= rows * cols;
      // The grid replaces the plan: the permit measures its holes alone.
      const holesAfter = (cells?.clear ?? []).map((c, i) => ({ id: `G${i}`, x: c.x, z: c.z, depth: this.gridDepth, diameter: this.gridDiameter, spacingM: this.gridSpacing, burdenM: this.gridBurden }));
      const permitWarning = sel ? gridAreaLimitWarning(this.lastState?.grade, holesAfter, this.lastState?.tickCount) : null;
      const refusal = hoverRefusal(controller, allCovered ? t('mining.drill_plan.grid_all_blocked') : null);
      strip.show({
        icon: 'grid',
        title: t('ui.blast_workshop.drill.grid_tool'),
        subtitle: sel ? `${cols} × ${rows}` : '',
        fields: [
          this.stepField('spacing', t('ui.blast_workshop.drill.spacing'), 'gridSpacing', 1, 20, refresh),
          this.stepField('burden', t('ui.blast_workshop.drill.burden'), 'gridBurden', 1, 20, refresh),
          this.stepField('depth', t('ui.blast_workshop.drill.depth'), 'gridDepth', DRILL_HOLE_MIN_DEPTH_M, this.reachM(), refresh),
          this.diameterField(refresh),
        ],
        actions: [this.layoutAction(refresh)],
        result: sel
          ? `${cols} × ${rows} ${t('ui.blast_workshop.drill.holes_section')}${coveredCount > 0 ? ` — ${t('ui.blast_workshop.drill.grid_skipped_preview', { count: coveredCount })}` : ''}${permitWarning ? ` — ${permitWarning}` : ''}`
          : '—',
        readout: this.drillReadout(holesAfter.length, holesAfter),
        confirmEnabled: controller.canConfirm && !allCovered,
        confirmDisabledReason: refusal.reason,
        instruction: `${t('ui.blast_workshop.drill.grid_tool_hint')}\n${t('ui.blast_workshop.drill.depth_reach', { reach: this.reachM() })}`,
      });
    }, (sel, overlay) => {
      const { rows, cols } = this.gridShape(sel);
      const cmd = this.gridCommand(sel, rows, cols);
      const layout = this.gridLayout;
      const run = (command: string): void => this.afterConfirm(overlay, command, () => { this.lastGridPattern = { rows, cols, layout }; });
      // Replacing a drilled/charged pattern asks first (#1345).
      const st = this.lastState;
      const loss = st && this.onConfirmRequestCb ? planReplacementLoss(st) : null;
      if (loss) {
        this.onConfirmRequestCb?.(buildReplacePatternConfirm(loss, () => run(`${cmd} confirm:true`)));
        return;
      }
      run(cmd);
    });
  }

  private armAddHoleTool(): void {
    this.armTool('point', (kit, refresh) => {
      const { controller, overlay, strip } = kit;
      this.clampDepthToReach();
      this.clampDiameterToFleet();
      const sel = controller.selection;
      const covered = sel ? this.coveredCount([{ id: 'add', x: sel.x1, z: sel.z1 }]) > 0 : false;
      const footprintReason = covered && sel ? t('mining.drill_plan.refused_footprint', { x: Math.floor(sel.x1), z: Math.floor(sel.z1) }) : null;
      const refusal = hoverRefusal(controller, footprintReason);
      // An added hole joins the plan: the permit measures the whole plan with it.
      const holesAfter = sel && !covered && this.lastState
        ? [...this.planHoles(this.lastState), { id: 'add', x: sel.x1, z: sel.z1, depth: this.gridDepth, diameter: this.gridDiameter }]
        : [];
      const permitWarning = holesAfter.length > 0 ? gridAreaLimitWarning(this.lastState?.grade, holesAfter, this.lastState?.tickCount) : null;
      overlay.update(sel ? { shape: 'point', x: sel.x1, z: sel.z1, refused: refusal.refused } : null);

      strip.show({
        icon: 'hole',
        title: t('ui.blast_workshop.drill.add_hole'),
        subtitle: sel ? `(${sel.x1}, ${sel.z1})` : '',
        fields: [
          this.stepField('depth', t('ui.blast_workshop.drill.depth'), 'gridDepth', DRILL_HOLE_MIN_DEPTH_M, this.reachM(), refresh),
          this.diameterField(refresh),
        ],
        result: sel ? `1${permitWarning ? ` — ${permitWarning}` : ''}` : '—',
        readout: sel && !covered ? this.drillReadout(1, holesAfter) : [],
        confirmEnabled: controller.canConfirm && !covered,
        confirmDisabledReason: refusal.reason,
        instruction: `${t('ui.blast_workshop.drill.add_hole_hint')}\n${t('ui.blast_workshop.drill.depth_reach', { reach: this.reachM() })}`,
      });
    }, (sel, overlay) => {
      this.afterConfirm(overlay, `drill_plan add x:${sel.x1} z:${sel.z1} depth:${this.gridDepth} diameter:${this.gridDiameter}`);
    });
  }
}
