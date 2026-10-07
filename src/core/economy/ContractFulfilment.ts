// BlastSimulator2026 — Delivery of stored ore to active contracts, by hand or automatically.

import { FRAGMENT_SPLIT_EPSILON_KG } from '../config/balance.js';
import { t } from '../i18n/I18n.js';
import { deliverMaterials, remainingKg, sortByDeadline, storedStockKg, type ContractState } from './Contract.js';
import { addIncome, type FinanceState } from './Finance.js';
import { consumeStoredOre, type LogisticsState } from './Logistics.js';

type DeliveryResult<T> = { success: true; data: T } | { success: false; error: string };

/** What one delivery to one contract produced. */
interface DeliveryOutcome {
  kg: number;
  payment: number;
  bonus: number;
  completed: boolean;
}

/** One automatic delivery, tagged with its contract. */
interface AutoDelivery extends DeliveryOutcome {
  contractId: number;
}

/**
 * Deliver up to `requestedKg` of stored ore to one active contract, drawing it
 * down from storage. The request is capped at what the contract still needs and what storage holds.
 */
export function deliverStoredOre(
  contracts: ContractState,
  logistics: LogisticsState,
  collectedOre: Record<string, number>,
  contractId: number,
  requestedKg: number,
  tick: number,
): DeliveryResult<DeliveryOutcome> {
  const contract = contracts.active.find(c => c.id === contractId);
  if (!contract) return { success: false, error: t('economy.contract.deliver_not_found', { id: contractId }) };

  let request = Math.min(requestedKg, remainingKg(contract));
  // Partial delivery: take what storage holds; an empty store falls through to the insufficient-stock error.
  const stock = storedStockKg(contract, collectedOre, logistics.storedMassKg);
  if (stock > FRAGMENT_SPLIT_EPSILON_KG) request = Math.min(request, stock);
  if (!(request > 0)) return { success: false, error: t('economy.contract.deliver_fulfilled', { id: contractId }) };

  const consumption = consumeStoredOre(logistics, collectedOre, contract.materialId, request);
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
  return { success: true, data: { kg, ...result } };
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
): AutoDelivery[] {
  const deliveries: AutoDelivery[] = [];
  // Sorted copy: completing a contract splices it out of contracts.active.
  for (const contract of sortByDeadline(contracts.active)) {
    if (contract.held || contract.completed || contract.expired) continue;
    const stock = storedStockKg(contract, collectedOre, logistics.storedMassKg);
    if (stock <= FRAGMENT_SPLIT_EPSILON_KG) continue;
    const result = deliverStoredOre(contracts, logistics, collectedOre, contract.id, stock, tick);
    if (result.success && result.data.kg > 0) deliveries.push({ contractId: contract.id, ...result.data });
  }
  return deliveries;
}

/** Credit a delivery's payment (and early bonus) to cash and the books. */
export function bookDeliveryIncome(
  account: { cash: number; finances: FinanceState },
  contractId: number,
  outcome: Pick<DeliveryOutcome, 'payment' | 'bonus'>,
  tick: number,
): void {
  account.cash += outcome.payment;
  addIncome(account.finances, outcome.payment, 'contracts', `Contract #${contractId} delivery`, tick);
  if (outcome.bonus > 0) {
    account.cash += outcome.bonus;
    addIncome(account.finances, outcome.bonus, 'bonus', `Contract #${contractId} early bonus`, tick);
  }
}
