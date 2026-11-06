// BlastSimulator2026 — Delivery of stored ore to active contracts, by hand or automatically.

import { AUTO_SALE_DWELL_TICKS, FRAGMENT_SPLIT_EPSILON_KG, ORE_GRADE_SCALE_DEFAULT } from '../config/balance.js';
import { t } from '../i18n/I18n.js';
import { acceptContract, deliverMaterials, isAutoDeliverable, isPaidClearance, remainingKg, sortByDeadline, storedStockKg, type ContractState } from './Contract.js';
import { addExpense, addIncome, type FinanceState } from './Finance.js';
import { consumeStoredOre, type LogisticsState } from './Logistics.js';
import { rubbleStockKg } from './SpoilHeaps.js';
import type { Contract, ContractType } from './Contract.js';
import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { recordOreDelivery } from './MineGrade.js';
import { recordOreSale, saturationAt } from './OreSaturation.js';
import { autoSalePricePerKg } from './Market.js';
import { oreGradeScaleOf } from './OreGrade.js';
import { recordBoardOre } from './Board.js';
import type { Building } from '../entities/Building.js';

/** The slice of a building a rubble delivery reads and draws down: its spoil heap stock. */
type SpoilBuildings = readonly Pick<Building, 'type' | 'tier' | 'storedSpoilKg'>[];

type DeliveryResult<T> = { success: true; data: T } | { success: false; error: string };

/** What one delivery to one contract produced. */
interface DeliveryOutcome {
  kg: number;
  /** Ore delivered ('' for rubble); keys the per-ore market saturation (#1930). */
  materialId?: string;
  /** Type of the contract delivered to: mine grades count ore_sale and supply kg only (#1921). */
  contractType: ContractType;
  payment: number;
  bonus: number;
  completed: boolean;
  /** True when the player paid for the delivery (paid clearance): `payment` is a fee, not income (#1892). */
  fee: boolean;
}

/** One automatic delivery, tagged with its contract. */
export interface AutoDelivery extends DeliveryOutcome {
  contractId: number;
  /** True when the contract was accepted automatically; its cashflow carries its own label (#2145). */
  auto?: boolean;
}

/**
 * Deliver up to `requestedKg` of stored ore to one active contract, drawing it
 * down from storage. The request is capped at what the contract still needs and what storage holds.
 * Rubble draws on the spoil heaps in `buildings` first (#1530).
 */
export function deliverStoredOre(
  contracts: ContractState,
  logistics: LogisticsState,
  collectedOre: Record<string, number>,
  contractId: number,
  requestedKg: number,
  tick: number,
  buildings: SpoilBuildings,
  gradeScale = ORE_GRADE_SCALE_DEFAULT,
): DeliveryResult<DeliveryOutcome> {
  const contract = contracts.active.find(c => c.id === contractId);
  if (!contract) return { success: false, error: t('economy.contract.deliver_not_found', { id: contractId }) };

  let request = Math.min(requestedKg, remainingKg(contract));
  // Partial delivery: take what stock holds (rubble: barren rock only, #1871); an empty store falls through to the insufficient-stock error.
  const stock = storedStockKg(contract, collectedOre, rubbleStockKg(logistics.fragments, buildings, gradeScale));
  if (stock > FRAGMENT_SPLIT_EPSILON_KG) request = Math.min(request, stock);
  if (!(request > 0)) return { success: false, error: t('economy.contract.deliver_fulfilled', { id: contractId }) };

  const consumption = consumeStoredOre(logistics, collectedOre, contract.materialId, request, buildings, gradeScale);
  if (!consumption.success) {
    return {
      success: false,
      error: consumption.error ?? t('economy.contract.deliver_insufficient', { material: contract.materialId || t('ui.contracts.material_rubble') }),
    };
  }
  // Float dust left by splitting fragments must not strand a contract epsilon short of complete.
  const consumed = Math.min(consumption.consumedKg, request);
  const kg = request - consumed <= FRAGMENT_SPLIT_EPSILON_KG ? request : consumed;

  const result = deliverMaterials(contracts, contractId, kg, tick);
  contract.paidTotal = (contract.paidTotal ?? 0) + result.payment;
  return { success: true, data: { kg, materialId: contract.materialId, contractType: contract.type, ...result, fee: isPaidClearance(contract) } };
}

/**
 * Deliver stored ore to every eligible (active, not held) contract, soonest
 * deadline first. Each contract takes min(stock, remaining) (clamped by deliverStoredOre); stock is re-read
 * after every delivery, since contracts share one warehouse. Walks the active
 * contracts once.
 */
export function autoDeliverContracts(
  contracts: ContractState,
  logistics: LogisticsState,
  collectedOre: Record<string, number>,
  tick: number,
  buildings: SpoilBuildings,
  gradeScale = ORE_GRADE_SCALE_DEFAULT,
): AutoDelivery[] {
  const deliveries: AutoDelivery[] = [];
  // Sorted copy: completing a contract splices it out of contracts.active.
  for (const contract of sortByDeadline(contracts.active)) {
    if (!isAutoDeliverable(contract)) continue;
    const stock = storedStockKg(contract, collectedOre, rubbleStockKg(logistics.fragments, buildings, gradeScale));
    if (stock <= FRAGMENT_SPLIT_EPSILON_KG) continue;
    const result = deliverStoredOre(contracts, logistics, collectedOre, contract.id, stock, tick, buildings, gradeScale);
    if (result.success && result.data.kg > 0) deliveries.push({ contractId: contract.id, ...result.data, ...(contract.autoAccepted ? { auto: true } : {}) });
  }
  return deliveries;
}

/** Book a delivery's cashflow: income for a paying contract (payment and early bonus), an expense when the outcome is a fee (#1892). */
export function bookDeliveryCashflow(
  account: { cash: number; finances: FinanceState },
  contractId: number,
  outcome: Pick<DeliveryOutcome, 'payment' | 'bonus' | 'fee'> & { auto?: boolean },
  tick: number,
): void {
  const label = outcome.auto ? `Auto rubble clearance #${contractId}` : `Contract #${contractId} delivery`;
  if (outcome.fee) {
    if (outcome.payment <= 0) return;
    account.cash -= outcome.payment;
    addExpense(account.finances, outcome.payment, 'contracts', label, tick);
    return;
  }
  account.cash += outcome.payment;
  addIncome(account.finances, outcome.payment, 'contracts', label, tick);
  if (outcome.bonus > 0) {
    account.cash += outcome.bonus;
    addIncome(account.finances, outcome.bonus, 'bonus', `Contract #${contractId} early bonus`, tick);
  }
}

/**
 * Settle one delivery: book cashflow, count it toward mine grade and board ore, and record the
 * ore's market saturation (#1930). The one place every delivery path calls.
 */
export function settleDelivery(
  state: GameState,
  delivery: AutoDelivery,
  tick: number,
  emitter?: EventEmitter,
): void {
  bookDeliveryCashflow(state, delivery.contractId, delivery, tick);
  recordOreDelivery(state.grade, delivery.contractType, delivery.kg);
  recordBoardOre(state.board, delivery.contractType, delivery.kg);
  const oreId = delivery.materialId;
  if (state.grade === undefined || delivery.contractType === 'rubble_disposal' || !oreId || !(delivery.kg > 0)) return;
  state.saturation ??= {};
  const sale = recordOreSale(state.saturation, oreId, delivery.kg, tick, state.grade.grade);
  if (sale.crossed) emitter?.emit('progression:ore_glut', { oreId, saturation: sale.after });
}

/** One automatic sale of unclaimed stored ore (#2145). */
export interface AutoSale {
  oreId: string;
  kg: number;
  payment: number;
}

/**
 * Sell stored ore no active contract claims, once it has stayed unclaimed for AUTO_SALE_DWELL_TICKS (#2145).
 * Performs the whole sale on `state`: draws the ore down, books `sales` income, records saturation and mine grade.
 * Sells nothing when `state.contracts.autoSell === false`.
 */
export function autoSellUnclaimedOre(state: GameState, tick: number): AutoSale[] {
  const contracts = state.contracts;
  if (contracts.autoSell === false) return [];
  const since = (contracts.autoSaleSince ??= {});
  const claimed: Record<string, number> = {};
  for (const c of contracts.active) {
    if (c.type === 'rubble_disposal' || c.completed || c.expired) continue;
    claimed[c.materialId] = (claimed[c.materialId] ?? 0) + remainingKg(c);
  }
  const sales: AutoSale[] = [];
  const gradeScale = oreGradeScaleOf(state.world);
  for (const [oreId, stock] of Object.entries(state.collectedOre)) {
    const unclaimed = stock - (claimed[oreId] ?? 0);
    if (!(unclaimed > FRAGMENT_SPLIT_EPSILON_KG)) {
      delete since[oreId];
      continue;
    }
    since[oreId] ??= tick;
    if (tick - since[oreId]! < AUTO_SALE_DWELL_TICKS) continue;
    const consumed = consumeStoredOre(state.logistics, state.collectedOre, oreId, unclaimed, state.buildings.buildings, gradeScale);
    if (!consumed.success || !(consumed.consumedKg > 0)) continue;
    const kg = consumed.consumedKg;
    state.saturation ??= {};
    const saturation = saturationAt(state.saturation[oreId], tick);
    const payment = kg * autoSalePricePerKg(oreId, contracts.market ?? 'legacy', saturation);
    state.cash += payment;
    addIncome(state.finances, payment, 'sales', `Auto sale: ${oreId}`, tick);
    recordOreDelivery(state.grade, 'ore_sale', kg);
    recordBoardOre(state.board, 'ore_sale', kg);
    recordOreSale(state.saturation, oreId, kg, tick, state.grade?.grade ?? 0);
    delete since[oreId];
    sales.push({ oreId, kg, payment });
  }
  return sales;
}

/**
 * Accept every available rubble clearance that pays the player and fits `rubbleStockKg` of barren rock,
 * stock shared across the accepted offers (#2145). Paid clearances are never taken.
 * Accepts nothing when `contracts.autoClearRubble === false`. Returns the accepted contracts, flagged `autoAccepted`.
 */
export function autoAcceptRubbleClearances(contracts: ContractState, rubbleStockKg: number, tick: number): Contract[] {
  if (contracts.autoClearRubble === false) return [];
  let room = rubbleStockKg;
  const accepted: Contract[] = [];
  for (const offer of [...contracts.available]) {
    if (offer.type !== 'rubble_disposal' || isPaidClearance(offer) || offer.quantityKg > room) continue;
    const contract = acceptContract(contracts, offer.id, tick);
    if (!contract) continue;
    contract.autoAccepted = true;
    room -= contract.quantityKg;
    accepted.push(contract);
  }
  return accepted;
}
