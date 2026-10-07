// BlastSimulator2026 — Automatic delivery of stored ore to active contracts.

import type { ContractState } from './Contract.js';
import type { LogisticsState } from './Logistics.js';

export type DeliveryResult<T> = { success: true; data: T } | { success: false; error: string };

/** What one delivery to one contract produced. */
export interface DeliveryOutcome {
  kg: number;
  payment: number;
  bonus: number;
  completed: boolean;
}

/** One automatic delivery, tagged with its contract. */
export interface AutoDelivery extends DeliveryOutcome {
  contractId: number;
}

/** Deliver up to `requestedKg` of stored ore to one active contract, drawing it down from storage. */
export function deliverStoredOre(
  _contracts: ContractState,
  _logistics: LogisticsState,
  _collectedOre: Record<string, number>,
  _contractId: number,
  _requestedKg: number,
  _tick: number,
): DeliveryResult<DeliveryOutcome> {
  return { success: false, error: 'not implemented' }; // TODO: implement
}

/** Deliver stored ore to every eligible active contract, soonest deadline first. */
export function autoDeliverContracts(
  _contracts: ContractState,
  _logistics: LogisticsState,
  _collectedOre: Record<string, number>,
  _tick: number,
): AutoDelivery[] {
  return []; // TODO: implement
}
