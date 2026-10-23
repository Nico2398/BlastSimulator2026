/**
 * BlastSimulator2026 — Git plumbing for the pipeline CLI
 *
 * Every pipeline step that used to be a model turn (`[branch-sanity]`,
 * `[verify-commit]`, `[cherry-pick]`, `[git-verify]`) is a call into here. A
 * failing command throws `GitError` with git's own stderr, so the CLI reports
 * what git said rather than a paraphrase of it.
 *
 * @module pipeline/git
 */

import { execFileSync } from 'child_process';
import { dirname, resolve } from 'path';

export class GitError extends Error {}

/** Run `git <args>` in `cwd` and return trimmed stdout. Throws `GitError` on non-zero exit. */
export function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    throw new GitError(`git ${args.join(' ')} failed${stderr ? `:\n${stderr}` : ''}`);
  }
}

/** True when `git <args>` exits 0. */
export function gitSucceeds(cwd: string, ...args: string[]): boolean {
  try {
    git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
}

/** The main working tree's root, whichever worktree `cwd` sits in. */
export function mainRoot(cwd: string): string {
  const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  return dirname(resolve(common));
}

/** The shared `.git` directory every worktree of this repository uses. */
export function commonDir(cwd: string): string {
  return resolve(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
}

export function currentBranch(cwd: string): string {
  return git(cwd, 'branch', '--show-current');
}

export function headSha(cwd: string): string {
  return git(cwd, 'rev-parse', 'HEAD');
}

export function branchExists(cwd: string, branch: string): boolean {
  return gitSucceeds(cwd, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
}

/** Tracked and untracked changes, ignored files excluded. Empty means clean. */
export function dirtyPaths(cwd: string): string[] {
  const out = git(cwd, 'status', '--porcelain', '--untracked-files=all');
  return out === '' ? [] : out.split('\n').map((line) => line.slice(3));
}

/**
 * The tree the working directory holds, when that is exactly a committed tree.
 * A dirty working directory has no stable identity, so it returns `undefined`
 * and callers must not cache anything against it.
 */
export function cleanTreeHash(cwd: string): string | undefined {
  return dirtyPaths(cwd).length === 0 ? git(cwd, 'rev-parse', 'HEAD^{tree}') : undefined;
}

/** Paths changed between `from` and `to` (a commit, or the working tree when omitted). */
export function changedPaths(cwd: string, from: string, to?: string): string[] {
  const args = ['diff', '--name-only', from];
  if (to !== undefined) args.push(to);
  const out = git(cwd, ...args);
  return out === '' ? [] : out.split('\n');
}

/** Untracked files that are not ignored. */
export function untrackedPaths(cwd: string): string[] {
  const out = git(cwd, 'ls-files', '--others', '--exclude-standard');
  return out === '' ? [] : out.split('\n');
}

/** Files this branch changed relative to where it left `base`, committed or not. */
export function branchChanges(cwd: string, base: string): string[] {
  const forkPoint = git(cwd, 'merge-base', base, 'HEAD');
  return [...new Set([...changedPaths(cwd, forkPoint), ...untrackedPaths(cwd)])].sort();
}

/** True while a cherry-pick stopped on a conflict is waiting to be continued. */
export function cherryPickInProgress(cwd: string): boolean {
  return gitSucceeds(cwd, 'rev-parse', '--verify', '--quiet', 'CHERRY_PICK_HEAD');
}

/** Files git currently reports as unmerged. */
export function conflictedPaths(cwd: string): string[] {
  const out = git(cwd, 'diff', '--name-only', '--diff-filter=U');
  return out === '' ? [] : out.split('\n');
}
