// BlastSimulator2026 — Blast Workshop sticky footer (redesign P4)
// Shared chrome under every step: PLAN COST / EST. ORE VALUE / MARGIN, then
// the FIRE button. Fire dispatches `blast` behind a lightweight confirm —
// the richer PreflightModal (danger-zone occupants, tier-aware predictions)
// replaces this confirm in a later phase; this is the minimum that keeps the
// tutorial's blast-confirm step satisfiable in the meantime.

import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import type { GameState } from '../../core/state/GameState.js';
import type { CommandResult } from '../../console/ConsoleRunner.js';
import { assembleBlastPlan, validateBlastPlan } from '../../core/mining/BlastPlan.js';
import { estimateBlastOreValue } from '../../core/mining/BlastValueEstimate.js';
import { getExplosive } from '../../core/world/ExplosiveCatalog.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export class BlastFooter {
  private readonly el: HTMLElement;
  private readonly costEl: HTMLElement;
  private readonly valueEl: HTMLElement;
  private readonly marginEl: HTMLElement;
  private readonly fireBtn: HTMLButtonElement;
  private readonly reasonEl: HTMLElement;
  private gameConsole?: GameConsoleFn;
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
    this.valueEl = value.value;
    this.marginEl = margin.value;
    row.append(cost.wrap, value.wrap, margin.wrap);

    this.fireBtn = el('button', { className: 'bsx-btn bsx-btn-danger-solid', attrs: { id: 'bs-blast-fire' } });
    this.fireBtn.style.cssText = 'height:42px;font:800 13px/1 var(--bsx-font-ui);letter-spacing:.2em;gap:9px';
    this.fireBtn.dataset['action'] = 'execute';
    this.fireBtn.append(iconEl('blast', 17), this.locale.bindText(el('span'), 'ui.blast_workshop.footer.fire'));
    this.fireBtn.addEventListener('click', () => this.confirmFire());

    this.reasonEl = el('div');
    this.reasonEl.style.cssText = 'display:none;gap:6px;align-items:flex-start';

    this.el.append(row, this.fireBtn, this.reasonEl);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  update(state: GameState): void {
    const plan = assembleBlastPlan(state.drillHoles, state.chargesByHole, state.sequenceDelays);
    const errors = validateBlastPlan(plan);
    const hasHoles = plan.holes.length > 0;
    const fireOk = hasHoles && errors.length === 0;

    const planCost = Object.values(state.chargesByHole).reduce((sum, charge) => {
      const explosive = getExplosive(charge.explosiveId);
      return sum + (explosive ? explosive.costPerKg * charge.amountKg : 0);
    }, 0);
    const estValue = estimateBlastOreValue(plan, state.surveyResults);
    const margin = estValue - planCost;
    const reason = !hasHoles
      ? t('ui.blast_workshop.footer.fire_reason_no_holes')
      : (errors[0] ? t('ui.blast_workshop.footer.fire_reason_invalid', { hole: errors[0].holeId, issue: errors[0].issue }) : null);

    const signature = JSON.stringify({ planCost, estValue, margin, fireOk, reason });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.costEl.textContent = `$${formatMoney(planCost)}`;
    this.valueEl.textContent = `$${formatMoney(estValue)}`;
    this.marginEl.textContent = `${margin < 0 ? '-' : ''}$${formatMoney(Math.abs(margin))}`;

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

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = ''; // forces the next update() to re-t() the fire-blocked reason line
  }

  dispose(): void { this.el.remove(); }

  /**
   * Legacy `.bs-confirm-overlay`/`.bs-btn` classes, not the new `bsx-` system —
   * matches BlastPlanUI's old confirmBlast() exactly so the tutorial rail's
   * existing target (`.bs-confirm-overlay:not(#bs-event-dialog) .bs-btn-danger`)
   * keeps resolving. Interim: the richer PreflightModal (§P4/Fire step) replaces
   * this whole dialog with a bsx-styled one.
   */
  private confirmFire(): void {
    if (this.fireBtn.disabled) return;
    const overlay = el('div', { className: 'bs-confirm-overlay' });
    const box = el('div', { className: 'bs-confirm-box' });
    const msg = el('p', { text: t('ui.blast_workshop.footer.confirm') });
    const yesBtn = el('button', { className: 'bs-btn bs-btn-danger', text: t('ui.blast_workshop.footer.confirm_yes') });
    yesBtn.addEventListener('click', () => {
      overlay.remove();
      this.gameConsole?.('blast');
    });
    const noBtn = el('button', { className: 'bs-btn', text: t('ui.blast_workshop.footer.confirm_no') });
    noBtn.addEventListener('click', () => overlay.remove());
    box.append(msg, yesBtn, noBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }
}
