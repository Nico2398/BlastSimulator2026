// BlastSimulator2026 — No hardcoded player-facing English strings (issue #457, bug 3)
//
// Static source analysis over src/ui/ and src/renderer/ (plus src/main.ts,
// which the audit also implicated): flags string literals assigned to
// `.textContent`, `.title`, `.innerHTML`, or passed to `fillText(...)` /
// `showNotification(...)` that read as English UI text and do not go
// through `t(...)`.
//
// The scan is deliberately narrow (plain-quoted literals, plus one targeted
// pattern for TileSelectOverlay's "Selected:" template strings) rather than a
// generic backtick-template heuristic — a generic scan over every template
// literal would also flag legitimate interpolation-heavy strings elsewhere
// (e.g. ContractUI's `${c.quantityKg}kg @ ...`), which is out of scope for
// this issue. This keeps the test's failures pointed at the bugs this issue
// actually describes.
//
// MUST currently fail (red) against: TileSelectOverlay.ts ('No selection' x2,
// 'Confirm', 'Cancel', two 'Selected:' templates), MainMenu.ts (subtitle),
// MiniMap.ts (fillText 'No map data'), and main.ts (7 notification strings).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');

/**
 * Keys whitelisted as legitimately non-translatable (debug-only output,
 * technical strings) — never used to hide real src/ui or src/renderer DOM
 * text. Format: `relative/path/to/File.ts:<line>`.
 */
const HARDCODED_STRING_ALLOWLIST: readonly string[] = [];

interface Violation {
  file: string;
  line: number;
  snippet: string;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** True when a quoted literal's contents look like English UI prose (has a real word, not just symbols/numbers/ids). */
function looksLikeEnglishText(literal: string): boolean {
  return /[A-Za-z]{2,}/.test(literal);
}

/**
 * Scans one file for plain-quoted (non-template) literals assigned to
 * `.textContent` / `.title` / `.innerHTML`, or passed as the first argument
 * to `fillText(...)`, that never pass through `t(...)`.
 */
function scanPlainQuotedAssignments(relPath: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const lines = source.split('\n');
  const assignPattern = /\.(textContent|title|innerHTML)\s*=\s*(['"])((?:(?!\2).)*)\2/;
  const fillTextPattern = /fillText\(\s*(['"])((?:(?!\1).)*)\1/;

  lines.forEach((lineText, idx) => {
    if (lineText.includes('t(')) return; // already routed through i18n
    for (const pattern of [assignPattern, fillTextPattern]) {
      const m = pattern.exec(lineText);
      if (m) {
        const literal = m[pattern === assignPattern ? 3 : 2] ?? '';
        if (looksLikeEnglishText(literal)) {
          violations.push({ file: relPath, line: idx + 1, snippet: lineText.trim() });
        }
      }
    }
  });
  return violations;
}

/**
 * Scans one file for `.notify({ ..., title: <literal>, body: <literal> })`
 * calls (the UIManager/NotificationCenter API — replaced the old
 * `showNotification(string)` call after the redesign's P1 shell) whose
 * `title:`/`body:` field is a literal — quoted or a template literal — that
 * never passes through `t(...)`. A field written as `title: t('key')` never
 * matches the quote-immediately-after-colon pattern, so legitimately
 * localized calls produce zero violations. `${...}` segments are stripped
 * before the English-word check so interpolation alone can't dodge detection.
 */
function scanNotifyCalls(relPath: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const lines = source.split('\n');
  const callPattern = /\.notify\(/;
  const fieldPattern = /(?:title|body)\s*:\s*(['"`])((?:(?!\1).)*)\1/g;

  lines.forEach((lineText, idx) => {
    if (!callPattern.test(lineText)) return;
    fieldPattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = fieldPattern.exec(lineText))) {
      const literal = (m[2] ?? '').replace(/\$\{[^}]*\}/g, '');
      if (looksLikeEnglishText(literal)) {
        violations.push({ file: relPath, line: idx + 1, snippet: lineText.trim() });
      }
    }
  });
  return violations;
}

/**
 * TileSelectOverlay-specific: `textContent = \`Selected: (...)\`` template
 * literals bypass t() entirely. A generic backtick scan would also flag
 * legitimate interpolation-heavy strings elsewhere, so this targets the
 * known "Selected:" prefix pattern only.
 */
function scanSelectedTemplateLiteral(relPath: string, source: string): Violation[] {
  const violations: Violation[] = [];
  const lines = source.split('\n');
  const pattern = /textContent\s*=\s*`Selected:/;
  lines.forEach((lineText, idx) => {
    if (pattern.test(lineText)) {
      violations.push({ file: relPath, line: idx + 1, snippet: lineText.trim() });
    }
  });
  return violations;
}

function filterAllowlisted(violations: Violation[]): Violation[] {
  return violations.filter((v) => !HARDCODED_STRING_ALLOWLIST.includes(`${v.file}:${v.line}`));
}

function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `  ${v.file}:${v.line}  ${v.snippet}`).join('\n');
}

describe('src/ui/ and src/renderer/ — no hardcoded English UI strings (issue #457)', () => {
  it('every .textContent / .title / .innerHTML / fillText() literal goes through t()', () => {
    const dirs = ['src/ui', 'src/renderer'];
    const violations: Violation[] = [];
    for (const dir of dirs) {
      for (const file of listTsFiles(join(ROOT, dir))) {
        const relPath = file.slice(ROOT.length + 1);
        const source = readFileSync(file, 'utf8');
        violations.push(...scanPlainQuotedAssignments(relPath, source));
        violations.push(...scanSelectedTemplateLiteral(relPath, source));
      }
    }

    const remaining = filterAllowlisted(violations);
    expect(
      remaining,
      `${remaining.length} hardcoded English UI string(s) found outside t():\n${formatViolations(remaining)}`,
    ).toEqual([]);
  });

  it('sanity: the scanner actually finds source files to check', () => {
    const files = [...listTsFiles(join(ROOT, 'src/ui')), ...listTsFiles(join(ROOT, 'src/renderer'))];
    expect(files.length).toBeGreaterThan(10);
  });
});

describe('src/main.ts — no hardcoded notification strings (issue #457)', () => {
  it('every notify(...) call\'s title/body goes through t()', () => {
    const relPath = 'src/main.ts';
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const violations = filterAllowlisted(scanNotifyCalls(relPath, source));

    expect(
      violations,
      `${violations.length} hardcoded notify() string(s) found in src/main.ts:\n${formatViolations(violations)}`,
    ).toEqual([]);
  });

  it('finds all 7 known notification call sites (bankruptcy/ecology/arrest/revolt handlers)', () => {
    // Pinned count — guards against the scanner silently stopping to find
    // any of them (e.g. a refactor changing the call syntax so the pattern
    // no longer matches).
    const relPath = 'src/main.ts';
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const allCalls = (source.match(/uiManager\.notify\(/g) ?? []).length;
    expect(allCalls).toBeGreaterThanOrEqual(7);
  });
});
