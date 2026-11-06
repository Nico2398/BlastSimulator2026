// BlastSimulator2026 — `contract auto`: switches for automatic ore sale and rubble clearance (#2145)
import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { autoFulfilmentEnabled } from '../../../src/core/campaign/Level.js';

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
