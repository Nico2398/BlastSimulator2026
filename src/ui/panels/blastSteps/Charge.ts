// BlastSimulator2026 — Blast Workshop: Charge step (redesign P4)
// Product-card explosive picker, amount/stemming steppers, Charge All, and
// the tubing block (buy stock, install on every wet hole at once).
//
// Deliberate deviation from the design mock: there, clicking a product card
// immediately charges every hole with it (identical to pressing CHARGE ALL —
// the mock treats them as one interaction). Here a card click only *selects*
// a product; CHARGE ALL is the one explicit commit. A row that looks like
// "browse the catalog" silently reflashing every hole's charge is a bad
// surprise, and per-hole charging isn't a feature here anyway, so nothing is
// lost by requiring the extra click.
//
// Also omitted vs. the mock: locking a product by "site rock tier" — the
// mock's single site-wide rock tier has no real-data equivalent (rock is
// per-voxel; holes can sit over different rock), so gating would need new
// plumbing (grid access no panel currently has) for a comparison the design
// doc doesn't specify how to make. All 8 explosives stay selectable; the
// water-sensitivity badge still surfaces (that data is real and per-hole
// derivable via wetHoles()).

import { t } from '../../../core/i18n/I18n.js';
import { el, stepper, sectionHeader, reasonLine, button } from '../../dom.js';
import { iconEl } from '../../icons.js';
import { LocaleTextRegistry } from '../../localeText.js';
import { getAllExplosives, getExplosive, type ExplosiveType } from '../../../core/world/ExplosiveCatalog.js';
import { wetHoles } from '../../../core/mining/WetHoles.js';
import { TUBING_COST } from '../../../core/mining/Tubing.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import type { GameState } from '../../../core/state/GameState.js';
import type { WeatherState } from '../../../core/weather/WeatherCycle.js';
import type { CommandResult } from '../../../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

const DEFAULT_EXPLOSIVE = 'boomite';
const DEFAULT_AMOUNT_KG = 5;
const DEFAULT_STEMMING_M = 2;
const TUBING_BUY_AMOUNT = 10;

export class ChargeStep {
  private readonly el: HTMLElement;
  private readonly productListEl: HTMLElement;
  private readonly amountValueEl: HTMLElement;
  private readonly stemmingValueEl: HTMLElement;
  private readonly chargeAllBtn: HTMLButtonElement;
  private readonly chargeLineEl: HTMLElement;
  private readonly tubingCardEl: HTMLElement;

  private gameConsole?: GameConsoleFn;
  private selectedExplosiveId = DEFAULT_EXPLOSIVE;
  private amountKg = DEFAULT_AMOUNT_KG;
  private stemmingM = DEFAULT_STEMMING_M;
  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div');
    this.el.style.cssText = 'display:flex;flex-direction:column;gap:10px';

    const productHeader = el('div', { className: 'bsx-section' });
    const productLabelEl = this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.charge.section');
    productHeader.append(productLabelEl, el('span', { className: 'bsx-section-rule' }));

    this.productListEl = el('div');
    // Bounded + independently scrollable: 8 catalog cards would otherwise
    // push Charge All and the tubing block below the panel's fold, out of
    // reach without the player first scrolling the whole step (#24 found
    // this the moment the step's own update() actually ran live — the
    // stub-era wiring gap had been masking it).
    this.productListEl.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:184px;overflow-y:auto';

    const fieldLabelStyle = 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-text-micro)';
    const amountStepperEl = stepper(`${this.amountKg} kg`, () => this.adjustAmount(-1), () => this.adjustAmount(1));
    this.amountValueEl = amountStepperEl.querySelector('.bsx-stepper-value') as HTMLElement;
    const stemmingStepperEl = stepper(`${this.stemmingM.toFixed(1)} m`, () => this.adjustStemming(-0.2), () => this.adjustStemming(0.2));
    this.stemmingValueEl = stemmingStepperEl.querySelector('.bsx-stepper-value') as HTMLElement;

    // data-field, same reasoning as ParamStrip.ts's grid spacing/depth
    // steppers (issue #479 follow-up, Finding #4): without it there is no
    // selector a click-only scenario/playtest step can target to reach an
    // exact amount/stemming before Charge All, so a declared
    // `charge ... amount:8 stemming:0` silently charged at the panel's
    // 5kg/2m defaults instead whenever the click never touched these.
    const amountField = el('div', { attrs: { 'data-field': 'amount' }, children: [
      this.locale.bindText(el('span', { attrs: { style: fieldLabelStyle } }), 'ui.blast_workshop.charge.amount'),
      amountStepperEl,
    ] });
    amountField.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px';
    const stemmingField = el('div', { attrs: { 'data-field': 'stemming' }, children: [
      this.locale.bindText(el('span', { attrs: { style: fieldLabelStyle } }), 'ui.blast_workshop.charge.stemming'),
      stemmingStepperEl,
    ] });
    stemmingField.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px';
    const stepperRow = el('div', { children: [amountField, stemmingField] });
    stepperRow.style.cssText = 'display:flex;gap:8px';

    this.chargeAllBtn = el('button', { className: 'bsx-btn bsx-btn-primary' });
    this.chargeAllBtn.style.cssText = 'flex-direction:column;gap:3px;height:auto;padding:9px';
    this.chargeAllBtn.dataset['action'] = 'charge-all';
    const chargeAllLabelEl = this.locale.bindText(
      el('span', { attrs: { style: 'font:800 11px/1 var(--bsx-font-ui);letter-spacing:.14em' } }),
      'ui.blast_workshop.charge.charge_all',
    );
    this.chargeLineEl = el('span', { className: 'bsx-mono', attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);opacity:.75' } });
    this.chargeAllBtn.append(chargeAllLabelEl, this.chargeLineEl);
    this.chargeAllBtn.addEventListener('click', () => this.chargeAll());

    const tubingHeader = sectionHeader(t('ui.blast_workshop.charge.tubing_section'));
    this.tubingCardEl = el('div');

    this.el.append(productHeader, this.productListEl, stepperRow, this.chargeAllBtn, tubingHeader, this.tubingCardEl);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
  }

  update(state: GameState, weather: WeatherState | undefined): void {
    const wet = weather ? wetHoles(state, weather) : [];
    const holeCount = state.drillHoles.length;

    const signature = JSON.stringify({
      selected: this.selectedExplosiveId, amt: this.amountKg, stem: this.stemmingM,
      holeCount, wet, tub: state.tubingState.inventory,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.renderProductList(wet.length > 0);
    this.updateChargeLine(holeCount);
    this.renderTubingCard(wet, state.tubingState.inventory);
  }

  dispose(): void { this.el.remove(); }

  private renderProductList(anyWet: boolean): void {
    this.productListEl.replaceChildren(...getAllExplosives().map(e => this.makeProductCard(e, anyWet)));
  }

  private makeProductCard(explosive: ExplosiveType, anyWet: boolean): HTMLElement {
    const selected = explosive.id === this.selectedExplosiveId;
    const card = el('button');
    card.style.cssText = [
      'display:flex', 'flex-direction:column', 'gap:5px', 'padding:9px 11px',
      `border:1px solid ${selected ? 'rgba(255,176,46,.55)' : 'var(--bsx-hairline)'}`,
      'border-radius:5px', `background:${selected ? 'rgba(255,176,46,.12)' : 'var(--bsx-card)'}`,
      'cursor:pointer', 'text-align:left',
    ].join(';');
    card.dataset['action'] = 'select-explosive';
    card.dataset['explosive'] = explosive.id;
    card.dataset['selected'] = String(selected);

    const nameRow = el('div');
    nameRow.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%';
    nameRow.append(
      iconEl('explosive', 14),
      el('span', { text: t(explosive.nameKey), attrs: { style: 'font:600 12px/1 var(--bsx-font-ui);color:var(--bsx-text-primary)' } }),
      el('span', {
        text: `$${explosive.costPerKg.toFixed(2)} / kg`,
        attrs: { style: 'margin-left:auto;font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-amber)' },
      }),
    );

    const statsRow = el('div');
    statsRow.style.cssText = 'display:flex;gap:10px;font:400 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)';
    statsRow.append(
      el('span', { text: `${explosive.energyPerKg} MJ/kg` }),
      el('span', { text: `${explosive.maxChargeKg} kg max` }),
    );
    if (explosive.waterSensitive && anyWet) {
      const badge = el('span', { attrs: { style: 'display:flex;align-items:center;gap:3px;color:var(--bsx-info)' } });
      badge.append(iconEl('water', 9), el('span', { text: t('ui.blast_workshop.charge.water_sensitive') }));
      statsRow.appendChild(badge);
    }

    card.append(nameRow, statsRow);
    card.addEventListener('click', () => {
      this.selectedExplosiveId = explosive.id;
      this.clampAmount();
      this.lastSignature = '';
      this.renderProductList(anyWet);
    });
    return card;
  }

  private updateChargeLine(holeCount: number): void {
    const explosive = getExplosive(this.selectedExplosiveId);
    const name = explosive ? t(explosive.nameKey) : this.selectedExplosiveId;
    const cost = explosive ? holeCount * this.amountKg * explosive.costPerKg : 0;
    this.chargeLineEl.textContent = t('ui.blast_workshop.charge.charge_line', {
      count: holeCount, amount: this.amountKg, name, cost: `$${formatMoney(cost)}`,
    });
  }

  private renderTubingCard(wetIds: string[], inventory: number): void {
    if (wetIds.length === 0) {
      this.tubingCardEl.replaceChildren(this.makeTubingSettledCard(inventory));
      return;
    }
    this.tubingCardEl.replaceChildren(this.makeTubingNeededCard(wetIds, inventory));
  }

  private makeTubingSettledCard(inventory: number): HTMLElement {
    const wrap = el('div');
    wrap.style.cssText = 'padding:11px;border:1px solid rgba(79,199,107,.28);border-radius:5px;background:rgba(79,199,107,.06);display:flex;align-items:center;gap:9px';
    const iconWrap = el('div', { attrs: { style: 'color:var(--bsx-positive)' }, children: [iconEl('check', 15)] });
    const copy = el('span', {
      text: t('ui.blast_workshop.charge.tubing_settled'),
      attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1' },
    });
    const stock = el('span', {
      text: t('ui.blast_workshop.charge.tubing_spare', { count: inventory }),
      attrs: { style: 'font:600 10px/1 var(--bsx-font-mono);color:var(--bsx-text-muted);white-space:nowrap' },
    });
    wrap.append(iconWrap, copy, stock);
    return wrap;
  }

  private makeTubingNeededCard(wetIds: string[], inventory: number): HTMLElement {
    const wrap = el('div');
    wrap.style.cssText = 'padding:11px;border:1px solid rgba(85,168,255,.28);border-radius:5px;background:rgba(85,168,255,.06);display:flex;flex-direction:column;gap:9px';

    const messageRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:9px' } });
    messageRow.append(
      el('div', { attrs: { style: 'color:var(--bsx-info)' }, children: [iconEl('water', 15)] }),
      el('span', {
        text: t('ui.blast_workshop.charge.tubing_needed', { count: wetIds.length }),
        attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1' },
      }),
    );

    const insufficientStock = inventory < wetIds.length;
    const actionRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' } });
    actionRow.appendChild(el('span', {
      text: t('ui.blast_workshop.charge.tubing_stock', { count: inventory }),
      attrs: { style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-text-muted)' },
    }));
    const buyBtn = button('ghost', t('ui.blast_workshop.charge.tubing_buy', { count: TUBING_BUY_AMOUNT, cost: `$${formatMoney(TUBING_BUY_AMOUNT * TUBING_COST)}` }), {
      dataAction: 'tubing-buy',
      onClick: () => this.buyTubing(),
    });
    buyBtn.style.height = '28px';
    const installBtn = el('button', {
      text: t('ui.blast_workshop.charge.tubing_install', { count: wetIds.length }),
    });
    installBtn.style.cssText = [
      'margin-left:auto', 'height:28px', 'padding:0 11px', 'border:0', 'border-radius:4px',
      `background:${insufficientStock ? '#2a323d' : 'var(--bsx-info)'}`,
      `color:${insufficientStock ? 'var(--bsx-text-disabled)' : '#06121f'}`,
      'font:700 10px/1 var(--bsx-font-ui)', 'letter-spacing:.09em',
      `cursor:${insufficientStock ? 'not-allowed' : 'pointer'}`,
    ].join(';');
    installBtn.dataset['action'] = 'tubing-install';
    if (insufficientStock) installBtn.disabled = true;
    installBtn.addEventListener('click', () => this.installTubing(wetIds));
    actionRow.append(buyBtn, installBtn);

    wrap.append(messageRow, actionRow);
    if (insufficientStock) {
      wrap.appendChild(reasonLine(t('ui.blast_workshop.charge.tubing_reason', { stock: inventory, wet: wetIds.length })));
    }
    return wrap;
  }

  private clampAmount(): void {
    const explosive = getExplosive(this.selectedExplosiveId);
    if (!explosive) return;
    this.amountKg = Math.max(explosive.minChargeKg, Math.min(explosive.maxChargeKg, this.amountKg));
    this.amountValueEl.textContent = `${this.amountKg} kg`;
  }

  private adjustAmount(delta: number): void {
    const explosive = getExplosive(this.selectedExplosiveId);
    const max = explosive?.maxChargeKg ?? 100;
    const min = explosive?.minChargeKg ?? 1;
    this.amountKg = Math.max(min, Math.min(max, this.amountKg + delta));
    this.amountValueEl.textContent = `${this.amountKg} kg`;
    this.lastSignature = '';
  }

  private adjustStemming(delta: number): void {
    this.stemmingM = Math.max(0.5, +(this.stemmingM + delta).toFixed(1));
    this.stemmingValueEl.textContent = `${this.stemmingM.toFixed(1)} m`;
    this.lastSignature = '';
  }

  private chargeAll(): void {
    this.gameConsole?.(`charge hole:* explosive:${this.selectedExplosiveId} amount:${this.amountKg}kg stemming:${this.stemmingM}m`);
  }

  private buyTubing(): void {
    this.gameConsole?.(`tubing buy amount:${TUBING_BUY_AMOUNT}`);
  }

  private installTubing(wetIds: string[]): void {
    for (const holeId of wetIds) this.gameConsole?.(`tubing install hole:${holeId}`);
  }
}
