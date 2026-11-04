/**
 * BlastSimulator2026 — `npm run pipeline -- open-pr`: a run's PR and its plan comment, in one step
 *
 * The body is checked before anything is pushed: the standalone `Closes #<issue>`
 * line, `READY TO MERGE` as the last line (absent from a draft), no placeholder
 * left from the template, and no closing keyword before another issue number in
 * the title, the body or a commit of the range — the grammar of
 * `.github/scripts/check-closing-keywords.cjs`, the CI guard itself. Then the
 * branch is pushed, the PR created (or the open one for the branch found again)
 * and the plan from `.agentic/plan/` posted under `<!-- agentic-run-plan -->`, so
 * a CI-fix session starts from what the change set out to do. A re-run after a
 * failure creates nothing twice.
 *
 * @module pipeline/open-pr
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPaths, currentBranch, dirtyPaths, git, mainRoot } from './git.js';
import { isValidLabel } from './paths.js';
import { readState } from './tdd-state.js';

export type Runner = (argv: string[], cwd: string) => { code: number; out: string };

export const PLAN_MARKER = '<!-- agentic-run-plan -->';
const READY = 'READY TO MERGE';
const MAX_COMMENT = 60_000;
/** The repository this module belongs to: the templates and the closing-keyword grammar come from here. */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PLACEHOLDER = /<(?!!--)[^<>\n]+>/g;

export class OpenPrError extends Error {}

/** stdout alone on success (`gh` writes progress to stderr), stdout and stderr together on failure. */
export const runStdout: Runner = (argv, cwd) => {
  const result = spawnSync(argv[0]!, argv.slice(1), { cwd, encoding: 'utf8' });
  if (result.error) return { code: 127, out: result.error.message };
  const code = result.status ?? 1;
  return { code, out: code === 0 ? result.stdout : `${result.stdout}${result.stderr}` };
};

function plans(root: string, label: string): string[] {
  const directory = join(root, '.agentic', 'plan');
  if (!existsSync(directory)) return [];
  const own = existsSync(join(directory, `${label}.md`)) ? [join(directory, `${label}.md`)] : [];
  const sections = readdirSync(directory).filter((name) => name.startsWith(`${label}-s`) && name.endsWith('.md')).sort();
  return [...own, ...sections.map((name) => join(directory, name))];
}

/** The plan comment: the marker, then every plan of the run in a collapsed block, cut at 60 000 characters. */
export function planComment(files: string[], label: string): string {
  const parts = files.map((file) => {
    const stem = file.split(/[\\/]/).pop()!.replace(/\.md$/, '');
    const text = readFileSync(file, 'utf8').trim();
    return stem === label ? text : `### Section ${stem.slice(label.length + 2)}\n\n${text}`;
  });
  const head = `${PLAN_MARKER}\n<details><summary>Plan this run worked from</summary>\n\n`;
  const tail = '\n\n</details>\n';
  let inner = parts.join('\n\n');
  const room = MAX_COMMENT - head.length - tail.length - 80;
  if (inner.length > room) inner = `${inner.slice(0, room)}\n\n_(cut at 60 000 characters)_`;
  return `${head}${inner}${tail}`;
}

/** What keeps `body` from being this run's PR body, from what can be read without GitHub. */
export function bodyProblems(body: string, issue: string | undefined, draft: boolean, template: string): string[] {
  const problems: string[] = [];
  const lines = body.split('\n').map((line) => line.trimEnd());
  if (issue !== undefined && !lines.some((line) => line.trim() === `Closes #${issue}`)) problems.push(`no standalone \`Closes #${issue}\` line`);
  const filled = lines.filter((line) => line.trim() !== '');
  const ready = lines.filter((line) => line.trim() === READY);
  if (draft && ready.length > 0) problems.push(`a draft carries no \`${READY}\` line`);
  if (!draft && (ready.length !== 1 || filled.at(-1)?.trim() !== READY)) {
    problems.push(`\`${READY}\` must be the body's last line, once (agentic-pipeline-pr-management)`);
  }
  const left = [...new Set(template.match(PLACEHOLDER) ?? [])].filter((token) => body.includes(token)).sort();
  if (left.length > 0) problems.push(`template placeholders left unfilled: ${left.join(', ')}`);
  return problems;
}

/** The CI guard's verdict before the PR exists. */
function closingKeywordProblems(title: string, body: string, commits: string[]): string[] {
  const guard = createRequire(import.meta.url)(join(REPO, '.github/scripts/check-closing-keywords.cjs')) as {
    findClosingKeywordViolations: (input: { title: string; body: string; commitMessages: string[] }) => { source: string; line: number; text: string }[];
  };
  return guard.findClosingKeywordViolations({ title, body, commitMessages: commits }).map(
    (v) => `closing keyword in ${v.source} line ${v.line}: \`${v.text}\` (only the body's standalone \`Closes #<issue>\` line may name an issue that way)`,
  );
}

function gh(run: Runner, root: string, ...args: string[]): string {
  const { code, out } = run(['gh', ...args], root);
  if (code !== 0) throw new OpenPrError(`\`gh ${args.slice(0, 2).join(' ')}\` failed — fix it and re-run \`open-pr\`; nothing is created twice:\n${out}`);
  return out.trim();
}

interface OpenPrOptions {
  label: string;
  title: string;
  bodyFile: string;
  draft?: boolean;
  /** A paused handover: a draft labelled `paused` on the create call, checked against the paused template. */
  paused?: boolean;
}

/** Check, push, create or find the PR, post the plan comment; the report lines. */
export function openPr(cwd: string, options: OpenPrOptions, run: Runner = runStdout): string[] {
  const { label, title, bodyFile } = options;
  if (!isValidLabel(label)) throw new OpenPrError(`Invalid label ${label}.`);
  const root = mainRoot(cwd);
  const head = readState(root, label)?.featureBranch ?? `pipeline/feature-${label}`;
  const issue = /^(\d+)-/.exec(label)?.[1];
  const paused = options.paused === true;
  const draft = options.draft === true || paused;
  if (currentBranch(root) !== head) throw new OpenPrError(`On ${currentBranch(root) || '(detached HEAD)'}: check out ${head} first.`);
  if (dirtyPaths(root).length > 0) throw new OpenPrError('The working tree has uncommitted changes: commit them first (the PR must carry them).');
  const files = plans(root, label);
  if (files.length === 0) {
    throw new OpenPrError(`No plan at .agentic/plan/${label}.md: write it (agentic-pipeline-tdd, The plan) — the plan comment is how a CI-fix session learns what the change set out to do.`);
  }
  if (!existsSync(bodyFile)) throw new OpenPrError(`No body file at ${bodyFile}.`);
  const body = readFileSync(bodyFile, 'utf8');
  const templatePath = join(REPO, '.github/PULL_REQUEST_TEMPLATE', paused ? 'paused.md' : 'pipeline.md');
  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '';
  git(root, 'fetch', '-q', 'origin', 'main');
  const commits = git(root, 'log', '--format=%B%x00', 'origin/main..HEAD').split('\0').filter((m) => m.trim() !== '');
  const problems = [...bodyProblems(body, issue, draft, template), ...closingKeywordProblems(title, body, commits)];
  if (changedPaths(root, 'origin/main', 'HEAD').length === 0) problems.push(`${head} changes nothing against origin/main`);
  if (problems.length > 0) throw new OpenPrError(`The PR was not opened:\n  ✗ ${problems.join('\n  ✗ ')}`);

  const push = run(['git', 'push', '-q', '-u', 'origin', head], root);
  if (push.code !== 0) throw new OpenPrError(`\`git push\` failed — fetch, merge origin/${head} if the gate pushed to it, and re-run:\n${push.out}`);
  const lines: string[] = [];
  const found = gh(run, root, 'pr', 'list', '--head', head, '--state', 'open', '--json', 'number,url', '--jq', '.[0] | select(. != null) | "\\(.number) \\(.url)"');
  let number: string;
  if (found !== '') {
    const [n, url] = found.split(' ');
    number = n!;
    lines.push(`PR #${number} already open for ${head}: ${url}`);
  } else {
    const create = ['pr', 'create', '--base', 'main', '--head', head, '--title', title, '--body-file', bodyFile];
    if (draft) create.push('--draft');
    if (paused) create.push('--label', 'paused');
    const url = gh(run, root, ...create).split('\n').at(-1)!.trim();
    number = url.replace(/\/$/, '').split('/').at(-1)!;
    if (!/^\d+$/.test(number)) throw new OpenPrError(`\`gh pr create\` printed no PR URL: ${url}`);
    lines.push(`Opened ${draft ? 'draft ' : ''}PR #${number}: ${url}`);
  }

  const existing = gh(run, root, 'api', `repos/{owner}/{repo}/issues/${number}/comments`, '--paginate', '--jq', `.[] | select(.body | startswith("${PLAN_MARKER}")) | .id`);
  if (existing !== '') {
    lines.push('Plan comment already posted.');
  } else {
    const directory = mkdtempSync(join(tmpdir(), 'plan-comment-'));
    try {
      const file = join(directory, 'plan.md');
      writeFileSync(file, planComment(files, label));
      gh(run, root, 'pr', 'comment', number, '--body-file', file);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    lines.push(`Plan comment posted from ${files.map((file) => file.split(/[\\/]/).pop()).join(', ')}.`);
  }
  return lines;
}
