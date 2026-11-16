// BlastSimulator2026 — Permits panel (#1924)
// Mine-grade ladder: current grade stamp, next-grade targets, fee, apply button, pending application.
// DOM contracts: [data-role="permit-stamp"], [data-target="<kind>"][data-met],
// [data-role="target-bar"], [data-action="permit-apply"], [data-role="permit-apply-reason"],
// [data-role="permit-pending"]; the ladder: [data-role="permit-grade"][data-grade][data-current],
// [data-role="permit-tier"][data-tier][data-state], [data-role="tier-perk"] (tier-block targets use [data-tier-target], never [data-target]).

import { PanelBase } from './PanelBase.js';
import { t } from '../../core/i18n/I18n.js';
import { permitStrikesExplain } from '../panelExplain.js';
import { el, explainable, card, button, sectionHeader, progressBar, panelHeader, flashStatus } from '../dom.js';
import { windowRoot, windowBody } from '../windowKit.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatGameDuration } from '../formatGameDuration.js';
import { getAllQuests } from '../../core/economy/QuestCatalog.js';
import { isQuestCompleted, questObjectiveStatuses, questPrerequisitesMet, type QuestDef } from '../../core/economy/Quests.js';
import { questRewardLine } from '../../core/economy/QuestRewardText.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import {
  gradeDef, gradeRung, nextGradeTargets, permitApplyBlocker, formatGradeAmount, tierDef, tierTargetStatuses,
  LAST_NAMED_GRADE, type GradeTargetStatus,
} from '../../core/economy/MineGrade.js';
import { MINE_TIERS_PER_GRADE } from '../../core/config/balance.js';
import { permitLimitTexts, tierPerkText } from '../../core/economy/permitLimitText.js';
import { permitRefusalText } from '../../core/economy/permitRefusalText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { GameConsoleFn } from '../gameConsole.js';

const MICRO_STYLE = 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)';
const LABEL_STYLE = 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-muted)';
const STAMP_STYLE = 'margin:0 auto;transform:rotate(-4deg);white-space:nowrap;padding:4px 9px;border:2px solid var(--bsx-critical-text);border-radius:4px;'
  + 'color:var(--bsx-critical-text);font:800 11px/1 var(--bsx-font-ui);letter-spacing:.2em;opacity:.85';

/** Tier block look by state: the current tier carries an amber rule, passed tiers recede, later ones are dimmer still. */
const TIER_STATE_STYLE = {
  current: 'border-left:2px solid var(--bsx-amber)',
  done: 'border-left:2px solid transparent;opacity:.65',
  locked: 'border-left:2px solid transparent;opacity:.5',
} as const;

export class PermitPanel extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private readonly contentEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly locale = new LocaleTextRegistry();

  private gameConsole?: GameConsoleFn;
  private lastSignature = '';
  private lastState: GameState | null = null;

  constructor(container: HTMLElement) {
    super(windowRoot('bs-permit-panel'));

    const { header, titleEl } = panelHeader({
      icon: 'contract',
      accent: 'amber',
      onClose: () => this.onCloseCb?.(),
    });
    this.locale.bindText(titleEl, 'ui.permit.title');

    this.bodyEl = windowBody();

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
    const targets = nextGradeTargets(state);
    const signature = this.computeSignature(state, targets);
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.render(state, targets);
    }
    this.refreshDynamic(state, targets);
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
    if (this.lastState) this.update(this.lastState);
  }

  /** What changes the layout; per-tick numbers go through refreshDynamic. Affordability, not raw cash, so the Apply button is not rebuilt each tick. */
  private computeSignature(state: GameState, targets: readonly GradeTargetStatus[]): string {
    const g = state.grade;
    if (!g) return 'none';
    const next = gradeDef(g.grade + 1);
    const targetFlags = targets.map(s => `${s.kind}:${s.met ? 1 : 0}`).join(',');
    const { limits, strikes } = permitLimitTexts(gradeRung(g), g.strikeTicks ?? [], state.tickCount);
    const questFlags = state.quests ? getAllQuests().map(q => `${q.id}:${isQuestCompleted(state, q.id) ? 1 : 0}`).join(',') : '';
    const tierFlags = this.tierIndices(g.grade).map(n => tierTargetStatuses(state, n).map(x => (x.met ? 1 : 0)).join('')).join('/');
    return [g.grade, g.tier, tierFlags, g.pending ? g.pending.toGrade : '-', targetFlags, state.cash >= next.fee ? 1 : 0, limits, strikes, questFlags].join('|');
  }

  private render(state: GameState, targets: readonly GradeTargetStatus[]): void {
    const g = state.grade;
    if (!g) {
      this.contentEl.replaceChildren(card([el('span', { text: t('permit.no_ladder'), attrs: { style: MICRO_STYLE } })]));
      return;
    }
    const current = gradeDef(g.grade);
    const next = gradeDef(g.grade + 1);
    const nextName = t(next.nameKey, next.nameParams);

    const limitTexts = permitLimitTexts(gradeRung(g), g.strikeTicks ?? [], state.tickCount);
    const currentCard = card([
      el('span', { text: t('ui.permit.current_label'), attrs: { style: LABEL_STYLE } }),
      el('div', { attrs: { style: 'display:flex;align-items:center;justify-content:center;padding:10px 0 6px' }, children: [
        el('span', {
          text: `${t('ui.permit.stamp')} - ${t('ui.permit.stamp_tier', { name: t(current.nameKey, current.nameParams), tier: g.tier })}`,
          attrs: { 'data-role': 'permit-stamp', style: STAMP_STYLE },
        }),
      ] }),
      el('span', { text: limitTexts.limits, attrs: { 'data-role': 'permit-limits', style: MICRO_STYLE } }),
      explainable(el('span', { text: limitTexts.strikes, attrs: { 'data-role': 'permit-strikes', style: MICRO_STYLE } }), permitStrikesExplain()),
    ]);

    const nextChildren: (Node | null)[] = [
      sectionHeader(t('ui.permit.next_label', { name: nextName })),
      ...targets.map(s => this.targetRow(s)),
      el('span', {
        text: t('ui.permit.fee_line', { fee: formatMoney(next.fee), time: formatGameDuration(next.processingTicks) }),
        attrs: { 'data-role': 'permit-fee', style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-amber)' },
      }),
    ];
    nextChildren.push(g.pending ? this.pendingBlock() : this.applyBlock(state));

    const ladder = [this.gradesCard(g.grade), ...(g.grade <= LAST_NAMED_GRADE ? [this.tiersCard(state)] : [])];
    const questCards = state.quests ? [this.questsCard(state)] : [];
    this.contentEl.replaceChildren(currentCard, ...ladder, card(nextChildren), ...questCards);
  }

  private tierIndices(grade: number): number[] {
    return grade <= LAST_NAMED_GRADE ? Array.from({ length: MINE_TIERS_PER_GRADE }, (_, i) => i + 1) : [];
  }

  /** The four named grades (and the endless class the site is in, if any), the current one marked. */
  private gradesCard(current: number): HTMLElement {
    const shown = Array.from({ length: LAST_NAMED_GRADE + 1 }, (_, i) => i);
    if (current > LAST_NAMED_GRADE) shown.push(current);
    const rows = shown.map(n => {
      const def = gradeDef(n);
      const row = el('div', { text: t(def.nameKey, def.nameParams), attrs: { 'data-role': 'permit-grade', style: `font:${n === current ? 700 : 400} 11px/1.3 var(--bsx-font-ui);color:var(--bsx-text-${n === current ? 'primary' : 'muted'})` } });
      row.dataset['grade'] = String(n);
      row.dataset['current'] = String(n === current);
      return row;
    });
    return card([el('span', { text: t('ui.permit.grades_label'), attrs: { style: LABEL_STYLE } }), ...rows]);
  }

  /** The current grade's three tiers: caps, targets and the perk each one grants. */
  private tiersCard(state: GameState): HTMLElement {
    const g = state.grade!;
    const grade = gradeDef(g.grade);
    const blocks = this.tierIndices(g.grade).map(n => {
      const def = tierDef(g.grade, n)!;
      const tierState = n < g.tier ? 'done' : n === g.tier ? 'current' : 'locked';
      const block = el('div', { attrs: { 'data-role': 'permit-tier', style: `display:flex;flex-direction:column;gap:3px;padding:4px 0 4px 6px;${TIER_STATE_STYLE[tierState]}` } });
      block.dataset['tier'] = String(n);
      block.dataset['state'] = tierState;
      block.append(
        el('span', { text: t('ui.permit.tier_row', { tier: n }), attrs: { style: LABEL_STYLE } }),
        el('span', { text: t('ui.permit.tier_caps', { kg: def.limits.maxChargeKg, area: def.limits.maxAreaM2 }), attrs: { style: MICRO_STYLE } }),
        ...def.targets.map(x => {
          const line = el('span', { attrs: { style: MICRO_STYLE } });
          line.dataset['tierTarget'] = x.kind;
          return line;
        }),
        el('span', { text: tierPerkText(g.grade, n), attrs: { 'data-role': 'tier-perk', style: MICRO_STYLE + ';font-style:italic' } }),
      );
      return block;
    });
    return card([el('span', { text: t('ui.permit.tiers_label', { name: t(grade.nameKey, grade.nameParams) }), attrs: { style: LABEL_STYLE } }), ...blocks]);
  }

  /** Every quest from the start, completed ones kept visible (#2280). */
  private questsCard(state: GameState): HTMLElement {
    return card([
      el('span', { text: t('ui.progression.quests_label'), attrs: { style: LABEL_STYLE } }),
      ...getAllQuests().map(q => this.questBlock(state, q)),
    ]);
  }

  private questBlock(state: GameState, quest: QuestDef): HTMLElement {
    const block = el('div', { attrs: { 'data-role': 'quest', style: 'display:flex;flex-direction:column;gap:4px;padding:4px 0 4px 6px;border-left:2px solid var(--bsx-amber)' } });
    block.dataset['questId'] = quest.id;
    block.dataset['state'] = isQuestCompleted(state, quest.id) ? 'completed' : 'available';
    block.append(
      el('span', { text: t(quest.titleKey), attrs: { style: 'font:700 11px/1.3 var(--bsx-font-ui);color:var(--bsx-text-primary)' } }),
      el('span', { text: t('quest.detail.giver', { giver: t(quest.giverKey) }), attrs: { 'data-role': 'quest-giver', style: MICRO_STYLE } }),
      el('span', { text: t(quest.pitchKey), attrs: { style: MICRO_STYLE + ';font-style:italic' } }),
    );
    for (const o of quest.objectives) {
      const row = el('div', { attrs: { 'data-role': 'quest-objective', style: 'display:flex;flex-direction:column;gap:4px' } });
      row.dataset['kind'] = o.kind;
      row.append(el('span', { attrs: { 'data-role': 'quest-objective-text', style: 'font:500 11px/1.3 var(--bsx-font-ui)' } }), progressBar(0, 'var(--bsx-amber)'));
      row.querySelector('.bsx-progress-fill')!.setAttribute('data-role', 'quest-bar');
      block.append(row);
    }
    block.append(el('span', { text: questRewardLine(quest.reward), attrs: { 'data-role': 'quest-reward', style: 'font:600 10px/1.3 var(--bsx-font-ui);color:var(--bsx-amber)' } }));
    const open = (quest.requires ?? []).filter(id => !isQuestCompleted(state, id));
    if (!questPrerequisitesMet(state, quest)) {
      const names = open.map(id => t(getAllQuests().find(q => q.id === id)?.titleKey ?? id)).join(', ');
      block.append(el('span', { text: t('quest.detail.requires', { quests: names }), attrs: { 'data-role': 'quest-requires', style: MICRO_STYLE } }));
    }
    return block;
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
    return el('div', { attrs: { 'data-role': 'permit-pending', style: 'display:flex;flex-direction:column;gap:5px' }, children: [
      el('span', { attrs: { 'data-role': 'permit-countdown', style: 'font:600 12px/1 var(--bsx-font-mono);color:var(--bsx-info)' } }),
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
    const note = blocked
      ? el('span', { attrs: { 'data-role': 'permit-apply-reason', style: MICRO_STYLE } })
      : el('span', { text: t('ui.permit.all_met'), attrs: { 'data-role': 'permit-all-met', style: MICRO_STYLE } });
    return el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:6px' }, children: [applyBtn, note] });
  }

  /** Per-tick numbers, bar widths, countdown and the cash-bearing refusal text. */
  private refreshDynamic(state: GameState, targets: readonly GradeTargetStatus[]): void {
    const g = state.grade;
    if (!g) return;
    const rows = this.contentEl.querySelectorAll<HTMLElement>('[data-target]');
    targets.forEach((s, i) => {
      const row = rows[i];
      if (!row) return;
      row.dataset['met'] = String(s.met);
      row.querySelector<HTMLElement>('[data-role="target-text"]')!.textContent =
        t(`permit.target.${s.kind}`, { current: formatGradeAmount(s.current), needed: formatGradeAmount(s.needed) });
      const pct = s.needed > 0 ? Math.min(100, (s.current / s.needed) * 100) : 100;
      row.querySelector<HTMLElement>('[data-role="target-bar"]')!.style.width = `${pct}%`;
    });

    for (const block of Array.from(this.contentEl.querySelectorAll<HTMLElement>('[data-role="permit-tier"]'))) {
      const statuses = tierTargetStatuses(state, Number(block.dataset['tier']));
      statuses.forEach((s, i) => {
        const line = block.querySelectorAll<HTMLElement>('[data-tier-target]')[i];
        if (!line) return;
        line.dataset['met'] = String(s.met);
        line.textContent = `${s.met ? '[x]' : '[ ]'} ${t(`permit.target.${s.kind}`, { current: formatGradeAmount(s.current), needed: formatGradeAmount(s.needed) })}`;
      });
    }

    for (const block of Array.from(this.contentEl.querySelectorAll<HTMLElement>('[data-role="quest"]'))) {
      const quest = getAllQuests().find(q => q.id === block.dataset['questId']);
      if (!quest) continue;
      questObjectiveStatuses(state, quest).forEach(s => {
        const row = block.querySelector<HTMLElement>(`[data-role="quest-objective"][data-kind="${s.kind}"]`);
        if (!row) return;
        row.dataset['met'] = String(s.met);
        row.querySelector<HTMLElement>('[data-role="quest-objective-text"]')!.textContent =
          t(`quest.objective.${s.kind}`, { current: formatGradeAmount(s.current), needed: formatGradeAmount(s.needed) });
        const pct = s.needed > 0 ? Math.min(100, (s.current / s.needed) * 100) : 100;
        row.querySelector<HTMLElement>('[data-role="quest-bar"]')!.style.width = `${pct}%`;
      });
    }

    const pendingEl = this.contentEl.querySelector<HTMLElement>('[data-role="permit-countdown"]');
    if (pendingEl && g.pending) {
      pendingEl.textContent = t('ui.permit.pending_countdown', { time: formatGameDuration(g.pending.ticksLeft) });
    }

    const reasonEl = this.contentEl.querySelector<HTMLElement>('[data-role="permit-apply-reason"]');
    if (reasonEl) {
      const blocker = permitApplyBlocker(state);
      reasonEl.textContent = blocker
        ? permitRefusalText(blocker.refusal, blocker.unmet, gradeDef(g.grade + 1).fee, state.cash)
        : '';
    }
  }
}
