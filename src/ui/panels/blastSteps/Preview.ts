// BlastSimulator2026 — Blast Workshop: Preview step (redesign P4)
// Analysis Suite (buy software tiers) + Predicted rows (Run Analysis against
// the current plan) — the tier-gated preview data Software.ts already computes.
//
// Deviation from the design mock: there, a "SHOW ENERGY OVERLAY IN SCENE"
// button toggles the scene overlay. Real overlay behavior doesn't work that
// way — GameRenderer.showBlastPlanOverlay already renders every tier-owned
// layer (energy heatmap, frag-size dots, projection arcs, vibration waves)
// automatically whenever a plan exists, with no manual on/off switch. The
// button is replaced with a callout stating that fact instead of wiring up
// a toggle capability nothing else in the renderer supports.
//
// Predictions come from the real blast_preview console command, not a local
// computation — Software.ts's preview functions need VoxelGrid access, which
// only the console layer's MiningContext has (no UI panel reads the grid
// directly, same constraint the Charge step's rock-tier gating ran into).
// So "Run Analysis" is an explicit action, and the rows below it read
// state.lastBlastPreview — a snapshot from the last run, not a live value.
// Mock row "Oversized (> 1.2m)" is dropped for the same never-real-data
// reason: previewFragments() has no per-fragment size distribution, only an
// aggregate average, so it becomes "Avg Fragment Size" (avgFragmentSizeCm,
// already unit-converted by the command) instead.

import { t } from '../../../core/i18n/I18n.js';
import { el, emptyState, reasonLine, button } from '../../dom.js';
import { iconEl } from '../../icons.js';
import { LocaleTextRegistry } from '../../localeText.js';
import { SOFTWARE_TIER_COSTS, MAX_SOFTWARE_TIER, type BlastPreviewSummary } from '../../../core/mining/Software.js';
import { assembleBlastPlan, validateBlastPlan } from '../../../core/mining/BlastPlan.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import type { GameState } from '../../../core/state/GameState.js';
import type { GameConsoleFn } from '../../gameConsole.js';


const TIER_NAME_KEYS = [
  'ui.blast_workshop.preview.tier_1',
  'ui.blast_workshop.preview.tier_2',
  'ui.blast_workshop.preview.tier_3',
  'ui.blast_workshop.preview.tier_4',
];

interface PredictedRow {
  labelKey: string;
  requiredTier: number;
  value: (p: BlastPreviewSummary) => string;
}

const PREDICTED_ROWS: PredictedRow[] = [
  { labelKey: 'ui.blast_workshop.preview.row_affected_voxels', requiredTier: 1, value: p => `${p.energy!.affectedVoxels}` },
  { labelKey: 'ui.blast_workshop.preview.row_energy_range', requiredTier: 1, value: p => `${p.energy!.minEnergy.toFixed(1)}–${p.energy!.maxEnergy.toFixed(1)}` },
  { labelKey: 'ui.blast_workshop.preview.row_fragments', requiredTier: 2, value: p => `${p.fragments!.fractured}` },
  { labelKey: 'ui.blast_workshop.preview.row_avg_size', requiredTier: 2, value: p => `${p.fragments!.avgFragmentSizeCm.toFixed(0)} cm` },
  { labelKey: 'ui.blast_workshop.preview.row_projection_zone', requiredTier: 3, value: p => `${p.projections!.projectionZoneVoxels} voxels` },
  { labelKey: 'ui.blast_workshop.preview.row_vibration', requiredTier: 4, value: p => `${p.vibrations!.maxVibration.toFixed(2)} mm/s` },
];

export class PreviewStep {
  private readonly el: HTMLElement;
  private readonly tierListEl: HTMLElement;
  private readonly predictedListEl: HTMLElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly reasonEl: HTMLElement;

  private gameConsole?: GameConsoleFn;
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

    const callout = el('div');
    callout.style.cssText = 'display:flex;align-items:center;gap:7px;padding:9px 11px;border-radius:5px;background:rgba(169,140,255,.08);border:1px solid rgba(169,140,255,.24)';
    const calloutIcon = el('div', { attrs: { style: 'color:var(--bsx-ore)' }, children: [iconEl('eye', 14)] });
    const calloutText = this.locale.bindText(
      el('span', { attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1' } }),
      'ui.blast_workshop.preview.callout',
    );
    callout.append(calloutIcon, calloutText);

    this.el.append(suiteHeader, this.tierListEl, predictedHeader, this.predictedListEl, this.runBtn, this.reasonEl, callout);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  update(state: GameState): void {
    const plan = assembleBlastPlan(state.drillHoles, state.chargesByHole, state.sequenceDelays);
    const errors = state.drillHoles.length > 0 ? validateBlastPlan(plan) : [];
    const canAnalyze = state.drillHoles.length > 0 && errors.length === 0;

    const signature = JSON.stringify({
      tier: state.softwareTier, cash: state.cash, preview: state.lastBlastPreview,
      holeCount: state.drillHoles.length, canAnalyze,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

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
    this.predictedListEl.replaceChildren(...PREDICTED_ROWS.map(row => this.makePredictedRow(row, preview)));
  }

  private makePredictedRow(row: PredictedRow, preview: BlastPreviewSummary): HTMLElement {
    const locked = preview.tier < row.requiredTier;
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:9px;padding:9px 11px;border-bottom:1px solid var(--bsx-hairline)';

    if (locked) wrap.appendChild(iconEl('lock', 11, 0.5));
    wrap.appendChild(el('span', { text: t(row.labelKey), attrs: { style: 'font:500 11px/1 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }));

    const valueText = locked ? t('ui.blast_workshop.preview.locked', { tier: row.requiredTier }) : row.value(preview);
    const valueColor = locked ? 'var(--bsx-text-micro)' : 'var(--bsx-text-primary)';
    wrap.appendChild(el('span', { text: valueText, attrs: { style: `margin-left:auto;font:600 12px/1 var(--bsx-font-mono);color:${valueColor}` } }));

    return wrap;
  }
}
