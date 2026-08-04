// BlastSimulator2026 — Blast Workshop: Charge step (redesign P4)
// Interim stub: one explosive picker + amount/stemming steppers + Charge All,
// enough to keep the tutorial's charge flow working. Task P4/#23 replaces
// this with the designed product-card list and the tubing block.

import { el, stepper, card } from '../../dom.js';
import { LocaleTextRegistry } from '../../localeText.js';
import { getAllExplosives, getExplosive } from '../../../core/world/ExplosiveCatalog.js';
import type { CommandResult } from '../../../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

const DEFAULT_EXPLOSIVE = 'boomite';
const DEFAULT_AMOUNT_KG = 5;
const DEFAULT_STEMMING_M = 2;

export class ChargeStep {
  private readonly el: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly amountValueEl: HTMLElement;
  private readonly stemmingValueEl: HTMLElement;
  private gameConsole?: GameConsoleFn;
  private amountKg = DEFAULT_AMOUNT_KG;
  private stemmingM = DEFAULT_STEMMING_M;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div');
    this.el.style.cssText = 'display:flex;flex-direction:column;gap:10px';

    const sectionEl = el('div', { className: 'bsx-section' });
    sectionEl.append(
      this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.charge.section'),
      el('span', { className: 'bsx-section-rule' }),
    );
    this.el.appendChild(sectionEl);

    this.select = el('select');
    this.select.style.cssText = 'height:32px;border:1px solid var(--bsx-hairline-strong);border-radius:var(--bsx-r-control);background:var(--bsx-well);color:var(--bsx-text-primary);padding:0 8px;font:600 12px/1 var(--bsx-font-ui)';
    for (const explosive of getAllExplosives()) {
      const opt = this.locale.bindText(el('option', { attrs: { value: explosive.id } }), explosive.nameKey);
      this.select.appendChild(opt);
    }
    this.select.value = DEFAULT_EXPLOSIVE;
    this.select.addEventListener('change', () => this.clampAmount());

    const amountStepperEl = stepper(`${this.amountKg} kg`, () => this.adjustAmount(-1), () => this.adjustAmount(1));
    this.amountValueEl = amountStepperEl.querySelector('.bsx-stepper-value') as HTMLElement;
    const stemmingStepperEl = stepper(`${this.stemmingM.toFixed(1)} m`, () => this.adjustStemming(-0.5), () => this.adjustStemming(0.5));
    this.stemmingValueEl = stemmingStepperEl.querySelector('.bsx-stepper-value') as HTMLElement;

    const fieldLabelStyle = 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-muted)';
    const amountField = el('div', { children: [
      this.locale.bindText(el('span', { attrs: { style: fieldLabelStyle } }), 'ui.blast_workshop.charge.amount'),
      amountStepperEl,
    ] });
    amountField.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    const stemmingField = el('div', { children: [
      this.locale.bindText(el('span', { attrs: { style: fieldLabelStyle } }), 'ui.blast_workshop.charge.stemming'),
      stemmingStepperEl,
    ] });
    stemmingField.style.cssText = 'display:flex;flex-direction:column;gap:4px';

    const chargeAllBtn = el('button', { className: 'bsx-btn bsx-btn-primary' });
    this.locale.bindText(chargeAllBtn, 'ui.blast_workshop.charge.charge_all');
    chargeAllBtn.dataset['action'] = 'charge-all';
    chargeAllBtn.addEventListener('click', () => this.chargeAll());

    this.el.appendChild(card([
      this.locale.bindText(el('span', { attrs: { style: fieldLabelStyle } }), 'ui.blast_workshop.charge.explosive'),
      this.select,
      amountField,
      stemmingField,
      chargeAllBtn,
    ]));

    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  refreshLocale(): void { this.locale.refresh(); }

  private clampAmount(): void {
    const explosive = getExplosive(this.select.value);
    if (!explosive) return;
    this.amountKg = Math.max(explosive.minChargeKg, Math.min(explosive.maxChargeKg, this.amountKg));
    this.amountValueEl.textContent = `${this.amountKg} kg`;
  }

  private adjustAmount(delta: number): void {
    const explosive = getExplosive(this.select.value);
    const max = explosive?.maxChargeKg ?? 100;
    const min = explosive?.minChargeKg ?? 1;
    this.amountKg = Math.max(min, Math.min(max, this.amountKg + delta));
    this.amountValueEl.textContent = `${this.amountKg} kg`;
  }

  private adjustStemming(delta: number): void {
    this.stemmingM = Math.max(0, +(this.stemmingM + delta).toFixed(1));
    this.stemmingValueEl.textContent = `${this.stemmingM.toFixed(1)} m`;
  }

  private chargeAll(): void {
    this.gameConsole?.(`charge hole:* explosive:${this.select.value} amount:${this.amountKg}kg stemming:${this.stemmingM}m`);
  }
}
