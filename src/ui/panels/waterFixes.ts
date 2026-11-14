// BlastSimulator2026 — Water fixes carried by the water warnings (#2267)
// Drain, tube and open-the-water-section controls shared by the Fire checklist and the
// preflight modal. Every action is a console command the Charge step already uses.

import { t } from '../../core/i18n/I18n.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import type { GameState } from '../../core/state/GameState.js';
import { HOLE_DRAIN_COST_PER_HOLE } from '../../core/config/balance.js';
import { drainBlockReason } from '../../core/mining/HoleDrain.js';
import { TUBING_BUY_AMOUNT, TUBING_COST, hasTubing } from '../../core/mining/Tubing.js';
import { rainExposedHoles, unprotectedSensitiveHoles, wetHoles } from '../../core/mining/WetHoles.js';
import { button, el, reasonLine } from '../dom.js';
import { applyLinkStyle } from '../entityLinks.js';
import { drainReasonText } from './blastSteps/ChargeHoleList.js';

/** Which warning row the fixes belong to: holes already wet, or holes rain will fill. */
export type WaterFixTarget = 'wet' | 'rain';

export interface WaterFixOffer {
  readonly target: WaterFixTarget;
  /** Wet holes that can be drained now. */
  readonly drainableIds: readonly string[];
  /** Wet untubed holes in porous rock: tubing must come before draining. */
  readonly porousBlockedIds: readonly string[];
  /** Holes the tube action installs on. */
  readonly tubeIds: readonly string[];
  readonly wetCount: number;
  readonly drainCost: number;
  readonly cash: number;
  readonly stock: number;
}

interface WaterFixIO {
  readonly run: (command: string) => void;
  readonly openWater?: (() => void) | undefined;
}

const BUY_COST = TUBING_BUY_AMOUNT * TUBING_COST;

export function waterFixOffer(state: GameState, target: WaterFixTarget): WaterFixOffer {
  const wet = wetHoles(state);
  const tubed = (id: string): boolean => hasTubing(state.tubingState, id);
  const porous = (id: string): boolean => drainBlockReason(state.holeWater[id], tubed(id), Infinity) === 'porous_untubed';
  const porousBlockedIds = wet.filter(porous);
  const drainableIds = wet.filter(id => !porous(id));
  const tubeIds = target === 'wet' ? wet.filter(id => !tubed(id)) : rainExposedHoles(state);
  return {
    target, drainableIds, porousBlockedIds, tubeIds,
    wetCount: wet.length,
    drainCost: drainableIds.length * HOLE_DRAIN_COST_PER_HOLE,
    cash: state.cash,
    stock: state.tubingState.inventory,
  };
}

/** Cheap string that changes whenever what the fixes show changes (for render signatures). */
export function waterFixKey(state: GameState): string {
  const unprotected = unprotectedSensitiveHoles(state).length;
  return JSON.stringify([unprotected, ...(['wet', 'rain'] as const).map(target => {
    const { cash, ...rest } = waterFixOffer(state, target);
    return { ...rest, canDrain: cash >= rest.drainCost, canBuy: cash >= BUY_COST };
  })]);
}

function disable(btn: HTMLButtonElement, reasons: HTMLElement, text: string): void {
  btn.disabled = true;
  btn.title = text;
  const line = reasonLine(text);
  line.dataset['role'] = 'water-fix-reason';
  reasons.appendChild(line);
}

function drainButton(offer: WaterFixOffer, io: WaterFixIO, reasons: HTMLElement): HTMLButtonElement {
  const btn = button('ghost', t('ui.blast_workshop.water_fix.drain', { count: offer.drainableIds.length, cost: `$${formatMoney(offer.drainCost)}` }), {
    dataAction: 'water-drain',
    onClick: () => { for (const id of offer.drainableIds) io.run(`drain_hole hole:${id}`); },
  });
  if (offer.drainableIds.length === 0) disable(btn, reasons, drainReasonText(offer.porousBlockedIds.length > 0 ? 'porous_untubed' : 'dry'));
  else if (offer.cash < offer.drainCost) disable(btn, reasons, drainReasonText('insufficient_funds'));
  return btn;
}

function tubeButtons(offer: WaterFixOffer, io: WaterFixIO, reasons: HTMLElement): HTMLButtonElement[] {
  const need = offer.tubeIds.length;
  const tube = button('ghost', t('ui.blast_workshop.water_fix.tube', { count: need }), {
    dataAction: 'water-tube',
    onClick: () => { for (const id of offer.tubeIds) io.run(`install_tubing hole:${id}`); },
  });
  if (offer.stock >= need) return [tube];
  disable(tube, reasons, t(need === 1 ? 'ui.blast_workshop.charge.tubing_reason_one' : 'ui.blast_workshop.charge.tubing_reason', { stock: offer.stock, need }));
  const buy = button('ghost', t('ui.blast_workshop.charge.tubing_buy', { count: TUBING_BUY_AMOUNT, cost: `$${formatMoney(BUY_COST)}` }), {
    dataAction: 'water-buy-tubing',
    onClick: () => io.run(`buy amount:${TUBING_BUY_AMOUNT}`),
  });
  if (offer.cash < BUY_COST) disable(buy, reasons, t('ui.blast_workshop.water_fix.buy_funds'));
  return [tube, buy];
}

/** The fixes a water warning row carries: drain, tube (and buy tubing), and a link to the Charge step's water section. */
export function buildWaterFixes(offer: WaterFixOffer, io: WaterFixIO): HTMLElement {
  const root = el('div', { attrs: { 'data-role': 'water-fixes', style: 'display:flex;flex-direction:column;gap:5px;margin-top:5px' } });
  const actions = el('div', { attrs: { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center' } });
  const reasons = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px' } });
  if (offer.porousBlockedIds.length > 0) {
    const first = reasonLine(t('ui.blast_workshop.water_fix.tube_first', { count: offer.porousBlockedIds.length }));
    first.dataset['role'] = 'water-tube-first';
    reasons.appendChild(first);
  }
  if (offer.target === 'wet' || offer.wetCount > 0) actions.appendChild(drainButton(offer, io, reasons));
  if (offer.tubeIds.length > 0) actions.append(...tubeButtons(offer, io, reasons));
  const link = el('button', { text: t('ui.blast_workshop.water_fix.open'), attrs: { type: 'button' } });
  link.dataset['action'] = 'water-open';
  applyLinkStyle(link);
  link.addEventListener('click', () => io.openWater?.());
  actions.appendChild(link);
  root.appendChild(actions);
  if (reasons.childElementCount > 0) root.appendChild(reasons);
  return root;
}
