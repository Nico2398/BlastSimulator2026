// BlastSimulator2026 — Contract system
// Contracts define material delivery requirements with deadlines, payments, and penalties.

import { Random } from '../math/Random.js';
import type { ScriptedOreSaleOffer } from '../config/balance.js';
import {
  CONTRACT_REFRESH_INTERVAL,
  CONTRACTS_PER_REFRESH,
  MAX_AVAILABLE_CONTRACTS,
  NEGOTIATION_EARLY_BONUS_RATE,
  ORE_PRICES,
  RUBBLE_DISPOSAL_PRICE_RANGE,
  SUPPLY_COMMON_ORE_COUNT,
} from '../config/balance.js';

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
  /** Negotiation attempts already made on this offer. Absent means none. */
  negotiationAttempts?: number;
  /** True when the player holds the contract back from automatic delivery. Absent means not held. */
  held?: boolean;
  /** Cumulative payment already credited for partial deliveries. Absent means none. */
  paidTotal?: number;
  /** Penalty already charged for this contract. Absent means none. */
  penaltyCharged?: number;
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

const ORE_BASE_PRICES: Record<string, number> = ORE_PRICES;

// ── Generation ──

/** Generate new available contracts. */
export function generateContracts(
  state: ContractState,
  rng: Random,
  currentTick: number,
  /** Scales every generated contract's `pricePerKg` (Level.ts's `contractPriceMultiplier`); pass 1 for unscaled pricing. */
  priceMultiplier: number,
  /** Ore ids the level's rocks can yield (Level.ts's resolveContractOres). */
  availableOres: readonly string[],
): void {
  // Only refresh if enough time has passed
  if (currentTick - state.lastRefreshTick < CONTRACT_REFRESH_INTERVAL && state.available.length > 0) return;

  // Evict oldest offers so exactly CONTRACTS_PER_REFRESH new ones fit.
  const overflow = state.available.length + CONTRACTS_PER_REFRESH - MAX_AVAILABLE_CONTRACTS;
  if (overflow > 0) state.available.splice(0, overflow);

  for (let i = 0; i < CONTRACTS_PER_REFRESH; i++) {
    state.available.push(generateOneContract(state, rng, priceMultiplier, availableOres));
  }
  state.lastRefreshTick = currentTick;
}

/** Puts one extra offer on the board outside the refresh cycle (an event's special contract); the oldest offer makes room when full. */
export function offerSpecialContract(
  state: ContractState, rng: Random, priceMultiplier: number, availableOres: readonly string[],
): Contract {
  if (state.available.length >= MAX_AVAILABLE_CONTRACTS) state.available.shift();
  const contract = generateOneContract(state, rng, priceMultiplier, availableOres);
  state.available.push(contract);
  return contract;
}

/** The cheapest SUPPLY_COMMON_ORE_COUNT of the given ores, by base price. */
function commonOres(ores: readonly string[]): string[] {
  return [...ores]
    .sort((a, b) => (ORE_BASE_PRICES[a] ?? 10) - (ORE_BASE_PRICES[b] ?? 10))
    .slice(0, SUPPLY_COMMON_ORE_COUNT);
}

function generateOneContract(state: ContractState, rng: Random, priceMultiplier: number, availableOres: readonly string[]): Contract {
  const typeRoll = rng.nextFloat(0, 1);
  // A site whose rocks yield no ore has nothing to sell or supply: rubble only.
  const rubbleOnly = availableOres.length === 0;
  let type: ContractType;
  let materialId: string;
  let pricePerKg: number;
  let description: string;

  if (!rubbleOnly && typeRoll < 0.5) {
    // Ore sale contract
    type = 'ore_sale';
    materialId = rng.pick(availableOres);
    pricePerKg = (ORE_BASE_PRICES[materialId] ?? 10) * rng.nextFloat(0.8, 1.3);
    description = `Deliver ${materialId} ore`;
  } else if (rubbleOnly || typeRoll < 0.8) {
    // Rubble disposal
    type = 'rubble_disposal';
    materialId = '';
    pricePerKg = rng.nextFloat(RUBBLE_DISPOSAL_PRICE_RANGE.min, RUBBLE_DISPOSAL_PRICE_RANGE.max);
    description = 'Dispose of rubble';
  } else {
    // Supply contract (recurring, higher quantity, lower price)
    type = 'supply';
    materialId = rng.pick(commonOres(availableOres)); // Only the site's cheapest ores for supply
    pricePerKg = (ORE_BASE_PRICES[materialId] ?? 10) * rng.nextFloat(0.6, 0.9);
    description = `Supply ${materialId} (bulk)`;
  }

  // The level's multiplier is what its market PAYS for delivered material, so
  // it scales the price and the early-delivery bonus that rides on it. The
  // missed-deadline penalty is deliberately left on the unmultiplied base
  // (#959): a level raises this lever precisely because its own economy is too
  // narrow to be closed at market rate, and scaling the fine with it makes one
  // mis-accepted contract an instant unrecoverable loss on exactly the levels
  // least able to absorb it — tutorial_pit runs at 16.0, where a single
  // 500kg gloomium contract nobody can fill would fine a $340,000 mine
  // $250,000 for the mistake the tutorial exists to let a player make.
  const basePricePerKg = pricePerKg;
  pricePerKg *= priceMultiplier;

  const quantityKg = Math.round(rng.nextFloat(50, 500) / 10) * 10;
  const deadlineTicks = rng.nextInt(30, 100);
  const penaltyAmount = Math.round(quantityKg * basePricePerKg * 0.3);
  const earlyBonus = computeEarlyBonus(quantityKg, pricePerKg);

  const id = state.nextId++;

  return {
    id, type, materialId, description, quantityKg, deliveredKg: 0,
    pricePerKg, deadlineTicks, acceptedAtTick: 0, penaltyAmount, earlyBonus,
    completed: false, expired: false,
  };
}

/** Early-delivery bonus for a contract of the given size and price. */
export function computeEarlyBonus(quantityKg: number, pricePerKg: number): number {
  return Math.round(quantityKg * pricePerKg * NEGOTIATION_EARLY_BONUS_RATE);
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

  const remaining = remainingKg(contract);
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
  /**
   * Match only an offer the site can fill in full (`isFillableSaleOffer`:
   * ore_sale against `collectedOre`, rubble_disposal against stored mass);
   * none covered means no match (#1338).
   */
  fillable?: boolean;
}

/**
 * True when `available` holds an `ore_sale` offer asking for no more of its
 * ore than `collectedOre` already carries — an offer that can be accepted
 * and filled in full, which is what completes a sale. A part delivery
 * completes nothing, so "some of that ore is in storage" is not the
 * question.
 *
 * Both halves of the answer move on their own: `generateContracts` re-rolls
 * which ore is asked for and how much every `CONTRACT_REFRESH_INTERVAL` ticks, while
 * the haulers change what is in storage. That is why this is a condition to
 * wait on (the state dumps expose it as `fillableOreSaleOffered`) rather
 * than a tick count to guess at. `materialId` narrows the question to one
 * ore (#1574: a scenario that must not sell the pit's priciest ore first).
 */
export function hasFillableOreSaleOffer(
  available: readonly Contract[],
  collectedOre: Readonly<Record<string, number>>,
  materialId?: string,
): boolean {
  return available.some(
    c => c.type === 'ore_sale'
      && (materialId === undefined || c.materialId === materialId)
      && isFillableSaleOffer(c, collectedOre, 0),
  );
}

/**
 * True when `offer` is a sale the site can fill in full today: an `ore_sale`
 * asking no more of its ore than `collectedOre` holds, or a `rubble_disposal`
 * asking no more than the raw `storedMassKg` (rubble has no material of its
 * own). `supply` is a recurring bulk deal, never a one-click sale (#1338).
 */
export function isFillableSaleOffer(
  offer: Contract,
  collectedOre: Readonly<Record<string, number>>,
  storedMassKg: number,
): boolean {
  if (offer.type === 'ore_sale') return (collectedOre[offer.materialId] ?? 0) >= offer.quantityKg;
  if (offer.type === 'rubble_disposal') return storedMassKg >= offer.quantityKg;
  return false;
}

/**
 * True when `available` holds any offer `isFillableSaleOffer` accepts: the
 * condition a free-play player waits on, since ore and rubble share one
 * warehouse and selling either one frees room for the haulers to bring more
 * (#1338). Exposed in the state dumps as `fillableSaleOffered`.
 */
export function hasFillableSaleOffer(
  available: readonly Contract[],
  collectedOre: Readonly<Record<string, number>>,
  storedMassKg: number,
): boolean {
  return available.some(c => isFillableSaleOffer(c, collectedOre, storedMassKg));
}

/**
 * True when `available` holds at least one `rubble_disposal` offer.
 *
 * Exists for the same reason `hasFillableOreSaleOffer` does (issue #1263
 * CI-fix): `generateContracts` re-rolls the pool's contents every
 * `CONTRACT_REFRESH_INTERVAL` ticks, so which absolute tick first carries a
 * `rubble_disposal` instance is a property of that RNG stream, not of the
 * player's own path to this point in the tutorial. `tutorial-interactive.json`
 * used to pin a fixed `tick N` pad to "wherever the offer happened to sit"
 * against one traced trajectory, exactly the fragility #1042/#1048 already
 * fixed for the analogous `ore_sale` wait (`fillableOreSaleOffered` below) —
 * a fixed pad breaks the moment anything upstream re-times the run onto a
 * different pool instance, which is what turning on agent occupancy did to
 * the tutorial's own crew-dispatch timing. No ore-quantity check is
 * needed here (unlike the ore_sale sibling): `rubble_disposal` contracts
 * carry `materialId: ''` and are fulfilled from raw `storedMassKg`, so mere
 * presence in the pool is the whole condition to wait on.
 */
export function hasRubbleDisposalOffer(available: readonly Contract[]): boolean {
  return available.some(c => c.type === 'rubble_disposal');
}

/**
 * True when `available` holds an `ore_sale` offer for `materialId`, whatever
 * quantity it asks for — the wait before a scenario clicks that offer's
 * Accept, where nothing has to be in storage yet (#1586: how fast the crew
 * gets there decides which pool instance is on the board, so a fixed
 * position in the run cannot name one).
 */
export function hasOreSaleOffer(available: readonly Contract[], materialId: string): boolean {
  return available.some(c => c.type === 'ore_sale' && c.materialId === materialId);
}

/**
 * Find the first contract in `pool` matching every selector field given
 * (`id`, `type`, `materialId`, `fillable` are ANDed, so an `id` whose
 * contract has another `type` is no match). Null when no selector field is
 * set (nothing to search for) or nothing in `pool` matches.
 */
export function findContract(
  pool: readonly Contract[],
  selector: ContractSelector,
  collectedOre: Readonly<Record<string, number>> = {},
  storedMassKg = 0,
): Contract | null {
  if (selector.id === undefined && selector.type === undefined && selector.materialId === undefined && !selector.fillable) {
    return null;
  }
  return pool.find(c =>
    (selector.id === undefined || c.id === selector.id)
    && (selector.type === undefined || c.type === selector.type)
    && (selector.materialId === undefined || c.materialId === selector.materialId)
    && (!selector.fillable || isFillableSaleOffer(c, collectedOre, storedMassKg)),
  ) ?? null;
}

/** Share of a contract's quantity still undelivered, clamped to [0, 1]. A contract asking for nothing counts as fully undelivered. */
export function undeliveredShare(c: Pick<Contract, 'quantityKg' | 'deliveredKg'>): number {
  if (c.quantityKg <= 0) return 1;
  return Math.min(1, Math.max(0, (c.quantityKg - c.deliveredKg) / c.quantityKg));
}

/** Kilograms a contract still needs delivered (negative if over-delivered). */
export function remainingKg(c: Pick<Contract, 'quantityKg' | 'deliveredKg'>): number {
  return c.quantityKg - c.deliveredKg;
}

/** Penalty owed if the contract expired now: the full penalty scaled by the share still undelivered. */
export function outstandingPenalty(c: Pick<Contract, 'quantityKg' | 'deliveredKg' | 'penaltyAmount'>): number {
  return Math.round(c.penaltyAmount * undeliveredShare(c));
}

/** Active contracts ordered by soonest deadline first (ties: lowest id), without mutating the input. */
export function sortByDeadline(active: readonly Contract[]): Contract[] {
  const deadline = (c: Contract) => c.acceptedAtTick + c.deadlineTicks;
  return [...active].sort((a, b) => deadline(a) - deadline(b) || a.id - b.id);
}

/** Hold or release an active contract for automatic delivery. Returns false when the contract is not active. */
export function setContractHeld(state: ContractState, contractId: number, held: boolean): boolean {
  const contract = state.active.find(c => c.id === contractId);
  if (!contract) return false;
  contract.held = held;
  return true;
}

/** Stored kilograms that can fill the contract: raw stored mass for rubble, the ore ledger entry otherwise. */
export function storedStockKg(
  c: Pick<Contract, 'type' | 'materialId'>,
  collectedOre: Readonly<Record<string, number>>,
  storedMassKg: number,
): number {
  return c.type === 'rubble_disposal' ? storedMassKg : (collectedOre[c.materialId] ?? 0);
}

/** True when stored stock of the contract's material cannot cover what it still needs (held contracts included). */
export function contractShortOfStock(
  c: Contract,
  collectedOre: Readonly<Record<string, number>>,
  storedMassKg: number,
): boolean {
  return storedStockKg(c, collectedOre, storedMassKg) < remainingKg(c);
}

/**
 * Check and expire overdue contracts. Returns the penalty charged, scaled by
 * the share still undelivered, with what was delivered and paid before expiry.
 */
export function checkDeadlines(
  state: ContractState,
  currentTick: number,
): Array<{ contractId: number; penalty: number; deliveredKg: number; paid: number }> {
  const penalties: Array<{ contractId: number; penalty: number; deliveredKg: number; paid: number }> = [];

  for (let i = state.active.length - 1; i >= 0; i--) {
    const c = state.active[i]!;
    if (c.completed || c.expired) continue;

    const elapsed = currentTick - c.acceptedAtTick;
    if (elapsed > c.deadlineTicks) {
      c.expired = true;
      const penalty = outstandingPenalty(c);
      c.penaltyCharged = penalty;
      penalties.push({ contractId: c.id, penalty, deliveredKg: c.deliveredKg, paid: c.paidTotal ?? 0 });
      state.active.splice(i, 1);
      state.completedHistory.push(c);
    }
  }

  return penalties;
}

/** Why a contract cannot be accepted yet, or null. */
export function contractAcceptBlocker(
  c: Contract,
  hasFreightWarehouse: boolean,
): 'needs_freight_warehouse' | null {
  return c.type === 'ore_sale' && !hasFreightWarehouse ? 'needs_freight_warehouse' : null;
}

/** Guarantee the level's scripted ore-sale offer is on the board (#1600). */
export function ensureScriptedOreSale(
  state: ContractState,
  offer: ScriptedOreSaleOffer | undefined,
  priceMultiplier: number,
  tick: number,
): void {
  void state; void offer; void priceMultiplier; void tick; // TODO: implement
}
