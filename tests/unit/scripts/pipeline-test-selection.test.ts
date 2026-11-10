// BlastSimulator2026 — Which test files `verify`'s focused `logic` channel runs
// (scripts/lib/pipeline/test-selection.ts)
//
// The local `logic` channel stopped running the whole 1005-file suite on every
// `verify` call — five to seven calls a run, 49 of 159 measured wall-hours, and
// the reason five issues hit the 270-minute agent timeout. The full suite is
// CI's; locally the channel runs a selection read off a static import graph.
// These cases pin each selection rule on a synthetic repository built in
// memory, the identifier narrowing that keeps a one-constant edit to a hub from
// re-running hundreds of files, and the IO layer against a real git diff.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import vitestConfig from '../../../vitest.config.js';
import { branchChanges } from '../../../scripts/lib/pipeline/git.js';
import {
  buildImportGraph,
  changedExports,
  describeSelection,
  diffLineNumbers,
  FULL_SUITE_SHARE,
  HUB_IMPORTERS,
  importRefs,
  isFullSuiteTrigger,
  isRunnableTest,
  mentionPattern,
  mirroredTests,
  packageJsonChangeIsInert,
  planLogic,
  resolveImport,
  selectionLog,
  selectTests,
  verbPattern,
  verbsCalling,
  vitestSetupFiles,
  COMMAND_REGISTRY,
  declaredExports,
  type TestSelection,
} from '../../../scripts/lib/pipeline/test-selection.js';

// Paths of the synthetic repositories below, built rather than written
// literally so the repo-wide dangling-reference lint does not read them as ours.
const p = (...parts: string[]): string => parts.join('/');
const SRC = (name: string): string => p('src', 'core', 'demo', name);
const UNIT = (name: string): string => p('tests', 'unit', 'demo', name);
const LINT = p('tests', 'unit', 'lint', 'NoThing.test.ts');
/** A selection's files come back sorted; the expectations list them in the order they read best. */
const sorted = (...files: string[]): string[] => [...files].sort();

/** An in-memory repository: its files' texts, their import graph and the runnable tests among them. */
function world(files: Record<string, string>) {
  const texts = new Map(Object.entries(files));
  const graph = buildImportGraph(texts, (path) => texts.has(path));
  const testFiles = [...texts.keys()].filter(isRunnableTest).sort();
  return { texts, graph, testFiles };
}

function select(files: Record<string, string>, changed: string[], identifiers: Record<string, string[] | undefined> = {}): TestSelection {
  return selectTests({
    ...world(files),
    changed,
    changedIdentifiers: (path) => {
      const names = identifiers[path];
      return names === undefined ? undefined : new Set(names);
    },
  });
}

const importing = (from: string, target: string, names = 'x'): string => {
  const fromDir = dirname(from).split('/');
  const toParts = target.replace(/\.ts$/, '.js').split('/');
  let shared = 0;
  while (shared < fromDir.length && fromDir[shared] === toParts[shared]) shared++;
  const ups = fromDir.length - shared;
  const rel = `${ups === 0 ? './' : '../'.repeat(ups)}${toParts.slice(shared).join('/')}`;
  return `import { ${names} } from '${rel}';\n`;
};

describe('importRefs', () => {
  it('reads static, re-export, side-effect, dynamic, require and mock references', () => {
    const text = [
      "import { a } from './a.js';",
      "export { b } from '../b.js';",
      "import './side.js';",
      "const c = await import('./c.js');",
      "const d = require('./d.cjs');",
      "vi.mock('./e.js', () => ({}));",
      "import { describe } from 'vitest';",
    ].join('\n');
    expect(importRefs(text).map((r) => r.spec).sort()).toEqual(['../b.js', './a.js', './c.js', './d.cjs', './e.js', './side.js', 'vitest']);
  });

  it('marks whole-statement type imports, and reads a multi-line import clause', () => {
    const text = "import type { T } from './types.js';\nimport {\n  one,\n  two,\n} from './multi.js';\nexport type { U } from './u.js';\n";
    expect(importRefs(text)).toEqual([
      { spec: './types.js', typeOnly: true },
      { spec: './multi.js', typeOnly: false },
      { spec: './u.js', typeOnly: true },
    ]);
  });

  it('never stretches a type alias over the runtime import on the next line', () => {
    const text = "export type Mode = 'a' | 'b'\nimport { run } from './run.js';\n";
    expect(importRefs(text)).toEqual([{ spec: './run.js', typeOnly: false }]);
  });
});

describe('resolveImport', () => {
  const files = new Set([SRC('Mod.ts'), SRC('index.ts'), p('src', 'core', 'demo', 'data.json'), p('hooks', 'h.mjs')]);
  const exists = (path: string): boolean => files.has(path);

  it('reads a `.js` specifier as the `.ts` source and an extensionless one as its index', () => {
    expect(resolveImport(SRC('Other.ts'), './Mod.js', exists)).toBe(SRC('Mod.ts'));
    expect(resolveImport(p('src', 'core', 'x.ts'), './demo', exists)).toBe(SRC('index.ts'));
    expect(resolveImport(SRC('Other.ts'), './data.json', exists)).toBe(p('src', 'core', 'demo', 'data.json'));
    expect(resolveImport(p('hooks', 'g.mjs'), './h.mjs', exists)).toBe(p('hooks', 'h.mjs'));
  });

  it('ignores packages and paths that leave the repository', () => {
    expect(resolveImport(SRC('Other.ts'), 'vitest', exists)).toBeUndefined();
    expect(resolveImport('top.ts', '../outside.js', exists)).toBeUndefined();
  });

  it('still resolves a module that no longer exists, so a test importing it is selected', () => {
    expect(resolveImport(SRC('Other.ts'), './Gone.js', exists)).toBe(SRC('Gone.ts'));
  });
});

describe('buildImportGraph', () => {
  it('records runtime edges both ways and drops type-only ones', () => {
    const { graph } = world({
      [SRC('Mod.ts')]: 'export const x = 1;\n',
      [UNIT('Mod.test.ts')]: importing(UNIT('Mod.test.ts'), SRC('Mod.ts')),
      [UNIT('Types.test.ts')]: importing(UNIT('Types.test.ts'), SRC('Mod.ts')).replace('import {', 'import type {'),
    });
    expect([...graph.importers.get(SRC('Mod.ts'))!]).toEqual([UNIT('Mod.test.ts')]);
    expect([...graph.imports.get(UNIT('Mod.test.ts'))!]).toEqual([SRC('Mod.ts')]);
  });
});

describe('path rules', () => {
  it("runs exactly what vitest.config.ts's include runs", () => {
    expect(vitestConfig.test?.include).toEqual(['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/integration/full-level/**/*.test.ts']);
    expect(isRunnableTest(UNIT('A.test.ts'))).toBe(true);
    expect(isRunnableTest(p('tests', 'integration', 'full-level', 'win.test.ts'))).toBe(true);
    expect(isRunnableTest(p('tests', 'scenarios', 'level-playthroughs.test.ts'))).toBe(false);
    expect(isRunnableTest(p('tests', 'helpers', 'gameContext.ts'))).toBe(false);
  });

  it('mirrors a source module onto its test file and its split siblings', () => {
    const tests = [
      p('tests', 'unit', 'nav', 'Pathfinding.test.ts'),
      p('tests', 'unit', 'nav', 'Pathfinding.diagonal.test.ts'),
      p('tests', 'unit', 'nav', 'Pathfinding-ramps.test.ts'),
      p('tests', 'unit', 'nav', 'PathfindingCache.test.ts'),
      p('tests', 'unit', 'ui', 'RampTool.test.ts'),
      p('tests', 'unit', 'scripts', 'shared', 'scenario-utils.test.ts'),
    ];
    expect(mirroredTests(p('src', 'core', 'nav', 'Pathfinding.ts'), tests)).toEqual(tests.slice(0, 3));
    expect(mirroredTests(p('src', 'ui', 'RampTool.ts'), tests)).toEqual([tests[4]]);
    expect(mirroredTests(p('scripts', 'shared', 'scenario-utils.ts'), tests)).toEqual([tests[5]]);
    expect(mirroredTests('package.json', tests)).toEqual([]);
  });

  it('treats what changes how every test runs as a full-suite trigger', () => {
    for (const path of ['package.json', 'package-lock.json', 'vitest.config.ts', 'vitest.coverage.config.ts', 'tsconfig.json', p('tests', 'tsconfig.json'), p('scripts', 'tsconfig.json')]) {
      expect(isFullSuiteTrigger(path), path).toBe(true);
    }
    expect(isFullSuiteTrigger(SRC('Mod.ts'))).toBe(false);
    const setup = vitestSetupFiles(`test: { setupFiles: ['./${p('tests', 'setup.ts')}'], globalSetup: '${p('tests', 'global.ts')}' }`);
    expect(setup).toEqual([p('tests', 'setup.ts'), p('tests', 'global.ts')]);
    expect(isFullSuiteTrigger(p('tests', 'setup.ts'), setup)).toBe(true);
    expect(vitestSetupFiles("coverage: { exclude: ['src/main.ts'] }")).toEqual([]);
  });

  it('finds a file named by a test, and a data file by its directory', () => {
    expect(mentionPattern(p('.claude', 'hooks', 'guard.mjs')).test("hook('guard.mjs', payload)")).toBe(true);
    expect(mentionPattern(p('.claude', 'hooks', 'guard.mjs')).test("hook('guard.mjs.bak', payload)")).toBe(false);
    const defs = mentionPattern(p('scripts', 'scenario-defs', 'blast-basic.json'));
    expect(defs.test("readdirSync(join(ROOT, 'scripts', 'scenario-defs'))")).toBe(true);
    expect(defs.test('readFileSync(`scripts/scenario-defs/${name}.json`)')).toBe(true);
    expect(defs.test("import x from './scenario-defs-validation/fixtures.js'")).toBe(false);
    // A code module's directory is too generic a word to count.
    expect(mentionPattern(p('scripts', 'shared', 'chrome.ts')).test("join(ROOT, 'shared')")).toBe(false);
  });

  it('finds a data file by the stem its loader takes, and by its name in prose', () => {
    const defs = mentionPattern(p('scripts', 'scenario-defs', 'blast-basic.json'));
    expect(defs.test("const COLLAPSE = 'blast-basic';")).toBe(true);
    expect(defs.test('runScenarioSteps("blast-basic")')).toBe(true);
    expect(defs.test('// Runs blast-basic.json and its twin through the runner')).toBe(true);
    expect(defs.test('(see blast-basic.json)')).toBe(true);
    expect(defs.test("loadScenarioDef('blast-basic-2', SCENARIO_DIR)")).toBe(false);
    expect(defs.test('a blast-basic shot')).toBe(false);
    // A locale's stem is a language code every i18n-aware test quotes.
    const locale = mentionPattern(p('src', 'core', 'i18n', 'locales', 'en.json'));
    expect(locale.test("setLocale('en')")).toBe(false);
    expect(locale.test('// every key of en.json')).toBe(true);
  });

  it('finds a code file by a directory of it a test lists, written whole', () => {
    const kit = mentionPattern(p('src', 'ui', 'scene', 'Kit.ts'));
    expect(kit.test(`const UI_DIR = resolve(import.meta.dirname, '../../../${p('src', 'ui')}');`)).toBe(true);
    expect(kit.test(`readdirSync('${p('src', 'ui', 'scene')}/')`)).toBe(true);
    // A bare first segment is an ordinary word (an HTML attribute here).
    expect(kit.test("expect(el.attributes.has('src')).toBe(false)")).toBe(false);
    expect(mentionPattern(p('.github', 'scripts', 'gate.cjs')).test(`readdirSync(join(ROOT, '${p('.github', 'scripts')}'))`)).toBe(true);
    // A code file named in prose is no mention: that would bypass a hub's narrowing.
    expect(mentionPattern(SRC('Hub.ts')).test('// constants from Hub.ts')).toBe(false);
  });
});

describe('selectTests', () => {
  const base = {
    [SRC('Mod.ts')]: 'export const x = 1;\n',
    [UNIT('Mod.test.ts')]: importing(UNIT('Mod.test.ts'), SRC('Mod.ts')),
    [UNIT('Mod.edge.test.ts')]: '// tests Mod through the console\n',
    [UNIT('User.test.ts')]: importing(UNIT('User.test.ts'), SRC('Mod.ts')),
    [UNIT('Unrelated.test.ts')]: '',
    [p('tests', 'unit', 'other', 'A.test.ts')]: '',
    [p('tests', 'unit', 'other', 'B.test.ts')]: '',
    [p('tests', 'unit', 'other', 'C.test.ts')]: '',
    [p('tests', 'unit', 'other', 'D.test.ts')]: '',
    [p('tests', 'unit', 'other', 'E.test.ts')]: '',
    [LINT]: "// reads src/ as text\n",
  };

  it('runs a changed test file, and not a deleted one', () => {
    const selection = select(base, [UNIT('Unrelated.test.ts'), UNIT('Deleted.test.ts')]);
    expect(selection.reasons.get(UNIT('Unrelated.test.ts'))).toBe('changed');
    expect(selection.files).not.toContain(UNIT('Deleted.test.ts'));
    // Reported as changed even when it also imports a changed module.
    expect(select(base, [SRC('Mod.ts'), UNIT('Mod.test.ts')]).reasons.get(UNIT('Mod.test.ts'))).toBe('changed');
  });

  it("runs a changed module's direct importers and its mirrored tests — and the repo lint, always", () => {
    const selection = select(base, [SRC('Mod.ts')]);
    expect(selection.full).toBe(false);
    expect(selection.files).toEqual(sorted(LINT, UNIT('Mod.edge.test.ts'), UNIT('Mod.test.ts'), UNIT('User.test.ts')));
    expect(selection.reasons.get(UNIT('User.test.ts'))).toBe('importer');
    expect(selection.reasons.get(UNIT('Mod.edge.test.ts'))).toBe('mirrored');
    expect(selection.reasons.get(LINT)).toBe('lint');
    expect(describeSelection(selection)).toBe('focused: 4 of 10 test files (2 direct importers, 1 mirrored, 1 repo lint)');
  });

  it('is deterministic whatever order the diff lists files in', () => {
    const changed = [SRC('Mod.ts'), UNIT('Unrelated.test.ts')];
    expect(selectionLog(select(base, changed))).toEqual(selectionLog(select(base, [...changed].reverse())));
  });

  it('runs a test helper\'s importers', () => {
    const helper = p('tests', 'helpers', 'demoWorld.ts');
    const selection = select({ ...base, [helper]: 'export const w = 1;\n', [UNIT('Unrelated.test.ts')]: importing(UNIT('Unrelated.test.ts'), helper, 'w') }, [helper]);
    expect(selection.reasons.get(UNIT('Unrelated.test.ts'))).toBe('importer');
  });

  it('walks up to the nearest tests when no test imports a changed module', () => {
    const files = {
      ...base,
      [SRC('Deep.ts')]: 'export const deep = 1;\n',
      [SRC('Middle.ts')]: importing(SRC('Middle.ts'), SRC('Deep.ts'), 'deep'),
      [SRC('Top.ts')]: importing(SRC('Top.ts'), SRC('Middle.ts'), 'deep'),
      [UNIT('Top.test.ts')]: importing(UNIT('Top.test.ts'), SRC('Top.ts'), 'deep'),
      [UNIT('Far.test.ts')]: '',
    };
    const selection = select(files, [SRC('Deep.ts')]);
    expect(selection.files).toEqual(sorted(LINT, UNIT('Top.test.ts')));
    expect(selection.reasons.get(UNIT('Top.test.ts'))).toBe('nearest');
  });

  it('says so when no test reaches a changed module at all', () => {
    const selection = select({ ...base, [SRC('Orphan.ts')]: 'export const o = 1;\n' }, [SRC('Orphan.ts')]);
    expect(selection.files).toEqual([LINT]);
    expect(selection.notes).toEqual([expect.stringContaining(`no test reaches ${SRC('Orphan.ts')}`)]);
  });

  describe('hub narrowing', () => {
    const hub = SRC('Hub.ts');
    const user = SRC('UsesB.ts');
    const files: Record<string, string> = { ...base, [hub]: 'export const A = 1;\nexport const B = 2;\n' };
    for (let i = 0; i <= HUB_IMPORTERS; i++) {
      const test = UNIT(`Hub${i}.test.ts`);
      files[test] = `${importing(test, hub, i < 3 ? 'A' : 'B')}it('works', () => {});\n`;
    }
    files[user] = `${importing(user, hub, 'B')}export const usesB = () => B;\n`;
    files[UNIT('UsesB.test.ts')] = importing(UNIT('UsesB.test.ts'), user, 'usesB');
    files[UNIT('Bystander.test.ts')] = importing(UNIT('Bystander.test.ts'), SRC('Mod.ts'));
    // Enough of the suite elsewhere that running every hub importer stays under FULL_SUITE_SHARE.
    for (let i = 0; i < 40; i++) files[p('tests', 'unit', 'other', `Filler${i}.test.ts`)] = '';

    it('narrows a hub to the tests naming a changed identifier', () => {
      const selection = select(files, [hub], { [hub]: ['A'] });
      expect(selection.files).toEqual(sorted(LINT, UNIT('Hub0.test.ts'), UNIT('Hub1.test.ts'), UNIT('Hub2.test.ts')));
      expect(selection.notes[0]).toMatch(/hub \(41 direct test importers\) narrowed to 3 by the changed identifiers A/);
    });

    it('adds the direct importers of a module that uses the changed identifier', () => {
      const selection = select(files, [hub], { [hub]: ['B'] });
      expect(selection.files).toContain(UNIT('UsesB.test.ts'));
      expect(selection.files).not.toContain(UNIT('Hub0.test.ts'));
      expect(selection.files).not.toContain(UNIT('Bystander.test.ts'));
    });

    it('runs every direct importer when the diff names no identifier', () => {
      const selection = select(files, [hub], { [hub]: undefined });
      expect(selection.files.filter((f) => /Hub\d+\.test/.test(f))).toHaveLength(HUB_IMPORTERS + 1);
      expect(selection.notes[0]).toMatch(/names no identifier, so all of them run/);
    });

    it('runs none of them when the diff touches no exported identifier', () => {
      const selection = select(files, [hub], { [hub]: [] });
      expect(selection.files).toEqual([LINT]);
    });
  });

  describe('data files', () => {
    const def = p('scripts', 'scenario-defs', 'blast-basic.json');
    const locale = p('src', 'core', 'i18n', 'locales', 'en.json');
    const files = {
      ...base,
      [p('tests', 'unit', 'scenario-defs-validation', 'shape.test.ts')]: '',
      [p('tests', 'unit', 'scenario', 'survey.test.ts')]: '',
      [p('tests', 'integration', 'replays.integration.test.ts')]: "const DIR = join(ROOT, 'scripts', 'scenario-defs');\n",
      [p('tests', 'unit', 'i18n', 'keyParity.test.ts')]: '',
      [p('tests', 'unit', 'ui', 'TopBar.test.ts')]: "import en from '../../../src/core/i18n/locales/en.json';\n",
      [p('tests', 'unit', 'config', 'ci.test.ts')]: "const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');\n",
      [p('tests', 'unit', 'config', 'hooks.test.ts')]: "expect(hook('guard.mjs', payload)).toBe(0);\n",
    };

    it('runs the validation suites and the tests that list the directory for a scenario definition', () => {
      const selection = select(files, [def]);
      expect(selection.files).toEqual(sorted(
        p('tests', 'integration', 'replays.integration.test.ts'),
        LINT,
        p('tests', 'unit', 'scenario', 'survey.test.ts'),
        p('tests', 'unit', 'scenario-defs-validation', 'shape.test.ts'),
      ));
    });

    it('runs the i18n suites and the importers for a locale', () => {
      const selection = select(files, [locale]);
      expect(selection.files).toEqual(sorted(LINT, p('tests', 'unit', 'i18n', 'keyParity.test.ts'), p('tests', 'unit', 'ui', 'TopBar.test.ts')));
    });

    it('runs the tests that load a scenario definition by its stem, directly or through a helper', () => {
      const helper = p('tests', 'helpers', 'crowd.ts');
      const replay = p('tests', 'unit', 'demo', 'replay.test.ts');
      const dense = p('tests', 'unit', 'audio', 'dense.test.ts');
      const runner = p('tests', 'integration', 'charge.integration.test.ts');
      const twin = p('tests', 'unit', 'demo', 'twin.test.ts');
      const selection = select({
        ...files,
        [helper]: "export const scenarioRun = (name: string) => loadScenarioDef(name, SCENARIO_DIR);\n",
        [replay]: "const NAME = 'blast-basic';\nconst def = loadScenarioDef(NAME, SCENARIO_DIR);\n",
        [dense]: `${importing(dense, helper, 'scenarioRun')}const COLLAPSE = 'blast-basic';\nscenarioRun(COLLAPSE);\n`,
        [runner]: '// Runs blast-basic.json through the scenario runner.\n',
        [twin]: "loadScenarioDef('blast-basic-2', SCENARIO_DIR);\n",
      }, [def]);
      for (const test of [replay, dense, runner]) expect(selection.reasons.get(test), test).toBe('mention');
      expect(selection.files).not.toContain(twin);
    });

    it('runs the whole config suite for the Actions layer, whose rules sweep files they never name', () => {
      const config = [p('tests', 'unit', 'config', 'ci.test.ts'), p('tests', 'unit', 'config', 'hooks.test.ts')];
      for (const changed of [p('.github', 'workflows', 'ci.yml'), p('.github', 'actions', 'gate', 'action.yml'), p('.github', 'scripts', 'gate.cjs')]) {
        expect(select(files, [changed]).files, changed).toEqual(sorted(LINT, ...config));
      }
      expect(select(files, [p('.github', 'scripts', 'gate.cjs')]).reasons.get(config[1]!)).toBe('owner');
    });

    it('runs the tests that read a workflow or spawn a hook by name', () => {
      expect(select(files, [p('.github', 'workflows', 'ci.yml')]).reasons.get(p('tests', 'unit', 'config', 'ci.test.ts'))).toBe('mention');
      expect(select(files, [p('.claude', 'hooks', 'guard.mjs')]).files).toEqual(sorted(LINT, p('tests', 'unit', 'config', 'hooks.test.ts')));
    });
  });

  it('runs a test that lists a directory holding a changed module', () => {
    const stages = p('tests', 'unit', 'ui', 'stages.test.ts');
    const files = {
      ...base,
      [p('src', 'ui', 'scene', 'Kit.ts')]: "export const kit = 'data-tutorial-target';\n",
      [stages]: `const UI_DIR = resolve(import.meta.dirname, '../../../${p('src', 'ui')}');\n`,
    };
    const selection = select(files, [p('src', 'ui', 'scene', 'Kit.ts')]);
    expect(selection.files).toEqual(sorted(LINT, stages));
    expect(selection.reasons.get(stages)).toBe('mention');
  });

  it('runs the full suite for a change to how tests run', () => {
    const selection = select(base, [SRC('Mod.ts'), 'package.json']);
    expect(selection.full).toBe(true);
    expect(selection.files).toEqual([]);
    expect(describeSelection(selection)).toBe('full suite: 10 test files (package.json changes how every test runs)');
  });

  it(`runs the full suite once the focused set reaches ${FULL_SUITE_SHARE * 100}% of it`, () => {
    const files: Record<string, string> = { ...base };
    for (const name of ['A', 'B', 'C', 'D']) {
      const test = p('tests', 'unit', 'other', `${name}.test.ts`);
      files[test] = importing(test, SRC('Mod.ts'));
    }
    const selection = select(files, [SRC('Mod.ts')]);
    expect(selection.full).toBe(true);
    expect(selection.fullReason).toBe('the focused selection reached 80% of test files');
  });
});

describe('changedExports', () => {
  const source = [
    "import { clamp } from './math.js';", // 1
    '', // 2
    '/** How far a truck reaches. */', // 3
    'export const REACH = 4;', // 4
    'export const DOUBLE_REACH = REACH * 2;', // 5
    'const SECRET = 7;', // 6
    'export function reveal(): number {', // 7
    '  return clamp(SECRET);', // 8
    '}', // 9
    'export const UNRELATED = 1;', // 10
    'registerSomething();', // 11
    'const local = 3;', // 12
    'export { local as exportedLocal };', // 13
  ].join('\n');

  it('names the exported declaration a changed line sits in, and every export that uses it', () => {
    expect([...changedExports(source, [4])!].sort()).toEqual(['DOUBLE_REACH', 'REACH']);
    expect([...changedExports(source, [10])!]).toEqual(['UNRELATED']);
  });

  it('attributes a comment line to the declaration after it', () => {
    expect([...changedExports(source, [3])!].sort()).toEqual(['DOUBLE_REACH', 'REACH']);
  });

  it('follows a private helper to the exports that use it, and an alias to its exported name', () => {
    expect([...changedExports(source, [6])!]).toEqual(['reveal']);
    expect([...changedExports(source, [12])!]).toEqual(['exportedLocal']);
  });

  it('cannot tell for an import-only change or a side-effect statement', () => {
    expect(changedExports(source, [1])).toBeUndefined();
    expect(changedExports(source, [11])).toBeUndefined();
  });

  it('names nothing for no changed line', () => {
    expect(changedExports(source, [])).toEqual(new Set());
  });

  it('marks the users of a binding a changed import line re-sources, beside the declaration it changed', () => {
    expect([...changedExports(source, [1, 10])!].sort()).toEqual(['UNRELATED', 'reveal']);
  });

  it('cannot tell once a changed name feeds a statement no name stands for', () => {
    const registered = ['export const REACH = 4;', 'const doubled = REACH * 2;', 'registerSomething(doubled);', 'export const OTHER = 1;'].join('\n');
    expect(changedExports(registered, [1])).toBeUndefined();
    expect([...changedExports(registered, [4])!]).toEqual(['OTHER']);
  });
});

describe('console verbs', () => {
  const registry = [
    "runner.register('ramp', 'Spiral ramp', (args, named) =>",
    '  rampCommand(ctx, args, named));',
    "runner.register('build_ramp', 'Build ramp', (args, named) => buildRampCommand(ctx, args, named));",
    "runner.register(`tick`, 'Advance', (args) => tickCommand(ctx, args));",
  ].join('\n');

  it('reads the verbs whose registered handler calls one of the given exports', () => {
    expect(verbsCalling(registry, new Set(['rampCommand']))).toEqual(['ramp']);
    expect(verbsCalling(registry, new Set(['rampCommand', 'tickCommand']))).toEqual(['ramp', 'tick']);
    expect(verbsCalling(registry, new Set(['helper']))).toEqual([]);
    expect(verbsCalling(registry, new Set())).toEqual([]);
  });

  it('counts a call of the handler, not its name in a description or a key', () => {
    const described = "runner.register('terrain_info', 'Show terrain grid info', () => terrainInfo(ctx));\nrunner.register('stats', 'Stats', () => ({ info: 1 }));";
    expect(verbsCalling(described, new Set(['info']))).toEqual([]);
    expect(verbsCalling(described, new Set(['terrainInfo']))).toEqual(['terrain_info']);
  });

  it('lists the names a module declares as exports', () => {
    const text = ['export function rampCommand() {}', 'export const LIMIT = 3;', 'function privateOne() {}', 'export async function later() {}'].join('\n');
    expect([...declaredExports(text)].sort()).toEqual(['LIMIT', 'later', 'rampCommand']);
  });

  it('finds a verb opening a command string or following a semicolon in one, never inside another verb', () => {
    const pattern = verbPattern(['ramp'])!;
    expect(pattern.test("runner.run('ramp spiral from:1,1')")).toBe(true);
    expect(pattern.test('run(`ramp spiral`)')).toBe(true);
    expect(pattern.test("'new_game seed:1; ramp spiral'")).toBe(true);
    expect(pattern.test("runner.run('build_ramp origin:1,1')")).toBe(false);
    expect(pattern.test('const ramp = 3;')).toBe(false);
    expect(verbPattern([])).toBeUndefined();
  });

  it('runs the tests that issue a verb whose handler the diff changed', () => {
    const command = p('src', 'console', 'commands', 'demo.ts');
    const files: Record<string, string> = {
      [COMMAND_REGISTRY]: `${importing(COMMAND_REGISTRY, command, 'rampCommand, tickCommand')}${registry}`,
      [command]: 'export function rampCommand() {}\nexport function tickCommand() {}\n',
      [UNIT('drivesRamp.test.ts')]: "runner.run('ramp spiral from:1,1');\n",
      [UNIT('drivesTick.test.ts')]: "runner.run('tick 10');\n",
      [UNIT('buildsRamp.test.ts')]: "runner.run('build_ramp origin:1,1');\n",
      // Unrelated tests, so two selected files stay under the full-suite share.
      [UNIT('a.test.ts')]: '\n',
      [UNIT('b.test.ts')]: '\n',
    };
    const narrowed = select(files, [command], { [command]: ['rampCommand'] });
    expect(narrowed.files).toEqual([UNIT('drivesRamp.test.ts')]);
    expect(describeSelection(narrowed)).toContain('1 runs a changed command');
    const unattributed = select(files, [command], { [command]: undefined });
    expect(unattributed.files).toEqual(sorted(UNIT('drivesRamp.test.ts'), UNIT('drivesTick.test.ts')));
  });

  it('runs the tests that issue the verb through a helper they import', () => {
    const command = p('src', 'console', 'commands', 'demo.ts');
    const helper = p('tests', 'helpers', 'rampFixture.ts');
    const files: Record<string, string> = {
      [COMMAND_REGISTRY]: `${importing(COMMAND_REGISTRY, command, 'rampCommand')}${registry}`,
      [command]: 'export function rampCommand() {}\n',
      [helper]: "export function digRamp(run) { run('ramp spiral from:1,1'); }\n",
      [UNIT('viaHelper.test.ts')]: importing(UNIT('viaHelper.test.ts'), helper, 'digRamp'),
      [UNIT('a.test.ts')]: '\n',
      [UNIT('b.test.ts')]: '\n',
      [UNIT('c.test.ts')]: '\n',
    };
    expect(select(files, [command], { [command]: ['rampCommand'] }).files).toEqual([UNIT('viaHelper.test.ts')]);
  });
});

describe('package.json', () => {
  const pkg = (scripts: Record<string, string>, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ name: 'x', type: 'module', scripts, devDependencies: { vitest: '^1.6.1' }, ...extra }, null, 2);

  it('is inert when only scripts other than `test` changed', () => {
    expect(packageJsonChangeIsInert(pkg({ test: 'vitest run', lint: 'a' }), pkg({ test: 'vitest run', lint: 'b', added: 'c' }))).toBe(true);
  });

  it('is a real change when `test`, a dependency or any other key changed, or a side does not parse', () => {
    expect(packageJsonChangeIsInert(pkg({ test: 'vitest run' }), pkg({ test: 'vitest run --pool=forks' }))).toBe(false);
    expect(packageJsonChangeIsInert(pkg({}), pkg({}, { devDependencies: { vitest: '^2.0.0' } }))).toBe(false);
    expect(packageJsonChangeIsInert(pkg({}), pkg({}, { type: 'commonjs' }))).toBe(false);
    expect(packageJsonChangeIsInert(pkg({}), '{ not json')).toBe(false);
  });

  it('selects an inert package.json like a data file instead of running the full suite', () => {
    const files = {
      [UNIT('scripts.test.ts')]: "readFileSync('package.json');\n",
      [UNIT('other.test.ts')]: '\n',
    };
    const selection = selectTests({
      ...world(files),
      changed: ['package.json'],
      changedIdentifiers: () => undefined,
      inertTriggers: ['package.json'],
    });
    expect(selection.full).toBe(false);
    expect(selection.files).toEqual([UNIT('scripts.test.ts')]);
  });
});

describe('diffLineNumbers', () => {
  it('reads added and removed line numbers off -U0 hunk headers', () => {
    const diff = ['diff --git a/x b/x', '@@ -3 +3 @@', '-old', '+new', '@@ -10,2 +9,0 @@', '-a', '-b', '@@ -20,0 +18,2 @@', '+c', '+d'].join('\n');
    expect(diffLineNumbers(diff)).toEqual({ added: [3, 18, 19], removed: [3, 10, 11] });
  });
});

describe('planLogic on a real repository', () => {
  const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  let repo: string;
  const sh = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim();
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'test-selection-'));
    sh('init', '-q', '-b', 'main');
    write(SRC('Hub.ts'), 'export const A = 1;\nexport const B = 2;\n');
    for (let i = 0; i <= HUB_IMPORTERS; i++) write(UNIT(`Hub${i}.test.ts`), importing(UNIT(`Hub${i}.test.ts`), SRC('Hub.ts'), i < 2 ? 'A' : 'B'));
    write(LINT, '');
    write(UNIT('Reader.test.ts'), "const dir = 'linked-dir';\n");
    sh('add', '-A');
    sh('commit', '-q', '-m', 'base');
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("narrows a hub by the identifier the working tree's diff changed, and takes no directory for a changed file", () => {
    const fork = sh('rev-parse', 'HEAD');
    write(SRC('Hub.ts'), 'export const A = 10;\nexport const B = 2;\n');
    // What a worktree's node_modules symlink looks like to `git status`: a path that is a directory.
    mkdirSync(join(repo, 'linked-dir'));
    const selection = planLogic(repo, fork, [SRC('Hub.ts'), 'linked-dir']);
    expect(selection.files).toEqual(sorted(LINT, UNIT('Hub0.test.ts'), UNIT('Hub1.test.ts')));
    expect(selection.notes).toEqual([expect.stringContaining('narrowed to 2 by the changed identifiers A')]);
  });

  it('still runs a test that imports a module by the path a rename left behind', () => {
    write(SRC('Old.ts'), 'export const x = 1;\n');
    write(UNIT('UsesOld.test.ts'), importing(UNIT('UsesOld.test.ts'), SRC('Old.ts')));
    sh('add', '-A');
    sh('commit', '-q', '-m', 'old module');
    const fork = sh('rev-parse', 'HEAD');
    sh('mv', SRC('Old.ts'), SRC('Renamed.ts'));
    sh('commit', '-q', '-m', 'rename');
    const changed = branchChanges(repo, fork);
    expect(changed).toEqual(sorted(SRC('Old.ts'), SRC('Renamed.ts')));
    expect(planLogic(repo, fork, changed).files).toContain(UNIT('UsesOld.test.ts'));
  });

  it('selects a scripts-only package.json edit as data, and runs the full suite for a dependency change', () => {
    write('package.json', JSON.stringify({ name: 'x', scripts: { test: 'vitest run', lint: 'a' }, devDependencies: { vitest: '1' } }));
    write(UNIT('Scripts.test.ts'), "readFileSync('package.json');\n");
    sh('add', '-A');
    sh('commit', '-q', '-m', 'package');
    const fork = sh('rev-parse', 'HEAD');
    write('package.json', JSON.stringify({ name: 'x', scripts: { test: 'vitest run', lint: 'b' }, devDependencies: { vitest: '1' } }));
    const scriptsOnly = planLogic(repo, fork, ['package.json']);
    expect(scriptsOnly.full).toBe(false);
    expect(scriptsOnly.files).toContain(UNIT('Scripts.test.ts'));
    write('package.json', JSON.stringify({ name: 'x', scripts: { test: 'vitest run', lint: 'b' }, devDependencies: { vitest: '2' } }));
    expect(planLogic(repo, fork, ['package.json']).full).toBe(true);
  });
});
