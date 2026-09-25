// BlastSimulator2026 — interaction-mode actions never call
// window.__placement.paintRect directly
//
// `pickTile`/`dragTiles` in scripts/shared/interaction-executor.ts's
// executeActionOnPage switch call __placement.paintRect(...) straight from
// page.evaluate, bypassing real mouse input the way
// NoBareSelectorClick.test.ts's PRIMITIVE bypasses page.click(). Once the fix
// folds both cases into the existing 'set'/'clickLabel'/.../'clickEntity'
// branch that forwards through runAction (interaction-driver.ts), no file
// under scripts/ should call __placement.paintRect directly any more — mirrors
// NoBareSelectorClick.test.ts's listTsFiles/bareClickLines-style scan (same
// file, scripts/shared/click-retry.ts's ROOT/SCANNED_DIR/ALLOWLIST pattern)
// for `__placement.paintRect(` call sites here.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const ROOT = join(import.meta.dirname, '../../..');
export const SCANNED_DIR = 'scripts';

/** Files allowed to call `__placement.paintRect` directly, each with the reason. */
export const ALLOWLIST: Readonly<Record<string, string>> = {
  // Populated only if a genuine command-mode-only caller under scripts/ needs
  // an exemption; investigation for issue #1209 found none — command mode's
  // own paintRect caller in src/main.ts sits outside SCANNED_DIR.
};

const PAINT_RECT = /\.paintRect\(/;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'scenario-defs' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** 1-based line numbers of non-comment `.paintRect(` calls in `file` (repo-relative). */
function paintRectLines(file: string): number[] {
  return readFileSync(join(ROOT, file), 'utf8').split('\n')
    .map((line, i) => (PAINT_RECT.test(line) && !COMMENT_LINE.test(line) ? i + 1 : 0))
    .filter((n) => n > 0);
}

const FILES = listTsFiles(join(ROOT, SCANNED_DIR)).map((f) => relative(ROOT, f).split(sep).join('/'));

describe('repo-wide — interaction actions never call __placement.paintRect directly (issue #1209)', () => {
  it('sanity: the scan finds TypeScript files under scripts/', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it('no interaction-executor action file calls __placement.paintRect() directly', () => {
    const violations = FILES
      .filter((f) => !(f in ALLOWLIST))
      .flatMap((f) => paintRectLines(f).map((line) => `${f}:${line}`));
    expect(
      violations,
      `${violations.length} .paintRect() call site(s):\n` + violations.map((v) => `  ${v}`).join('\n')
      + '\n\npickTile/dragTiles must drive real mouse input through runAction (interaction-driver.ts),'
      + ' the way every other interaction action type does, instead of reaching into'
      + ' window.__placement.paintRect from page.evaluate.',
    ).toEqual([]);
  });

  it('every allowlist entry still calls __placement.paintRect() — a stale entry is removed, not kept', () => {
    for (const file of Object.keys(ALLOWLIST)) {
      expect(FILES, `${file} is allowlisted but no longer exists`).toContain(file);
      expect(paintRectLines(file), `${file} is allowlisted but no longer calls .paintRect()`).not.toHaveLength(0);
    }
  });
});
