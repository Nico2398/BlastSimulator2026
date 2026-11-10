// BlastSimulator2026 — Blast Workshop: Charge step (redesign P4)
// Product-card explosive picker, stemming stepper, Charge All, and
// the drain button and the tubing block (buy stock, install on every untubed hole at once).
//
// A hole is charged by filling it: the explosive runs from the bottom up to the stemming.
// The player chooses the explosive and the stemming; the kilograms per hole follow from the
// hole's depth, its bore and the explosive's density, and are shown, never stepped.
//
// Deliberate deviation from the design mock: there, clicking a product card
// immediately charges every hole with it (identical to pressing CHARGE ALL —
// the mock treats them as one interaction). Here a card click only *selects*
// a product; CHARGE ALL is the one explicit commit. A row that looks like
// "browse the catalog" silently reflashing every hole's charge is a bad
// surprise, so nothing is lost by requiring the extra click.
//
// Per-hole charging (gap G3): `charge hole:<id> …` is a real gameplay command
// and had no button at all — only CHARGE ALL — so a player could never charge
// one hole differently from the rest, while the console could. ChargeHoleList
// closes that; this step feeds it the panel's current product / stemming
// values and dispatches for the one hole whose row was clicked.
//
// Only the active level's explosives are offered (resolveAvailableExplosives);
// the water-sensitivity badge still surfaces (that data is real and per-hole
// derivable via wetHoles()).

import type { DrillHole } from '../../../core/mining/DrillPlan.js';
import { t } from '../../../core/i18n/I18n.js';
import { stemmingExplain } from '../../blastWorkshopExplain.js';
import { el, stepper, reasonLine, button, scrollBoundedSection, explainable } from '../../dom.js';
import { iconEl } from '../../icons.js';
import { LocaleTextRegistry } from '../../localeText.js';
import { ChargeHoleList, holeChargeSignature, drainReasonText, drainRainReasonText, type HoleDrainView } from './ChargeHoleList.js';
import { fillChargeKg } from '../../../core/mining/ChargePlan.js';
import { quoteChargeLoad } from '../../../core/mining/ChargeLoad.js';
import { getAllExplosives, getExplosive, type ExplosiveType } from '../../../core/world/ExplosiveCatalog.js';
import { resolveAvailableExplosives } from '../../../core/campaign/Level.js';
import { chargeKgPerMetre } from '../../../core/mining/HoleDiameter.js';
import { rainWithinTicks } from '../../../core/weather/WeatherCycle.js';
import { rainExposedHoles, wetHoles } from '../../../core/mining/WetHoles.js';
import { drainBlockReason } from '../../../core/mining/HoleDrain.js';
import { TUBING_COST, hasTubing } from '../../../core/mining/Tubing.js';
import { MIN_STEMMING_M, CHARGE_DEFAULT_STEMMING_M, HOLE_DRAIN_COST_PER_HOLE, DRILL_HOLE_DEFAULT_DIAMETER_M, TICKS_PER_DAY } from '../../../core/config/balance.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { defaultStemmingM } from '../../../core/economy/PermitDefaults.js';
import type { WeatherState } from '../../../core/weather/WeatherCycle.js';
import type { VoxelGrid } from '../../../core/world/VoxelGrid.js';
import type { GameState } from '../../../core/state/GameState.js';
import { permitPreview, chargeKgLimitWarning } from '../permitPreview.js';
import type { GameConsoleFn } from '../../gameConsole.js';
import { bandMixEl } from '../../bandMix.js';
import { ChargeReadouts } from './chargeReadouts.js';
import { ChargeOptimizerBlock } from './chargeOptimizerBlock.js';


const DEFAULT_EXPLOSIVE = 'boomite';
/** Stemming stepper increment (m); 0.1 keeps 2.5 and whole-metre values reachable. */
const STEMMING_STEP_M = 0.1;
const TUBING_BUY_AMOUNT = 10;

/** Explosive the step preselects: the pattern's, else the default (#2016). */
function preferredExplosiveId(
  patternExplosiveId: string | undefined,
  allowedIds: readonly string[],
): string | undefined {
  if (patternExplosiveId !== undefined && allowedIds.includes(patternExplosiveId)) return patternExplosiveId;
  return allowedIds.includes(DEFAULT_EXPLOSIVE) ? DEFAULT_EXPLOSIVE : allowedIds[0];
}

export class ChargeStep {
  private readonly el: HTMLElement;
  private readonly productListEl: HTMLElement;
  /** Kilograms each hole will hold, filled up to the stemming (read-only). */
  private readonly perHoleValueEl: HTMLElement;
  private readonly stemmingValueEl: HTMLElement;
  private readonly chargeAllBtn: HTMLButtonElement;
  private readonly chargeLineEl: HTMLElement;
  private readonly fitLineEl: HTMLElement;
  private readonly capacityLineEl: HTMLElement;
  private readonly patternLineEl: HTMLElement;
  private readonly paidOnFillEl: HTMLElement;
  private readonly noticeEl: HTMLElement;
  /** Projected plan kg against the permit, and the over-permit warning (#2167). */
  private readonly permitKgEl: HTMLElement;
  private readonly permitKgWarningEl: HTMLElement;
  private readonly holeList: ChargeHoleList;
  /** Tier-4 charge optimizer: button, locked hint and the proposal (#2204). */
  private readonly optimizer: ChargeOptimizerBlock;
  private readonly tubingCardEl: HTMLElement;
  private readonly drainEl: HTMLElement;

  private gameConsole?: GameConsoleFn;
  private gridProvider: () => VoxelGrid | null = () => null;
  private readonly readouts = new ChargeReadouts();
  private selectedExplosiveId = DEFAULT_EXPLOSIVE;
  /** Set by a card click; stops the pattern from overriding the player's choice. */
  private playerPickedExplosive = false;
  private allowedIds: readonly string[] = resolveAvailableExplosives(null);
  private stemmingM = CHARGE_DEFAULT_STEMMING_M;
  /** False until the player steps the stemming: until then it follows the permit (#2101). */
  private playerAdjustedStemming = false;
  /** Diameter (m) of the narrowest drilled hole, for the per-metre capacity line (#1934). */
  private narrowestM = DRILL_HOLE_DEFAULT_DIAMETER_M;
  private readonly stemmingLabelEl: HTMLElement;
  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div');
    this.el.style.cssText = 'display:flex;flex-direction:column;gap:10px';

    const productHeader = el('div', { className: 'bsx-section' });
    const productLabelEl = this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.charge.section');
    productHeader.append(productLabelEl, el('span', { className: 'bsx-section-rule' }));

    // Bounded + independently scrollable: 8 catalog cards would otherwise
    // push Charge All and the tubing block below the panel's fold, out of
    // reach without the player first scrolling the whole step (#24 found
    // this the moment the step's own update() actually ran live — the
    // stub-era wiring gap had been masking it).
    this.productListEl = scrollBoundedSection([], 184, { gap: 4 });

    const fieldLabelStyle = 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-text-micro)';
    const stemmingStepperEl = stepper(`${this.stemmingM.toFixed(1)} m`, () => this.adjustStemming(-STEMMING_STEP_M), () => this.adjustStemming(STEMMING_STEP_M));
    this.stemmingValueEl = stemmingStepperEl.querySelector('.bsx-stepper-value') as HTMLElement;

    // Read-only: a hole holds what fills it up to the stemming. data-role for tests and scenarios.
    this.perHoleValueEl = el('div', { className: 'bsx-mono', attrs: { 'data-role': 'charge-per-hole', style: 'height:32px;display:flex;align-items:center;font:600 13px/1 var(--bsx-font-mono);color:var(--bsx-text-primary)' } });
    const perHoleField = el('div', { children: [
      explainable(
        this.locale.bindText(el('span', { attrs: { style: fieldLabelStyle } }), 'ui.blast_workshop.charge.per_hole'),
        t('ui.blast_workshop.charge.per_hole_explain'),
      ),
      this.perHoleValueEl,
    ] });
    perHoleField.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px';
    this.stemmingLabelEl = explainable(
      this.locale.bindText(el('span', { attrs: { style: fieldLabelStyle } }), 'ui.blast_workshop.charge.stemming'),
      stemmingExplain(),
    );
    // data-field, same reasoning as ParamStrip.ts's grid spacing/depth steppers (#479 follow-up):
    // a click-only scenario step needs a selector to reach an exact stemming before Charge All.
    const stemmingField = el('div', { attrs: { 'data-field': 'stemming' }, children: [
      this.stemmingLabelEl,
      stemmingStepperEl,
    ] });
    stemmingField.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px';
    const stepperRow = el('div', { children: [stemmingField, perHoleField] });
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

    this.fitLineEl = el('div');
    this.capacityLineEl = el('div', { attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' } });
    this.capacityLineEl.dataset['info'] = 'hole-capacity';
    this.patternLineEl = el('div');
    this.paidOnFillEl = el('div', { attrs: { style: 'font:500 10px/1.4 var(--bsx-font-ui);color:var(--bsx-amber)' } });
    this.paidOnFillEl.dataset['info'] = 'paid-on-fill';
    this.permitKgEl = el('div', { attrs: { style: 'font:500 11px/1.4 var(--bsx-font-mono);color:var(--bsx-text-muted)' } });
    this.permitKgEl.dataset['role'] = 'permit-kg';
    this.permitKgWarningEl = el('div', { attrs: { style: 'font:500 11px/1.4 var(--bsx-font-ui);color:var(--bsx-amber)' } });
    this.permitKgWarningEl.dataset['role'] = 'permit-kg-warning';
    this.noticeEl = el('div');
    this.noticeEl.style.display = 'none';
    this.optimizer = new ChargeOptimizerBlock(cmd => this.runAndNotify(cmd));
    this.holeList = new ChargeHoleList(holeId => this.chargeHole(holeId), holeId => this.runAndNotify(`drain_hole hole:${holeId}`));

    const tubingHeader = el('div', { className: 'bsx-section' });
    tubingHeader.append(this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.charge.tubing_section'), el('span', { className: 'bsx-section-rule' }));
    this.tubingCardEl = el('div');
    this.drainEl = el('div');

    // fitLineEl must stay the button's next sibling: the #1361 scenario reads it via `charge-all + div`.
    this.el.append(
      productHeader, this.productListEl, this.capacityLineEl, stepperRow, this.chargeAllBtn, this.fitLineEl, this.noticeEl, this.optimizer.root, this.patternLineEl, this.paidOnFillEl, this.permitKgEl, this.permitKgWarningEl,
      this.holeList.root, this.drainEl, tubingHeader, this.tubingCardEl,
    );
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  /** Grid the cards and hole rows read their predicted band mix from (#2203). */
  setGridProvider(fn: () => VoxelGrid | null): void {
    this.gridProvider = fn;
    this.lastSignature = '';
  }

  refreshLocale(): void {
    this.locale.refresh();
    explainable(this.stemmingLabelEl, stemmingExplain());
    const perHoleLabel = this.perHoleValueEl.parentElement?.firstElementChild;
    if (perHoleLabel instanceof HTMLElement) explainable(perHoleLabel, t('ui.blast_workshop.charge.per_hole_explain'));
    this.holeList.refreshLocale();
    this.lastSignature = '';
  }

  update(state: GameState, _weather?: WeatherState): void {
    const wet = wetHoles(state);
    const holes = state.drillHoles;
    this.narrowestM = holes.length > 0 ? Math.min(...holes.map(h => h.diameter)) : DRILL_HOLE_DEFAULT_DIAMETER_M;

    this.allowedIds = resolveAvailableExplosives(state.campaign.activeLevelId);
    if (this.playerPickedExplosive && !this.allowedIds.includes(this.selectedExplosiveId)) this.playerPickedExplosive = false;
    // Deliberately re-run on every update until the player clicks: the step instance outlives Continue/load, so the preselection follows the live pattern.
    if (!this.playerPickedExplosive) {
      const preferred = preferredExplosiveId(state.patternCharge?.explosiveId, this.allowedIds);
      if (preferred !== undefined) this.selectedExplosiveId = preferred;
    }
    this.followPermitDefault(state);

    // Every hole is filled up to the stemming: what each holds follows from its depth and bore.
    const fills = holes.map(h => fillChargeKg(h.depth, this.stemmingM, h.diameter, this.selectedExplosiveId));
    const noRoom = holes.filter((_, i) => !(fills[i]! > 0));
    const shallowest = holes.reduce<DrillHole | null>((a, h) => (a === null || h.depth < a.depth ? h : a), null);

    const tubed = holes.filter(h => hasTubing(state.tubingState, h.id)).map(h => h.id);
    const tubedSet = new Set(tubed);
    const untubed = holes.filter(h => !tubedSet.has(h.id)).map(h => h.id);
    const wetSet = new Set(wet);
    const exposedSet = new Set(rainExposedHoles(state));
    const rainSoon = rainWithinTicks(state.weather, TICKS_PER_DAY, state.mineType);
    const drainViews: Record<string, HoleDrainView> = {};
    for (const h of holes) {
      drainViews[h.id] = {
        wet: wetSet.has(h.id),
        block: drainBlockReason(state.holeWater[h.id], tubedSet.has(h.id), state.cash),
        rainExposed: exposedSet.has(h.id),
      };
    }

    // Explosives are bought as each hole is loaded, at list price and the live event factor (#2153).
    const chargeCost = fills.reduce((sum, kg) => sum + (kg > 0 ? quoteChargeLoad(state, this.selectedExplosiveId, kg).cost : 0), 0);
    const projectedKg = fills.reduce((sum, kg) => sum + Math.max(0, kg), 0);
    this.readouts.begin(holes, wet, this.gridProvider());
    const signature = JSON.stringify({
      grid: this.readouts.revision,
      holeGeometry: holes.map(h => [h.x, h.z, h.depth, h.diameter]),
      level: state.campaign.activeLevelId,
      selected: this.selectedExplosiveId, stem: this.stemmingM,
      permitGrade: state.grade?.grade ?? null,
      tier: state.softwareTier,
      // Hole ids *and* their charges, not just a count: a per-hole charge
      // changes neither the hole list nor anything else in the signature, so a
      // count-only signature would leave the row it was fired from stale.
      holes: holes.map(h => h.id),
      charges: holes.map(h => holeChargeSignature(state.chargesByHole[h.id])),
      planned: holes.map(h => holeChargeSignature(state.plannedChargesByHole[h.id])),
      fills,
      planned_holes: state.plannedDrillHoles.length,
      pattern: state.patternCharge ? JSON.stringify(state.patternCharge) : null,
      wet, tubed, tub: state.tubingState.inventory,
      // Water levels (as percent) so the panel repaints while water fades, plus drain affordability.
      water: holes.map(h => Math.round((state.holeWater[h.id]?.level ?? 0) * 100)),
      drainBlocks: holes.map(h => drainViews[h.id]!.block),
      rainExposed: [...exposedSet], rainSoon,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.renderProductList(wet.length > 0);
    this.updatePerHole(fills);
    this.updateChargeLine(holes.length, fills, chargeCost);
    this.updatePermitKg(state, projectedKg);
    this.updateCapacityLine();
    this.updateFitLine(noRoom.length > 0 ? shallowest : null, holes.length + state.plannedDrillHoles.length === 0);
    this.updatePatternLines(state);
    this.optimizer.render(state, this.gridProvider());
    this.holeList.render(
      holes, state.chargesByHole, state.plannedChargesByHole, drainViews,
      this.readouts.rows(state.chargesByHole, this.selectedExplosiveId),
    );
    this.renderDrain(wet, drainViews);
    this.renderTubingCard(untubed, wet.filter(id => !tubedSet.has(id)).length, tubed.length === holes.length && wet.length === 0, state.tubingState.inventory, rainSoon);
  }

  dispose(): void { this.el.remove(); }

  private renderProductList(anyWet: boolean): void {
    const offered = getAllExplosives().filter(e => this.allowedIds.includes(e.id));
    this.productListEl.replaceChildren(...offered.map(e => this.makeProductCard(e, anyWet)));
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

    // What one metre of this bore holds: the density sets the kilograms, kilograms x energy the punch.
    const kgPerMetre = chargeKgPerMetre(this.narrowestM, explosive.id);
    const statsRow = el('div');
    statsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px 10px;font:400 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)';
    statsRow.append(
      el('span', { text: t('ui.blast_workshop.charge.energy_label', { value: explosive.energyPerKg }) }),
      explainable(
        el('span', { attrs: { 'data-role': 'explosive-per-metre' }, text: t('ui.blast_workshop.charge.per_metre_card', {
          kg: +kgPerMetre.toFixed(1),
          // In the card's own energy units (Energy N/kg): N x kg/m, so the two figures multiply out.
          energy: formatMoney(Math.round(kgPerMetre * explosive.energyPerKg)),
        }) }),
        t('ui.blast_workshop.charge.per_metre_explain', { density: explosive.density, diameter: Math.round(this.narrowestM * 1000) }),
      ),
      el('span', { text: t('ui.blast_workshop.charge.vibration', { value: explosive.vibrationMod }) }),
    );
    if (explosive.waterSensitive) {
      const badge = el('span', { attrs: { 'data-role': 'water-badge', style: `display:flex;align-items:center;gap:3px;color:${anyWet ? 'var(--bsx-info)' : 'var(--bsx-text-secondary)'}` } });
      badge.append(iconEl('water', 9), el('span', { text: t('ui.blast_workshop.charge.water_sensitive') }));
      statsRow.appendChild(badge);
    }

    card.append(nameRow, statsRow);
    const mix = this.readouts.cardMix(explosive.id, this.stemmingM);
    if (mix) card.appendChild(bandMixEl(mix, 'explosive-band-mix'));
    card.addEventListener('click', () => {
      this.selectedExplosiveId = explosive.id;
      this.playerPickedExplosive = true;
      this.lastSignature = '';
      this.renderProductList(anyWet);
    });
    return card;
  }

  /** Per-metre capacity of the narrowest hole for the selected explosive, so a wider bore's bigger charge is visible (#1934). */
  private updateCapacityLine(): void {
    const explosive = getExplosive(this.selectedExplosiveId);
    this.capacityLineEl.textContent = t('ui.blast_workshop.charge.hole_capacity', {
      diameter: Math.round(this.narrowestM * 1000),
      kgPerMetre: +chargeKgPerMetre(this.narrowestM, this.selectedExplosiveId).toFixed(2),
      explosive: explosive ? t(explosive.nameKey) : this.selectedExplosiveId,
    });
  }

  /** "11 kg", or the spread "7.5–11 kg" when the holes differ in depth or bore; "—" without holes. */
  private updatePerHole(fills: readonly number[]): void {
    this.perHoleValueEl.textContent = kgSpreadText(fills);
  }

  /** Warns, never blocks: Charge All stays enabled when the projected plan is over the permit (#2167). */
  private updatePermitKg(state: GameState, projectedKg: number): void {
    const preview = permitPreview(state.grade, { holes: [], charges: { total: { amountKg: projectedKg } } }, state.tickCount);
    this.permitKgEl.textContent = preview ? preview.kgText : '';
    this.permitKgWarningEl.textContent = chargeKgLimitWarning(state.grade, projectedKg, state.tickCount) ?? '';
  }

  private updateChargeLine(holeCount: number, fills: readonly number[], cashCost: number): void {
    const explosive = getExplosive(this.selectedExplosiveId);
    const name = explosive ? t(explosive.nameKey) : this.selectedExplosiveId;
    this.chargeLineEl.textContent = t('ui.blast_workshop.charge.charge_line', {
      count: holeCount, amount: kgSpreadText(fills).replace(/ kg$/, ''), name, cost: `$${formatMoney(cashCost)}`,
    });
    // Estimate only: nothing is paid until a blaster loads each hole (#2143).
    this.paidOnFillEl.textContent = cashCost > 0 ? t('ui.blast_workshop.charge.paid_on_fill') : '';
  }

  // Stemming leaving no room for explosive in a hole: say why and block Charge All.
  // The stepper is left alone so the player sees what they asked for.
  private updateFitLine(noRoomHole: DrillHole | null, noHoles: boolean): void {
    this.chargeAllBtn.disabled = noRoomHole !== null || noHoles;
    if (noHoles) {
      this.fitLineEl.replaceChildren(reasonLine(t('ui.blast_workshop.charge.no_holes_reason')));
      return;
    }
    if (noRoomHole === null) {
      this.fitLineEl.replaceChildren();
      return;
    }
    this.fitLineEl.replaceChildren(reasonLine(t('ui.blast_workshop.charge.no_room_reason', { depth: noRoomHole.depth, stemming: this.stemmingM })));
  }

  // Pattern settings (#1345) and, when set, why some holes are waiting for cash.
  private updatePatternLines(state: GameState): void {
    const pattern = state.patternCharge;
    if (pattern == null) {
      this.patternLineEl.replaceChildren();
    } else {
      const explosive = getExplosive(pattern.explosiveId);
      const name = explosive ? t(explosive.nameKey) : pattern.explosiveId;
      const text = pattern.amountKg === null
        ? t('ui.blast_workshop.charge.pattern_line_fill', { explosive: name, stemming: pattern.stemmingM })
        : t('ui.blast_workshop.charge.pattern_line', { explosive: name, amount: pattern.amountKg, stemming: pattern.stemmingM });
      const line = el('div', { text, attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } });
      line.dataset['info'] = 'pattern-charge';
      this.patternLineEl.replaceChildren(line);
    }
  }

  // One drain-all button; disabled with a visible reason when nothing is wet or a wet untubed hole sits in porous rock.
  private renderDrain(wetIds: string[], views: Readonly<Record<string, HoleDrainView>>): void {
    if (Object.keys(views).length === 0) {
      this.drainEl.replaceChildren();
      return;
    }
    const porousBlocked = wetIds.some(id => views[id]?.block === 'porous_untubed');
    // Nothing wet is a neutral state, not a problem: the button sits disabled and the reason is only its tooltip.
    const disabled = wetIds.length === 0 || porousBlocked;
    const reason = porousBlocked ? drainReasonText('porous_untubed') : null;
    const btn = button('ghost', t('ui.blast_workshop.charge.drain_holes', { count: wetIds.length, cost: `$${formatMoney(wetIds.length * HOLE_DRAIN_COST_PER_HOLE)}` }), {
      dataAction: 'drain-holes',
      onClick: () => this.runAndNotify('drain_hole hole:*'),
    });
    btn.disabled = disabled;
    if (wetIds.length === 0) btn.title = drainReasonText('dry');
    const rainExposed = !disabled && wetIds.some(id => views[id]?.rainExposed === true);
    const rainLine = rainExposed ? reasonLine(drainRainReasonText()) : null;
    if (rainLine) rainLine.dataset['role'] = 'drain-rain-reason';
    this.drainEl.replaceChildren(btn, ...(reason !== null ? [reasonLine(reason)] : []), ...(rainLine ? [rainLine] : []));
  }

  private renderTubingCard(untubedIds: string[], wetUntubed: number, settled: boolean, inventory: number, rainSoon: boolean): void {
    if (untubedIds.length > 0) {
      this.tubingCardEl.replaceChildren(this.makeTubingNeededCard(untubedIds, wetUntubed, inventory, rainSoon));
    } else if (settled) {
      this.tubingCardEl.replaceChildren(this.makeTubingSettledCard(inventory));
    } else {
      this.tubingCardEl.replaceChildren();
    }
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

  private makeTubingNeededCard(untubedIds: string[], wetUntubed: number, inventory: number, rainSoon: boolean): HTMLElement {
    const wrap = el('div');
    wrap.style.cssText = 'padding:11px;border:1px solid rgba(85,168,255,.28);border-radius:5px;background:rgba(85,168,255,.06);display:flex;flex-direction:column;gap:9px';

    const messageRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:9px' } });
    messageRow.append(
      el('div', { attrs: { style: 'color:var(--bsx-info)' }, children: [iconEl('water', 15)] }),
      el('span', {
        text: wetUntubed > 0
          ? t(wetUntubed === 1 ? 'ui.blast_workshop.charge.tubing_needed_one' : 'ui.blast_workshop.charge.tubing_needed', { count: wetUntubed })
          : t(untubedIds.length === 1 ? 'ui.blast_workshop.charge.tubing_ahead_one' : 'ui.blast_workshop.charge.tubing_ahead', { count: untubedIds.length }),
        attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1' },
      }),
    );

    const insufficientStock = inventory < untubedIds.length;
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
      text: t('ui.blast_workshop.charge.tubing_install', { count: untubedIds.length }),
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
    installBtn.addEventListener('click', () => this.installTubing(untubedIds));
    actionRow.append(buyBtn, installBtn);

    wrap.append(messageRow, actionRow);
    // A shortage is a warning only while water is a threat: a wet hole, or rain within the day (#2149).
    if (insufficientStock && (wetUntubed > 0 || rainSoon)) {
      wrap.appendChild(reasonLine(t(untubedIds.length === 1 ? 'ui.blast_workshop.charge.tubing_reason_one' : 'ui.blast_workshop.charge.tubing_reason', { stock: inventory, need: untubedIds.length })));
    }
    return wrap;
  }

  /** Until the player steps the stemming, open at the permit-derived default for the planned and drilled holes (#2101). */
  private followPermitDefault(state: GameState): void {
    if (this.playerAdjustedStemming) return;
    const stemming = defaultStemmingM(state.grade?.grade, [...state.drillHoles, ...state.plannedDrillHoles], this.selectedExplosiveId);
    if (stemming === this.stemmingM) return;
    this.stemmingM = stemming;
    this.stemmingValueEl.textContent = `${this.stemmingM.toFixed(1)} m`;
  }

  private adjustStemming(delta: number): void {
    this.playerAdjustedStemming = true;
    this.stemmingM = Math.max(MIN_STEMMING_M, +(this.stemmingM + delta).toFixed(1));
    this.stemmingValueEl.textContent = `${this.stemmingM.toFixed(1)} m`;
    this.lastSignature = '';
  }

  /** Fill every hole up to the stemming with the selected explosive. */
  private chargeAll(): void {
    this.runAndNotify(`charge hole:* explosive:${this.selectedExplosiveId} stemming:${this.stemmingM}m`);
  }

  /** Run a command and show its output on refusal, so a refusal is never silent (#1345). */
  private runAndNotify(cmd: string): void {
    const res = this.gameConsole?.(cmd);
    const refused = res !== undefined && !res.success && res.output !== '';
    this.noticeEl.replaceChildren(...(refused ? [reasonLine(res.output)] : []));
    this.noticeEl.style.display = refused ? 'block' : 'none';
    this.lastSignature = '';
  }

  // Same two panel values Charge All reads, one hole instead of `*`. The
  // list is re-rendered from the next update()'s real state (charge success is
  // the core's call, not this panel's), so the signature is cleared rather
  // than the row being repainted optimistically here.
  private chargeHole(holeId: string): void {
    this.gameConsole?.(`charge hole:${holeId} explosive:${this.selectedExplosiveId} stemming:${this.stemmingM}m`);
    this.lastSignature = '';
  }

  // `buy` / `install_tubing`, not `tubing buy` / `tubing install`: there is no
  // `tubing` command in the registry (createRunner.ts:150,153 register the two
  // verbs separately and pass the subcommand in themselves). Both buttons sent
  // the non-existent form and silently did nothing — the runner answers
  // `Unknown command: "tubing"`, and neither caller checks the result.
  private buyTubing(): void {
    this.gameConsole?.(`buy amount:${TUBING_BUY_AMOUNT}`);
  }

  private installTubing(untubedIds: string[]): void {
    for (const holeId of untubedIds) this.gameConsole?.(`install_tubing hole:${holeId}`);
  }
}

/** "11 kg", or the spread "7.5–11 kg" when the holes differ; "—" without holes. */
function kgSpreadText(fills: readonly number[]): string {
  const held = fills.filter(kg => kg > 0);
  if (held.length === 0) return '—';
  const min = Math.min(...held);
  const max = Math.max(...held);
  return min === max ? `${+min.toFixed(1)} kg` : `${+min.toFixed(1)}–${+max.toFixed(1)} kg`;
}
