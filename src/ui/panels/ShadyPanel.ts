// BlastSimulator2026 — Shady panel (redesign P9)
// Corruption arrangements (5 targets, always available) and, once the mafia
// is unlocked (corruption.level >= MAFIA_UNLOCK_THRESHOLD), the "other
// services": smuggling, an exposure meter, and the arranged-accident/frame
// flows against a live employee. Reachable only via ToolRail's own
// corruption-gated reveal — nothing links here before the player has
// actually made an arrangement.

import { t } from '../../core/i18n/I18n.js';
import { el, card, button, sectionHeader } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import { getSuccessRate, TARGET_COSTS, MAFIA_THRESHOLD, type CorruptionTarget } from '../../core/economy/Corruption.js';
import {
  ACCIDENT_COST, ACCIDENT_SUCCESS_RATE, FRAME_COST, FRAME_SUCCESS_RATE, FRAME_EVIDENCE_TICKS,
} from '../../core/events/MafiaActions.js';
import type { ConfirmModalConfig } from './ConfirmModal.js';
import type { CommandResult } from '../../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

const TARGETS: readonly { id: CorruptionTarget; nameKey: string; noteKey: string }[] = [
  { id: 'judge', nameKey: 'ui.shady.target.judge', noteKey: 'ui.shady.target.judge.note' },
  { id: 'union_leader', nameKey: 'ui.shady.target.union_leader', noteKey: 'ui.shady.target.union_leader.note' },
  { id: 'inspector', nameKey: 'ui.shady.target.inspector', noteKey: 'ui.shady.target.inspector.note' },
  { id: 'politician', nameKey: 'ui.shady.target.politician', noteKey: 'ui.shady.target.politician.note' },
  { id: 'witness', nameKey: 'ui.shady.target.witness', noteKey: 'ui.shady.target.witness.note' },
];

export class ShadyPanel {
  private readonly el: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly influenceValueEl: HTMLElement;
  private readonly influenceBarEl: HTMLElement;
  private readonly influenceNoteEl: HTMLElement;
  private readonly targetsEl: HTMLElement;
  private readonly servicesEl: HTMLElement;
  private readonly exposureCard: HTMLElement;
  private readonly exposureValueEl: HTMLElement;
  private readonly exposureBarEl: HTMLElement;
  private readonly statusEl: HTMLElement;

  private onCloseCb?: () => void;
  private gameConsole?: GameConsoleFn;
  private onConfirmRequestCb?: (config: ConfirmModalConfig) => void;
  private lastSignature = '';
  private lastState: GameState | null = null;
  /** Last cash value used for button affordability refresh. */
  private lastCash = -1;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div', { className: 'bsx-root', attrs: { id: 'bs-shady-panel' } });
    this.el.style.cssText = [
      'flex-direction:column', 'width:372px', 'max-height:100%',
      'border-radius:8px', 'background:var(--bsx-panel)', 'border:1px solid var(--bsx-hairline-strong)',
      'box-shadow:0 18px 44px rgba(0,0,0,.55)', 'overflow:hidden', 'pointer-events:all',
    ].join(';');
    this.el.style.display = 'none';

    const header = el('div');
    header.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 12px;background:#1a2028;border-bottom:1px solid var(--bsx-hairline)';
    const iconChip = el('div', { children: [iconEl('shady', 15)] });
    iconChip.style.cssText = 'width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:rgba(169,140,255,.14);color:var(--bsx-ore)';
    const titleEl = this.locale.bindText(
      el('div', { attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-primary)' } }),
      'ui.shady.title',
    );
    const closeBtn = el('button', { children: [iconEl('x', 12)] });
    closeBtn.style.cssText = 'margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer';
    closeBtn.addEventListener('click', () => this.onCloseCb?.());
    header.append(iconChip, titleEl, closeBtn);

    this.bodyEl = el('div');
    this.bodyEl.style.cssText = 'flex:1 1 auto;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:11px';

    const introEl = this.locale.bindText(
      el('span', { attrs: { style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro);font-style:italic' } }),
      'ui.shady.intro',
    );

    const influenceLabel = this.locale.bindText(
      el('span', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-muted)' } }),
      'ui.shady.influence_label',
    );
    this.influenceValueEl = el('span', { attrs: { style: 'margin-left:auto;font:600 14px/1 var(--bsx-font-mono);color:var(--bsx-ore)' } });
    const influenceHeadRow = el('div', { attrs: { style: 'display:flex;align-items:baseline;gap:8px' }, children: [influenceLabel, this.influenceValueEl] });
    const influenceTrack = el('div', { attrs: { style: 'height:5px;border-radius:3px;overflow:hidden;background:var(--bsx-well)' } });
    this.influenceBarEl = el('div', { attrs: { style: 'height:100%;background:var(--bsx-ore);width:0%' } });
    influenceTrack.appendChild(this.influenceBarEl);
    this.influenceNoteEl = el('span', { attrs: { style: 'font:400 10px/1.45 var(--bsx-font-ui);color:var(--bsx-text-muted)' } });
    const influenceCard = card([influenceHeadRow, influenceTrack, this.influenceNoteEl]);

    const arrangementsHeader = sectionHeader(t('ui.shady.arrangements_label'));
    this.locale.bindText(arrangementsHeader.querySelector('span')!, 'ui.shady.arrangements_label');
    this.targetsEl = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:8px' } });

    const servicesHeader = sectionHeader(t('ui.shady.other_services_label'));
    this.locale.bindText(servicesHeader.querySelector('span')!, 'ui.shady.other_services_label');
    this.servicesEl = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:8px' } });

    // Built once and reused across renders — refreshDynamic() keeps it live every
    // tick without the signature-gated rebuild that owns everything else, since
    // exposure climbs continuously while smuggling runs (MafiaActions.processSmuggling).
    const exposureLabel = this.locale.bindText(
      el('span', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-muted)' } }),
      'ui.shady.exposure_label',
    );
    this.exposureValueEl = el('span', { attrs: { style: 'margin-left:auto;font:600 13px/1 var(--bsx-font-mono);color:var(--bsx-critical-text)' } });
    const exposureHeadRow = el('div', { attrs: { style: 'display:flex;align-items:baseline;gap:8px' }, children: [exposureLabel, this.exposureValueEl] });
    const exposureTrack = el('div', { attrs: { style: 'height:5px;border-radius:3px;overflow:hidden;background:var(--bsx-well)' } });
    this.exposureBarEl = el('div', { attrs: { style: 'height:100%;background:var(--bsx-critical);width:0%' } });
    exposureTrack.appendChild(this.exposureBarEl);
    const exposureNote = this.locale.bindText(
      el('span', { attrs: { style: 'font:400 10px/1.45 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }),
      'ui.shady.exposure_note',
    );
    this.exposureCard = card([exposureHeadRow, exposureTrack, exposureNote]);

    this.statusEl = el('div', {
      attrs: { id: 'bs-shady-status', style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro);min-height:14px' },
    });

    this.bodyEl.append(introEl, influenceCard, arrangementsHeader, this.targetsEl, servicesHeader, this.servicesEl, this.statusEl);
    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }
  setCloseHandler(cb: () => void): void { this.onCloseCb = cb; }
  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setConfirmHandler(cb: (config: ConfirmModalConfig) => void): void { this.onConfirmRequestCb = cb; }

  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    setTimeout(() => { if (this.statusEl.textContent === msg) this.statusEl.textContent = ''; }, 3000);
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
    if (this.lastState) this.update(this.lastState);
  }

  dispose(): void { this.el.remove(); }

  update(state: GameState): void {
    this.lastState = state;
    this.refreshDynamic(state);

    if (state.cash !== this.lastCash) {
      this.lastCash = state.cash;
      this.refreshAffordability(state.cash);
    }

    const signature = this.computeSignature(state);
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.render(state);
  }

  /**
   * Disable/enable the corrupt/accident/frame-start action buttons per
   * affordability, mirroring BuildMenu's cost-gating pattern. Reapplies to
   * already-rendered DOM without a full rebuild. The frame-complete button
   * is never gated — completing a pending frame costs 0.
   */
  private refreshAffordability(cash: number): void {
    for (const targetEl of Array.from(this.targetsEl.children) as HTMLElement[]) {
      const targetId = targetEl.dataset['target'] as CorruptionTarget | undefined;
      if (!targetId) continue;
      const btn = targetEl.querySelector<HTMLButtonElement>('[data-action="corrupt"]');
      if (btn) btn.disabled = cash < TARGET_COSTS[targetId];
    }

    const accidentBtn = this.servicesEl.querySelector<HTMLButtonElement>('[data-action="mafia-accident"]');
    if (accidentBtn) {
      const select = this.servicesEl.querySelector<HTMLSelectElement>('[data-action="mafia-accident-employee"]');
      const noEligible = !select || select.disabled;
      accidentBtn.disabled = noEligible || cash < ACCIDENT_COST;
    }

    const frameStartBtn = this.servicesEl.querySelector<HTMLButtonElement>('[data-action="mafia-frame-start"]');
    if (frameStartBtn) {
      const select = this.servicesEl.querySelector<HTMLSelectElement>('[data-action="mafia-frame-employee"]');
      const noEligible = !select || select.disabled;
      frameStartBtn.disabled = noEligible || cash < FRAME_COST;
    }
  }

  /** Cheap per-tick refresh: the exposure meter climbs continuously while smuggling runs. */
  private refreshDynamic(state: GameState): void {
    const pct = Math.round(state.mafia.exposureRisk * 100);
    this.exposureValueEl.textContent = `${pct}%`;
    this.exposureBarEl.style.width = `${pct}%`;
  }

  /** Everything that only changes on a player action, not every tick. */
  private computeSignature(state: GameState): string {
    const framesSig = state.mafia.pendingFrames.map(f => `${f.employeeId}:${f.readyTick <= state.tickCount ? 1 : 0}`).join(',');
    const rosterSig = state.employees.employees.filter(e => e.alive).map(e => e.id).join(',');
    return [
      state.corruption.level,
      state.corruption.attempts.length,
      state.corruption.mafiaUnlocked ? 1 : 0,
      state.mafia.smugglingActive ? 1 : 0,
      framesSig,
      rosterSig,
    ].join('|');
  }

  private render(state: GameState): void {
    const level = state.corruption.level;
    this.influenceValueEl.textContent = String(level);
    const pct = Math.min(100, Math.round((level / MAFIA_THRESHOLD) * 100));
    this.influenceBarEl.style.width = `${pct}%`;
    this.influenceNoteEl.textContent = t('ui.shady.influence_note', { threshold: MAFIA_THRESHOLD });

    const rate = Math.round(getSuccessRate(state.corruption) * 100);
    this.targetsEl.replaceChildren(...TARGETS.map(target => this.targetCard(target, rate, state.cash)));

    this.servicesEl.replaceChildren(
      state.corruption.mafiaUnlocked ? this.unlockedServices(state) : this.lockedServicesTeaser(),
    );
  }

  private targetCard(target: { id: CorruptionTarget; nameKey: string; noteKey: string }, rate: number, cash: number): HTMLElement {
    const cost = TARGET_COSTS[target.id];
    const headRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' }, children: [
      iconEl('person', 13, 0.6),
      el('span', { text: t(target.nameKey), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
      el('span', { text: `${rate}%`, attrs: { style: 'margin-left:auto;font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-ore)' } }),
    ] });
    const noteEl = el('span', { text: t(target.noteKey), attrs: { style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' } });
    const callBtn = button('ghost', t('ui.shady.make_the_call'), { dataAction: 'corrupt' });
    callBtn.style.cssText = 'margin-left:auto;border-color:rgba(169,140,255,.4);background:rgba(169,140,255,.1);color:#c4aeff';
    callBtn.disabled = cash < cost;
    callBtn.addEventListener('click', () => {
      this.onConfirmRequestCb?.({
        icon: 'shady',
        title: t('ui.shady.confirm_title'),
        body: t('ui.shady.confirm_body', { target: t(target.nameKey), cost: cost.toLocaleString('en-US'), rate }),
        confirmLabel: t('ui.shady.make_the_call'),
        onConfirm: () => {
          const cmdResult = this.gameConsole?.(`corrupt target:${target.id}`);
          this.setStatus(cmdResult?.output ?? '');
        },
      });
    });
    const footRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' }, children: [
      el('span', { text: `$${cost.toLocaleString('en-US')}`, attrs: { style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-amber)' } }),
      callBtn,
    ] });
    // `data-target` scopes the card so a test can reach one specific
    // arrangement (`[data-target="judge"] [data-action="corrupt"]`) instead of
    // counting `nth-of-type` positions across five identical cards.
    const wrap = card([headRow, noteEl, footRow]);
    wrap.dataset['target'] = target.id;
    return wrap;
  }

  private lockedServicesTeaser(): HTMLElement {
    const lockIcon = el('div', { attrs: { style: 'color:var(--bsx-text-micro)' }, children: [iconEl('lock', 15, 0.5)] });
    const title = el('span', { text: t('ui.shady.locked_title'), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } });
    const body = el('span', { text: t('ui.shady.locked_body'), attrs: { style: 'font:400 10px/1.45 var(--bsx-font-ui);color:var(--bsx-text-muted)' } });
    const textCol = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:4px' }, children: [title, body] });
    return el('div', { attrs: {
      style: 'display:flex;gap:10px;padding:13px;border:1px dashed var(--bsx-hairline-strong);border-radius:5px;background:var(--bsx-well)',
    }, children: [lockIcon, textCol] });
  }

  private unlockedServices(state: GameState): HTMLElement {
    const wrap = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:8px' } });
    wrap.append(this.exposureCard, this.smugglingCard(state), this.accidentCard(state, state.cash), this.frameCard(state, state.cash));
    return wrap;
  }

  private smugglingCard(state: GameState): HTMLElement {
    const active = state.mafia.smugglingActive;
    const label = el('span', { text: t('ui.shady.smuggling_label'), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-muted)' } });
    const status = el('span', {
      text: active ? t('ui.shady.smuggling_active', { income: state.mafia.smugglingIncome }) : t('ui.shady.smuggling_inactive'),
      attrs: { style: `margin-left:auto;font:500 10px/1 var(--bsx-font-mono);color:${active ? 'var(--bsx-positive)' : 'var(--bsx-text-muted)'}` },
    });
    const headRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' }, children: [label, status] });
    const note = el('span', { text: t('ui.shady.smuggling_note'), attrs: { style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' } });
    const toggleBtn = button(
      active ? 'danger' : 'ghost',
      t(active ? 'ui.shady.smuggling_stop' : 'ui.shady.smuggling_start'),
      { dataAction: 'mafia-smuggle' },
    );
    toggleBtn.style.width = '100%';
    toggleBtn.addEventListener('click', () => {
      const cmdResult = this.gameConsole?.('mafia smuggle');
      this.setStatus(cmdResult?.output ?? '');
    });
    return card([headRow, note, toggleBtn]);
  }

  private accidentCard(state: GameState, cash: number): HTMLElement {
    const successRate = Math.round(ACCIDENT_SUCCESS_RATE * 100);
    const label = el('span', { text: t('ui.shady.accident_label'), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-muted)' } });
    const note = el('span', { text: t('ui.shady.accident_note', { rate: successRate }), attrs: { style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' } });
    const alive = state.employees.employees.filter(e => e.alive);
    const select = this.employeeSelect(alive);
    select.dataset['action'] = 'mafia-accident-employee';
    const goBtn = button('ghost', t('ui.shady.accident_button'), { dataAction: 'mafia-accident' });
    goBtn.style.cssText = 'border-color:rgba(255,91,76,.35);color:var(--bsx-critical-text)';
    goBtn.disabled = alive.length === 0 || cash < ACCIDENT_COST;
    goBtn.addEventListener('click', () => {
      const empId = Number(select.value);
      const emp = alive.find(e => e.id === empId);
      if (!emp) return;
      this.onConfirmRequestCb?.({
        icon: 'skull',
        title: t('ui.shady.accident_confirm_title'),
        body: t('ui.shady.accident_confirm_body', { name: emp.name, cost: ACCIDENT_COST.toLocaleString('en-US'), rate: successRate }),
        confirmLabel: t('ui.shady.accident_button'),
        onConfirm: () => {
          const cmdResult = this.gameConsole?.(`mafia accident employee:${emp.id}`);
          this.setStatus(cmdResult?.output ?? '');
        },
      });
    });
    const row = el('div', { attrs: { style: 'display:flex;gap:6px' }, children: [select, goBtn] });
    return card([label, note, row]);
  }

  private frameCard(state: GameState, cash: number): HTMLElement {
    const successRate = Math.round(FRAME_SUCCESS_RATE * 100);
    const label = el('span', { text: t('ui.shady.frame_label'), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-muted)' } });
    const note = el('span', {
      text: t('ui.shady.frame_note', { ticks: FRAME_EVIDENCE_TICKS }),
      attrs: { style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' },
    });
    const children: HTMLElement[] = [label, note];

    for (const frame of state.mafia.pendingFrames) {
      const emp = state.employees.employees.find(e => e.id === frame.employeeId);
      if (!emp) continue;
      const ready = state.tickCount >= frame.readyTick;
      const row = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' } });
      // Pending frames are keyed by the framed employee — `data-frame-id`
      // scopes the row so a test targets one frame, not "the third row".
      row.dataset['frameId'] = String(frame.employeeId);
      row.appendChild(el('span', { text: emp.name, attrs: { style: 'font:500 10px/1 var(--bsx-font-ui);flex:1' } }));
      if (ready) {
        const useBtn = button('ghost', t('ui.shady.frame_complete_button'), { dataAction: 'mafia-frame-complete' });
        useBtn.style.cssText = 'border-color:rgba(255,91,76,.35);color:var(--bsx-critical-text)';
        useBtn.addEventListener('click', () => {
          this.onConfirmRequestCb?.({
            icon: 'skull',
            title: t('ui.shady.frame_complete_confirm_title'),
            body: t('ui.shady.frame_complete_confirm_body', { name: emp.name, rate: successRate }),
            confirmLabel: t('ui.shady.frame_complete_button'),
            onConfirm: () => {
              const cmdResult = this.gameConsole?.(`mafia frame employee:${emp.id}`);
              this.setStatus(cmdResult?.output ?? '');
            },
          });
        });
        row.appendChild(useBtn);
      } else {
        row.appendChild(el('span', {
          text: t('ui.shady.frame_pending', { ticks: frame.readyTick - state.tickCount }),
          attrs: { style: 'font:400 10px/1 var(--bsx-font-mono);color:var(--bsx-text-muted)' },
        }));
      }
      children.push(row);
    }

    const framedIds = new Set(state.mafia.pendingFrames.map(f => f.employeeId));
    const eligible = state.employees.employees.filter(e => e.alive && !framedIds.has(e.id));
    const select = this.employeeSelect(eligible);
    select.dataset['action'] = 'mafia-frame-employee';
    const startBtn = button('ghost', t('ui.shady.frame_start_button'), { dataAction: 'mafia-frame-start' });
    startBtn.disabled = eligible.length === 0 || cash < FRAME_COST;
    startBtn.addEventListener('click', () => {
      const empId = Number(select.value);
      const emp = eligible.find(e => e.id === empId);
      if (!emp) return;
      this.onConfirmRequestCb?.({
        icon: 'gavel',
        title: t('ui.shady.frame_start_confirm_title'),
        body: t('ui.shady.frame_start_confirm_body', { name: emp.name, cost: FRAME_COST.toLocaleString('en-US'), ticks: FRAME_EVIDENCE_TICKS }),
        confirmLabel: t('ui.shady.frame_start_button'),
        onConfirm: () => {
          const cmdResult = this.gameConsole?.(`mafia frame employee:${emp.id}`);
          this.setStatus(cmdResult?.output ?? '');
        },
      });
    });
    children.push(el('div', { attrs: { style: 'display:flex;gap:6px' }, children: [select, startBtn] }));

    return card(children);
  }

  private employeeSelect(employees: readonly { id: number; name: string }[]): HTMLSelectElement {
    const select = el('select', { attrs: { style: 'flex:1;height:30px;border-radius:4px;background:var(--bsx-well);border:1px solid var(--bsx-hairline);color:var(--bsx-text-primary);font:400 10px/1 var(--bsx-font-ui)' } });
    if (employees.length === 0) {
      select.appendChild(el('option', { text: t('ui.shady.no_employees'), attrs: { value: '' } }));
      select.disabled = true;
      return select;
    }
    select.appendChild(el('option', { text: t('ui.shady.select_employee'), attrs: { value: '' } }));
    for (const emp of employees) {
      select.appendChild(el('option', { text: `${emp.name} #${emp.id}`, attrs: { value: String(emp.id) } }));
    }
    return select;
  }
}
