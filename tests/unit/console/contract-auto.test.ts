// BlastSimulator2026 — `contract auto`: switches for automatic ore sale and rubble clearance (#2145)
import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { autoFulfilmentEnabled } from '../../../src/core/campaign/Level.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';

function sandbox() {
  const { runner, ctx } = createRunner();
  expect(runner.run('sandbox start biome:desert_badlands kit:full seed:42').success).toBe(true);
  return { runner, state: ctx.state! };
}

describe('contract auto (#2145)', () => {
  it('lists both states', () => {
    const { runner } = sandbox();
    const r = runner.run('contract auto');
    expect(r.success).toBe(true);
    expect(r.output.trim().length).toBeGreaterThan(0);
  });

  it('`contract auto sell off` turns automatic ore sale off, leaving rubble alone', () => {
    const { runner, state } = sandbox();
    const r = runner.run('contract auto sell off');
    expect(r.success).toBe(true);
    expect(state.contracts.autoSell).toBe(false);
    expect(autoFulfilmentEnabled(state, 'autoSell')).toBe(false);
    expect(autoFulfilmentEnabled(state, 'autoClearRubble')).toBe(true);
  });

  it('`contract auto sell on` turns it back on', () => {
    const { runner, state } = sandbox();
    runner.run('contract auto sell off');
    expect(runner.run('contract auto sell on').success).toBe(true);
    expect(state.contracts.autoSell).toBe(true);
  });

  it('`contract auto rubble off` and `on` set autoClearRubble, leaving selling alone', () => {
    const { runner, state } = sandbox();
    expect(runner.run('contract auto rubble off').success).toBe(true);
    expect(state.contracts.autoClearRubble).toBe(false);
    expect(autoFulfilmentEnabled(state, 'autoSell')).toBe(true);
    expect(runner.run('contract auto rubble on').success).toBe(true);
    expect(state.contracts.autoClearRubble).toBe(true);
  });

  it('the listing changes when a switch flips', () => {
    const { runner } = sandbox();
    const before = runner.run('contract auto').output;
    runner.run('contract auto sell off');
    const after = runner.run('contract auto').output;
    expect(after).not.toBe(before);
    runner.run('contract auto sell on');
    expect(runner.run('contract auto').output).toBe(before);
  });

  it('refuses an unknown switch name and changes nothing', () => {
    const { runner, state } = sandbox();
    expect(runner.run('contract auto bogus on').success).toBe(false);
    expect(state.contracts.autoSell).toBeUndefined();
    expect(state.contracts.autoClearRubble).toBeUndefined();
  });

  it('refuses a value that is not on or off and changes nothing', () => {
    const { runner, state } = sandbox();
    expect(runner.run('contract auto sell maybe').success).toBe(false);
    expect(runner.run('contract auto rubble 1').success).toBe(false);
    expect(state.contracts.autoSell).toBeUndefined();
    expect(state.contracts.autoClearRubble).toBeUndefined();
  });
});

describe('contract auto names the ores automatic sale covers (#2278)', () => {
  const ALL = ['dirtite', 'rustite', 'blingite', 'gloomium', 'sparkium', 'craktonite', 'absurdium', 'treranium'];
  const nameOf = (ore: string): string => t(`ore.${ore}.name`);

  function siteAt(grade: number) {
    setLocale('en');
    const { runner } = createRunner();
    expect(runner.run(`sandbox start biome:desert_badlands kit:full seed:42 grade:${grade}`).success).toBe(true);
    return runner;
  }

  it('at grade 0 it names no ore: nothing sells automatically', () => {
    const r = siteAt(0).run('contract auto');
    expect(r.success).toBe(true);
    for (const ore of ALL) expect(r.output, ore).not.toContain(nameOf(ore));
  });

  it('at grade 1 it names the G0 ores and no other', () => {
    const r = siteAt(1).run('contract auto');
    expect(r.success).toBe(true);
    for (const ore of ['dirtite', 'rustite']) expect(r.output, ore).toContain(nameOf(ore));
    for (const ore of ['blingite', 'gloomium', 'sparkium', 'craktonite', 'absurdium', 'treranium']) expect(r.output, ore).not.toContain(nameOf(ore));
  });

  it('at grade 2 it names the G0 and G1 ores, never the G2 or G3 ones', () => {
    const r = siteAt(2).run('contract auto');
    for (const ore of ['dirtite', 'rustite', 'blingite', 'gloomium', 'sparkium']) expect(r.output, ore).toContain(nameOf(ore));
    for (const ore of ['craktonite', 'absurdium', 'treranium']) expect(r.output, ore).not.toContain(nameOf(ore));
  });

  it('the listing differs between grade 0 and grade 1', () => {
    expect(siteAt(1).run('contract auto').output).not.toBe(siteAt(0).run('contract auto').output);
  });

  it('switching sale off keeps the command succeeding', () => {
    const runner = siteAt(1);
    expect(runner.run('contract auto sell off').success).toBe(true);
    expect(runner.run('contract auto').success).toBe(true);
  });
});
