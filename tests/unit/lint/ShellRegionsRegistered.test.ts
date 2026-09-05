// #956 — Every screen-edge shell region file must register itself with the
// shared `shellLayoutRegistry` (LayoutRegistry.ts), the same way
// tests/unit/lint/UiCommandsAreRegistered.test.ts walks src/ui to enforce a
// different "everything in category X does Y" invariant.
//
// A shell region that forgets to register (or a new region file added later
// that never wires in) is invisible to the layout-matrix test
// (tests/unit/ui/shell/layoutRegions.test.ts) — it just silently never gets
// checked for overlap or viewport containment. This is a structural
// guardrail, not a behavioral test: it currently passes, since the #956
// skeleton already added the register() call to all 5 existing files.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SHELL_ROOT = join(process.cwd(), 'src/ui/shell');
/** The registry module itself declares the mechanism; it doesn't register with itself. */
const EXCLUDED_FILES = ['LayoutRegistry.ts'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts') && !EXCLUDED_FILES.includes(entry)) out.push(full);
  }
  return out;
}

describe('shell region files register with shellLayoutRegistry (#956)', () => {
  const files = walk(SHELL_ROOT);

  it('finds shell region files at all (guards the walk itself)', () => {
    // If the walk silently found nothing (wrong path, empty directory), every
    // assertion below would vacuously pass.
    expect(files.length).toBeGreaterThan(0);
  });

  it('every shell/*.ts file (besides LayoutRegistry.ts) calls shellLayoutRegistry.register(', () => {
    const missing: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (!src.includes('shellLayoutRegistry.register(')) {
        missing.push(file.replace(process.cwd() + '/', ''));
      }
    }
    expect(missing, `shell region files never calling shellLayoutRegistry.register(:\n${missing.join('\n')}`).toEqual([]);
  });
});
