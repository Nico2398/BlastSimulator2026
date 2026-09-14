// BlastSimulator2026 — every selector click in scripts/ goes through
// clickWithTransientRetry
//
// `scripts/shared/click-retry.ts` is the one place the interaction harness
// calls Puppeteer's `page.click()`. It re-inspects the selector after a
// refusal and clicks again when the fresh node reads as usable — the shape
// of a control a panel rebuilt between the probe and the click, which is
// what turned PR #1080's shard 5 red twice through one bare `page.click` in
// `clickIfPresent`. A bare call anywhere else is a probe-once/click-once
// site waiting for the same race, so this refuses it where it is written
// instead of on a browser shard. `page.mouse.click` is out of scope: a
// coordinate click has no selector to re-resolve.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const SCANNED_DIR = 'scripts';
const PRIMITIVE = 'scripts/shared/click-retry.ts';

/** Files allowed a bare `page.click`, each with the reason it is not a harness click. */
const ALLOWLIST: Readonly<Record<string, string>> = {
  'scripts/bench-hotspots.ts': 'times one raw Puppeteer click; the retry would sit inside the measurement',
};

const BARE_CLICK = /\bpage\.click\(/;
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

/** 1-based line numbers of non-comment `page.click(` calls in `file` (repo-relative). */
function bareClickLines(file: string): number[] {
  return readFileSync(join(ROOT, file), 'utf8').split('\n')
    .map((line, i) => (BARE_CLICK.test(line) && !COMMENT_LINE.test(line) ? i + 1 : 0))
    .filter((n) => n > 0);
}

const FILES = listTsFiles(join(ROOT, SCANNED_DIR)).map((f) => relative(ROOT, f).split(sep).join('/'));

describe('repo-wide — a selector click in scripts/ goes through clickWithTransientRetry (PR #1080 shard 5)', () => {
  it('sanity: the primitive exists and is the single site that calls page.click()', () => {
    expect(FILES).toContain(PRIMITIVE);
    expect(bareClickLines(PRIMITIVE)).toHaveLength(1);
  });

  it('no other file calls page.click() directly', () => {
    const violations = FILES
      .filter((f) => f !== PRIMITIVE && !(f in ALLOWLIST))
      .flatMap((f) => bareClickLines(f).map((line) => `${f}:${line}`));
    expect(
      violations,
      `${violations.length} bare page.click() call(s):\n` + violations.map((v) => `  ${v}`).join('\n')
      + '\n\nClick through clickWithTransientRetry (scripts/shared/click-retry.ts) — or through'
      + ' the executor\'s clickSelector path when a usability wait is owed — so a control the'
      + ' panel rebuilt between probe and click is retried instead of failing the scenario.',
    ).toEqual([]);
  });

  it('every allowlist entry still calls page.click() — a stale entry is removed, not kept', () => {
    for (const file of Object.keys(ALLOWLIST)) {
      expect(FILES, `${file} is allowlisted but no longer exists`).toContain(file);
      expect(bareClickLines(file), `${file} is allowlisted but no longer calls page.click()`).not.toHaveLength(0);
    }
  });
});
