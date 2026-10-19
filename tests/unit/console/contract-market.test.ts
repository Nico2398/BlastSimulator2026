// BlastSimulator2026 — `contract market`: per-ore saturation and price trend (#1930)
import { describe, it, expect, afterEach } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { resolveContractOres } from '../../../src/core/campaign/Level.js';
import { oreContractBasePrice } from '../../../src/core/economy/Market.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';

afterEach(() => setLocale('en'));

function sandbox() {
  const { runner, ctx } = createRunner();
  expect(runner.run('sandbox start biome:desert_badlands kit:full seed:42').success).toBe(true);
  return { runner, state: ctx.state! };
}

describe('contract market (#1930)', () => {
  it('lists every site ore with a saturation percent on a progression site', () => {
    const { runner, state } = sandbox();
    expect(state.grade).toBeDefined();
    const r = runner.run('contract market');
    expect(r.success).toBe(true);
    for (const ore of resolveContractOres(state)) expect(r.output).toContain(ore);
    expect(r.output).toContain(t('economy.contract.market_header'));
    expect(r.output).toMatch(/0%/);
  });

  it('shows 50% saturated and a -25% trend after 10 t of dirtite', () => {
    const { runner, state } = sandbox();
    state.saturation = { dirtite: { level: 0.5, tick: state.tickCount } };
    const line = runner.run('contract market').output.split('\n').find(l => l.includes('dirtite'))!;
    expect(line).toContain('50%');
    expect(line).toContain('-25%');
    const base = oreContractBasePrice('dirtite', state.contracts.market);
    expect(line).toContain(`$${base.toFixed(2)}`);
    expect(line).toContain(`$${(base * 0.75).toFixed(2)}`);
  });

  it('decays: the printed saturation halves after 500 ticks', () => {
    const { runner, state } = sandbox();
    state.saturation = { dirtite: { level: 0.5, tick: state.tickCount } };
    state.tickCount += 500;
    const line = runner.run('contract market').output.split('\n').find(l => l.includes('dirtite'))!;
    expect(line).toContain('25%');
  });

  it('unsaturated ores show no price change', () => {
    const { runner, state } = sandbox();
    state.saturation = { dirtite: { level: 0.5, tick: state.tickCount } };
    const others = runner.run('contract market').output.split('\n')
      .filter(l => /^\s+\w+:/.test(l) && !l.includes('dirtite'));
    for (const l of others) expect(l).toMatch(/0%/);
  });

  it('a non-progression site prints the none line', () => {
    const { runner } = createRunner();
    expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const r = runner.run('contract market');
    expect(r.output).toBe(t('economy.contract.market_none'));
  });

  it('the none line is localized', () => {
    const { runner } = createRunner();
    runner.run('new_game seed:42 size:32 staffed:true');
    const en = runner.run('contract market').output;
    setLocale('fr');
    const fr = runner.run('contract market').output;
    expect(fr).not.toBe(en);
    expect(fr).not.toContain('economy.contract');
  });
});
