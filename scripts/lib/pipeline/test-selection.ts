/**
 * BlastSimulator2026 — Which test files a change owes before CI runs the rest
 *
 * `verify`'s `logic` channel used to run the whole Vitest suite on every call:
 * 1005 files, 734 s wall on a 4-core box and longer on a 2-core runner. A
 * pipeline run calls `verify` five to seven times, and across 58 measured runs
 * (the `agentic-metrics` branch) those waits came to 49 of 159 wall-hours, while
 * model time was 6. Issues #2142, #2143, #2148, #2154 and #2199 ran into the
 * 270-minute agent timeout that way. CI already runs the full suite, sharded, on
 * every pull request head, and every run waits for that verdict in-session, so
 * the local channel is a focused pre-flight: the tests a change can plausibly
 * break, chosen deterministically and printed with the reason for each.
 *
 * The rules, in the order `selectTests` applies them:
 *
 * - **Full-suite triggers.** A change to how tests run at all (`package.json`,
 *   the lockfile, a Vitest config, a tsconfig, a Vitest setup file) owes the
 *   whole suite.
 * - **Changed tests** run.
 * - **Direct importers.** For every other changed file: the test files that
 *   import it at runtime (`import type` is the typecheck's business, not a
 *   runtime edge), the test files that name it (`mentionPattern`: a test that
 *   `require`s a hook, spawns a script, reads a workflow or lists a source
 *   directory has no import edge), and the mirrored test files
 *   (`src/core/nav/Pathfinding.ts` →
 *   `tests/unit/nav/Pathfinding.test.ts` and its `Pathfinding.*` /
 *   `Pathfinding-*` siblings). Test helpers are files like any other: a changed
 *   `tests/helpers/` module selects the tests that import it.
 * - **Hub narrowing.** "Every test that imports the file" is not focused for a
 *   hub: a third of `src/` transitively reaches 98% of the suite, and the
 *   direct test importers alone run to minutes (`src/core/config/balance.ts`:
 *   289 files, 921 s summed; `src/console/createRunner.ts`: 118, 1022 s).
 *   Past `HUB_IMPORTERS` direct test importers the set is narrowed to the files
 *   that name one of the exported identifiers the diff touched
 *   (`changedExports`), plus the direct test importers of the modules that
 *   import the hub and use one of those identifiers. When the diff cannot be
 *   attributed to a named declaration (only import lines, a side-effect
 *   statement, a default export), every direct importer runs.
 * - **Directory owners** (`DIRECTORY_OWNERS`). A scenario definition owes the
 *   scenario validation suites, a locale the i18n suites, and a workflow,
 *   composite action or decision module under `.github/` the whole
 *   `tests/unit/config/` — the Actions layer's only proof before CI. Beyond
 *   these, a data file owes the tests that name its directory as a path
 *   segment or quote its stem (`mentionPattern`).
 * - **Nearest tests.** A changed module no test reaches by any rule above takes
 *   the test files at the first importer depth that has any, up to
 *   `NEAREST_MAX_DEPTH`.
 * - **Repo lint** (`tests/unit/lint/`) always runs: those suites read the tree
 *   as text (dead code, hard-coded strings, dangling references), so no import
 *   edge leads to them, and all 36 cost one second summed — 11 s of wall clock
 *   with Vitest's start-up, measured alone on a contended 4-core box.
 * - **Escalation.** A focused set that reaches `FULL_SUITE_SHARE` of the suite
 *   saves too little to be worth being partial, and runs the whole suite.
 *
 * What it cannot see: a test reaching a module only through a longer import
 * chain (a hub change whose behaviour flows through an intermediate module
 * that never names the changed identifier), files read from disk under a
 * computed name that is neither a path, a file name, a quoted stem nor a
 * directory literal, and a console command a test drives by its verb string.
 * All three are what CI's full run on the pull request head catches.
 *
 * The pure half (`importRefs` … `selectTests`) works on maps a test can build
 * by hand; `planLogic` is the thin layer that reads the repository.
 *
 * @module pipeline/test-selection
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { createRequire } from 'module';
import { join, posix } from 'path';
import { git, gitSucceeds } from './git.js';

/**
 * Above this many direct test importers a changed module is a hub and its
 * tests are narrowed to the identifiers the diff touched. Measured on this
 * repository's 681 `src/` modules: the median has 1 direct test importer, the
 * 90th percentile 9 (4 s summed), the 95th 20. Only 14 modules have more than
 * 40 — GameState, balance, VoxelGrid, createRunner, I18n, Random, the entity
 * modules, NavGrid, EventEmitter, DrillPlan — at 72 to 1022 s summed each.
 * Narrowing a module below the line buys seconds and costs recall; above it,
 * it is the difference between a pre-flight and a second full suite.
 */
export const HUB_IMPORTERS = 40;

/** At or above this share of the suite, a focused run is the full suite with gaps, so run the full one. */
export const FULL_SUITE_SHARE = 0.6;

/** How many importer hops the nearest-tests fallback walks before giving up on a module. */
const NEAREST_MAX_DEPTH = 4;

/** Suites that read the repository as text. No import edge leads to them, so they always run. */
const REPO_LINT_DIR = 'tests/unit/lint/';

/** Tests that own every file under a directory, whether or not they name the file. */
interface DirectoryOwner {
  /** Repository directory, with its trailing slash. */
  dir: string;
  /** Test files, or test directories with their trailing slash. */
  tests: readonly string[];
  /** The files' stems are words tests quote for their own sake, so a quoted stem is no sign a test reads the file. */
  commonStems?: true;
}

/**
 * The Actions layer has no local runtime, so `tests/unit/config/` is its proof
 * before CI (`agentic-workflow-edition`), and its rules sweep every workflow,
 * action and decision module without naming each — `autonomy-loop.test.ts`
 * applies the no-clock rule to whatever `readdirSync('.github/scripts')`
 * returns. All 25 files: 9 s wall, 13 s summed, on a contended 4-core box.
 */
const ACTIONS_LAYER_PROOF = ['tests/unit/config/'];

/** Explicit owners of directories, beyond the tests that name a file in them or the directory itself. */
const DIRECTORY_OWNERS: readonly DirectoryOwner[] = [
  // Every definition is validated by these suites (they list the directory), and
  // the survey scenario suites replay specific definitions.
  { dir: 'scripts/scenario-defs/', tests: ['tests/unit/scenario-defs-validation/', 'tests/unit/scenario/'] },
  // Key parity, glossary and value-parity suites read both locales whole. A
  // locale's stem is a language code: 148 test files quote 'en' or 'fr' to pick
  // a language, and counting them would take the en.json + fr.json change most
  // feature branches carry from 125 selected files to 210.
  { dir: 'src/core/i18n/locales/', tests: ['tests/unit/i18n/'], commonStems: true },
  ...['.github/workflows/', '.github/actions/', '.github/scripts/'].map((dir) => ({ dir, tests: ACTIONS_LAYER_PROOF })),
];

const CODE_EXTENSION = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Why a test file is in the focused set. The first rule that picks a file names it. */
type SelectionReason = 'changed' | 'importer' | 'mirrored' | 'mention' | 'owner' | 'nearest' | 'lint';

const REASON_LABELS: Record<SelectionReason, [string, string]> = {
  changed: ['changed test', 'changed tests'],
  importer: ['direct importer', 'direct importers'],
  mirrored: ['mirrored', 'mirrored'],
  mention: ['names a changed file', 'name a changed file'],
  owner: ['directory owner', 'directory owners'],
  nearest: ['nearest importer', 'nearest importers'],
  lint: ['repo lint', 'repo lint'],
};

/** One module reference as a file writes it. */
interface ImportRef {
  spec: string;
  /** `import type` / `export type … from`: erased before Vitest runs the file. */
  typeOnly: boolean;
}

/** Runtime import edges between repository files, both directions. */
interface ImportGraph {
  readonly imports: ReadonlyMap<string, ReadonlySet<string>>;
  readonly importers: ReadonlyMap<string, ReadonlySet<string>>;
}

interface SelectionInput {
  /** Repository paths the branch changed, deleted ones included. */
  changed: readonly string[];
  /** Every test file Vitest's `include` would run, as it exists now. */
  testFiles: readonly string[];
  /** Text of every code file read for the graph — tests included. */
  texts: ReadonlyMap<string, string>;
  graph: ImportGraph;
  /**
   * The exported identifiers a hub's diff touched, or `undefined` when the
   * diff cannot be attributed to named declarations. Asked for hubs only.
   */
  changedIdentifiers: (path: string) => ReadonlySet<string> | undefined;
  /** Vitest setup files the config names: a change to one changes how every test runs. */
  setupFiles?: readonly string[] | undefined;
}

export interface TestSelection {
  /** True when the whole suite runs; `files` is then empty. */
  full: boolean;
  fullReason?: string;
  /** The focused set, sorted. */
  files: string[];
  reasons: ReadonlyMap<string, SelectionReason>;
  /** How many test files the full suite holds. */
  total: number;
  /** One line per decision worth reading in the channel log: hubs narrowed, modules no test reaches. */
  notes: string[];
}

// ── Import graph ─────────────────────────────────────────────────────────────

/** `import … from '…'` / `export … from '…'`, never reaching past the next import/export line. */
const FROM_STATEMENT = /^[ \t]*(?:import|export)\s+(type\s+)?(?:(?!^[ \t]*(?:import|export)\b)[^;])*?\bfrom\s*['"]([^'"\n]+)['"]/gm;
/** `import '…'` — a side-effect import. */
const SIDE_EFFECT_IMPORT = /^[ \t]*import\s*['"]([^'"\n]+)['"]/gm;
/** `import('…')`, `require('…')`, and Vitest's module mocks, which load the module they name. */
const CALL_IMPORT = /(?<![\w$.])(?:import|require|vi\.(?:mock|doMock|importActual|importMock))\(\s*['"]([^'"\n]+)['"]/g;

/** Every module reference in one file's text, in source order per form. */
export function importRefs(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const match of text.matchAll(FROM_STATEMENT)) refs.push({ spec: match[2]!, typeOnly: match[1] !== undefined });
  for (const match of text.matchAll(SIDE_EFFECT_IMPORT)) refs.push({ spec: match[1]!, typeOnly: false });
  for (const match of text.matchAll(CALL_IMPORT)) refs.push({ spec: match[1]!, typeOnly: false });
  return refs;
}

/**
 * The repository path a relative specifier names, or `undefined` for a
 * package. Source writes `.js` for `.ts` files, so `./dom.js` is `./dom.ts`.
 * A specifier whose file no longer exists still resolves — to its likeliest
 * name — so a test importing a deleted module is selected and fails loudly.
 */
export function resolveImport(from: string, spec: string, exists: (path: string) => boolean): string | undefined {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return undefined;
  const target = posix.join(posix.dirname(from), spec);
  if (target.startsWith('../')) return undefined;
  const extension = /\.[A-Za-z0-9]+$/.exec(target)?.[0] ?? '';
  const stem = target.slice(0, target.length - extension.length);
  const candidates =
    extension === '.js' || extension === '.jsx' ? [`${stem}.ts`, `${stem}.tsx`, target, `${stem}/index.ts`]
      : extension === '.mjs' ? [`${stem}.mts`, target]
        : extension === '.cjs' ? [`${stem}.cts`, target]
          : extension === '' ? [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}.js`, target]
            : [target];
  return candidates.find(exists) ?? candidates[0];
}

/** Runtime edges among `texts`' files. Type-only imports carry no runtime behaviour and make no edge. */
export function buildImportGraph(texts: ReadonlyMap<string, string>, exists: (path: string) => boolean): ImportGraph {
  const imports = new Map<string, Set<string>>();
  const importers = new Map<string, Set<string>>();
  for (const [file, text] of texts) {
    for (const ref of importRefs(text)) {
      if (ref.typeOnly) continue;
      const target = resolveImport(file, ref.spec, exists);
      if (target === undefined || target === file) continue;
      if (!imports.has(file)) imports.set(file, new Set());
      imports.get(file)!.add(target);
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target)!.add(file);
    }
  }
  return { imports, importers };
}

// ── Path rules ───────────────────────────────────────────────────────────────

/** A file Vitest's `include` (vitest.config.ts) runs: `tests/unit/**` and `tests/integration/**` `*.test.ts`. */
export function isRunnableTest(path: string): boolean {
  return /^tests\/(unit|integration)\/.+\.test\.ts$/.test(path);
}

/**
 * A change to how every test runs: the dependency set, a Vitest config, a
 * tsconfig (Vitest's esbuild reads it), or a setup file the config names.
 */
export function isFullSuiteTrigger(path: string, setupFiles: readonly string[] = []): boolean {
  return (
    /^(package(-lock)?\.json|vitest[^/]*\.config\.[cm]?[jt]s|tsconfig[^/]*\.json)$/.test(path) ||
    /^(scripts|tests)\/tsconfig[^/]*\.json$/.test(path) ||
    setupFiles.includes(path)
  );
}

/** Setup files a Vitest config names under `setupFiles` / `globalSetup`, as repository paths. */
export function vitestSetupFiles(configText: string): string[] {
  const found: string[] = [];
  for (const block of configText.matchAll(/\b(?:setupFiles|globalSetup)\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)) {
    for (const quoted of block[1]!.matchAll(/['"]([^'"]+)['"]/g)) found.push(posix.normalize(quoted[1]!).replace(/^\.\//, ''));
  }
  return found;
}

/**
 * The test files the naming convention mirrors onto a source module:
 * `src/core/<p>` → `tests/unit/<p>` (and `tests/unit/core/<p>`), `src/<p>` →
 * `tests/unit/<p>`, `scripts/<p>` → `tests/unit/scripts/<p>`; each as
 * `<Name>.test.ts` and the `<Name>.<aspect>.test.ts` / `<Name>-<aspect>.test.ts`
 * siblings that split one module's suite.
 */
export function mirroredTests(path: string, testFiles: readonly string[]): string[] {
  const match = /^(src|scripts)\/(.+)\.(ts|tsx|mts|cts|js|mjs|cjs)$/.exec(path);
  if (!match) return [];
  const [root, rest] = [match[1]!, match[2]!];
  const stems =
    root === 'scripts' ? [`tests/unit/scripts/${rest}`]
      : rest.startsWith('core/') ? [`tests/unit/${rest.slice('core/'.length)}`, `tests/unit/${rest}`]
        : [`tests/unit/${rest}`];
  return testFiles.filter((file) =>
    stems.some((stem) => file === `${stem}.test.ts` || ((file.startsWith(`${stem}.`) || file.startsWith(`${stem}-`)) && file.endsWith('.test.ts'))),
  );
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches any of `names` as a whole identifier (`$` and `_` count as identifier characters). */
function identifierPattern(names: Iterable<string>): RegExp | undefined {
  const list = [...names].map(escapeRegExp);
  return list.length === 0 ? undefined : new RegExp(`(?<![\\w$])(?:${list.join('|')})(?![\\w$])`);
}

/** `dir` as a path ending a literal (`'…/scenario-defs'`, `'src/ui/'`) or opening a template (`` `locales/${l}.json` ``). */
const directoryLiteral = (dir: string): string => `(?:^|[/'"\`])${escapeRegExp(dir)}(?:\\/?['"\`]|\\/\\$\\{)`;

/**
 * How a test names a file it reads or runs instead of importing it — a hook it
 * spawns, a workflow it parses, a definition it loads, a directory it lists.
 *
 * - **Code file:** its name ending a path or a string
 *   (`'require-foreground-bash.mjs'`, `.github/scripts/assignability.cjs`), or
 *   one of its directories two segments deep or more, written whole as a
 *   literal: `tutorialStages.test.ts` reads every file under `'../../../src/ui'`
 *   and `autonomy-loop.test.ts` every module `readdirSync` finds in
 *   `'.github/scripts'`. A bare segment (`'scripts'`, `'shared'`, `'src'` — an
 *   HTML attribute in the audio tests) is too generic to count.
 * - **Data file:** its name after a path, quote, space or parenthesis (a comment
 *   saying `Runs blast-overcharge.json`), its stem as a whole quoted literal —
 *   the project's loaders take the stem (`loadScenarioDef(name, dir)`,
 *   `scenarioRun(name)`, `` `${id}.glb` ``), so `denseBlast.test.ts` names
 *   `ore-haul-dispatch.json` only as `'ore-haul-dispatch'` — unless its
 *   directory's stems are common words (`DirectoryOwner.commonStems`); or its
 *   directory as a path segment (`join(ROOT, 'scenario-defs')`).
 */
export function mentionPattern(path: string): RegExp {
  const parts = path.split('/');
  const name = parts.at(-1)!;
  if (CODE_EXTENSION.test(path)) {
    const directories = Array.from({ length: Math.max(0, parts.length - 2) }, (_, i) => parts.slice(0, i + 2).join('/'));
    return new RegExp([`(?:^|[/'"\`])${escapeRegExp(name)}(?![\\w.-])`, ...directories.map(directoryLiteral)].join('|'));
  }
  const alternatives = [`(?:^|[\\s(/'"\`])${escapeRegExp(name)}(?![\\w.-])`];
  const dot = name.lastIndexOf('.');
  if (dot > 0 && !DIRECTORY_OWNERS.some((owner) => owner.commonStems === true && path.startsWith(owner.dir))) {
    alternatives.push(`['"\`]${escapeRegExp(name.slice(0, dot))}['"\`]`);
  }
  if (parts.length >= 2) alternatives.push(directoryLiteral(parts.at(-2)!));
  return new RegExp(alternatives.join('|'));
}

// ── Selection ────────────────────────────────────────────────────────────────

/** The focused test set for a change, or the verdict that it owes the full suite. */
export function selectTests(input: SelectionInput): TestSelection {
  const { changed, testFiles, texts, graph } = input;
  const total = testFiles.length;
  const full = (fullReason: string, notes: string[] = []): TestSelection => ({ full: true, fullReason, files: [], reasons: new Map(), total, notes });

  const trigger = [...changed].sort().find((path) => isFullSuiteTrigger(path, input.setupFiles));
  if (trigger !== undefined) return full(`${trigger} changes how every test runs`);

  const testSet = new Set(testFiles);
  const reasons = new Map<string, SelectionReason>();
  const notes: string[] = [];
  const add = (files: Iterable<string>, reason: SelectionReason): number => {
    let added = 0;
    for (const file of files) {
      if (!testSet.has(file)) continue;
      added++;
      if (!reasons.has(file)) reasons.set(file, reason);
    }
    return added;
  };
  const testImporters = (path: string): string[] => [...(graph.importers.get(path) ?? [])].filter((f) => testSet.has(f)).sort();
  const mentioning = (pattern: RegExp): string[] => testFiles.filter((file) => pattern.test(texts.get(file) ?? ''));

  /** Direct test importers of `path`, narrowed to the changed identifiers when `path` is a hub. */
  const narrowedImporters = (path: string): string[] => {
    const direct = testImporters(path);
    // A data file has no declarations to narrow by: every importer reads all of it.
    if (direct.length <= HUB_IMPORTERS || !CODE_EXTENSION.test(path)) return direct;
    const hub = `${path}: hub (${direct.length} direct test importers)`;
    const identifiers = input.changedIdentifiers(path);
    if (identifiers === undefined) {
      notes.push(`${hub}; the diff names no identifier, so all of them run`);
      return direct;
    }
    const pattern = identifierPattern(identifiers);
    if (pattern === undefined) {
      notes.push(`${hub}; the diff touches no exported identifier, so none of them run`);
      return [];
    }
    const narrowed = new Set(direct.filter((file) => pattern.test(texts.get(file) ?? '')));
    for (const user of graph.importers.get(path) ?? []) {
      if (testSet.has(user) || !pattern.test(texts.get(user) ?? '')) continue;
      for (const file of testImporters(user)) narrowed.add(file);
    }
    notes.push(`${hub} narrowed to ${narrowed.size} by the changed identifiers ${[...identifiers].sort().join(', ')}`);
    return [...narrowed].sort();
  };

  /** The test files at the first importer depth that has any, walking up from `path`. */
  const nearestTests = (path: string): string[] => {
    const seen = new Set([path]);
    let frontier = [path];
    for (let depth = 1; depth <= NEAREST_MAX_DEPTH && frontier.length > 0; depth++) {
      const next = [...new Set(frontier.flatMap((module) => [...(graph.importers.get(module) ?? [])]))].filter((f) => !seen.has(f));
      for (const module of next) seen.add(module);
      const tests = next.filter((f) => testSet.has(f));
      if (tests.length > 0) return tests.sort();
      frontier = next;
    }
    return [];
  };

  // Changed tests first, so a test the diff edits is reported as changed rather than as an importer.
  add([...changed].filter(isRunnableTest), 'changed');
  for (const path of [...changed].filter((p) => !isRunnableTest(p)).sort()) {
    let reached = add(narrowedImporters(path), 'importer');
    reached += add(mirroredTests(path, testFiles), 'mirrored');
    reached += add(mentioning(mentionPattern(path)), 'mention');
    for (const owner of DIRECTORY_OWNERS.filter((o) => path.startsWith(o.dir))) {
      reached += add(testFiles.filter((f) => owner.tests.some((test) => f.startsWith(test))), 'owner');
    }
    // A hub narrowed to nothing has tests; it is the diff that reaches none of them.
    if (reached === 0 && testImporters(path).length === 0 && (CODE_EXTENSION.test(path) || graph.importers.has(path))) {
      const nearest = nearestTests(path);
      add(nearest, 'nearest');
      if (nearest.length === 0) notes.push(`no test reaches ${path} within ${NEAREST_MAX_DEPTH} importer hops`);
    }
  }
  add(testFiles.filter((f) => f.startsWith(REPO_LINT_DIR)), 'lint');

  const files = [...reasons.keys()].sort();
  if (total > 0 && files.length >= FULL_SUITE_SHARE * total) {
    return full(`the focused selection reached ${Math.round((100 * files.length) / total)}% of test files`, notes);
  }
  return { full: false, files, reasons, total, notes };
}

/** `focused: 23 of 1005 test files (2 changed tests, 19 direct importers, 2 mirrored)` — or the full-suite verdict. */
export function describeSelection(selection: TestSelection): string {
  if (selection.full) return `full suite: ${selection.total} test files (${selection.fullReason ?? 'requested'})`;
  const counts = new Map<SelectionReason, number>();
  for (const reason of selection.reasons.values()) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const parts = (Object.keys(REASON_LABELS) as SelectionReason[])
    .filter((reason) => counts.has(reason))
    .map((reason) => `${counts.get(reason)} ${REASON_LABELS[reason][counts.get(reason) === 1 ? 0 : 1]}`);
  return `focused: ${selection.files.length} of ${selection.total} test files${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
}

/** The selection as channel-log lines: each chosen file with its reason, then the notes. */
export function selectionLog(selection: TestSelection): string[] {
  return [
    `# logic — ${describeSelection(selection)}`,
    ...selection.files.map((file) => `#   ${selection.reasons.get(file)}: ${file}`),
    ...selection.notes.map((note) => `# note: ${note}`),
  ];
}

// ── Changed identifiers ──────────────────────────────────────────────────────

/** Added (new-file) and removed (old-file) line numbers of a `git diff -U0`. */
export function diffLineNumbers(diff: string): { added: number[]; removed: number[] } {
  const added: number[] = [];
  const removed: number[] = [];
  for (const match of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [oldStart, oldCount, newStart, newCount] = [match[1], match[2] ?? '1', match[3], match[4] ?? '1'].map(Number) as [number, number, number, number];
    for (let i = 0; i < oldCount; i++) removed.push(oldStart + i);
    for (let i = 0; i < newCount; i++) added.push(newStart + i);
  }
  return { added, removed };
}

type TypeScript = typeof import('typescript');
let typescriptModule: TypeScript | undefined;
/** Loaded on first use: only a hub change pays the half-second the compiler takes to load. */
function typescript(): TypeScript {
  typescriptModule ??= createRequire(import.meta.url)('typescript') as TypeScript;
  return typescriptModule;
}

interface TopLevelStatement {
  firstLine: number;
  lastLine: number;
  kind: 'import' | 'named' | 'opaque';
  names: string[];
  exported: boolean;
  text: string;
}

function topLevelStatements(text: string): { statements: TopLevelStatement[]; aliases: Map<string, string[]> } {
  const ts = typescript();
  const source = ts.createSourceFile('changed.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const line = (position: number): number => source.getLineAndCharacterOfPosition(position).line + 1;
  const aliases = new Map<string, string[]>();
  const bindingNames = (name: import('typescript').BindingName): string[] =>
    ts.isIdentifier(name) ? [name.text] : name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)));

  const statements = source.statements.map((statement): TopLevelStatement => {
    const base = { firstLine: line(statement.getStart(source)), lastLine: line(statement.getEnd()), text: statement.getText(source) };
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
    const exported = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) return { ...base, kind: 'import', names: [], exported: false };
    if (ts.isVariableStatement(statement)) {
      return { ...base, kind: 'named', names: statement.declarationList.declarations.flatMap((d) => bindingNames(d.name)), exported };
    }
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name !== undefined && !isDefault
    ) {
      return { ...base, kind: 'named', names: [statement.name.text], exported };
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (ts.isNamespaceExport(statement.exportClause)) return { ...base, kind: 'named', names: [statement.exportClause.name.text], exported: true };
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        aliases.set(local, [...(aliases.get(local) ?? []), element.name.text]);
      }
      return { ...base, kind: 'named', names: statement.exportClause.elements.map((e) => e.name.text), exported: true };
    }
    return { ...base, kind: 'opaque', names: [], exported: false };
  });
  return { statements, aliases };
}

/**
 * The exported identifiers whose behaviour the changed `lines` of `text` can
 * alter: the top-level declarations the lines fall in (a comment or blank line
 * belongs to the declaration after it), then every declaration whose text uses
 * one of those, to a fixpoint — a constant feeds the exported function that
 * reads it. `undefined` when a line falls in a statement no name stands for
 * (a side effect, `export *`, a default export) or the lines touch only imports.
 */
export function changedExports(text: string, lines: readonly number[]): Set<string> | undefined {
  if (lines.length === 0) return new Set();
  const { statements, aliases } = topLevelStatements(text);
  const hit = new Set<TopLevelStatement>();
  for (const changedLine of lines) {
    const statement = statements.find((s) => s.firstLine <= changedLine && changedLine <= s.lastLine) ?? statements.find((s) => s.firstLine > changedLine);
    if (statement !== undefined) hit.add(statement);
  }
  if ([...hit].some((s) => s.kind === 'opaque')) return undefined;
  const named = [...hit].filter((s) => s.kind === 'named');
  if (named.length === 0) return hit.size > 0 ? undefined : new Set();

  const marked = new Set(named);
  const names = new Set(named.flatMap((s) => s.names));
  for (let grew = true; grew;) {
    grew = false;
    const pattern = identifierPattern(names);
    for (const statement of statements) {
      if (marked.has(statement) || statement.kind !== 'named' || pattern === undefined || !pattern.test(statement.text)) continue;
      marked.add(statement);
      for (const name of statement.names) names.add(name);
      grew = true;
    }
  }
  const exported = new Set<string>();
  for (const statement of marked) {
    for (const name of statement.names) {
      if (statement.exported) exported.add(name);
      for (const alias of aliases.get(name) ?? []) exported.add(alias);
    }
  }
  return exported;
}

// ── Repository IO ────────────────────────────────────────────────────────────

/** The exported identifiers `path`'s diff against `forkPoint` touched, on both sides of the diff. */
function diffIdentifiers(root: string, forkPoint: string, path: string): Set<string> | undefined {
  if (!gitSucceeds(root, 'cat-file', '-e', `${forkPoint}:${path}`)) return undefined;
  const { added, removed } = diffLineNumbers(git(root, 'diff', '-U0', '--no-color', '--no-ext-diff', forkPoint, '--', path));
  const before = changedExports(git(root, 'show', `${forkPoint}:${path}`), removed);
  const now = existsSync(join(root, path)) ? changedExports(readFileSync(join(root, path), 'utf8'), added) : new Set<string>();
  return before === undefined || now === undefined ? undefined : new Set([...before, ...now]);
}

/**
 * Read the repository and select the tests `changed` owes since `forkPoint`.
 * Reads every code file once (1846 here: 80 ms, and 110 ms more for the
 * graph) and runs git only for the file listing and, per hub, its diff.
 */
export function planLogic(root: string, forkPoint: string, changed: readonly string[]): TestSelection {
  const listed = git(root, 'ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter((p) => p !== '');
  const known = new Set(listed);
  const texts = new Map<string, string>();
  for (const path of listed) {
    if (!CODE_EXTENSION.test(path) || path.startsWith('node_modules/')) continue;
    const absolute = join(root, path);
    if (existsSync(absolute)) texts.set(path, readFileSync(absolute, 'utf8'));
  }
  const configPath = join(root, 'vitest.config.ts');
  return selectTests({
    // A path git reports that is a directory on disk — a worktree's node_modules symlink — is no file change.
    changed: changed.filter((path) => !(existsSync(join(root, path)) && statSync(join(root, path)).isDirectory())),
    testFiles: [...texts.keys()].filter(isRunnableTest).sort(),
    texts,
    graph: buildImportGraph(texts, (path) => known.has(path) || texts.has(path)),
    changedIdentifiers: (path) => diffIdentifiers(root, forkPoint, path),
    setupFiles: existsSync(configPath) ? vitestSetupFiles(readFileSync(configPath, 'utf8')) : [],
  });
}
