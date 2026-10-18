// BlastSimulator2026 — Delivery of stored ore to active contracts, by hand or automatically.

import { FRAGMENT_SPLIT_EPSILON_KG } from '../config/balance.js';
import { t } from '../i18n/I18n.js';
import { deliverMaterials, isAutoDeliverable, isPaidClearance, remainingKg, sortByDeadline, storedStockKg, type ContractState } from './Contract.js';
import { addExpense, addIncome, type FinanceState } from './Finance.js';
import { consumeStoredOre, type LogisticsState } from './Logistics.js';
import { rubbleStockKg } from './SpoilHeaps.js';
import type { ContractType } from './Contract.js';
import type { Building } from '../entities/Building.js';

/** The slice of a building a rubble delivery reads and draws down: its spoil heap stock. */
type SpoilBuildings = readonly Pick<Building, 'type' | 'tier' | 'storedSpoilKg'>[];

type DeliveryResult<T> = { success: true; data: T } | { success: false; error: string };

/** What one delivery to one contract produced. */
interface DeliveryOutcome {
  kg: number;
  /** Type of the contract delivered to: mine grades count ore_sale and supply kg only (#1921). */
  contractType: ContractType;
  payment: number;
  bonus: number;
  completed: boolean;
  /** True when the player paid for the delivery (paid clearance): `payment` is a fee, not income (#1892). */
  fee: boolean;
}

/** One automatic delivery, tagged with its contract. */
interface AutoDelivery extends DeliveryOutcome {
  contractId: number;
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
): DeliveryResult<DeliveryOutcome> {
  const contract = contracts.active.find(c => c.id === contractId);
  if (!contract) return { success: false, error: t('economy.contract.deliver_not_found', { id: contractId }) };

  let request = Math.min(requestedKg, remainingKg(contract));
  // Partial delivery: take what stock holds (rubble: barren rock only, #1871); an empty store falls through to the insufficient-stock error.
  const stock = storedStockKg(contract, collectedOre, rubbleStockKg(logistics.fragments, buildings));
  if (stock > FRAGMENT_SPLIT_EPSILON_KG) request = Math.min(request, stock);
  if (!(request > 0)) return { success: false, error: t('economy.contract.deliver_fulfilled', { id: contractId }) };

  const consumption = consumeStoredOre(logistics, collectedOre, contract.materialId, request, buildings);
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
  return { success: true, data: { kg, contractType: contract.type, ...result, fee: isPaidClearance(contract) } };
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
): AutoDelivery[] {
  const deliveries: AutoDelivery[] = [];
  // Sorted copy: completing a contract splices it out of contracts.active.
  for (const contract of sortByDeadline(contracts.active)) {
    if (!isAutoDeliverable(contract)) continue;
    const stock = storedStockKg(contract, collectedOre, rubbleStockKg(logistics.fragments, buildings));
    if (stock <= FRAGMENT_SPLIT_EPSILON_KG) continue;
    const result = deliverStoredOre(contracts, logistics, collectedOre, contract.id, stock, tick, buildings);
    if (result.success && result.data.kg > 0) deliveries.push({ contractId: contract.id, ...result.data });
  }
  return deliveries;
}

/** Book a delivery's cashflow: income for a paying contract (payment and early bonus), an expense when the outcome is a fee (#1892). */
export function bookDeliveryCashflow(
  account: { cash: number; finances: FinanceState },
  contractId: number,
  outcome: Pick<DeliveryOutcome, 'payment' | 'bonus' | 'fee'>,
  tick: number,
): void {
  const label = `Contract #${contractId} delivery`;
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
