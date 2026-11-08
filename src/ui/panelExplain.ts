// BlastSimulator2026 — Explanation texts for the management panels (#2170)
//
// What a badge, condition, chip or gauge in the Contracts, Finances, Permit, Event and
// Fleet panels does to the game, translated through t(); every number is read from
// balance.ts or the core function that applies it. Callers attach the text with explainable().

import { t } from '../core/i18n/I18n.js';
import {
  BUYER_PRICE_FACTOR,
  CONTRACT_EARLY_BONUS_DEADLINE_FRACTION,
  MOVE_STUCK_ABANDON_TICKS,
  NEGOTIATION_MAX_IMPROVEMENT,
  NEGOTIATION_MAX_WORSENING,
  PERMIT_STRIKES_TO_SUSPEND,
  PERMIT_STRIKE_WINDOW_TICKS,
  PERMIT_SUSPENSION_TICKS,
  REPAIR_PARTS_COST_PER_HP,
  STUCK_THRESHOLD,
} from '../core/config/balance.js';
import type { BuyerTierId } from '../core/economy/BuyerTiers.js';
import type { VehicleStatusKind } from '../core/entities/VehicleStatus.js';
import type { Transaction } from '../core/economy/Finance.js';
import { formatMoney } from '../core/economy/formatMoney.js';
import { marketTooltipKey } from './panels/ContractsMarketStrip.js';
import { formatGameDuration } from './formatGameDuration.js';

/** Largest transactions named in a finance category explanation. */
const CATEGORY_EXPLAIN_ENTRIES = 5;

const pctOf = (fraction: number): number => Math.round(fraction * 100);

/** What a Held contract does: no automatic delivery until resumed. */
export function heldExplain(): string { return t('ui.explain.held'); }

/** When the missed-deadline penalty `amount` is charged. */
export function penaltyExplain(amount: number): string {
  return t('ui.explain.penalty', { amount: formatMoney(amount) });
}

/** The deadline condition of the early bonus `amount`. */
export function earlyBonusExplain(amount: number): string {
  return t('ui.explain.early_bonus', { amount: formatMoney(amount), pct: pctOf(CONTRACT_EARLY_BONUS_DEADLINE_FRACTION) });
}

/** What negotiating can gain and risk. */
export function negotiateExplain(): string {
  return t('ui.explain.negotiate', { gain: pctOf(NEGOTIATION_MAX_IMPROVEMENT), risk: pctOf(NEGOTIATION_MAX_WORSENING) });
}

/** What follows when an offer's ore is not found on this site. */
export function offSiteExplain(): string { return t('ui.explain.off_site'); }

/** What the buyer tier means for the offer's price and size. */
export function buyerExplain(tier: BuyerTierId): string {
  const f = BUYER_PRICE_FACTOR[tier];
  return t(`ui.explain.buyer_${tier}`, { min: pctOf(f.min), max: pctOf(f.max) });
}

/** Price effect of a market row: signed trend `pct` against the base price at saturation `sat`. */
export function marketRowExplain(pct: number, sat: number): string {
  const signed = pct > 0 ? `+${pct}` : `${pct}`;
  return t('ui.explain.market_row', { pct: signed, state: t(marketTooltipKey(sat)) });
}

/** What the inspection strikes lead to. */
export function permitStrikesExplain(): string {
  return t('ui.explain.permit_strikes', {
    strikes: PERMIT_STRIKES_TO_SUSPEND,
    window: formatGameDuration(PERMIT_STRIKE_WINDOW_TICKS),
    ticks: PERMIT_STRIKE_WINDOW_TICKS,
    ban: formatGameDuration(PERMIT_SUSPENSION_TICKS),
  });
}

/** Breakdown of one finance category: transaction count, share (whole percent) and the largest entries. */
export function financeCategoryExplain(transactions: readonly Transaction[], share: number): string {
  const pct = Number.isInteger(share) ? share : pctOf(share);
  const largest = [...transactions].sort((a, b) => b.amount - a.amount).slice(0, CATEGORY_EXPLAIN_ENTRIES);
  const lines = largest.map(tx => `${tx.description || t('ui.explain.no_description')}: $${formatMoney(tx.amount)}`);
  return [t('ui.explain.category', { count: transactions.length, pct }), ...lines].join('\n');
}

const SCORE_TIP_KEY: Record<string, string> = {
  wellBeing: 'shell.topbar.score_well_tip',
  safety: 'shell.topbar.score_safe_tip',
  ecology: 'shell.topbar.score_eco_tip',
  nuisance: 'shell.topbar.score_nuis_tip',
};

/** An event effect chip in full words; `kind`/`key` as on EventEffect, `delta` its signed amount when known. */
export function eventChipExplain(kind: 'cash' | 'score' | 'other', key: string, delta?: number): string {
  if (kind === 'cash') {
    if (delta === undefined) return t('ui.explain.event_cash_any');
    return t(delta < 0 ? 'ui.explain.event_cash_loss' : 'ui.explain.event_cash_gain', { amount: formatMoney(Math.abs(delta)) });
  }
  if (kind === 'score') {
    const tipKey = SCORE_TIP_KEY[key];
    const tip = tipKey ? t(tipKey) : key;
    if (delta === undefined) return t('ui.explain.event_score_any', { tip });
    return t('ui.explain.event_score', { delta: `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${Math.abs(delta)}`, tip });
  }
  if (key === 'corruption' || key === 'followUp' || key === 'exposure') return t(`ui.explain.event_${key}`);
  return t('ui.explain.event_lasting');
}

/** What low vehicle HP does. */
export function vehicleHpExplain(): string {
  return t('ui.explain.vehicle_hp', { cost: REPAIR_PARTS_COST_PER_HP });
}

/** Why a vehicle shows this status. */
export function vehicleStatusExplain(kind: VehicleStatusKind): string {
  return t(`ui.explain.vehicle_status_${kind}`, { stuck: STUCK_THRESHOLD, abandon: MOVE_STUCK_ABANDON_TICKS });
}
