// BlastSimulator2026 — Permit approval modal (#1926)
// Shown when the Ministry approves a mine-grade application: a stamped letter,
// the new grade's name and the unlock list. Visibility derives from
// state.grade.unseenApproval (cleared by `permit ack`), so a save taken while
// the letter is open reopens it on load with no extra code. The tick pipeline
// holds the clock while the letter is unseen.

import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
import { LocaleTextRegistry } from '../localeText.js';
import { gradeDef, unlockLinesFor } from '../../core/economy/MineGrade.js';
// Side-effect import: registers the permit-limits unlock line that unlockLinesFor lists,
// so the letter shows it regardless of which module happened to load PermitLimits first.
import '../../core/economy/PermitLimits.js';
import '../../core/economy/VehicleTierGate.js';
import type { GameState } from '../../core/state/GameState.js';
import type { GameConsoleFn } from '../gameConsole.js';

export class PermitApprovalModal {
  private readonly overlay: HTMLElement;
  private readonly gradeNameEl: HTMLElement;
  private readonly unlockListEl: HTMLElement;
  private readonly locale = new LocaleTextRegistry();
  private gameConsole?: GameConsoleFn;
  private shownGrade: number | null = null;

  constructor(container: HTMLElement) {
    this.overlay = el('div', { className: 'bs-confirm-overlay bs-permit-approval' });
    this.overlay.style.display = 'none';

    const box = el('div', { className: 'bs-permit-approval-letter' });
    
    const header = el('div', { className: 'bs-permit-approval-header' });
        header.append(
      this.locale.bindText(el('span', { attrs: { style: 'font:800 15px/1 var(--bsx-font-ui);letter-spacing:.08em;color:var(--bsx-amber)' } }), 'progression.approval.ministry'),
      this.locale.bindText(el('span', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-micro)' } }), 'progression.approval.letterhead'),
    );

    const body = el('div', { className: 'bs-permit-approval-body' });
        this.gradeNameEl = el('div', { className: 'bs-permit-approval-grade', });
    const stamp = this.locale.bindText(el('div', { className: 'bs-permit-approval-stamp' }), 'progression.approval.stamp');
    this.unlockListEl = el('ul', { className: 'bs-permit-approval-lines'});
    body.append(
      this.locale.bindText(el('p', { className: 'bs-permit-approval-text' }), 'progression.approval.greeting'),
      this.locale.bindText(el('p', { className: 'bs-permit-approval-text' }), 'progression.approval.body'),
      this.gradeNameEl,
      this.locale.bindText(el('div', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-micro)' } }), 'progression.approval.unlocks'),
      this.unlockListEl,
    );

    const dismiss = el('button', { className: 'bsx-btn bsx-btn-primary bs-btn bs-permit-approval-dismiss' });
        this.locale.bindText(dismiss, 'progression.approval.dismiss');
    dismiss.addEventListener('click', () => { this.gameConsole?.('permit ack'); });

    box.append(header, body, dismiss, stamp);
    this.overlay.appendChild(box);
    container.appendChild(this.overlay);
  }

  get root(): HTMLElement { return this.overlay; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  /** Opens while an approval is unseen, closes once acknowledged. */
  update(state: GameState): void {
    const grade = state.grade?.unseenApproval ?? null;
    if (grade === null) { this.hide(); return; }
    this.overlay.style.display = '';
    if (grade === this.shownGrade) return;
    this.shownGrade = grade;
    this.renderGrade(grade);
  }

  private renderGrade(grade: number): void {
    const def = gradeDef(grade);
    this.gradeNameEl.textContent = t(def.nameKey, def.nameParams);
    this.unlockListEl.replaceChildren(...unlockLinesFor(grade).map(line => el('li', { text: t(line.key, line.params) })));
  }

  private hide(): void {
    this.overlay.style.display = 'none';
    this.shownGrade = null;
  }

  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  /** Re-render locale-dependent text after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    if (this.shownGrade !== null) this.renderGrade(this.shownGrade);
  }

  dispose(): void { this.overlay.remove(); }
}
