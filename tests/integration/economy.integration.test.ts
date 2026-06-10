// BlastSimulator2026 — Integration tests: Economy system (Phase 4)
// Covers finance, contracts, logistics, corruption, and negotiation subsystems.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { createGame } from '../../src/core/state/GameState.js';
import {
  createFinanceState,
  addIncome,
  addExpense,
  getBalance,
  getFinancialReport,
  type FinanceState,
} from '../../src/core/economy/Finance.js';
import {
  createContractState,
  acceptContract,
  deliverMaterials,
  generateContracts,
  type ContractState,
  type Contract,
} from '../../src/core/economy/Contract.js';
import {
  createLogisticsState,
  syncLogisticsCapacity,
  type LogisticsState,
} from '../../src/core/economy/Logistics.js';
import {
  attemptCorruption,
  getCorruptionLevel,
  type CorruptionState,
  createCorruptionState,
} from '../../src/core/economy/Corruption.js';
import { Random } from '../../src/core/math/Random.js';

// ── Contract fixture helpers ─────────────────────────────────────────────────

/**
 * Insert a fixed ore_sale contract directly into the available list for deterministic tests.
 */
function insertOreSaleContract(
  state: ContractState,
  quantityKg: number,
  pricePerKg: number,
): Contract {
  const id = state.nextId++;
  const contract: Contract = {
    id,
    type: 'ore_sale',
    materialId: 'blingite',
    description: `[test fixture] deliver ${quantityKg} kg blingite @ $${pricePerKg}/kg`,
    quantityKg,
    deliveredKg: 0,
    pricePerKg,
    deadlineTicks: 500,
    acceptedAtTick: 0,
    penaltyAmount: Math.round(quantityKg * pricePerKg * 0.3),
    earlyBonus: Math.round(quantityKg * pricePerKg * 0.15),
    completed: false,
    expired: false,
  };
  state.available.push(contract);
  return contract;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

// ── Economy ──────────────────────────────────────────────────────────────────

describe('Economy', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('new game starts with default cash balance', () => {
    // TODO: implement
  });

  it('addIncome increases cash and records a transaction', () => {
    // TODO: implement
  });

  it('addExpense decreases cash and records a transaction', () => {
    // TODO: implement
  });

  it('acceptContract moves a contract from available to active', () => {
    // TODO: implement
  });

  it('deliverMaterials returns correct payment for partial delivery', () => {
    // TODO: implement
  });

  it('complete contract delivery moves contract to completedHistory', () => {
    // TODO: implement
  });

  it('generateContracts produces valid contracts with non-zero quantities', () => {
    // TODO: implement
  });

  it('syncLogisticsCapacity updates storage capacity from buildings', () => {
    // TODO: implement
  });

  it('attemptCorruption reduces cash and increases corruption level', () => {
    // TODO: implement
  });

  it('getFinancialReport returns a detailed breakdown of income and expenses', () => {
    // TODO: implement
  });
});
