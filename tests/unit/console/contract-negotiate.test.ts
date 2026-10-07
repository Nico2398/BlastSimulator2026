// BlastSimulator2026 — `contract negotiate` is once per offer (#1366)

import { describe, it, expect, afterEach } from 'vitest';
import { contractCommand } from '../../../src/console/commands/economy.js';
import { generateContracts } from '../../../src/core/economy/Contract.js';
import { Random } from '../../../src/core/math/Random.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { makeGameContext } from '../../helpers/gameContext.js';

afterEach(() => setLocale('en'));

function setup(opts: { manager?: boolean } = {}) {
  const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
  const state = ctx.state!;
  if (opts.manager !== false) hireEmployee(state.employees, 'manager', new Random(3), 0, 0, 0);
  generateContracts(state.contracts, new Random(5), state.tickCount);
  return { ctx, state };
}

function terms(c: { pricePerKg: number; deadlineTicks: number; penaltyAmount: number; earlyBonus: number }) {
  return [c.pricePerKg, c.deadlineTicks, c.penaltyAmount, c.earlyBonus];
}

describe('contract negotiate once per offer', () => {
  it('first call succeeds as a command and records lastNegotiation', () => {
    const { ctx, state } = setup();
    const id = state.contracts.available[0]!.id;
    const r = contractCommand(ctx, ['negotiate'], { id: String(id) });
    expect(r.success).toBe(true);
    expect(state.contracts.lastNegotiation?.contractId).toBe(id);
    expect(state.contracts.available[0]!.negotiationAttempts).toBe(1);
  });

  it('second call is refused with a localized message naming the id; terms and lastNegotiation unchanged', () => {
    const { ctx, state } = setup();
    const c = state.contracts.available[0]!;
    contractCommand(ctx, ['negotiate'], { id: String(c.id) });
    const termsBefore = terms(c);
    const lastBefore = JSON.parse(JSON.stringify(state.contracts.lastNegotiation));

    const en = contractCommand(ctx, ['negotiate'], { id: String(c.id) });
    expect(en.success).toBe(false);
    expect(en.output).toContain(String(c.id));
    expect(en.output).not.toContain('economy.negotiation');
    setLocale('fr');
    const fr = contractCommand(ctx, ['negotiate'], { id: String(c.id) });
    expect(fr.success).toBe(false);
    expect(fr.output).toContain(String(c.id));
    expect(fr.output).not.toBe(en.output);
    expect(terms(c)).toEqual(termsBefore);
    expect(state.contracts.lastNegotiation).toEqual(lastBefore);
  });

  it('30 repeats change the terms at most once', () => {
    const { ctx, state } = setup();
    const c = state.contracts.available[0]!;
    const seen = new Set<string>([JSON.stringify(terms(c))]);
    for (let i = 0; i < 30; i++) {
      contractCommand(ctx, ['negotiate'], { id: String(c.id) });
      state.tickCount += 1;
      seen.add(JSON.stringify(terms(c)));
    }
    expect(seen.size).toBeLessThanOrEqual(2);
    expect(c.negotiationAttempts).toBe(1);
  });

  it('two different offers at the same tick can each be negotiated once', () => {
    const { ctx, state } = setup();
    const [a, b] = state.contracts.available;
    expect(contractCommand(ctx, ['negotiate'], { id: String(a!.id) }).success).toBe(true);
    expect(contractCommand(ctx, ['negotiate'], { id: String(b!.id) }).success).toBe(true);
  });
});

describe('contract negotiate needs a manager (#1340)', () => {
  it('refuses with a localized no_manager message and spends no attempt', () => {
    const { ctx, state } = setup({ manager: false });
    const c = state.contracts.available[0]!;
    const before = terms(c);
    const r = contractCommand(ctx, ['negotiate'], { id: String(c.id) });
    expect(r.success).toBe(false);
    expect(r.output).toBe(t('economy.negotiation.no_manager', { id: c.id }));
    expect(r.output).not.toContain('economy.negotiation');
    expect(c.negotiationAttempts ?? 0).toBe(0);
    expect(terms(c)).toEqual(before);
    expect(state.contracts.lastNegotiation).toBeUndefined();
  });

  it('no_manager message differs under fr', () => {
    const { ctx, state } = setup({ manager: false });
    const id = String(state.contracts.available[0]!.id);
    const en = contractCommand(ctx, ['negotiate'], { id }).output;
    setLocale('fr');
    const fr = contractCommand(ctx, ['negotiate'], { id }).output;
    expect(fr).not.toBe(en);
    expect(fr).not.toContain('economy.negotiation');
  });

  it('an injured only-manager blocks negotiation', () => {
    const { ctx, state } = setup();
    state.employees.employees[0]!.injured = true;
    const r = contractCommand(ctx, ['negotiate'], { id: String(state.contracts.available[0]!.id) });
    expect(r.success).toBe(false);
    expect(state.contracts.available[0]!.negotiationAttempts ?? 0).toBe(0);
  });

  it('works after the manager arrives, then the second attempt is still refused', () => {
    const { ctx, state } = setup({ manager: false });
    const c = state.contracts.available[0]!;
    expect(contractCommand(ctx, ['negotiate'], { id: String(c.id) }).success).toBe(false);
    hireEmployee(state.employees, 'manager', new Random(3), 0, 0, 0);
    expect(contractCommand(ctx, ['negotiate'], { id: String(c.id) }).success).toBe(true);
    expect(c.negotiationAttempts).toBe(1);
    const again = contractCommand(ctx, ['negotiate'], { id: String(c.id) });
    expect(again.success).toBe(false);
    expect(again.output).toBe(t('economy.negotiation.already_negotiated', { id: c.id }));
  });
});
