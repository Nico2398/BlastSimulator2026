// Every console command a UI control dispatches must actually be registered.
//
// A button wired to a non-existent command fails *silently*: ConsoleRunner
// answers `Unknown command: "…"` and no UI call site checks the returned
// CommandResult, so the control just does nothing. Both tubing buttons in the
// Charge step shipped that way — `tubing buy` / `tubing install`, where the
// registry has `buy` and `install_tubing`. Nothing caught it: types can't see
// inside a template literal, the command mode of every scenario ran the
// *correct* console command directly, and no playtest beat covered tubing.
//
// This closes the class rather than the instance.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRunner } from '../../../src/console-api.js';

const UI_ROOT = join(process.cwd(), 'src/ui');
const EXTRA_FILES = [join(process.cwd(), 'src/main.ts')];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Command strings handed to a game-console callback. Covers both the template
 * and plain-string forms, and the `gameConsole` / `onCommand` / `runCommand`
 * naming used across panels.
 */
const DISPATCH_RE = /(?:gameConsole|onCommand|runCommand|consoleFn)\s*\??\.?\s*\(\s*([`'"])([^`'"]*)\1/g;

interface Dispatch { file: string; verb: string; raw: string }

function collectDispatches(): Dispatch[] {
  const files = [...walk(UI_ROOT), ...EXTRA_FILES];
  const found: Dispatch[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(DISPATCH_RE)) {
      const raw = m[2] ?? '';
      // A command built entirely from an interpolation can't be checked
      // statically — skip rather than guess.
      if (raw.startsWith('$')) continue;
      const verb = raw.trim().split(/[\s$]/)[0] ?? '';
      if (verb === '') continue;
      found.push({ file: file.replace(process.cwd() + '/', ''), verb, raw });
    }
  }
  return found;
}

describe('UI-dispatched commands are registered', () => {
  // createRunner() returns a RunnerWithContext wrapper; the registry lives on
  // its `.runner`.
  const { runner } = createRunner();
  const dispatches = collectDispatches();

  it('finds the UI command dispatch sites at all (guards the regex itself)', () => {
    // If the extraction silently stops matching, every assertion below would
    // vacuously pass. Anchor on a known-good, long-lived dispatch.
    expect(dispatches.length).toBeGreaterThan(10);
    expect(dispatches.some(d => d.verb === 'build')).toBe(true);
  });

  it('every dispatched command verb exists in the registry', () => {
    const unknown = dispatches.filter(d => !runner.has(d.verb));
    const detail = unknown
      .map(d => `  ${d.file}: "${d.raw}" — verb "${d.verb}" is not registered`)
      .join('\n');
    expect(unknown, `UI controls wired to non-existent commands:\n${detail}`).toEqual([]);
  });
});
