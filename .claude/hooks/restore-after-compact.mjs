// SessionStart hook (matcher: "compact") — hand the session back its run state
// after an automatic compaction.
//
// Compaction can land on any turn, in the middle of a step: a summary replaces
// the conversation, and whatever the summary dropped is gone. What must not be
// lost is on disk — the TDD cycle state, the blind marker, the plan and its
// `## Progress` checkpoints, the last `verify` — so this hook reads it back
// into the context right after the summary. With it, when compaction happens
// stops mattering; only how often does.
//
// Output on stdout is added to the session context. Prints nothing outside a
// pipeline run (no `.agentic/` state). Always exits 0.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readStdin } from './lib/hook-io.mjs';

readStdin();

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const agentic = join(root, '.agentic');
const PROGRESS_LINES = 30;

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
};

const tddDir = join(agentic, 'tdd');
const cycles = existsSync(tddDir)
  ? readdirSync(tddDir)
      .filter((name) => name.endsWith('.json') && name !== 'blind.json')
      .map((name) => readJson(join(tddDir, name)))
      .filter(Boolean)
  : [];
const blind = existsSync(join(tddDir, 'blind.json')) ? readJson(join(tddDir, 'blind.json')) : undefined;
const planDir = join(agentic, 'plan');
const plans = existsSync(planDir) ? readdirSync(planDir).filter((name) => name.endsWith('.md')) : [];
const lastVerify = join(agentic, 'verify', 'last.txt');
const stepInFlight = existsSync(join(agentic, 'step.json')) ? readJson(join(agentic, 'step.json')) : undefined;

if (cycles.length === 0 && plans.length === 0 && !existsSync(lastVerify)) process.exit(0);

const lines = ['## Run state restored after compaction', '', 'The conversation was compacted. This is the run state on disk — trust it over the summary where they differ.', ''];

if (blind) {
  lines.push(
    `**Blind phase open for ${blind.label}.** Do not read, grep, list or \`git show\` ${blind.worktree} or ${blind.testsBranch} until your implementation is committed and \`npm run pipeline -- tdd join --label ${blind.label}\` has run. Implement from the plan's Contract.`,
    '',
  );
}

if (stepInFlight) lines.push(`- Step in flight: \`${stepInFlight.name}\` (since ${stepInFlight.since}). Close it with \`npm run pipeline -- step <next> --label ${stepInFlight.label}\` when it is done.`);

for (const cycle of cycles) {
  lines.push(
    `- TDD ${cycle.label}: phase \`${cycle.phase}\`, impl \`${cycle.implBranch}\`, tests \`${cycle.testsBranch}\`, feature \`${cycle.featureBranch}\`${cycle.red ? `, RED ${String(cycle.red).slice(0, 9)}` : ''}.`,
  );
}

const branch = git('branch', '--show-current');
const dirty = git('status', '--porcelain').split('\n').filter(Boolean);
const recent = git('log', '--format=%h %s', '-5');
lines.push(
  `- Branch \`${branch || '(detached)'}\`; ${dirty.length === 0 ? 'clean tree' : `${dirty.length} uncommitted path(s): ${dirty.slice(0, 8).map((l) => l.slice(3)).join(', ')}`}.`,
);
if (recent) lines.push('- Last commits:', ...recent.split('\n').map((l) => `  - ${l}`));

for (const plan of plans) {
  const text = readFileSync(join(planDir, plan), 'utf8');
  const start = text.indexOf('## Progress');
  lines.push('', `### Plan \`.agentic/plan/${plan}\` — re-read it before the next step`);
  if (start !== -1) {
    const progress = text.slice(start).split('\n').slice(1).filter((l) => l.trim() !== '');
    lines.push(...progress.slice(-PROGRESS_LINES));
  } else {
    lines.push('(no `## Progress` checkpoints yet)');
  }
}

if (existsSync(lastVerify)) {
  lines.push('', '### Last `npm run pipeline -- verify`', ...readFileSync(lastVerify, 'utf8').trimEnd().split('\n'));
}

process.stdout.write(`${lines.join('\n')}\n`);
