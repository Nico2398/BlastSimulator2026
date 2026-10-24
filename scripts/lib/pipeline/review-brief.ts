/**
 * BlastSimulator2026 — The reviewer's starting page
 *
 * One reviewer replaced five. What keeps that from costing recall is that it
 * starts from the facts a script can establish — which areas changed, which
 * checklist sections that obliges, which RED tests were edited after the
 * implementation could see them, what the channels already said — and spends
 * its reading on the judgment calls only it can make.
 *
 * @module pipeline/review-brief
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { branchChanges, git, gitSucceeds } from './git.js';
import { reviewSectionsFor } from './paths.js';
import { readState } from './tdd-state.js';

interface BriefOptions {
  base?: string | undefined;
  /** The TDD label, for the tamper audit. Several, for a multi run's sections. */
  labels?: string[] | undefined;
}

function area(path: string): string {
  const parts = path.split('/');
  if (parts[0] === 'src' && parts.length > 2) return `src/${parts[1]}/`;
  if (parts[0] === 'scripts' && parts[1] === 'scenario-defs') return 'scripts/scenario-defs/';
  if (parts[0] === '.github' && parts.length > 2) return `.github/${parts[1]}/`;
  return parts.length > 1 ? `${parts[0]}/` : '(root)';
}

/** Changed files grouped by top-level area, one line per area. */
export function groupByArea(paths: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const path of paths) groups.set(area(path), [...(groups.get(area(path)) ?? []), path]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, files]) => `${name} (${files.length}): ${files.join(', ')}`);
}

export function reviewBrief(root: string, options: BriefOptions = {}): string[] {
  const base = options.base ?? (gitSucceeds(root, 'rev-parse', '--verify', '--quiet', 'origin/main') ? 'origin/main' : 'main');
  const changed = branchChanges(root, base);
  const forkPoint = git(root, 'merge-base', base, 'HEAD');
  const lines = [
    `# Review brief — HEAD ${git(root, 'rev-parse', '--short', 'HEAD')} vs ${base}`,
    '',
    `## Changed (${changed.length} files)`,
    ...groupByArea(changed).map((line) => `- ${line}`),
    '',
    `Diff size: ${git(root, 'diff', '--shortstat', forkPoint) || 'none'}`,
    `Read it with: git diff ${forkPoint.slice(0, 12)}`,
    '',
    `## Sections owed: ${reviewSectionsFor(changed).join(', ')}`,
  ];

  for (const label of options.labels ?? []) {
    const state = readState(root, label);
    if (!state?.red || !state.redFiles?.length) continue;
    const edited = git(root, 'diff', '--stat=120', state.red, 'HEAD', '--', ...state.redFiles);
    lines.push('', `## Tamper audit — RED tests of ${label} edited after RED (${state.red.slice(0, 9)})`);
    lines.push(edited === '' ? 'None: every RED test reached GREEN unchanged.' : edited);
    if (edited !== '') lines.push(`Judge each edit against the plan's Contract: git diff ${state.red.slice(0, 12)} HEAD -- <file>`);
  }

  const last = join(root, '.agentic', 'verify', 'last.txt');
  if (existsSync(last)) lines.push('', '## Last `verify`', readFileSync(last, 'utf8').trimEnd());
  return lines;
}
