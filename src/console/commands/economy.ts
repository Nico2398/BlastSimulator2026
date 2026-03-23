// BlastSimulator2026 — Console commands for economy (Phase 4)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { getBalance, getFinancialReport, addIncome } from '../../core/economy/Finance.js';
import {
  generateContracts,
  acceptContract,
  deliverMaterials,
} from '../../core/economy/Contract.js';
import { negotiateContract } from '../../core/economy/Negotiation.js';
import { getFragmentCounts } from '../../core/economy/Logistics.js';
import { Random } from '../../core/math/Random.js';

function requireGame(ctx: GameContext): CommandResult | null {
  if (!ctx.state) return { success: false, output: 'No game loaded. Use new_game first.' };
  return null;
}

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
      const id = parseInt(args[1] ?? named['id'] ?? '', 10);
      if (isNaN(id)) return { success: false, output: 'Usage: contract accept <id>' };
      const contract = acceptContract(state.contracts, id, state.tickCount);
      if (!contract) return { success: false, output: `Contract #${id} not found in available list.` };
      return { success: true, output: `Accepted contract #${id}: ${contract.description}` };
    }

    case 'decline': {
      const id = parseInt(args[1] ?? named['id'] ?? '', 10);
      if (isNaN(id)) return { success: false, output: 'Usage: contract decline <id>' };
      const before = state.contracts.available.length;
      state.contracts.available = state.contracts.available.filter(c => c.id !== id);
      if (state.contracts.available.length === before) {
        return { success: false, output: `Contract #${id} not found.` };
      }
      return { success: true, output: `Declined contract #${id}.` };
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
      const id = parseInt(args[1] ?? '', 10);
      const amount = parseFloat(named['amount'] ?? '0');
      if (isNaN(id) || amount <= 0) {
        return { success: false, output: 'Usage: contract deliver <id> amount:<kg>' };
      }
      const result = deliverMaterials(state.contracts, id, amount, state.tickCount);
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
      const id = parseInt(args[1] ?? named['id'] ?? '', 10);
      if (isNaN(id)) return { success: false, output: 'Usage: contract negotiate <id>' };
      const result = negotiateContract(state.contracts, id, 0, rng);
      if (!result) return { success: false, output: `Contract #${id} not found.` };
      const lines = [
        result.success ? 'Negotiation SUCCEEDED!' : 'Negotiation FAILED.',
        ...result.changes.map(c => `  • ${c}`),
      ];
      return { success: true, output: lines.join('\n') };
    }

    default:
      return { success: false, output: 'Usage: contract (list|accept|decline|status|deliver|negotiate) [id] [amount:X]' };
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

  return { success: false, output: 'Usage: fragments status' };
}
