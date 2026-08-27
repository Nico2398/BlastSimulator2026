// BlastSimulator2026 — Console commands for economy (Phase 4)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { getBalance, getFinancialReport, addIncome } from '../../core/economy/Finance.js';
import {
  generateContracts,
  acceptContract,
  deliverMaterials,
  findContract,
  type Contract,
  type ContractSelector,
  type ContractType,
} from '../../core/economy/Contract.js';
import { negotiateContract } from '../../core/economy/Negotiation.js';
import { getFragmentCounts, consumeStoredOre } from '../../core/economy/Logistics.js';
import { Random } from '../../core/math/Random.js';
import { t } from '../../core/i18n/I18n.js';
import { requireGame } from './commandUtils.js';

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
    `Balance: $${balance.toFixed(2)}`,
    `Bankrupt: ${state.finances.isBankrupt ? 'YES' : 'No'}`,
    '',
    `Total income:   $${report.totalIncome.toFixed(2)}`,
    `Total expenses: $${report.totalExpenses.toFixed(2)}`,
    `Net profit:     $${report.netProfit.toFixed(2)}`,
  ];

  if (report.incomeByCategory.length > 0) {
    lines.push('', 'Income breakdown:');
    for (const c of report.incomeByCategory) {
      lines.push(`  ${c.category}: $${c.total.toFixed(2)}`);
    }
  }

  if (report.expensesByCategory.length > 0) {
    lines.push('', 'Expense breakdown:');
    for (const c of report.expensesByCategory) {
      lines.push(`  ${c.category}: $${c.total.toFixed(2)}`);
    }
  }

  // Show last 5 transactions
  const recent = state.finances.transactions.slice(-5);
  if (recent.length > 0) {
    lines.push('', 'Recent transactions:');
    for (const t of recent) {
      const sign = t.type === 'income' ? '+' : '-';
      lines.push(`  [tick ${t.tick}] ${sign}$${t.amount.toFixed(2)} (${t.category}) ${t.description}`);
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
  if (type === undefined && materialId === undefined) return null;
  return {
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
): Contract | CommandResult {
  const selector = parseContractSelector(args, named);
  if (!selector) return { success: false, output: usage };
  const contract = findContract(pool, selector);
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
      generateContracts(state.contracts, rng, state.tickCount);
      if (state.contracts.available.length === 0) {
        return { success: true, output: 'No contracts available.' };
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
      const resolved = resolveContract(state.contracts.available, args, named, usage);
      if ('success' in resolved) return resolved;
      const contract = acceptContract(state.contracts, resolved.id, state.tickCount);
      if (!contract) return { success: false, output: `Contract #${resolved.id} not found in available list.` };
      return { success: true, output: `Accepted contract #${contract.id}: ${contract.description}` };
    }

    case 'decline': {
      const usage = t('economy.contract.usage_decline');
      const resolved = resolveContract(state.contracts.available, args, named, usage);
      if ('success' in resolved) return resolved;
      state.contracts.available = state.contracts.available.filter(c => c.id !== resolved.id);
      return { success: true, output: `Declined contract #${resolved.id}.` };
    }

    case 'status': {
      if (state.contracts.active.length === 0) {
        return { success: true, output: 'No active contracts.' };
      }
      const lines = ['Active contracts:'];
      for (const c of state.contracts.active) {
        const pct = ((c.deliveredKg / c.quantityKg) * 100).toFixed(0);
        const remaining = c.deadlineTicks - (state.tickCount - c.acceptedAtTick);
        lines.push(
          `  [${c.id}] ${c.description} — ${c.deliveredKg}/${c.quantityKg}kg (${pct}%)` +
          ` | ${remaining} ticks remaining | penalty: $${c.penaltyAmount}`,
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
      const resolved = resolveContract(state.contracts.active, args, named, usage);
      if ('success' in resolved) return resolved;
      const contract = resolved;
      const id = contract.id;
      const cappedAmount = Math.min(amount, contract.quantityKg - contract.deliveredKg);
      if (cappedAmount <= 0) {
        return { success: false, output: `Contract #${id} already fulfilled or has no outstanding quantity.` };
      }
      const consumption = consumeStoredOre(state.logistics, state.collectedOre, contract.materialId, cappedAmount);
      if (!consumption.success) {
        return { success: false, output: consumption.error ?? `Not enough ${contract.materialId || 'material'} in storage to deliver.` };
      }
      const deliverKg = Math.min(consumption.consumedKg, cappedAmount);
      const result = deliverMaterials(state.contracts, id, deliverKg, state.tickCount);
      if (result.payment === 0 && !result.completed) {
        return { success: false, output: `Contract #${id} not found or already completed.` };
      }
      state.cash += result.payment;
      addIncome(state.finances, result.payment, 'contracts', `Contract #${id} delivery`, state.tickCount);
      if (result.bonus > 0) {
        state.cash += result.bonus;
        addIncome(state.finances, result.bonus, 'bonus', `Contract #${id} early bonus`, state.tickCount);
      }
      const msg = result.completed
        ? `Contract #${id} COMPLETED! Payment: $${result.payment.toFixed(2)}` +
          (result.bonus > 0 ? ` + early bonus: $${result.bonus.toFixed(2)}` : '')
        : `Delivered to contract #${id}. Payment: $${result.payment.toFixed(2)}`;
      return { success: true, output: msg };
    }

    case 'negotiate': {
      const usage = t('economy.contract.usage_negotiate');
      const resolved = resolveContract(state.contracts.available, args, named, usage);
      if ('success' in resolved) return resolved;
      const id = resolved.id;
      const result = negotiateContract(state.contracts, id, 0, rng);
      if (!result) return { success: false, output: `Contract #${id} not found.` };
      state.contracts.lastNegotiation = { contractId: id, success: result.success, changes: result.changes };
      const lines = [
        result.success ? 'Negotiation SUCCEEDED!' : 'Negotiation FAILED.',
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
