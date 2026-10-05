import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';

const VEHICLE_SUBS = ['list', 'buy', 'reposition', 'driver', 'haul', 'scrap', 'break'];
const BUILD_SUBS = ['list', 'destroy', 'upgrade', 'move', 'types'];

function helpLine(name: string): string {
  const { runner } = createRunner();
  const result = runner.run('help');
  expect(result.success).toBe(true);
  const line = result.output.split('\n').find((l) => l.trim().startsWith(name + ' '));
  expect(line, `help line for ${name}`).toBeDefined();
  return line as string;
}

/** Plain word tokens inside the first parenthesised group of a string. */
function groupTokens(text: string): string[] {
  const m = /\(([^)]*)\)/.exec(text);
  expect(m, `parenthesised group in: ${text}`).not.toBeNull();
  return ((m as RegExpExecArray)[1] ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter((s) => /^[a-z_]+$/.test(s));
}

describe('help lists real subcommands (#1402)', () => {
  beforeAll(() => setLocale('en'));

  it('vehicle line lists every real subcommand', () => {
    const line = helpLine('vehicle');
    for (const sub of VEHICLE_SUBS) expect(line).toContain(sub);
  });

  it('vehicle line does not list removed assign or move', () => {
    const line = helpLine('vehicle');
    expect(line).not.toContain('assign');
    expect(line).not.toContain('move');
  });

  it('build line lists every real subcommand', () => {
    const line = helpLine('build');
    for (const sub of BUILD_SUBS) expect(line).toContain(sub);
  });

  it('vehicle help and t(vehicle.usage) agree both ways', () => {
    const line = helpLine('vehicle');
    const usage = t('vehicle.usage');
    const usageTokens = groupTokens(usage);
    expect(usageTokens.length).toBeGreaterThan(0);
    for (const tok of usageTokens) expect(line).toContain(tok);
    for (const tok of groupTokens(line)) expect(usage).toContain(tok);
  });

  it('build help and t(entities.build_unknown_subcommand) agree both ways', () => {
    const line = helpLine('build');
    const usage = t('entities.build_unknown_subcommand', { sub: 'x' });
    const usageTokens = groupTokens(usage);
    expect(usageTokens.length).toBeGreaterThan(0);
    for (const tok of usageTokens) expect(line).toContain(tok);
    for (const tok of groupTokens(line)) expect(usage).toContain(tok);
  });

  describe('behavioural probe', () => {
    it('each listed vehicle subcommand is recognised', () => {
      const { runner } = createRunner();
      runner.run('new_game seed:42');
      const usage = t('vehicle.usage');
      for (const sub of VEHICLE_SUBS) {
        const r = runner.run(`vehicle ${sub}`);
        expect(r.output, `vehicle ${sub}`).not.toBe(usage);
      }
    });

    it('removed vehicle assign and move return usage', () => {
      const { runner } = createRunner();
      runner.run('new_game seed:42');
      const usage = t('vehicle.usage');
      expect(runner.run('vehicle assign').output).toBe(usage);
      expect(runner.run('vehicle move').output).toBe(usage);
    });
  });
});
