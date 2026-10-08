// BlastSimulator2026 — Console commands for economy (Phase 4)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { getBalance, getFinancialReport } from '../../core/economy/Finance.js';
import {
  generateContracts,
  acceptContract,
  contractAcceptBlocker,
  setContractHeld,
  findContract,
  remainingKg,
  storedStockKg,
  type Contract,
  type ContractSelector,
  type ContractType,
} from '../../core/economy/Contract.js';
import { freightWarehouseSites } from '../../core/entities/BuildingWarehouse.js';
import { bestAvailableManagerLevel } from '../../core/entities/Employee.js';
import { FRAGMENT_SPLIT_EPSILON_KG } from '../../core/config/balance.js';
import { negotiateContractAtTick, negotiationRefusalReason } from '../../core/economy/Negotiation.js';
import { deliverStoredOre, bookDeliveryIncome } from '../../core/economy/ContractFulfilment.js';
import { getFragmentCounts } from '../../core/economy/Logistics.js';
import { rubbleStockKg } from '../../core/economy/SpoilHeaps.js';
import type { Building } from '../../core/entities/Building.js';
import { formatDollars } from '../../core/economy/formatMoney.js';
import { Random } from '../../core/math/Random.js';
import { t } from '../../core/i18n/I18n.js';
import { requireGame, resolveContractPriceMultiplier } from './commandUtils.js';
import { resolveContractOres } from '../../core/campaign/Level.js';

// ── finances command ──

export function financesCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;

  const balance = getBalance(state.finances);
  const report = getFinancialReport(state.finances, state.tickCount, 0);

  const lines = [
    `Balance: ${formatDollars(balance)}`,
    `Bankrupt: ${state.bankruptcy.bankrupt ? 'YES' : 'No'}`,
    '',
    `Total income:   ${formatDollars(report.totalIncome)}`,
    `Total expenses: ${formatDollars(report.totalExpenses)}`,
    `Net profit:     ${formatDollars(report.netProfit)}`,
    `Operating profit: ${formatDollars(report.operatingProfit)}`,
  ];

  if (report.incomeByCategory.length > 0) {
    lines.push('', 'Income breakdown:');
    for (const c of report.incomeByCategory) {
      lines.push(`  ${c.category}: ${formatDollars(c.total)}`);
    }
  }

  if (report.expensesByCategory.length > 0) {
    lines.push('', 'Expense breakdown:');
    for (const c of report.expensesByCategory) {
      lines.push(`  ${c.category}: ${formatDollars(c.total)}`);
    }
  }

  // Show last 5 transactions
  const recent = state.finances.transactions.slice(-5);
  if (recent.length > 0) {
    lines.push('', 'Recent transactions:');
    for (const t of recent) {
      const sign = t.type === 'income' ? '+' : '-';
      lines.push(`  [tick ${t.tick}] ${sign}${formatDollars(t.amount)} (${t.category}) ${t.description}`);
    }
  }

  return { success: true, output: lines.join('\n') };
}

// ── contract command ──

const CONTRACT_TYPES: readonly ContractType[] = ['ore_sale', 'rubble_disposal', 'supply'];

/**
 * Parse a contract subcommand's target from its args: a numeric id
 * (positional or `id:`, the existing form) or a `type:`/`material:` selector
 * that survives the offer pool rotating (#597 — see `ContractSelector`'s
 * doc comment in `Contract.ts`). Returns `null` when neither form is given.
 */
function parseContractSelector(args: string[], named: Record<string, string>): ContractSelector | null {
  const idRaw = args[1] ?? named['id'];
  const id = idRaw !== undefined ? parseInt(idRaw, 10) : NaN;
  if (!isNaN(id)) return { id };

  const typeRaw = named['type'];
  const type = typeRaw !== undefined && (CONTRACT_TYPES as readonly string[]).includes(typeRaw)
    ? (typeRaw as ContractType)
    : undefined;
  const materialId = named['material'];
  const fillable = named['fillable'] === 'true';
  if (type === undefined && materialId === undefined && !fillable) return null;
  return {
    ...(fillable ? { fillable } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(materialId !== undefined ? { materialId } : {}),
  };
}

/** Human-readable name for a selector, for a "not found" message. */
function describeContractSelector(selector: ContractSelector): string {
  if (selector.id !== undefined) return `#${selector.id}`;
  return ['contract', selector.type, selector.materialId].filter(Boolean).join(' ');
}

/** Resolve a subcommand's target contract against `pool`, or a CommandResult error explaining why not. */
function resolveContract(
  pool: readonly Contract[],
  args: string[],
  named: Record<string, string>,
  usage: string,
  stock: { collectedOre: Readonly<Record<string, number>>; logistics: { storedMassKg: number }; buildings: { buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[] } },
): Contract | CommandResult {
  const selector = parseContractSelector(args, named);
  if (!selector) return { success: false, output: usage };
  const contract = findContract(pool, selector, stock.collectedOre, rubbleStockKg(stock.logistics.storedMassKg, stock.buildings.buildings));
  if (!contract && selector.fillable) return { success: false, output: t('economy.contract.none_fillable') };
  if (!contract) return { success: false, output: `Contract ${describeContractSelector(selector)} not found.` };
  return contract;
}

export function contractCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'list';
  const rng = new Random(state.seed + state.tickCount);

  switch (sub) {
    case 'list': {
      generateContracts(state.contracts, rng, state.tickCount, resolveContractPriceMultiplier(state), resolveContractOres(state));
      if (state.contracts.available.length === 0) {
        return { success: true, output: t('ui.contracts.none') };
      }
      const lines = ['Available contracts:'];
      for (const c of state.contracts.available) {
        lines.push(
          `  [${c.id}] ${c.description} — ${c.quantityKg}kg @ $${c.pricePerKg.toFixed(2)}/kg` +
          ` | deadline: ${c.deadlineTicks} ticks | penalty: $${c.penaltyAmount}`,
        );
      }
      return { success: true, output: lines.join('\n') };
    }

    case 'accept': {
      const usage = t('economy.contract.usage_accept');
      const resolved = resolveContract(state.contracts.available, args, named, usage, state);
      if ('success' in resolved) return resolved;
      const offer = state.contracts.available.find(c => c.id === resolved.id);
      if (offer && contractAcceptBlocker(offer, freightWarehouseSites(state.buildings).length > 0) === 'needs_freight_warehouse') {
        return { success: false, output: t('economy.contract.needs_warehouse') };
      }
      const contract = acceptContract(state.contracts, resolved.id, state.tickCount);
      if (!contract) return { success: false, output: `Contract #${resolved.id} not found in available list.` };
      return { success: true, output: `Accepted contract #${contract.id}: ${contract.description}` };
    }

    case 'decline': {
      const usage = t('economy.contract.usage_decline');
      const resolved = resolveContract(state.contracts.available, args, named, usage, state);
      if ('success' in resolved) return resolved;
      state.contracts.available = state.contracts.available.filter(c => c.id !== resolved.id);
      return { success: true, output: `Declined contract #${resolved.id}.` };
    }

    case 'status': {
      if (state.contracts.active.length === 0) {
        return { success: true, output: t('ui.contracts.none_active') };
      }
      const lines = ['Active contracts:'];
      for (const c of state.contracts.active) {
        const pct = ((c.deliveredKg / c.quantityKg) * 100).toFixed(0);
        const remaining = c.deadlineTicks - (state.tickCount - c.acceptedAtTick);
        lines.push(
          `  [${c.id}] ${c.description} — ${c.deliveredKg}/${c.quantityKg}kg (${pct}%)` +
          ` | ${remaining} ticks remaining | penalty: $${c.penaltyAmount}` +
          (c.held ? ` ${t('economy.contract.held_badge')}` : ''),
        );
      }
      return { success: true, output: lines.join('\n') };
    }

    case 'deliver': {
      const usage = t('economy.contract.usage_deliver');
      const amount = parseFloat(named['amount'] ?? '0');
      if (!Number.isFinite(amount) || amount <= 0) {
        return { success: false, output: usage };
      }
      const resolved = resolveContract(state.contracts.active, args, named, usage, state);
      if ('success' in resolved) return resolved;
      const contract = resolved;
      const id = contract.id;
      // A manual request is all-or-nothing; only the automatic path caps at stock.
      const stock = storedStockKg(contract, state.collectedOre, rubbleStockKg(state.logistics.storedMassKg, state.buildings.buildings));
      if (Math.min(amount, remainingKg(contract)) > stock + FRAGMENT_SPLIT_EPSILON_KG) {
        return { success: false, output: t('economy.contract.deliver_insufficient', { material: contract.materialId || t('ui.contracts.material_rubble') }) };
      }
      const delivery = deliverStoredOre(state.contracts, state.logistics, state.collectedOre, id, amount, state.tickCount, state.buildings.buildings);
      if (!delivery.success) return { success: false, output: delivery.error };
      const result = delivery.data;
      bookDeliveryIncome(state, id, result, state.tickCount);
      const msg = result.completed
        ? `Contract #${id} COMPLETED! Payment: $${result.payment.toFixed(2)}` +
          (result.bonus > 0 ? ` + early bonus: $${result.bonus.toFixed(2)}` : '')
        : `Delivered to contract #${id}. Payment: $${result.payment.toFixed(2)}`;
      return { success: true, output: msg };
    }

    case 'hold':
    case 'release': {
      const usage = t(sub === 'hold' ? 'economy.contract.usage_hold' : 'economy.contract.usage_release');
      const resolved = resolveContract(state.contracts.active, args, named, usage, state);
      if ('success' in resolved) return resolved;
      setContractHeld(state.contracts, resolved.id, sub === 'hold');
      return { success: true, output: t(sub === 'hold' ? 'economy.contract.held' : 'economy.contract.released', { id: resolved.id }) };
    }

    case 'negotiate': {
      const usage = t('economy.contract.usage_negotiate');
      const resolved = resolveContract(state.contracts.available, args, named, usage, state);
      if ('success' in resolved) return resolved;
      const id = resolved.id;
      const managerLevel = bestAvailableManagerLevel(state.employees.employees);
      // `managerLevel === null` is the same gate, repeated only to narrow the type for the call below.
      if (negotiationRefusalReason(resolved, managerLevel) === 'no_manager' || managerLevel === null) {
        return { success: false, output: t('economy.negotiation.no_manager') };
      }
      const result = negotiateContractAtTick(state.contracts, id, 0, state.seed, state.tickCount, managerLevel);
      if ('refused' in result && result.refused === 'not_found') return { success: false, output: t('economy.negotiation.not_found', { id }) };
      if ('refused' in result) return { success: false, output: t('economy.negotiation.already_negotiated', { id }) };
      state.contracts.lastNegotiation = { contractId: id, success: result.success, changes: result.changes };
      const lines = [
        t(result.success ? 'economy.negotiation.success' : 'economy.negotiation.failure'),
        ...result.changes.map(c => `  • ${c.field} ${c.improved ? 'improved' : 'worsened'} by ${c.pct}%`),
      ];
      return { success: true, output: lines.join('\n') };
    }

    default:
      return { success: false, output: t('economy.contract.usage_combined') };
  }
}

// ── fragments command ──

export function fragmentsCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'status';

  if (sub === 'status') {
    const counts = getFragmentCounts(state.logistics);
    return {
      success: true,
      output: [
        `Fragments:`,
        `  On ground:  ${counts.onGround}`,
        `  In transit: ${counts.inTransit}`,
        `  Stored:     ${counts.stored}`,
        `  Total:      ${counts.total}`,
        `Storage: ${state.logistics.storedMassKg.toFixed(0)}/${state.logistics.storageCapacityKg}kg`,
      ].join('\n'),
    };
  }

  return { success: false, output: t('economy.fragments.usage') };
}
