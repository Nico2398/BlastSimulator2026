/**
 * BlastSimulator2026 — Dead code detector
 *
 * `tsc` already refuses unused locals, parameters and imports
 * (`noUnusedLocals`/`noUnusedParameters` in tsconfig.json), so dead code
 * *inside* a file cannot survive a typecheck. What nothing checked is the
 * module graph above it: a file nobody imports, or an export nobody imports,
 * both typecheck perfectly and both are dead. A 46-line table of typed i18n
 * key constants under core/i18n survived that way — no file in the project
 * imported it — until this script went looking. It is deleted now.
 *
 * The analysis parses every file with the TypeScript compiler API rather than
 * grepping, and errs toward silence: a module that is namespace-imported
 * (`import * as x`) or star-re-exported (`export * from`) has all of its
 * exports counted as used, because tracking which members a namespace object
 * touches at runtime is beyond what this can honestly claim.
 *
 * Usage:
 *   npx tsx scripts/dead-code.ts            # findings, judged against the baseline
 *   npx tsx scripts/dead-code.ts --strict   # ignore the baseline, fail on any finding
 *   npx tsx scripts/dead-code.ts --json
 *
 * Exit code: 0 when no unused file exists and every unused export is already
 * in tests/unit/lint/dead-code-baseline.json, 1 otherwise. `--strict` drops
 * the baseline, which is what working the backlog down looks like.
 *
 * @module dead-code
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '..');

/** Trees searched for dead code, and for the imports that keep code alive. */
const SOURCE_ROOTS = ['src', 'scripts'];

/** Searched for imports only — a test importing a symbol keeps it alive. */
const IMPORTER_ONLY_ROOTS = ['tests'];

/**
 * Reachable by something other than an import, so never dead however few
 * files import them. Entry points found in package.json scripts, the
 * workflows and index.html are added to this set automatically; these are the
 * ones no file names literally.
 */
const ALWAYS_LIVE = new Set<string>([
  'src/main.ts',    // index.html's module script
  'src/console.ts', // npm run console
]);

/**
 * Exports that exist for a consumer this analysis cannot see. Keep this list
 * short and give every entry a reason — an entry here is a claim that the
 * symbol is used somewhere the module graph does not reach, not a way to
 * silence a finding.
 */
const LIVE_EXPORTS = new Set<string>([
  // Read off `window` by the scenario harness, never imported.
  'src/ui/uiActionProbe.ts:probeUiAction',
  'src/ui/tutorialStateProbe.ts:probeTutorialState',
]);

export interface DeadCodeReport {
  /** Files under the source roots that nothing imports. */
  unusedFiles: string[];
  /** `file:exportName` for each export nothing imports. */
  unusedExports: string[];
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const rel = (abs: string): string => relative(ROOT, abs).split('\\').join('/');

/**
 * Resolves an import specifier to a file in the project, or null when it
 * points at a package. Source uses `.js` specifiers for `.ts` files (NodeNext
 * style), so `./dom.js` has to be read as `./dom.ts`.
 */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '/index.ts'),
    `${base}.ts`,
    join(base, 'index.ts'),
  ];
  return candidates.find(c => existsSync(c) && statSync(c).isFile()) ?? null;
}

interface FileFacts {
  /** Names this file exports. */
  exports: Set<string>;
  /** Per resolved target: the names imported from it. */
  imports: Map<string, Set<string>>;
  /** Targets pulled in whole — `import * as x` or `export * from`. */
  opaque: Set<string>;
  /** Every target referenced at all, including side-effect and dynamic imports. */
  referenced: Set<string>;
}

/** Reads one file's exports and the imports it makes, via the TS parser. */
export function readFileFacts(file: string, text: string): FileFacts {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const facts: FileFacts = {
    exports: new Set(), imports: new Map(), opaque: new Set(), referenced: new Set(),
  };

  const note = (spec: string, names: string[], opaqueImport: boolean): void => {
    const target = resolveSpecifier(file, spec);
    if (!target) return;
    facts.referenced.add(target);
    if (opaqueImport) facts.opaque.add(target);
    if (names.length === 0) return;
    const bucket = facts.imports.get(target) ?? new Set<string>();
    for (const n of names) bucket.add(n);
    facts.imports.set(target, bucket);
  };

  const isExported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);

  const visit = (node: ts.Node): void => {
    // import ... from '...'
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (!clause) {
        note(spec, [], false); // side-effect import
      } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        note(spec, [], true);
      } else {
        const names: string[] = [];
        if (clause.name) names.push('default');
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            names.push((el.propertyName ?? el.name).text);
          }
        }
        note(spec, names, false);
      }
    }

    // export ... from '...' / export * from '...'
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        const names = node.exportClause.elements.map(el => (el.propertyName ?? el.name).text);
        note(spec, names, false);
        // The re-exported names are also this file's own exports.
        for (const el of node.exportClause.elements) facts.exports.add(el.name.text);
      } else {
        // `export *` — everything the target exports flows through here.
        note(spec, [], true);
      }
    }

    // export { a, b } — no module specifier, so these are this file's exports.
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier
        && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) facts.exports.add(el.name.text);
    }

    // import('...')
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) note(arg.text, [], true);
    }

    if (isExported(node)) {
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
        if (node.name) facts.exports.add(node.name.text);
      } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
                 || ts.isEnumDeclaration(node)) {
        facts.exports.add(node.name.text);
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) facts.exports.add(decl.name.text);
        }
      }
    }
    if (ts.isExportAssignment(node)) facts.exports.add('default');

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return facts;
}

/** Entry points named by package.json scripts, the workflows and index.html. */
function discoverEntryPoints(): Set<string> {
  const found = new Set<string>(ALWAYS_LIVE);
  const texts: string[] = [];

  texts.push(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const indexHtml = join(ROOT, 'index.html');
  if (existsSync(indexHtml)) texts.push(readFileSync(indexHtml, 'utf8'));
  const workflows = join(ROOT, '.github', 'workflows');
  if (existsSync(workflows)) {
    for (const f of readdirSync(workflows)) {
      if (f.endsWith('.yml') || f.endsWith('.yaml')) texts.push(readFileSync(join(workflows, f), 'utf8'));
    }
  }

  const re = /(?:src|scripts)\/[A-Za-z0-9_\-./]+\.ts/g;
  for (const text of texts) {
    for (const m of text.match(re) ?? []) found.add(m);
  }
  return found;
}

export function findDeadCode(): DeadCodeReport {
  const sourceFiles = SOURCE_ROOTS.flatMap(r => listTsFiles(join(ROOT, r)));
  const importerFiles = [
    ...sourceFiles,
    ...IMPORTER_ONLY_ROOTS.flatMap(r => listTsFiles(join(ROOT, r))),
  ];

  const factsByFile = new Map<string, FileFacts>();
  for (const file of importerFiles) {
    factsByFile.set(file, readFileFacts(file, readFileSync(file, 'utf8')));
  }

  const importedNames = new Map<string, Set<string>>();
  const opaque = new Set<string>();
  const referenced = new Set<string>();

  for (const [file, facts] of factsByFile) {
    for (const target of facts.referenced) {
      // A file importing itself proves nothing about whether anyone needs it.
      if (target !== file) referenced.add(target);
    }
    for (const target of facts.opaque) if (target !== file) opaque.add(target);
    for (const [target, names] of facts.imports) {
      if (target === file) continue;
      const bucket = importedNames.get(target) ?? new Set<string>();
      for (const n of names) bucket.add(n);
      importedNames.set(target, bucket);
    }
  }

  const entryPoints = discoverEntryPoints();
  const unusedFiles: string[] = [];
  const unusedExports: string[] = [];

  for (const file of sourceFiles) {
    const path = rel(file);
    if (entryPoints.has(path)) continue;
    // scripts/*.ts at the top level are CLI tools, run by hand or by an npm
    // script. Nothing imports a CLI. Their libraries live a directory down
    // (scripts/shared/, scripts/lib/) and are checked like any other module.
    if (/^scripts\/[^/]+\.ts$/.test(path)) continue;

    if (!referenced.has(file)) {
      unusedFiles.push(path);
      continue; // Its exports are dead by consequence; one finding, not twenty.
    }

    // Namespace-imported or star-re-exported: cannot tell which members are
    // touched, so claim nothing about them.
    if (opaque.has(file)) continue;

    const used = importedNames.get(file) ?? new Set<string>();
    const facts = factsByFile.get(file)!;
    for (const name of facts.exports) {
      if (used.has(name)) continue;
      if (LIVE_EXPORTS.has(`${path}:${name}`)) continue;
      unusedExports.push(`${path}:${name}`);
    }
  }

  unusedFiles.sort();
  unusedExports.sort();
  return { unusedFiles, unusedExports };
}

function main(): void {
  const report = findDeadCode();
  const strict = process.argv.includes('--strict');

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.unusedFiles.length + report.unusedExports.length === 0 ? 0 : 1);
  }

  // The lint test judges unused exports against this same list, so the command
  // and the gate cannot disagree about what is currently acceptable.
  const baselinePath = join(ROOT, 'tests', 'unit', 'lint', 'dead-code-baseline.json');
  const baseline: string[] = strict || !existsSync(baselinePath)
    ? []
    : (JSON.parse(readFileSync(baselinePath, 'utf8')) as { unusedExports: string[] }).unusedExports;
  const known = new Set(baseline);
  const newExports = report.unusedExports.filter(e => !known.has(e));

  if (report.unusedFiles.length > 0) {
    console.log(`\n${report.unusedFiles.length} file(s) nothing imports:`);
    for (const f of report.unusedFiles) console.log(`  ${f}`);
  }
  if (newExports.length > 0) {
    console.log(`\n${newExports.length} export(s) nothing imports${strict ? '' : ', not in the baseline'}:`);
    for (const e of newExports) console.log(`  ${e}`);
  }

  const carried = report.unusedExports.length - newExports.length;
  if (carried > 0) {
    console.log(`\n${carried} known unused export(s) carried in the baseline`
      + ' (tests/unit/lint/dead-code-baseline.json). Run with --strict to list them.');
  }

  const failed = report.unusedFiles.length > 0 || newExports.length > 0;
  console.log(failed
    ? '\nFAILED — delete it, drop the `export` keyword, or (for something reached outside the'
      + ' module graph) add it to ALWAYS_LIVE / LIVE_EXPORTS in scripts/dead-code.ts with the reason.'
    : '\nOK — no unimported file, and no unused export outside the baseline.');
  process.exit(failed ? 1 : 0);
}

// Run only when invoked as a CLI; imported by its lint test, the module stays
// side-effect free — main() ends in process.exit().
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) main();
