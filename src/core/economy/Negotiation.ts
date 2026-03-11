// BlastSimulator2026 — Contract negotiation system
// Probabilistic negotiation that can improve or worsen contract terms.

import type { Contract, ContractState } from './Contract.js';
import { Random } from '../math/Random.js';

// ── Config ──

/** Base success probability (50%). */
const BASE_SUCCESS_RATE = 0.5;
/** Score influence: each point of reputation adds this to success rate. */
const REPUTATION_FACTOR = 0.01;
/** Maximum improvement factor for successful negotiation (20% better terms). */
const MAX_IMPROVEMENT = 0.20;
/** Maximum worsening factor for failed negotiation (15% worse terms). */
const MAX_WORSENING = 0.15;

// ── Negotiation result ──

export interface NegotiationResult {
  success: boolean;
  /** What changed (human-readable). */
  changes: string[];
  /** The modified contract. */
  contract: Contract;
}

/**
 * Negotiate a contract in the available list.
 * Success probability = BASE_SUCCESS_RATE + reputation * REPUTATION_FACTOR.
 * Success: better price, longer deadline, lower penalty (picks 1-2 improvements).
 * Failure: worse price, shorter deadline, higher penalty (picks 1 worsening).
 */
export function negotiateContract(
  state: ContractState,
  contractId: number,
  reputation: number,
  rng: Random,
): NegotiationResult | null {
  const contract = state.available.find(c => c.id === contractId);
  if (!contract) return null;

  const successRate = Math.min(0.95, Math.max(0.05, BASE_SUCCESS_RATE + reputation * REPUTATION_FACTOR));
  const isSuccess = rng.chance(successRate);

  const changes: string[] = [];

  if (isSuccess) {
    // Improve 1-2 terms
    const improvements = rng.nextInt(1, 2);
    const options = shuffleOptions(['price', 'deadline', 'penalty'], rng);

    for (let i = 0; i < improvements && i < options.length; i++) {
      const factor = rng.nextFloat(0.05, MAX_IMPROVEMENT);
      switch (options[i]) {
        case 'price':
          contract.pricePerKg *= (1 + factor);
          changes.push(`Price improved by ${(factor * 100).toFixed(0)}%`);
          break;
        case 'deadline':
          contract.deadlineTicks = Math.round(contract.deadlineTicks * (1 + factor));
          changes.push(`Deadline extended by ${(factor * 100).toFixed(0)}%`);
          break;
        case 'penalty':
          contract.penaltyAmount = Math.round(contract.penaltyAmount * (1 - factor));
          changes.push(`Penalty reduced by ${(factor * 100).toFixed(0)}%`);
          break;
      }
    }
  } else {
    // Worsen 1 term
    const options = shuffleOptions(['price', 'deadline', 'penalty'], rng);
    const factor = rng.nextFloat(0.05, MAX_WORSENING);

    switch (options[0]) {
      case 'price':
        contract.pricePerKg *= (1 - factor);
        changes.push(`Price worsened by ${(factor * 100).toFixed(0)}%`);
        break;
      case 'deadline':
        contract.deadlineTicks = Math.max(10, Math.round(contract.deadlineTicks * (1 - factor)));
        changes.push(`Deadline shortened by ${(factor * 100).toFixed(0)}%`);
        break;
      case 'penalty':
        contract.penaltyAmount = Math.round(contract.penaltyAmount * (1 + factor));
        changes.push(`Penalty increased by ${(factor * 100).toFixed(0)}%`);
        break;
    }
  }

  return { success: isSuccess, changes, contract };
}

function shuffleOptions(options: string[], rng: Random): string[] {
  const arr = [...options];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export { BASE_SUCCESS_RATE, REPUTATION_FACTOR };
