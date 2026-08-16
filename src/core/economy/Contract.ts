// BlastSimulator2026 — Contract system
// Contracts define material delivery requirements with deadlines, payments, and penalties.

import { Random } from '../math/Random.js';

// ── Contract types ──

export type ContractType = 'ore_sale' | 'rubble_disposal' | 'supply';

export interface Contract {
  id: number;
  type: ContractType;
  /** Ore or material ID required. '' for generic rubble. */
  materialId: string;
  /** Human-readable description. */
  description: string;
  /** Total quantity required in kg. */
  quantityKg: number;
  /** Quantity already delivered in kg. */
  deliveredKg: number;
  /** Price per kg in game dollars. */
  pricePerKg: number;
  /** Deadline in game ticks from acceptance. */
  deadlineTicks: number;
  /** Tick when accepted (0 if not yet accepted). */
  acceptedAtTick: number;
  /** Penalty for missing the deadline. */
  penaltyAmount: number;
  /** Bonus for early completion (delivered before 50% of deadline). */
  earlyBonus: number;
  /** Whether the contract has been completed. */
  completed: boolean;
  /** Whether the contract has expired (deadline passed). */
  expired: boolean;
}

// ── Negotiation outcome (types live here, not in Negotiation.ts, so
// ContractState can reference them without a circular import — Negotiation.ts
// already imports Contract/ContractState from this module) ──

export type NegotiationField = 'price' | 'deadline' | 'penalty';

/** One term negotiation moved, structured rather than prose so the UI can localize it (core stays locale-agnostic). */
export interface NegotiationChange {
  field: NegotiationField;
  /** True when the change favors the player (better price/longer deadline/lower penalty). */
  improved: boolean;
  /** Magnitude of the change, 0-100. */
  pct: number;
}

// ── Contract state ──

export interface ContractState {
  available: Contract[];
  active: Contract[];
  completedHistory: Contract[];
  nextId: number;
  /** Tick when available contracts were last refreshed. */
  lastRefreshTick: number;
  /** Outcome of the most recent negotiate attempt, so the panel can show it inline on the right card. Null until the first attempt. */
  lastNegotiation: { contractId: number; success: boolean; changes: NegotiationChange[] } | null;
}

export function createContractState(): ContractState {
  return {
    available: [],
    active: [],
    completedHistory: [],
    nextId: 1,
    lastRefreshTick: 0,
    lastNegotiation: null,
  };
}

// ── Config ──

/** How often new contracts appear (in ticks). */
const REFRESH_INTERVAL = 20;
/** Number of contracts generated per refresh. */
const CONTRACTS_PER_REFRESH = 3;
/** Max available contracts at once. */
const MAX_AVAILABLE = 8;

// Ore IDs that can appear in contracts
const CONTRACT_ORES = ['dirtite', 'rustite', 'blingite', 'gloomium', 'sparkium', 'craktonite', 'absurdium', 'treranium'];
// Base prices per kg (slightly above catalog to give player profit margin)
const ORE_CONTRACT_PRICES: Record<string, number> = {
  dirtite: 3, rustite: 12, blingite: 35, gloomium: 80,
  sparkium: 200, craktonite: 450, absurdium: 1000, treranium: 2500,
};

// ── Generation ──

/** Generate new available contracts. */
export function generateContracts(
  state: ContractState,
  rng: Random,
  currentTick: number,
): void {
  // Only refresh if enough time has passed
  if (currentTick - state.lastRefreshTick < REFRESH_INTERVAL && state.available.length > 0) return;

  // Remove oldest contracts if at max
  while (state.available.length >= MAX_AVAILABLE) {
    state.available.shift();
  }

  for (let i = 0; i < CONTRACTS_PER_REFRESH; i++) {
    if (state.available.length >= MAX_AVAILABLE) break;
    state.available.push(generateOneContract(state, rng));
  }
  state.lastRefreshTick = currentTick;
}

function generateOneContract(state: ContractState, rng: Random): Contract {
  const typeRoll = rng.nextFloat(0, 1);
  let type: ContractType;
  let materialId: string;
  let pricePerKg: number;
  let description: string;

  if (typeRoll < 0.5) {
    // Ore sale contract
    type = 'ore_sale';
    materialId = rng.pick(CONTRACT_ORES);
    pricePerKg = (ORE_CONTRACT_PRICES[materialId] ?? 10) * rng.nextFloat(0.8, 1.3);
    description = `Deliver ${materialId} ore`;
  } else if (typeRoll < 0.8) {
    // Rubble disposal
    type = 'rubble_disposal';
    materialId = '';
    pricePerKg = rng.nextFloat(0.5, 2.0);
    description = 'Dispose of rubble';
  } else {
    // Supply contract (recurring, higher quantity, lower price)
    type = 'supply';
    materialId = rng.pick(CONTRACT_ORES.slice(0, 4)); // Only common ores for supply
    pricePerKg = (ORE_CONTRACT_PRICES[materialId] ?? 10) * rng.nextFloat(0.6, 0.9);
    description = `Supply ${materialId} (bulk)`;
  }

  const quantityKg = Math.round(rng.nextFloat(50, 500) / 10) * 10;
  const deadlineTicks = rng.nextInt(30, 100);
  const penaltyAmount = Math.round(quantityKg * pricePerKg * 0.3);
  const earlyBonus = Math.round(quantityKg * pricePerKg * 0.15);

  const id = state.nextId++;

  return {
    id, type, materialId, description, quantityKg, deliveredKg: 0,
    pricePerKg, deadlineTicks, acceptedAtTick: 0, penaltyAmount, earlyBonus,
    completed: false, expired: false,
  };
}

// ── Operations ──

/** Accept a contract from the available list. */
export function acceptContract(
  state: ContractState,
  contractId: number,
  currentTick: number,
): Contract | null {
  const idx = state.available.findIndex(c => c.id === contractId);
  if (idx < 0) return null;

  const contract = state.available.splice(idx, 1)[0]!;
  contract.acceptedAtTick = currentTick;
  state.active.push(contract);
  return contract;
}

/**
 * Deliver materials against an active contract.
 * Returns the payment amount (0 if contract not found or already completed).
 */
export function deliverMaterials(
  state: ContractState,
  contractId: number,
  amountKg: number,
  currentTick: number,
): { payment: number; bonus: number; completed: boolean } {
  const contract = state.active.find(c => c.id === contractId);
  if (!contract || contract.completed || contract.expired) {
    return { payment: 0, bonus: 0, completed: false };
  }

  const remaining = contract.quantityKg - contract.deliveredKg;
  const delivered = Math.min(amountKg, remaining);
  contract.deliveredKg += delivered;

  const payment = delivered * contract.pricePerKg;

  if (contract.deliveredKg >= contract.quantityKg) {
    contract.completed = true;

    // Check for early bonus
    const elapsed = currentTick - contract.acceptedAtTick;
    const isEarly = elapsed < contract.deadlineTicks * 0.5;
    const bonus = isEarly ? contract.earlyBonus : 0;

    // Move to history
    const idx = state.active.indexOf(contract);
    if (idx >= 0) state.active.splice(idx, 1);
    state.completedHistory.push(contract);

    return { payment, bonus, completed: true };
  }

  return { payment, bonus: 0, completed: false };
}

/**
 * Criteria for locating a contract without needing its exact numeric id.
 *
 * `generateContracts` assigns ids by generation order and evicts the oldest
 * `available` entries (`shift()`) once the pool is full — a scenario or
 * player upstream of a rotation has to hardcode a fixed id like `1`, which
 * stops naming anything real once the pool has turned over: it might be a
 * different contract, or gone entirely (#597; PR #586 re-numbered contract
 * ids by hand across several files chasing this — 1 → 4 → 14 in one of
 * them). `type`/`materialId` name a contract by what it actually is instead
 * of where it landed in generation order, so it survives the pool rotating
 * as long as a contract of that kind is still offered.
 */
export interface ContractSelector {
  id?: number;
  type?: ContractType;
  materialId?: string;
}

/**
 * Find a contract in `pool` by `selector.id` if given, else by the first
 * entry matching `selector.type`/`selector.materialId` (either or both).
 * Null when no selector field is set (nothing to search for) or nothing in
 * `pool` matches.
 */
export function findContract(pool: readonly Contract[], selector: ContractSelector): Contract | null {
  if (selector.id !== undefined) {
    return pool.find(c => c.id === selector.id) ?? null;
  }
  if (selector.type === undefined && selector.materialId === undefined) return null;
  return pool.find(c =>
    (selector.type === undefined || c.type === selector.type)
    && (selector.materialId === undefined || c.materialId === selector.materialId),
  ) ?? null;
}

/** Check and expire overdue contracts. Returns penalty amounts. */
export function checkDeadlines(
  state: ContractState,
  currentTick: number,
): Array<{ contractId: number; penalty: number }> {
  const penalties: Array<{ contractId: number; penalty: number }> = [];

  for (let i = state.active.length - 1; i >= 0; i--) {
    const c = state.active[i]!;
    if (c.completed || c.expired) continue;

    const elapsed = currentTick - c.acceptedAtTick;
    if (elapsed > c.deadlineTicks) {
      c.expired = true;
      penalties.push({ contractId: c.id, penalty: c.penaltyAmount });
      state.active.splice(i, 1);
      state.completedHistory.push(c);
    }
  }

  return penalties;
}

export { REFRESH_INTERVAL, MAX_AVAILABLE };
