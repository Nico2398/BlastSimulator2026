/**
 * BlastSimulator2026 — The TDD cycle's git choreography
 *
 *   start  → pipeline/impl-<label> from the base; the lead writes the skeleton there
 *   split  → pipeline/tests-<label> at the skeleton, in its own worktree; blind phase opens
 *   red    → (test-writer) prove the new tests fail on the stubs, then commit them
 *   join   → pipeline/feature-<label> = base + skeleton + tests + implementation;
 *            blind phase closes
 *
 * The blind phase is the separation the old five-agent cycle bought with
 * branches alone: the session implementing never sees the tests until its
 * implementation is committed. Here the branches are the same, and the
 * `blind-to-tests.mjs` hook refuses the implementing session the tests
 * worktree and branch while `blind.json` exists — the mechanical version of
 * what used to be a sentence in a prompt.
 *
 * @module pipeline/tdd
 */

import { spawnSync } from 'child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';
import {
  branchExists,
  changedPaths,
  cherryPickInProgress,
  commonDir,
  conflictedPaths,
  currentBranch,
  dirtyPaths,
  git,
  gitSucceeds,
  headSha,
  mainRoot,
  untrackedPaths,
} from './git.js';
import { isTestPath, isValidLabel, isVitestFile, issueFromLabel } from './paths.js';
import { judgeRed, summarizeVitest, typeErrorsIn, type RedVerdict, type VitestJsonReport } from './red.js';
import { closeBlindPhase, openBlindPhase, readState, writeState, type TddState } from './tdd-state.js';

export class PipelineError extends Error {}

function requireState(root: string, label: string): TddState {
  const state = readState(root, label);
  if (!state) throw new PipelineError(`No TDD cycle for label ${label}. Start one: npm run pipeline -- tdd start --label ${label}`);
  return state;
}

function requireClean(cwd: string, what: string): void {
  const dirty = dirtyPaths(cwd);
  if (dirty.length > 0) {
    throw new PipelineError(`${what} has uncommitted changes — commit them first:\n  ${dirty.slice(0, 20).join('\n  ')}`);
  }
}

function requireOn(cwd: string, branch: string): void {
  const actual = currentBranch(cwd);
  if (actual !== branch) throw new PipelineError(`On ${actual || '(detached HEAD)'}, expected ${branch}.`);
}

interface StartOptions {
  label: string;
  base?: string | undefined;
  /** The deliverable branch; a later multi section passes the run's shared one. */
  feature?: string | undefined;
}

/** Create the implementation branch from the base and record the cycle. */
export function start(cwd: string, options: StartOptions): string[] {
  const { label } = options;
  if (!isValidLabel(label)) throw new PipelineError(`Invalid label ${label}: use <issue>-<runId>[-s<K>].`);
  const root = mainRoot(cwd);
  if (readState(root, label)) throw new PipelineError(`A TDD cycle for ${label} already exists. Never reuse a label.`);
  const base = options.base ?? 'main';
  const implBranch = `pipeline/impl-${label}`;
  const testsBranch = `pipeline/tests-${label}`;
  for (const branch of [implBranch, testsBranch]) {
    if (branchExists(root, branch)) throw new PipelineError(`${branch} already exists. Never reuse a branch from an earlier run.`);
  }
  requireClean(root, 'The working tree');
  const baseSha = git(root, 'rev-parse', '--verify', `${base}^{commit}`);
  git(root, 'checkout', '-b', implBranch, baseSha);
  writeState(root, {
    label,
    issue: issueFromLabel(label),
    base,
    baseSha,
    implBranch,
    testsBranch,
    featureBranch: options.feature ?? `pipeline/feature-${label}`,
    phase: 'skeleton',
  });
  return [
    `TDD ${label}: on ${implBranch} (from ${base} ${baseSha.slice(0, 9)}).`,
    'Next: write the skeleton (public API, stubs, no logic, no tests), commit it, then',
    `  npm run pipeline -- tdd split --label ${label}`,
  ];
}

/** Sibling directory of the main working tree, so nothing inside the repository sees it. */
export function worktreePath(root: string, label: string): string {
  return join(dirname(root), `${basename(root)}-tests-${label}`);
}

function excludeNodeModules(root: string): void {
  const exclude = join(commonDir(root), 'info', 'exclude');
  const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (!current.split('\n').includes('node_modules')) appendFileSync(exclude, `${current.endsWith('\n') || current === '' ? '' : '\n'}node_modules\n`);
}

/** Cut the tests branch at the skeleton in its own worktree and open the blind phase. */
export function split(cwd: string, label: string): string[] {
  const root = mainRoot(cwd);
  const state = requireState(root, label);
  if (state.phase !== 'skeleton') throw new PipelineError(`${label} is past the skeleton (phase ${state.phase}).`);
  requireOn(root, state.implBranch);
  requireClean(root, 'The working tree');
  const skeleton = headSha(root);
  if (skeleton === state.baseSha) throw new PipelineError('No skeleton commit yet: commit the stubs on the impl branch first.');
  const touched = changedPaths(root, state.baseSha, skeleton).filter(isTestPath);
  if (touched.length > 0) {
    throw new PipelineError(`The skeleton touches test paths, which belong to the test-writer:\n  ${touched.join('\n  ')}`);
  }
  const worktree = worktreePath(root, label);
  if (existsSync(worktree)) throw new PipelineError(`${worktree} already exists — remove it, it belongs to no live cycle.`);
  git(root, 'worktree', 'add', '-b', state.testsBranch, worktree, skeleton);
  if (existsSync(join(root, 'node_modules'))) {
    excludeNodeModules(root);
    symlinkSync(join(root, 'node_modules'), join(worktree, 'node_modules'), 'junction');
  }
  writeState(root, { ...state, phase: 'tests', skeleton, worktree });
  openBlindPhase(root, { label, testsBranch: state.testsBranch, worktree });
  return [
    `TDD ${label}: skeleton ${skeleton.slice(0, 9)}; tests worktree ${worktree} on ${state.testsBranch}.`,
    'Blind phase open: this session is refused that worktree and branch until `tdd join`.',
    'Next: delegate the test-writer with the plan\'s Contract section and that worktree path.',
  ];
}

interface RedOptions {
  label: string;
  commit: boolean;
  /** Quote load errors and type errors in full — the test-writer's view; the lead's view names files and codes only. */
  detail?: boolean;
}

/** What the tests worktree changed that a test-writer may not: production paths, and tests the skeleton already had. */
function outOfScope(worktree: string, skeleton: string): string[] {
  const out = git(worktree, 'diff', '--name-status', '--no-renames', skeleton);
  const problems: string[] = [];
  for (const line of out === '' ? [] : out.split('\n')) {
    const [status, path] = line.split('\t');
    if (!path) continue;
    if (!isTestPath(path)) problems.push(`${path}: not a test path — the test-writer changes tests/ and scripts/scenario-defs/ only`);
    else if (status === 'D') problems.push(`${path}: deleted — a test the skeleton already had stays`);
  }
  for (const path of untrackedPaths(worktree)) {
    if (!isTestPath(path)) problems.push(`${path}: not a test path — the test-writer changes tests/ and scripts/scenario-defs/ only`);
  }
  return problems;
}

/** A RED problem with every quote of test code cut: the file, the line, the error code. */
function redacted(problem: string): string {
  return problem
    .replace(/^(type error: \S+?\(\d+,\d+\): error TS\d+).*$/, '$1')
    .replace(/^(\S+: did not load) — .*$/, '$1')
    .replace(/^(\S+: must pass and does not) \(.*\)$/, '$1');
}

function runCapture(command: string, args: string[], cwd: string): { status: number; output: string } {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Run the new tests against the stubs, judge RED, and commit them when proven. */
export function red(cwd: string, options: RedOptions): { verdict: RedVerdict; lines: string[] } {
  const root = mainRoot(cwd);
  const state = requireState(root, options.label);
  if (state.phase !== 'tests' && state.phase !== 'red') throw new PipelineError(`${options.label} is not in its test phase (phase ${state.phase}).`);
  const worktree = state.worktree!;
  const changed = [...new Set([...changedPaths(worktree, state.skeleton!), ...untrackedPaths(worktree)])]
    .filter((path) => isTestPath(path) && existsSync(join(worktree, path)))
    .sort();
  const vitestFiles = changed.filter(isVitestFile);
  const guards = changed.some((path) => path.startsWith('scripts/scenario-defs/')) ? ['tests/unit/scenario-defs-validation'] : [];

  const reportDir = mkdtempSync(join(tmpdir(), 'pipeline-red-'));
  const reportFile = join(reportDir, 'report.json');
  let report: VitestJsonReport = {};
  try {
    if (vitestFiles.length + guards.length > 0) {
      runCapture('npx', ['vitest', 'run', ...vitestFiles, ...guards, '--reporter=json', `--outputFile=${reportFile}`], worktree);
      if (existsSync(reportFile)) report = JSON.parse(readFileSync(reportFile, 'utf8')) as VitestJsonReport;
    }
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
  const files = summarizeVitest(report, worktree, vitestFiles);
  const guardFiles = (report.testResults ?? [])
    .map((result) => result.name ?? '')
    .filter((name) => name.includes('scenario-defs-validation'))
    .map((name) => name.slice(worktree.length + 1).split('\\').join('/'));
  const guardSummaries = summarizeVitest(report, worktree, guardFiles);
  if (guards.length > 0 && guardFiles.length === 0) guardSummaries.push({ file: guards[0]!, total: 0, failed: 0, loadError: 'did not run' });
  const tsc = vitestFiles.length > 0 ? runCapture('npx', ['tsc', '--noEmit', '--project', 'tests/tsconfig.json'], worktree).output : '';
  const judged = judgeRed(files, typeErrorsIn(tsc, changed), guardSummaries);
  const scope = outOfScope(worktree, state.skeleton!);
  const verdict = scope.length === 0 ? judged : { ...judged, red: false, problems: [...scope, ...judged.problems] };
  const show = options.detail ? (problem: string) => problem : redacted;

  const lines = files.map(
    (f) => `  ${f.file}: ${f.loadError ? (options.detail ? `LOAD ERROR (${f.loadError})` : 'LOAD ERROR') : `${f.failed}/${f.total} failing`}`,
  );
  if (verdict.passingOnStubs.length > 0) lines.push(`Passing on the stubs (check they test new behaviour): ${verdict.passingOnStubs.join(', ')}`);
  if (!verdict.red) {
    lines.unshift(`RED NOT PROVEN for ${options.label}:`);
    lines.push(...verdict.problems.map((problem) => `  ✗ ${show(problem)}`));
    if (!options.detail) lines.push('  (file names and error codes only: the test-writer runs `tdd red --detail` for the full text.)');
    return { verdict, lines };
  }
  lines.unshift(`RED PROVEN for ${options.label} (${files.reduce((sum, f) => sum + f.failed, 0)} failing tests in ${files.length} files):`);
  if (options.commit) {
    git(worktree, 'add', '-A');
    if (dirtyPaths(worktree).length > 0) git(worktree, 'commit', '-q', '-m', `test-writer: failing tests (#${state.issue})`);
    const sha = headSha(worktree);
    writeState(root, { ...state, phase: 'red', red: sha, redFiles: changed });
    lines.push(`Committed ${sha.slice(0, 9)} on ${state.testsBranch}.`);
  }
  return { verdict, lines };
}

function pick(cwd: string, range: string): string[] | undefined {
  if (git(cwd, 'rev-list', range) === '') return undefined;
  if (gitSucceeds(cwd, 'cherry-pick', '--allow-empty', range)) return undefined;
  return conflictedPaths(cwd);
}

/**
 * Build the feature branch from the tests and the implementation, close the
 * blind phase, and remove the tests worktree. Re-run after resolving a
 * conflict and `git cherry-pick --continue`: it resumes where it stopped.
 */
export function joinCycle(cwd: string, label: string): string[] {
  const root = mainRoot(cwd);
  let state = requireState(root, label);
  if (cherryPickInProgress(root)) {
    throw new PipelineError('A cherry-pick is waiting: resolve the conflicts, `git cherry-pick --continue`, then re-run `tdd join`.');
  }
  if (state.phase === 'tests') throw new PipelineError('RED is not proven yet: the test-writer runs `tdd red` before the join.');

  if (state.phase === 'red') {
    requireOn(root, state.implBranch);
    requireClean(root, 'The working tree');
    requireClean(state.worktree!, 'The tests worktree');
    if (headSha(root) === state.skeleton) throw new PipelineError('No implementation commit on the impl branch yet.');
    closeBlindPhase(root);
    if (branchExists(root, state.featureBranch)) {
      git(root, 'checkout', state.featureBranch);
    } else {
      git(root, 'checkout', '-b', state.featureBranch, state.baseSha);
    }
    const commits = (range: string) => Number(git(root, 'rev-list', '--count', range));
    state = {
      ...state,
      phase: 'joining-tests',
      joinFrom: headSha(root),
      joinCommits: commits(`${state.baseSha}..${state.testsBranch}`) + commits(`${state.skeleton}..${state.implBranch}`),
    };
    writeState(root, state);
    const conflicts = pick(root, `${state.baseSha}..${state.testsBranch}`);
    if (conflicts) return conflictLines(label, 'tests', conflicts);
  }

  if (state.phase === 'joining-tests') {
    state = { ...state, phase: 'joining-impl' };
    writeState(root, state);
    const conflicts = pick(root, `${state.skeleton}..${state.implBranch}`);
    if (conflicts) return conflictLines(label, 'implementation', conflicts);
  }

  if (state.phase === 'joining-impl') {
    requireClean(root, 'The feature branch');
    if (state.joinFrom && state.joinCommits !== undefined) {
      const landed = Number(git(root, 'rev-list', '--count', `${state.joinFrom}..HEAD`));
      if (landed < state.joinCommits) {
        throw new PipelineError(
          `${state.featureBranch} holds ${landed} of the ${state.joinCommits} commits the join picks — a cherry-pick was aborted or skipped. ` +
            `Pick what is missing from ${state.baseSha.slice(0, 9)}..${state.testsBranch} and ${state.skeleton!.slice(0, 9)}..${state.implBranch} ` +
            '(`git cherry-pick --allow-empty <sha>`), then re-run `tdd join`.',
        );
      }
    }
    if (state.worktree && existsSync(state.worktree)) git(root, 'worktree', 'remove', '--force', state.worktree);
    state = { ...state, phase: 'joined', worktree: undefined };
    writeState(root, state);
  }

  return [
    `TDD ${label}: joined onto ${state.featureBranch} at ${headSha(root).slice(0, 9)}. Blind phase closed.`,
    `RED commit for the tamper audit: ${state.red?.slice(0, 9) ?? '(none)'}.`,
    'Next: npm run long -- start verify -- npm run pipeline -- verify',
  ];
}

function conflictLines(label: string, side: string, conflicts: string[]): string[] {
  return [
    `TDD ${label}: cherry-picking the ${side} stopped on a conflict in:`,
    ...conflicts.map((file) => `  ${file}`),
    'Resolve so both sides survive, `git add` them, `git cherry-pick --continue`, then re-run `tdd join`.',
  ];
}

export function status(cwd: string, label: string): string[] {
  const state = requireState(mainRoot(cwd), label);
  return [JSON.stringify(state, null, 2)];
}
