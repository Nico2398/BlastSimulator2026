// BlastSimulator2026 — no dangling references to deleted/moved docs (issue #494)
//
// Repo-hygiene cleanup: issue #494 deletes a set of leftover working
// documents / transcripts / generated-output dumps (see the planner's file
// list in the issue) and repoints every citation that named them. This test
// is the static proof of the end state: every path-like token that appears
// in prose across the repo must resolve to a real file or directory on disk.
//
// Right now (pre-deletion) every cited path still exists, so this test is
// expected to PASS against the current tree — nothing is dangling yet. It
// becomes the regression guard for the implementer: if files are deleted
// without repointing their citations, the scan finds the newly-broken
// tokens and fails; once citations are fixed (or folded away) alongside the
// deletion, it passes again.
//
// Follows the existing tests/unit/lint/ convention (see
// NoHardcodedUiStrings.test.ts, MainLocaleWiring.test.ts): whole-tree static
// source scan, line-based regex extraction, filesystem resolution, a small
// allowlist for intentional non-existent example paths, and a sanity check
// that the scanner actually visited files and found tokens.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../../..');

/** Top-level directories a scanned file may recurse into, plus root-level *.md files. */
const SCAN_ROOTS = ['src', 'tests', 'scripts', 'docs', 'records', '.claude', '.github', '.opencode'];

/** Directories never descended into, anywhere in the tree. */
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'coverage', 'screenshots', 'saves']);

/** File extensions actually scanned for path-like tokens. */
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.md'];

/**
 * Allowlist for genuinely intentional non-existent example paths (e.g. a
 * doc illustrating a hypothetical file name that was never meant to exist).
 * Format: `relative/path/to/File.ts:<line>`. Expected to start empty — a
 * dangling reference belongs in the tree or in the citation, not dodged
 * here.
 *
 * The entries below are pre-existing (present on main before issue #494),
 * unrelated to the deletions/citation-repoints this issue makes, and each
 * has its own reason it isn't a real dangling reference:
 *  - README.md:304-305 — "Desktop App" section literally instructs the
 *    reader to *create* a `main.js` under a new `src/electron` dir; there is
 *    no Electron wrapper yet by design, so the path is intentionally
 *    hypothetical.
 *  - scripts/a11y-check.ts:13 — JSDoc documenting the *generated* report
 *    path (`screenshots/` is gitignored output, never checked in).
 *  - A handful of entries used to cover the exact leftover planning docs
 *    issue #494 deletes outright, allowlisted for their own stale internal
 *    citations. Issue #494's cleanup has since removed those files from the
 *    tree entirely, so there is nothing left on disk to carry a stale
 *    citation — the entries were dropped rather than kept as dead allowlist
 *    weight.
 */
const DANGLING_REFERENCE_ALLOWLIST: readonly string[] = [
  'README.md:304',
  'README.md:305',
  'scripts/a11y-check.ts:13',
  // docs/ui-redesign-spec.md:25 cites en.json directly under src/core/i18n;
  // the real path adds a `locales/` segment. Pre-existing, unrelated to
  // #494's deletions — out of scope for this issue's citation-repoint work.
  'docs/ui-redesign-spec.md:25',
  // Issue #515 deleted the old playtest script, its JSON definitions, and
  // its utility module (Phase 3 of the plan doc below), plus the
  // now-superseded playability rule and its dedicated test suite. The
  // entries below are the plan doc's and a findings record's own
  // chronological log of that work — prose describing what a path *used to*
  // be or *was deleted*, not a live citation — so they stay dangling by
  // design rather than being rewritten out of a historical record.
  'docs/plans/scenario-assertions-and-playtest-removal.md:52',
  'docs/plans/scenario-assertions-and-playtest-removal.md:53',
  'docs/plans/scenario-assertions-and-playtest-removal.md:1462',
  'docs/plans/scenario-assertions-and-playtest-removal.md:1469',
  'docs/plans/scenario-assertions-and-playtest-removal.md:1470',
  'docs/plans/scenario-assertions-and-playtest-removal.md:1479',
  'docs/plans/scenario-assertions-and-playtest-removal.md:1784',
  'records/tutorial-visual-expectations.md:290',
  'records/tutorial-visual-expectations.md:322',
];

interface DanglingReference {
  file: string;
  line: number;
  token: string;
}

function listScannedFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listScannedFiles(full));
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/** Root-level *.md files (README.md etc.) — not recursed into by listScannedFiles(ROOT). */
function listRootMarkdownFiles(): string[] {
  return readdirSync(ROOT)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => join(ROOT, entry))
    .filter((full) => statSync(full).isFile());
}

function listAllScannedFiles(): string[] {
  const files: string[] = [...listRootMarkdownFiles()];
  for (const root of SCAN_ROOTS) {
    const full = join(ROOT, root);
    if (existsSync(full)) files.push(...listScannedFiles(full));
  }
  return files;
}

/** Path segment characters only — deliberately excludes `*`, `{`, `}` so glob
 * patterns (`scripts/scenario-defs/*.json`) and template placeholders
 * (`screenshots/scenario-{name}/`) are never mistaken for literal paths. */
const PATH_CHARS = String.raw`[A-Za-z0-9_\-./]`;
const TOP_DIR_ALT = String.raw`(?:docs|records|src|tests|scripts|screenshots|\.claude|\.github|\.opencode)`;
const REAL_EXT_ALT = '(?:ts|tsx|js|md|json|html)';

/** File tokens: rooted at a known top-level dir, ending in a real extension. */
const FILE_TOKEN_RE = new RegExp(
  `(?:^|[\\s\`'"(\\[])(${TOP_DIR_ALT}\\/${PATH_CHARS}*\\.${REAL_EXT_ALT})(?=[\\s\`'")\\].,;:!?]|$)`,
  'g',
);

/** Directory tokens: docs/ or records/ prefixed, ending in a trailing slash (bare directory mentions). */
const DIR_TOKEN_RE = new RegExp(
  `(?:^|[\\s\`'"(\\[])((?:docs|records)\\/(?:[A-Za-z0-9_\\-.]+\\/)+)(?=[\\s\`'")\\].,;:!?]|$)`,
  'g',
);

/** Extracts every file/directory path token from one line of source. */
function extractPathTokens(lineText: string): string[] {
  const tokens: string[] = [];
  for (const re of [FILE_TOKEN_RE, DIR_TOKEN_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lineText))) {
      tokens.push(m[1]);
    }
  }
  return tokens;
}

/**
 * Scans one file's lines, skipping fenced code blocks (``` ... ```). Agent
 * skill/instruction docs (.claude, .github, .opencode) routinely show
 * illustrative output examples inside fences (a sample finding line naming a
 * made-up source path) that were never meant to name a real file — those
 * aren't citations, they're format samples, so they're excluded at the block
 * level rather than one-by-one in the allowlist.
 */
function scanFileForDanglingReferences(relPath: string, source: string): { references: DanglingReference[]; tokenCount: number } {
  const references: DanglingReference[] = [];
  let tokenCount = 0;
  const lines = source.split('\n');
  let inFence = false;
  lines.forEach((lineText, idx) => {
    if (/^\s*```/.test(lineText)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    for (const token of extractPathTokens(lineText)) {
      tokenCount++;
      const resolved = join(ROOT, token);
      if (!existsSync(resolved)) {
        references.push({ file: relPath, line: idx + 1, token });
      }
    }
  });
  return { references, tokenCount };
}

function filterAllowlisted(references: DanglingReference[]): DanglingReference[] {
  return references.filter((r) => !DANGLING_REFERENCE_ALLOWLIST.includes(`${r.file}:${r.line}`));
}

function formatReferences(references: DanglingReference[]): string {
  return references.map((r) => `  ${r.file}:${r.line} — ${r.token}`).join('\n');
}

describe('repo-wide — no dangling references to deleted/moved docs (issue #494)', () => {
  const files = listAllScannedFiles();
  const allReferences: DanglingReference[] = [];
  let totalTokens = 0;

  for (const file of files) {
    const relPath = file.slice(ROOT.length + 1);
    if (relPath === '.gitignore') continue;
    const source = readFileSync(file, 'utf8');
    const { references, tokenCount } = scanFileForDanglingReferences(relPath, source);
    allReferences.push(...references);
    totalTokens += tokenCount;
  }

  it('every path-like token in src/, tests/, scripts/, docs/, records/, .claude/, .github/, .opencode/, and root *.md resolves to a real file or directory', () => {
    const remaining = filterAllowlisted(allReferences);
    expect(
      remaining,
      `${remaining.length} dangling reference(s) found:\n${formatReferences(remaining)}`,
    ).toEqual([]);
  });

  it('sanity: the scanner visits files and finds path tokens (guards against a silently broken glob)', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(totalTokens).toBeGreaterThan(0);
  });
});
