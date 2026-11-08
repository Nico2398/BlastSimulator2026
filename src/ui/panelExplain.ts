// BlastSimulator2026 — Explanation texts for the management panels (#2170)
//
// What a badge, condition, chip or gauge in the Contracts, Finances, Permit, Event and
// Fleet panels does to the game, translated through t(); every number is read from
// balance.ts or the core function that applies it. Callers attach the text with explainable().

import type { BuyerTierId } from '../core/economy/BuyerTiers.js';
import type { VehicleStatusKind } from '../core/entities/VehicleStatus.js';
import type { Transaction } from '../core/economy/Finance.js';

const NOT_IMPLEMENTED = 'not implemented';

/** What a Held contract does: no automatic delivery until resumed. */
export function heldExplain(): string { throw new Error(NOT_IMPLEMENTED); }

/** When the missed-deadline penalty `amount` is charged. */
export function penaltyExplain(amount: number): string { void amount; throw new Error(NOT_IMPLEMENTED); }

/** The deadline condition of the early bonus `amount`. */
export function earlyBonusExplain(amount: number): string { void amount; throw new Error(NOT_IMPLEMENTED); }

/** What negotiating can gain and risk. */
export function negotiateExplain(): string { throw new Error(NOT_IMPLEMENTED); }

/** What follows when an offer's ore is not found on this site. */
export function offSiteExplain(): string { throw new Error(NOT_IMPLEMENTED); }

/** What the buyer tier means for the offer's price and size. */
export function buyerExplain(tier: BuyerTierId): string { void tier; throw new Error(NOT_IMPLEMENTED); }

/** Price effect of a market row: signed trend `pct` against the base price at saturation `sat`. */
export function marketRowExplain(pct: number, sat: number): string { void pct; void sat; throw new Error(NOT_IMPLEMENTED); }

/** What the inspection strikes lead to. */
export function permitStrikesExplain(): string { throw new Error(NOT_IMPLEMENTED); }

/** Breakdown of one finance category: transaction count, share and the largest entries. */
export function financeCategoryExplain(transactions: readonly Transaction[], share: number): string { void transactions; void share; throw new Error(NOT_IMPLEMENTED); }

/** An event effect chip in full words; `kind`/`key` as on EventEffect, `delta` its signed amount when known. */
export function eventChipExplain(kind: 'cash' | 'score' | 'other', key: string, delta?: number): string { void kind; void key; void delta; throw new Error(NOT_IMPLEMENTED); }

/** What low vehicle HP does. */
export function vehicleHpExplain(): string { throw new Error(NOT_IMPLEMENTED); }

/** Why a vehicle shows this status. */
export function vehicleStatusExplain(kind: VehicleStatusKind): string { void kind; throw new Error(NOT_IMPLEMENTED); }
