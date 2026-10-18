// BlastSimulator2026 — Blast Workshop sticky footer (redesign P4)
// Shared chrome under every step: PLAN COST / EST. ORE VALUE / MARGIN, then
// the FIRE button. FIRE no longer dispatches `blast` itself or builds its own
// confirm dialog — it just asks BlastWorkshop (and, above that, UIManager) to
// open PreflightModal, which owns the real confirm gate and the `blast`
// dispatch behind DETONATE.

import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import type { GameState } from '../../core/state/GameState.js';
import { assembleBlastPlan, validateBlastPlan } from '../../core/mining/BlastPlan.js';
import { oreEstimateView, oreValueColor, oreValueText } from './oreEstimateDisplay.js';
import { OreEstimateMemo } from './oreEstimateMemo.js';
import { chargeDeliveryArrivalByHole } from '../../core/mining/ExplosiveStock.js';
import { formatGameClock } from '../formatGameClock.js';
import { permitPreview, type PermitPreview } from './permitPreview.js';
import { recordedChargesCost } from '../../core/mining/ChargePlan.js';

export class BlastFooter {
  private readonly el: HTMLElement;
  private readonly costEl: HTMLElement;
  private readonly valueEl: HTMLElement;
  private readonly marginEl: HTMLElement;
  private readonly fireBtn: HTMLButtonElement;
  private readonly reasonEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly permitEl: HTMLElement;
  private onFireRequested?: () => void;
  private gridProvider: () => VoxelGrid | null = () => null;
  private readonly estimateMemo = new OreEstimateMemo();
  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div', { className: 'bsx-root' });
    this.el.style.cssText = [
      'flex:0 0 auto', 'padding:10px 12px', 'background:var(--bsx-well)',
      'border-top:1px solid var(--bsx-hairline-strong)', 'display:flex',
      'flex-direction:column', 'gap:9px', 'pointer-events:all',
    ].join(';');

    const row = el('div');
    row.style.cssText = 'display:flex;gap:14px';

    const makeStat = (labelKey: string, valueColor: string): { wrap: HTMLElement; value: HTMLElement } => {
      const wrap = el('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px';
      const label = this.locale.bindText(
        el('span', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-text-micro)' } }),
        labelKey,
      );
      const value = el('span', {
        className: 'bsx-mono',
        attrs: { style: `font:600 14px/1 var(--bsx-font-mono);color:${valueColor}` },
      });
      wrap.append(label, value);
      return { wrap, value };
    };

    const cost = makeStat('ui.blast_workshop.footer.plan_cost', 'var(--bsx-critical-text)');
    const value = makeStat('ui.blast_workshop.footer.est_ore_value', 'var(--bsx-positive)');
    const margin = makeStat('ui.blast_workshop.footer.margin', 'var(--bsx-positive)');
    margin.wrap.style.marginLeft = 'auto';
    margin.wrap.style.alignItems = 'flex-end';

    this.costEl = cost.value;
    this.costEl.dataset['info'] = 'plan-cost';
    this.valueEl = value.value;
    this.marginEl = margin.value;
    row.append(cost.wrap, value.wrap, margin.wrap);

    this.fireBtn = el('button', { className: 'bsx-btn bsx-btn-danger-solid', attrs: { id: 'bs-blast-fire' } });
    this.fireBtn.style.cssText = 'height:42px;font:800 13px/1 var(--bsx-font-ui);letter-spacing:.2em;gap:9px';
    this.fireBtn.dataset['action'] = 'execute';
    this.fireBtn.append(iconEl('blast', 17), this.locale.bindText(el('span'), 'ui.blast_workshop.footer.fire'));
    this.fireBtn.addEventListener('click', () => { if (!this.fireBtn.disabled) this.onFireRequested?.(); });

    this.reasonEl = el('div');
    this.reasonEl.style.cssText = 'display:none;gap:6px;align-items:flex-start';

    this.hintEl = el('div', { attrs: { style: 'display:none;font:500 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro)' } });

    this.permitEl = el('div', { attrs: { 'data-role': 'permit-usage', style: 'display:none;flex-direction:column;gap:4px' } });

    this.el.append(row, this.hintEl, this.permitEl, this.fireBtn, this.reasonEl);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  /** Supplies the voxel grid the pre-blast estimate reads geometry from (#1703). */
  setGridProvider(fn: () => VoxelGrid | null): void { this.gridProvider = fn; }

  setFireRequestedHandler(cb: () => void): void { this.onFireRequested = cb; }

  update(state: GameState): void {
    const plan = assembleBlastPlan(state.drillHoles, state.chargesByHole);
    const errors = validateBlastPlan(
      plan, new Set(Object.keys(state.plannedChargesByHole)), chargeDeliveryArrivalByHole(state),
    );
    const hasHoles = plan.holes.length > 0;
    const fireOk = hasHoles && errors.length === 0;

    const planCost = recordedChargesCost(state.chargesByHole).cashCost;
    const estimate = this.estimateMemo.get(state, plan, this.gridProvider());
    const estValue = estimate.value;
    const coverage = estimate.coverage;
    const margin = estValue - planCost;

    // Undrilled (ordered, not yet landed) holes are a PreflightModal warning
    // only, never a FIRE gate: the blast cancels their drill orders (#1346). An
    // occupied zone is no gate either: DETONATE clears it (#1362).

    const reason = !hasHoles
      ? t('ui.blast_workshop.footer.fire_reason_no_holes')
      : errors[0]
        ? errors[0].arrivalTick !== undefined
          ? t('ui.blast_workshop.footer.fire_reason_awaiting_delivery', {
            hole: errors[0].holeId, when: formatGameClock(errors[0].arrivalTick),
          })
          : t('ui.blast_workshop.footer.fire_reason_invalid', { hole: errors[0].holeId, issue: t(errors[0].issue) })
        : null;

    const permit = permitPreview(state.grade, plan, state.tickCount);
    const signature = JSON.stringify({ planCost, estValue, coverage, margin, fireOk, reason, permit });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.costEl.textContent = `$${formatMoney(planCost)}`;
    const view = oreEstimateView(coverage);
    this.valueEl.textContent = oreValueText(view, estValue);
    this.valueEl.style.color = oreValueColor(view);
    if (view.kind === 'unknown') {
      this.marginEl.textContent = t('ui.blast_workshop.footer.margin_unknown');
      this.marginEl.style.color = 'var(--bsx-text-micro)';
      this.hintEl.textContent = t('ui.blast_workshop.footer.survey_hint', { survey: t('ui.survey.title') });
      this.hintEl.style.display = hasHoles ? '' : 'none';
    } else {
      this.marginEl.textContent = `${margin < 0 ? '-' : ''}$${formatMoney(Math.abs(margin))}`;
      this.marginEl.style.color = 'var(--bsx-positive)';
      this.hintEl.style.display = 'none';
    }

    this.renderPermit(permit);

    this.fireBtn.disabled = !fireOk;
    this.fireBtn.style.cursor = fireOk ? 'pointer' : 'not-allowed';

    if (reason) {
      this.reasonEl.style.display = 'flex';
      this.reasonEl.replaceChildren(
        el('div', { attrs: { style: 'color:var(--bsx-amber);padding-top:1px' }, children: [iconEl('warn', 11)] }),
        el('span', { text: reason, attrs: { style: 'font:500 10px/1.4 var(--bsx-font-ui);color:var(--bsx-amber)' } }),
      );
    } else {
      this.reasonEl.style.display = 'none';
    }
  }

  /** Usage row of the permit; absent on sites without a grade. FIRE is never gated by it. */
  private renderPermit(permit: PermitPreview | null): void {
    this.permitEl.style.display = permit ? 'flex' : 'none';
    if (!permit) { this.permitEl.replaceChildren(); delete this.permitEl.dataset['over']; return; }
    if (permit.over) this.permitEl.dataset['over'] = 'true'; else delete this.permitEl.dataset['over'];
    const value = (role: string, text: string, over: boolean): HTMLElement => el('span', {
      text,
      attrs: { 'data-role': role, style: `font:600 11px/1 var(--bsx-font-mono);color:${over ? 'var(--bsx-amber)' : 'var(--bsx-text-secondary)'}` },
    });
    const usage = el('div', { attrs: { style: 'display:flex;gap:14px' } });
    usage.append(value('permit-kg', permit.kgText, permit.kgOver), value('permit-holes', permit.holesText, permit.holesOver));
    this.permitEl.replaceChildren(usage);
    if (permit.over) {
      this.permitEl.append(el('span', {
        text: permit.warningText,
        attrs: { 'data-role': 'permit-warning', style: 'font:500 10px/1.4 var(--bsx-font-ui);color:var(--bsx-amber)' },
      }));
    }
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = ''; // forces the next update() to re-t() the fire-blocked reason line
  }

  dispose(): void { this.el.remove(); }
}
