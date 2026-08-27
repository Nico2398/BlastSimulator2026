import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { requireGame, noEmployeesMessage, parseStaffedFlag } from '../../../src/console/commands/commandUtils.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import type { GameContext } from '../../../src/console/commands/world.js';

// #795: commandUtils' static, user-facing guard messages (requireGame's
// "No game loaded" text, NO_EMPLOYEES_MSG, and parseStaffedFlag's invalid-value
// message) route through t() — see src/core/i18n/I18n.ts. Every test below
// pins the exact English literal (must stay byte-identical) and proves the
// output actually changes under a French locale, rather than being a
// hardcoded string that happens to sit in en.json too.

const NO_GAME_LOADED_EN = 'No game loaded. Use new_game first.';
const NO_EMPLOYEES_EN = 'No employees.';

function makeEmptyContext(): GameContext {
  return {
    state: null,
    grid: null,
    landscape: null,
    playableArea: null,
    emitter: new EventEmitter(),
  };
}

afterEach(() => setLocale('en'));

describe('requireGame', () => {
  it('returns null when a game is loaded', () => {
    const ctx = makeEmptyContext();
    ctx.state = {} as GameContext['state'];
    expect(requireGame(ctx)).toBeNull();
  });

  it('returns the exact English guard message when no game is loaded', () => {
    const ctx = makeEmptyContext();
    const result = requireGame(ctx);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.output).toBe(NO_GAME_LOADED_EN);
  });

  it('returns a French-translated guard message under locale fr, differing from the English literal', () => {
    const ctx = makeEmptyContext();
    setLocale('fr');

    const result = requireGame(ctx);

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.output).not.toBe(NO_GAME_LOADED_EN);
  });
});

describe('noEmployeesMessage', () => {
  it('is the exact English literal by default', () => {
    expect(noEmployeesMessage()).toBe(NO_EMPLOYEES_EN);
  });

  // noEmployeesMessage() re-evaluates t('console.no_employees') on every call
  // rather than freezing a value at module load, so a runtime language switch
  // (Settings) is reflected without needing a fresh module instance.
  it('returns the currently-active locale translation on each call, without needing a fresh module instance', () => {
    expect(noEmployeesMessage()).toBe(NO_EMPLOYEES_EN);

    setLocale('fr');
    const frResult = noEmployeesMessage();

    expect(frResult).not.toBe(NO_EMPLOYEES_EN);

    setLocale('en');
    expect(noEmployeesMessage()).toBe(NO_EMPLOYEES_EN);
  });
});

describe('parseStaffedFlag', () => {
  it('returns staffed:false, error:null when raw is undefined (flag omitted)', () => {
    expect(parseStaffedFlag(undefined)).toEqual({ staffed: false, error: null });
  });

  it('returns staffed:true, error:null for raw "true"', () => {
    expect(parseStaffedFlag('true')).toEqual({ staffed: true, error: null });
  });

  it('returns staffed:false, error:null for raw "false"', () => {
    expect(parseStaffedFlag('false')).toEqual({ staffed: false, error: null });
  });

  it('returns the exact English error message for an unrecognized value', () => {
    const result = parseStaffedFlag('maybe');
    expect(result.staffed).toBe(false);
    expect(result.error).toBe('Invalid staffed value: "maybe". Use staffed:true or staffed:false.');
  });

  it('interpolates the raw value into the English error message', () => {
    const result = parseStaffedFlag('yes');
    expect(result.error).toBe('Invalid staffed value: "yes". Use staffed:true or staffed:false.');
  });

  it('returns a French-translated error message under locale fr, differing from the English literal', () => {
    setLocale('fr');

    const result = parseStaffedFlag('maybe');

    expect(result.staffed).toBe(false);
    expect(result.error).not.toBeNull();
    expect(result.error).not.toBe('Invalid staffed value: "maybe". Use staffed:true or staffed:false.');
  });

  it('still interpolates the raw value into the French-translated error message', () => {
    setLocale('fr');

    const result = parseStaffedFlag('nope');

    expect(result.error).not.toBeNull();
    expect(result.error).toContain('nope');
  });
});
