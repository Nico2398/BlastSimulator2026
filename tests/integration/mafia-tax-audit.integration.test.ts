// #1409 — Smuggling is balanced by a tax audit.
// Seeded multi-run simulation of the audit model through the exported TaxAudit functions
// (booking, per-tick draw, closing audit), plus a smuggling-only Dusty Hollow run through
// the console. Model and targets: docs/plans/issue-1409-smuggling-balance.md (§5, §9).
import { describe, it, expect } from 'vitest';
import { Random } from '../../src/core/math/Random.js';
import {
  DEFAULT_TAX_AUDIT_PARAMS,
  createTaxAuditState,
  bookTaxAuditIncome,
  tickTaxAudit,
  closingAudit,
  targetGain,
  smugglingIncomeRatio,
  type TaxAuditParams,
  type AuditOutcome,
} from '../../src/core/events/TaxAudit.js';
import { makeCampaignCtx } from './full-level/helpers.js';
import { tickWithEvents } from './full-level/helpers.js';
import { corruptCommand, mafiaCommand } from '../../src/console/commands/events.js';

const LEVEL_TICKS = 3_000; // ~4 months; the clean mean equals G* at any length
const LEGIT_PER_TICK = 100;

interface RunResult {
  gain: number;
  audits: number;
  clean: number;
  regularisations: number;
  owed: number;
}

/** One level of steady smuggling at `share`, ending with the closing audit. */
function simulateRun(share: number, seed: number, params: TaxAuditParams): RunResult {
  const a = createTaxAuditState();
  const rng = new Random(seed);
  const smuggledPerTick = LEGIT_PER_TICK * smugglingIncomeRatio(share);
  let smuggled = 0;
  let owed = 0;
  let clean = 0;
  let regularisations = 0;
  const account = (o: AuditOutcome | null): void => {
    if (!o) return;
    if (o.kind === 'clean') clean++;
    else { regularisations++; owed += o.owed; }
  };
  for (let tick = 1; tick <= LEVEL_TICKS; tick++) {
    bookTaxAuditIncome(a, tick, LEGIT_PER_TICK, smuggledPerTick);
    smuggled += smuggledPerTick;
    account(tickTaxAudit(a, tick, rng, params));
  }
  account(closingAudit(a, rng, params));
  return {
    gain: (smuggled - owed) / (LEGIT_PER_TICK * LEVEL_TICKS),
    audits: clean + regularisations,
    clean,
    regularisations,
    owed,
  };
}

function runMany(share: number, runs: number, params: TaxAuditParams, seedBase: number): RunResult[] {
  const out: RunResult[] = [];
  for (let i = 0; i < runs; i++) out.push(simulateRun(share, seedBase + i, params));
  return out;
}

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

describe('tax audit balance — seeded multi-run simulation (#1409)', () => {
  const NO_RECIDIVISM: TaxAuditParams = { ...DEFAULT_TAX_AUDIT_PARAMS, surcharge: 0 };
  const RUNS = 300;

  it('with recidivism off, mean gain at 0 % is exactly 0', () => {
    const runs = runMany(0, RUNS, NO_RECIDIVISM, 1_000);
    expect(mean(runs.map(r => r.gain))).toBe(0);
  });

  it('with recidivism off, mean gain at 20 % is within tolerance of G*(0.2) = +10 %', () => {
    const runs = runMany(0.2, RUNS, NO_RECIDIVISM, 2_000);
    expect(Math.abs(mean(runs.map(r => r.gain)) - targetGain(0.2))).toBeLessThan(0.05);
  });

  it('with recidivism off, mean gain at 50 % is within tolerance of G*(0.5) = -25 %', () => {
    const runs = runMany(0.5, RUNS, NO_RECIDIVISM, 3_000);
    expect(Math.abs(mean(runs.map(r => r.gain)) - targetGain(0.5))).toBeLessThan(0.1);
  });

  it('with recidivism on, the ordering is 20 % > 0 % > 50 %', () => {
    const g0 = mean(runMany(0, RUNS, DEFAULT_TAX_AUDIT_PARAMS, 4_000).map(r => r.gain));
    const g20 = mean(runMany(0.2, RUNS, DEFAULT_TAX_AUDIT_PARAMS, 5_000).map(r => r.gain));
    const g50 = mean(runMany(0.5, RUNS, DEFAULT_TAX_AUDIT_PARAMS, 6_000).map(r => r.gain));
    expect(g20).toBeGreaterThan(g0);
    expect(g0).toBeGreaterThan(g50);
  });

  it('50 % is worse than honest play on average, 20 % better, even with recidivism', () => {
    expect(mean(runMany(0.2, RUNS, DEFAULT_TAX_AUDIT_PARAMS, 7_000).map(r => r.gain))).toBeGreaterThan(0);
    expect(mean(runMany(0.5, RUNS, DEFAULT_TAX_AUDIT_PARAMS, 8_000).map(r => r.gain))).toBeLessThan(0);
  });

  it('0 % never pays a regularisation but is sometimes audited (clean)', () => {
    const runs = runMany(0, RUNS, DEFAULT_TAX_AUDIT_PARAMS, 9_000);
    expect(runs.every(r => r.regularisations === 0 && r.owed === 0)).toBe(true);
    expect(runs.some(r => r.clean > 0)).toBe(true);
  });

  it('20 % is volatile: some runs end ahead of honest play, some behind', () => {
    const gains = runMany(0.2, RUNS, DEFAULT_TAX_AUDIT_PARAMS, 10_000).map(r => r.gain);
    expect(gains.some(g => g > 0)).toBe(true);
    expect(gains.some(g => g < 0)).toBe(true);
  });

  it('an audit is high-chance but never certain at 50 %: some runs are never caught', () => {
    const runs = runMany(0.5, RUNS, DEFAULT_TAX_AUDIT_PARAMS, 11_000);
    expect(runs.some(r => r.regularisations === 0)).toBe(true);
    expect(runs.filter(r => r.regularisations > 0).length / RUNS).toBeGreaterThan(0.5);
  });

  it('is deterministic for a given seed', () => {
    expect(simulateRun(0.2, 77, DEFAULT_TAX_AUDIT_PARAMS)).toEqual(simulateRun(0.2, 77, DEFAULT_TAX_AUDIT_PARAMS));
  });
});

describe('smuggling-only Dusty Hollow run (#1409)', () => {
  it('earns $0 and cannot complete the level', () => {
    const ctx = makeCampaignCtx('dusty_hollow');
    ctx.state!.cash += 1_000_000;
    for (let i = 0; i < 30 && !ctx.state!.corruption.mafiaUnlocked; i++) {
      corruptCommand(ctx, [], { target: 'inspector' });
    }
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(true);

    const result = mafiaCommand(ctx, ['smuggle'], { volume: '1' });
    expect(result.success).toBe(true);

    tickWithEvents(ctx, 200);

    const smuggling = ctx.state!.finances.transactions.filter(tx => tx.type === 'income' && tx.category === 'smuggling');
    expect(smuggling.reduce((s, tx) => s + tx.amount, 0)).toBe(0);
    expect(ctx.state!.levelEnded).toBe(false);
    expect(ctx.state!.levelEndReason).toBeNull();
    expect(ctx.state!.mafia.exposureRisk).toBeLessThan(0.9);
  });
});
