// BlastSimulator2026 — ConsoleFormatter's ANSI wrappers and key/value table
//
// Pure string functions with no I/O, and until now no tests: the module sat in
// vitest.config.ts's coverage exclude list, so nothing measured it and nothing
// asserted it. The colour wrappers are one line each, but the reset suffix is
// the part that matters — a wrapper that opens a colour and forgets to close
// it bleeds into every later line the console prints.

import { describe, it, expect } from 'vitest';
import { bold, success, error, warn, info, table } from '../../../src/console/ConsoleFormatter.js';

const RESET = '\x1b[0m';

describe('ConsoleFormatter colour wrappers', () => {
  it.each([
    ['bold', bold, '\x1b[1m'],
    ['success', success, '\x1b[32m'],
    ['error', error, '\x1b[31m'],
    ['warn', warn, '\x1b[33m'],
    ['info', info, '\x1b[36m'],
  ])('%s opens its own code and closes with a reset', (_name, fn, code) => {
    expect(fn('text')).toBe(`${code}text${RESET}`);
  });

  it.each([
    ['bold', bold],
    ['success', success],
    ['error', error],
    ['warn', warn],
    ['info', info],
  ])('%s still terminates the sequence for an empty string', (_name, fn) => {
    // No text to colour is not a reason to leave the colour open.
    expect(fn('').endsWith(RESET)).toBe(true);
  });

  it('gives each level a distinct colour', () => {
    const painted = [success, error, warn, info].map(fn => fn('x'));
    expect(new Set(painted).size).toBe(4);
  });

  it('leaves the caller text untouched between the codes', () => {
    expect(success('12 fragments — 3 oversized')).toContain('12 fragments — 3 oversized');
  });
});

describe('ConsoleFormatter table', () => {
  it('pads every key to the widest one so the colons line up', () => {
    const lines = table({ cash: 1000, employees: 4 }).split('\n');
    expect(lines).toEqual([
      '  cash      : 1000',
      '  employees : 4',
    ]);
    // The separator sits at the same column on both rows — the point of padding.
    expect(new Set(lines.map(l => l.indexOf(':'))).size).toBe(1);
  });

  it('keeps the insertion order of the object', () => {
    expect(table({ b: 1, a: 2 }).split('\n').map(l => l.trim()[0])).toEqual(['b', 'a']);
  });

  it('renders numbers and strings alike', () => {
    expect(table({ n: 42, s: 'text' })).toBe('  n : 42\n  s : text');
  });

  it('handles a single entry, where the widest key is the only key', () => {
    expect(table({ only: 'one' })).toBe('  only : one');
  });

  // Math.max() of an empty spread is -Infinity, which padEnd rejects as a
  // length. Nothing calls it with an empty object today, so this pins the
  // boundary rather than asserting a behaviour anyone relies on.
  it('returns an empty string for an object with no entries', () => {
    expect(table({})).toBe('');
  });
});
