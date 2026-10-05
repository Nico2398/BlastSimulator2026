// BlastSimulator2026 — Contract negotiation system
// Probabilistic negotiation that can improve or worsen contract terms.

import type { Contract, ContractState, NegotiationChange } from './Contract.js';
import { computeEarlyBonus } from './Contract.js';
import { Random } from '../math/Random.js';
import { NEGOTIATION_MAX_ATTEMPTS_PER_OFFER } from '../config/balance.js';

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
  /** What changed, structured — core stays locale-agnostic, the UI renders the words. */
  changes: NegotiationChange[];
  /** The modified contract. */
  contract: Contract;
}

export type NegotiationRefusal = 'not_found' | 'already_negotiated';

/** Seed of the RNG stream for one negotiation attempt on one offer. */
export function negotiationStreamSeed(
  seed: number,
  tick: number,
  contractId: number,
  attempt: number,
): number {
  let h = Math.imul(seed | 0, 0x9e3779b1);
  for (const v of [tick, contractId, attempt]) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 15;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 13;
  }
  return h | 0;
}

/** Whether the offer still has negotiation attempts left. */
export function canNegotiate(contract: Contract): boolean {
  return (contract.negotiationAttempts ?? 0) < NEGOTIATION_MAX_ATTEMPTS_PER_OFFER;
}

/** Negotiate using a per-attempt RNG stream derived from seed, tick, id and attempt. */
export function negotiateContractAtTick(
  state: ContractState,
  contractId: number,
  reputation: number,
  seed: number,
  tick: number,
): NegotiationResult | { refused: NegotiationRefusal } {
  const contract = state.available.find(c => c.id === contractId);
  if (!contract) return { refused: 'not_found' };
  const rng = new Random(negotiationStreamSeed(seed, tick, contractId, contract.negotiationAttempts ?? 0));
  return negotiateContract(state, contractId, reputation, rng) as NegotiationResult | { refused: NegotiationRefusal };
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
): NegotiationResult | { refused: 'already_negotiated' } | null {
  const contract = state.available.find(c => c.id === contractId);
  if (!contract) return null;
  const attempts = contract.negotiationAttempts ?? 0;
  if (attempts >= NEGOTIATION_MAX_ATTEMPTS_PER_OFFER) return { refused: 'already_negotiated' };
  contract.negotiationAttempts = attempts + 1;

  const successRate = Math.min(0.95, Math.max(0.05, BASE_SUCCESS_RATE + reputation * REPUTATION_FACTOR));
  const isSuccess = rng.chance(successRate);

  const changes: NegotiationChange[] = [];

  if (isSuccess) {
    // Improve 1-2 terms
    const improvements = rng.nextInt(1, 2);
    const options = shuffleOptions(['price', 'deadline', 'penalty'], rng);

    for (let i = 0; i < improvements && i < options.length; i++) {
      const factor = rng.nextFloat(0.05, MAX_IMPROVEMENT);
      const pct = Math.round(factor * 100);
      switch (options[i]) {
        case 'price':
          contract.pricePerKg *= (1 + factor);
          changes.push({ field: 'price', improved: true, pct });
          break;
        case 'deadline':
          contract.deadlineTicks = Math.round(contract.deadlineTicks * (1 + factor));
          changes.push({ field: 'deadline', improved: true, pct });
          break;
        case 'penalty':
          contract.penaltyAmount = Math.round(contract.penaltyAmount * (1 - factor));
          changes.push({ field: 'penalty', improved: true, pct });
          break;
      }
    }
  } else {
    // Worsen 1 term
    const options = shuffleOptions(['price', 'deadline', 'penalty'], rng);
    const factor = rng.nextFloat(0.05, MAX_WORSENING);
    const pct = Math.round(factor * 100);

    switch (options[0]) {
      case 'price':
        contract.pricePerKg *= (1 - factor);
        changes.push({ field: 'price', improved: false, pct });
        break;
      case 'deadline':
        contract.deadlineTicks = Math.max(10, Math.round(contract.deadlineTicks * (1 - factor)));
        changes.push({ field: 'deadline', improved: false, pct });
        break;
      case 'penalty':
        contract.penaltyAmount = Math.round(contract.penaltyAmount * (1 + factor));
        changes.push({ field: 'penalty', improved: false, pct });
        break;
    }
  }

  if (changes.some(c => c.field === 'price')) {
    contract.earlyBonus = computeEarlyBonus(contract.quantityKg, contract.pricePerKg);
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
