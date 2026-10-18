// BlastSimulator2026 — Permits panel (#1924)
// Mine-grade ladder: current grade stamp, next-grade targets, fee, apply button, pending application.
// DOM contracts: [data-role="permit-stamp"], [data-target="<kind>"][data-met],
// [data-role="target-bar"], [data-action="permit-apply"], [data-role="permit-apply-reason"],
// [data-role="permit-pending"].

import { PanelBase } from './PanelBase.js';
import { t } from '../../core/i18n/I18n.js';
import { el, card, button, sectionHeader, progressBar, panelRoot, panelHeader, panelBody, flashStatus } from '../dom.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatGameDuration } from '../formatGameDuration.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { gradeDef, nextGradeTargets, formatGradeAmount, type GradeTargetStatus } from '../../core/economy/MineGrade.js';
import { permitApplyBlocker, permitRefusalText } from '../../core/economy/permitRefusalText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { GameConsoleFn } from '../gameConsole.js';

const MICRO_STYLE = 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)';
const LABEL_STYLE = 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-muted)';
const STAMP_STYLE = 'margin-left:auto;transform:rotate(-8deg);padding:4px 9px;border:2px solid var(--bsx-critical-text);border-radius:4px;'
  + 'color:var(--bsx-critical-text);font:800 11px/1 var(--bsx-font-ui);letter-spacing:.2em;opacity:.85';

export class PermitPanel extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private readonly contentEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly locale = new LocaleTextRegistry();

  private gameConsole?: GameConsoleFn;
  private lastSignature = '';
  private lastState: GameState | null = null;

  constructor(container: HTMLElement) {
    super(panelRoot('bs-permit-panel'));

    const { header, titleEl } = panelHeader({
      icon: 'contract',
      accent: 'amber',
      onClose: () => this.onCloseCb?.(),
    });
    this.locale.bindText(titleEl, 'ui.permit.title');

    this.bodyEl = panelBody(11);

    const letterhead = card([
      this.locale.bindText(
        el('div', { attrs: { style: 'font:700 13px/1.2 var(--bsx-font-ui);letter-spacing:.06em;color:var(--bsx-text-primary)' } }),
        'ui.permit.letterhead',
      ),
      this.locale.bindText(el('div', { attrs: { style: MICRO_STYLE + ';font-style:italic' } }), 'ui.permit.letterhead_sub'),
    ]);

    this.contentEl = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:11px' } });
    this.statusEl = el('div', {
      attrs: { 'data-role': 'permit-status', style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro);min-height:14px' },
    });

    this.bodyEl.append(letterhead, this.contentEl, this.statusEl);
    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  update(state: GameState): void {
    this.lastState = state;
    const signature = this.computeSignature(state);
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.render(state);
    }
    this.refreshDynamic(state);
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
    if (this.lastState) this.update(this.lastState);
  }

  /** What changes the layout; per-tick numbers go through refreshDynamic. Affordability, not raw cash, so the Apply button is not rebuilt each tick. */
  private computeSignature(state: GameState): string {
    const g = state.grade;
    if (!g) return 'none';
    const next = gradeDef(g.grade + 1);
    const targets = nextGradeTargets(state).map(s => `${s.kind}:${s.met ? 1 : 0}`).join(',');
    return [g.grade, g.pending ? g.pending.toGrade : '-', targets, state.cash >= next.fee ? 1 : 0].join('|');
  }

  private render(state: GameState): void {
    const g = state.grade;
    if (!g) {
      this.contentEl.replaceChildren(card([el('span', { text: t('permit.no_ladder'), attrs: { style: MICRO_STYLE } })]));
      return;
    }
    const current = gradeDef(g.grade);
    const next = gradeDef(g.grade + 1);
    const nextName = t(next.nameKey, next.nameParams);

    const currentCard = card([
      el('span', { text: t('ui.permit.current_label'), attrs: { style: LABEL_STYLE } }),
      el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' }, children: [
        el('span', { text: t(current.nameKey, current.nameParams), attrs: { 'data-role': 'permit-grade', style: 'font:700 13px/1.2 var(--bsx-font-ui)' } }),
        el('span', { text: t('ui.permit.stamp'), attrs: { 'data-role': 'permit-stamp', style: STAMP_STYLE } }),
      ] }),
    ]);

    const nextChildren: (Node | null)[] = [
      sectionHeader(t('ui.permit.next_label', { name: nextName })),
      ...nextGradeTargets(state).map(s => this.targetRow(s)),
      el('span', {
        text: t('ui.permit.fee_line', { fee: formatMoney(next.fee), time: formatGameDuration(next.processingTicks) }),
        attrs: { 'data-role': 'permit-fee', style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-amber)' },
      }),
    ];
    nextChildren.push(g.pending ? this.pendingBlock() : this.applyBlock(state));

    this.contentEl.replaceChildren(currentCard, card(nextChildren));
  }

  private targetRow(s: GradeTargetStatus): HTMLElement {
    const row = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:4px' } });
    row.dataset['target'] = s.kind;
    row.append(
      el('span', { attrs: { 'data-role': 'target-text', style: 'font:500 11px/1.3 var(--bsx-font-ui)' } }),
      progressBar(0, 'var(--bsx-amber)'),
    );
    row.querySelector('.bsx-progress-fill')!.setAttribute('data-role', 'target-bar');
    return row;
  }

  private pendingBlock(): HTMLElement {
    return el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:5px' }, children: [
      el('span', { attrs: { 'data-role': 'permit-pending', style: 'font:600 12px/1 var(--bsx-font-mono);color:var(--bsx-info)' } }),
      el('span', { text: t('ui.permit.pending_status'), attrs: { style: MICRO_STYLE + ';font-style:italic' } }),
    ] });
  }

  private applyBlock(state: GameState): HTMLElement {
    const blocked = permitApplyBlocker(state) !== null;
    const applyBtn = button('primary', t('ui.permit.apply'), { dataAction: 'permit-apply', disabled: blocked });
    applyBtn.addEventListener('click', () => {
      const result = this.gameConsole?.('permit apply');
      flashStatus(this.statusEl, result?.output ?? '');
    });
    const reason = el('span', { attrs: { 'data-role': 'permit-apply-reason', style: MICRO_STYLE } });
    const allMet = el('span', { text: t('ui.permit.all_met'), attrs: { 'data-role': 'permit-all-met', style: MICRO_STYLE } });
    allMet.style.display = 'none';
    return el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:6px' }, children: [applyBtn, reason, allMet] });
  }

  /** Per-tick numbers, bar widths, countdown and the cash-bearing refusal text. */
  private refreshDynamic(state: GameState): void {
    const g = state.grade;
    if (!g) return;
    const targets = nextGradeTargets(state);
    for (const s of targets) {
      const row = this.contentEl.querySelector<HTMLElement>(`[data-target="${s.kind}"]`);
      if (!row) continue;
      row.dataset['met'] = String(s.met);
      row.querySelector<HTMLElement>('[data-role="target-text"]')!.textContent =
        t(`permit.target.${s.kind}`, { current: formatGradeAmount(s.current), needed: formatGradeAmount(s.needed) });
      const pct = Math.min(100, (s.current / s.needed) * 100);
      row.querySelector<HTMLElement>('[data-role="target-bar"]')!.style.width = `${pct}%`;
    }

    const pendingEl = this.contentEl.querySelector<HTMLElement>('[data-role="permit-pending"]');
    if (pendingEl && g.pending) {
      pendingEl.textContent = t('ui.permit.pending_countdown', { time: formatGameDuration(g.pending.ticksLeft) });
    }

    const reasonEl = this.contentEl.querySelector<HTMLElement>('[data-role="permit-apply-reason"]');
    if (reasonEl) {
      const blocker = permitApplyBlocker(state);
      reasonEl.textContent = blocker
        ? permitRefusalText(blocker.refusal, blocker.unmet, gradeDef(g.grade + 1).fee, state.cash)
        : '';
      const allMet = this.contentEl.querySelector<HTMLElement>('[data-role="permit-all-met"]');
      if (allMet) allMet.style.display = blocker ? 'none' : '';
    }
  }
}
