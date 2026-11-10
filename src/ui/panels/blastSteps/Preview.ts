// BlastSimulator2026 — Blast Workshop: Preview step (redesign P4)
// Analysis Suite (buy software tiers) + Predicted rows (Run Analysis against
// the current plan) — the tier-gated preview data Software.ts already computes.
//
// Deviation from the design mock: the tier-owned scene layers (frag-size dots,
// projection arcs, vibration waves) have no manual on/off switch —
// GameRenderer.showBlastPlanOverlay renders them whenever a plan exists — so
// a callout states that fact. The energy heatmap is different: it has its own
// toggle at the top of the workshop (EnergyHeatmapView, #2200), at every tier.
//
// Predictions come from the real blast_preview console command, not a local
// computation — Software.ts's preview functions need VoxelGrid access, which
// only the console layer's MiningContext has (no UI panel reads the grid
// directly, same constraint the Charge step's rock-tier gating ran into).
// So "Run Analysis" is an explicit action, and the rows below it read
// state.lastBlastPreview — a snapshot from the last run, not a live value.
// Tier line-up (#2201): T1 fragment distribution, T2 projection risk plus the
// dry-run figures, T3 village vibration, T4 the charge optimizer (#2204).
// Energy is free through the heatmap, so no row carries it; at tier 0 the list
// is a pointer to the heatmap. Every row explains itself (`explainable`).

import { t } from '../../../core/i18n/I18n.js';
import { el, emptyState, reasonLine, button, explainable } from '../../dom.js';
import { SOFTWARE_TIER_FRAGMENTS, SOFTWARE_TIER_PROJECTIONS, SOFTWARE_TIER_VIBRATIONS } from '../../../core/config/balance.js';
import { iconEl } from '../../icons.js';
import { LocaleTextRegistry } from '../../localeText.js';
import { SOFTWARE_TIER_COSTS, MAX_SOFTWARE_TIER, type BlastPreviewSummary } from '../../../core/mining/Software.js';
import { assembleBlastPlan, validateBlastPlan } from '../../../core/mining/BlastPlan.js';
import { chargeKgPerMetre } from '../../../core/mining/HoleDiameter.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import type { GameState } from '../../../core/state/GameState.js';
import type { VoxelGrid } from '../../../core/world/VoxelGrid.js';
import { WallWarningMemo } from '../wallWarningMemo.js';
import { wallWarningText } from '../wallWarningText.js';
import type { GameConsoleFn } from '../../gameConsole.js';


const TIER_NAME_KEYS = [
  'ui.blast_workshop.preview.tier_1',
  'ui.blast_workshop.preview.tier_2',
  'ui.blast_workshop.preview.tier_3',
  'ui.blast_workshop.preview.tier_4',
];

interface PredictedRow {
  labelKey: string;
  explainKey: string;
  requiredTier: number;
  value: (p: BlastPreviewSummary) => string;
}

const P = 'ui.blast_workshop.preview.';

/** Every row is tier-gated: energy is free through the heatmap and has no row (#2201). */
const PREDICTED_ROWS: PredictedRow[] = [
  { labelKey: `${P}row_fragments`, explainKey: `${P}explain_fragments`, requiredTier: SOFTWARE_TIER_FRAGMENTS, value: p => `${p.fragments!.fractured}` },
  { labelKey: `${P}row_avg_size`, explainKey: `${P}explain_avg_size`, requiredTier: SOFTWARE_TIER_FRAGMENTS, value: p => `${p.fragments!.avgFragmentSizeCm.toFixed(0)} cm` },
  { labelKey: `${P}row_oversized`, explainKey: `${P}explain_oversized`, requiredTier: SOFTWARE_TIER_FRAGMENTS, value: p => `${p.fragments!.oversizedFragments} / ${p.fragments!.fragmentCount}` },
  { labelKey: `${P}row_good_volume`, explainKey: `${P}explain_good_volume`, requiredTier: SOFTWARE_TIER_FRAGMENTS, value: p => `${p.fragments!.goodVolumeM3.toFixed(1)} m³` },
  { labelKey: `${P}row_fines_volume`, explainKey: `${P}explain_fines_volume`, requiredTier: SOFTWARE_TIER_FRAGMENTS, value: p => `${p.fragments!.finesVolumeM3.toFixed(1)} m³` },
  { labelKey: `${P}row_dust_volume`, explainKey: `${P}explain_dust_volume`, requiredTier: SOFTWARE_TIER_FRAGMENTS, value: p => `${p.fragments!.dustVolumeM3.toFixed(1)} m³` },
  { labelKey: `${P}row_dust_loss`, explainKey: `${P}explain_dust_loss`, requiredTier: SOFTWARE_TIER_FRAGMENTS, value: p => `$${formatMoney(p.fragments!.dustLossValue)}` },
  { labelKey: `${P}row_predicted_rating`, explainKey: `${P}explain_predicted_rating`, requiredTier: SOFTWARE_TIER_PROJECTIONS, value: p => t(`blast.rating.${p.projections!.predictedRating}`) },
  { labelKey: `${P}row_thrown_share`, explainKey: `${P}explain_thrown_share`, requiredTier: SOFTWARE_TIER_PROJECTIONS, value: p => `${Math.round(p.projections!.thrownShare * 100)}%` },
  { labelKey: `${P}row_furthest_throw`, explainKey: `${P}explain_furthest_throw`, requiredTier: SOFTWARE_TIER_PROJECTIONS, value: p => `${Math.round(p.projections!.furthestThrowM)} m` },
  { labelKey: `${P}row_vibration`, explainKey: `${P}explain_vibration`, requiredTier: SOFTWARE_TIER_VIBRATIONS, value: p => `${p.vibrations!.maxVibration.toFixed(2)} mm/s` },
];

export class PreviewStep {
  private readonly el: HTMLElement;
  private readonly tierListEl: HTMLElement;
  private readonly predictedListEl: HTMLElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly reasonEl: HTMLElement;
  private readonly boreEl: HTMLElement;
  private readonly wallWarningsEl: HTMLElement;

  private gameConsole?: GameConsoleFn;
  private gridProvider: () => VoxelGrid | null = () => null;
  private readonly wallMemo = new WallWarningMemo();
  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div');
    this.el.style.cssText = 'display:flex;flex-direction:column;gap:11px';

    const suiteHeader = el('div', { className: 'bsx-section' });
    suiteHeader.append(
      this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.preview.section'),
      el('span', { className: 'bsx-section-rule' }),
    );
    this.tierListEl = el('div');
    this.tierListEl.style.cssText = 'display:flex;flex-direction:column;gap:4px';

    const predictedHeader = el('div', { className: 'bsx-section' });
    predictedHeader.style.cssText = 'padding-top:3px';
    predictedHeader.append(
      this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.preview.predicted_section'),
      el('span', { className: 'bsx-section-rule' }),
    );
    this.predictedListEl = el('div');
    this.predictedListEl.style.cssText = 'border:1px solid var(--bsx-hairline);border-radius:5px;background:var(--bsx-well);overflow:hidden';

    this.runBtn = el('button', { className: 'bsx-btn' });
    this.runBtn.style.cssText = 'height:34px;gap:8px';
    this.runBtn.dataset['action'] = 'run-analysis';
    this.runBtn.append(iconEl('eye', 13), this.locale.bindText(el('span'), 'ui.blast_workshop.preview.run_analysis'));
    this.runBtn.addEventListener('click', () => this.gameConsole?.('blast_preview'));

    this.reasonEl = el('div');
    this.boreEl = el('div', { attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' } });
    this.boreEl.dataset['info'] = 'plan-bore';

    // Predicted over-height faces (#1943): a warning, never a gate; empty off progression sites.
    this.wallWarningsEl = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:6px' } });

    const callout = el('div');
    callout.style.cssText = 'display:flex;align-items:center;gap:7px;padding:9px 11px;border-radius:5px;background:rgba(169,140,255,.08);border:1px solid rgba(169,140,255,.24)';
    const calloutIcon = el('div', { attrs: { style: 'color:var(--bsx-ore)' }, children: [iconEl('eye', 14)] });
    const calloutText = this.locale.bindText(
      el('span', { attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1' } }),
      'ui.blast_workshop.preview.callout',
    );
    callout.append(calloutIcon, calloutText);

    this.el.append(suiteHeader, this.tierListEl, predictedHeader, this.predictedListEl, this.boreEl, this.wallWarningsEl, this.runBtn, this.reasonEl, callout);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  /** Supplies the voxel grid the wall-slump prediction reads (#1943). */
  setGridProvider(fn: () => VoxelGrid | null): void { this.gridProvider = fn; }

  /** Distinct hole diameters of the plan with their charge capacity, so the preview names what it simulates (#1934). */
  private boreText(state: GameState): string {
    const diameters = [...new Set(state.drillHoles.map(h => h.diameter))].sort((a, b) => a - b);
    return diameters.map(d => t('ui.blast_workshop.preview.bore', {
      diameter: Math.round(d * 1000), kgPerMetre: +chargeKgPerMetre(d).toFixed(2),
    })).join(' · ');
  }

  update(state: GameState): void {
    const plan = assembleBlastPlan(state.drillHoles, state.chargesByHole);
    const errors = state.drillHoles.length > 0 ? validateBlastPlan(plan) : [];
    const canAnalyze = state.drillHoles.length > 0 && errors.length === 0;

    const boreText = this.boreText(state);
    const wallFaces = this.wallMemo.get(state, plan, this.gridProvider());
    const signature = JSON.stringify({
      tier: state.softwareTier, cash: state.cash, preview: state.lastBlastPreview,
      holeCount: state.drillHoles.length, canAnalyze, bore: boreText,
      walls: wallFaces.map(w => wallWarningText(w)),
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.boreEl.textContent = boreText;
    this.wallWarningsEl.replaceChildren(...wallFaces.map(w => {
      const line = reasonLine(wallWarningText(w));
      line.dataset['role'] = 'preview-wall-warning';
      return line;
    }));
    this.renderTierList(state.softwareTier, state.cash);
    this.renderPredicted(state.lastBlastPreview, state.drillHoles.length);

    this.runBtn.disabled = !canAnalyze;
    this.reasonEl.replaceChildren();
    if (!canAnalyze) {
      const reasonKey = state.drillHoles.length === 0 ? 'ui.blast_workshop.preview.no_plan' : 'ui.blast_workshop.preview.invalid_plan';
      this.reasonEl.appendChild(reasonLine(t(reasonKey)));
    }
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
  }

  dispose(): void { this.el.remove(); }

  private renderTierList(ownedTier: number, cash: number): void {
    const rows: HTMLElement[] = [];
    for (let n = 1; n <= MAX_SOFTWARE_TIER; n++) {
      rows.push(this.makeTierRow(n, ownedTier, cash));
    }
    this.tierListEl.replaceChildren(...rows);
  }

  private makeTierRow(n: number, ownedTier: number, cash: number): HTMLElement {
    const owned = n <= ownedTier;
    const buyable = n === ownedTier + 1;
    const cost = SOFTWARE_TIER_COSTS[n] ?? 0;

    const row = el('div');
    row.dataset['tier'] = String(n);
    row.style.cssText = [
      'display:flex', 'align-items:center', 'gap:9px', 'padding:9px 11px',
      `border:1px solid ${owned ? 'rgba(79,199,107,.35)' : 'var(--bsx-hairline)'}`,
      'border-radius:5px', `background:${owned ? 'rgba(79,199,107,.1)' : 'var(--bsx-card)'}`,
    ].join(';');

    const fg = owned ? 'var(--bsx-positive)' : 'var(--bsx-text-muted)';
    const numEl = el('span', { text: `T${n}`, attrs: { style: `font:700 10px/1 var(--bsx-font-mono);color:${fg};width:20px` } });
    const nameEl = el('span', { text: t(TIER_NAME_KEYS[n - 1]!), attrs: { style: `font:500 11px/1 var(--bsx-font-ui);color:${fg}` } });
    row.append(numEl, nameEl);

    if (owned) {
      const check = el('div', { attrs: { style: 'margin-left:auto;color:var(--bsx-positive)' }, children: [iconEl('check', 13)] });
      row.appendChild(check);
    } else if (buyable) {
      const buyBtn = button('warn', t('ui.blast_workshop.preview.buy', { cost: `$${formatMoney(cost)}` }), {
        dataAction: 'buy-tier',
        disabled: cash < cost,
        onClick: () => this.gameConsole?.('buy_software'),
      });
      buyBtn.style.cssText = 'margin-left:auto;height:26px;padding:0 10px';
      row.appendChild(buyBtn);
    }

    return row;
  }

  private renderPredicted(preview: BlastPreviewSummary | null, holeCount: number): void {
    if (!preview) {
      this.predictedListEl.replaceChildren(emptyState(
        t(holeCount === 0 ? 'ui.blast_workshop.preview.no_plan' : 'ui.blast_workshop.preview.not_run_yet'),
      ));
      return;
    }
    const rows = PREDICTED_ROWS.map(row => this.makePredictedRow(row, preview));
    if (preview.tier < SOFTWARE_TIER_FRAGMENTS) {
      // No software: every stat row is locked; a line points to the free heatmap.
      const pointer = emptyState(t(`${P}heatmap_pointer`));
      pointer.dataset['role'] = 'heatmap-pointer';
      this.predictedListEl.replaceChildren(pointer, ...rows);
      return;
    }
    this.predictedListEl.replaceChildren(...rows);
  }

  private makePredictedRow(row: PredictedRow, preview: BlastPreviewSummary): HTMLElement {
    const locked = preview.tier < row.requiredTier;
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:9px;padding:9px 11px;border-bottom:1px solid var(--bsx-hairline)';

    if (locked) wrap.appendChild(iconEl('lock', 11, 0.5));
    wrap.appendChild(el('span', { text: t(row.labelKey), attrs: { style: 'font:500 11px/1 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }));

    const valueText = locked
      ? t(`${P}locked`, { tier: row.requiredTier, shows: t(`${P}shows_${row.requiredTier}`) })
      : row.value(preview);
    const valueStyle = locked
      ? 'margin-left:auto;text-align:right;font:500 10px/1.3 var(--bsx-font-ui);color:var(--bsx-text-micro)'
      : 'margin-left:auto;font:600 12px/1 var(--bsx-font-mono);color:var(--bsx-text-primary)';
    wrap.appendChild(el('span', { text: valueText, attrs: { style: valueStyle } }));

    return explainable(wrap, t(row.explainKey));
  }
}
