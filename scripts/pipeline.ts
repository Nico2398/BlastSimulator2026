/**
 * BlastSimulator2026 — The pipeline's deterministic steps, as one command
 *
 * Every bracketed step of the agentic pipeline that needs no judgment lives
 * here instead of in a model turn: branch setup, the blind phase, the RED
 * proof, the cherry-pick join, verification and the reviewer's brief. Each
 * prints a few lines and exits 0 on success, 1 on a verdict that is red, 2 on
 * a step that could not run (wrong branch, dirty tree, unknown label).
 *
 * Usage:
 *   npm run pipeline -- tdd start  --label <issue>-<runId> [--base main] [--feature <branch>]
 *   npm run pipeline -- tdd split  --label <label>
 *   npm run pipeline -- tdd red    --label <label> [--no-commit] [--detail]  (the test-writer runs this with --detail)
 *   npm run pipeline -- tdd join   --label <label>
 *   npm run pipeline -- tdd status --label <label>
 *   npm run pipeline -- verify [--base origin/main] [--only static,logic] [--no-cache]
 *   npm run pipeline -- review-brief [--base origin/main] [--label <label>]...
 *   npm run pipeline -- step <name> --label <label> [--heavy] [--note "<what is open>"]   (`step done` closes the last)
 *
 * `verify` outlives one Bash call on a full change: run it through
 * `npm run long -- start verify -- npm run pipeline -- verify`.
 *
 * @module pipeline
 */

import { GitError, mainRoot } from './lib/pipeline/git.js';
import { CHANNEL_ORDER, type Channel } from './lib/pipeline/paths.js';
import { reviewBrief } from './lib/pipeline/review-brief.js';
import { step, StepError, stepFor } from './lib/pipeline/steps.js';
import { readState } from './lib/pipeline/tdd-state.js';
import { joinCycle, PipelineError, red, split, start, status } from './lib/pipeline/tdd.js';
import { verify } from './lib/pipeline/verify.js';

const USAGE = `Usage:
  npm run pipeline -- tdd start|split|red|join|status --label <label> [--base <ref>] [--feature <branch>] [--no-commit]
  npm run pipeline -- verify [--base <ref>] [--only <channel,...>] [--no-cache]
  npm run pipeline -- review-brief [--base <ref>] [--label <label>]...
  npm run pipeline -- step <name>|done --label <label> [--heavy] [--note <text>]`;

/** Values of `--name value` (repeatable) and the presence of bare `--flag`s. */
export function parseArgs(argv: string[]): { positional: string[]; values: Map<string, string[]>; flags: Set<string> } {
  const positional: string[] = [];
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
    } else if (['--no-commit', '--no-cache', '--heavy', '--detail'].includes(arg)) {
      flags.add(arg.slice(2));
    } else {
      const value = argv[++i];
      if (value === undefined) throw new PipelineError(`${arg} needs a value.`);
      values.set(arg.slice(2), [...(values.get(arg.slice(2)) ?? []), value]);
    }
  }
  return { positional, values, flags };
}

function one(values: Map<string, string[]>, name: string): string | undefined {
  return values.get(name)?.at(-1);
}

function required(values: Map<string, string[]>, name: string): string {
  const value = one(values, name);
  if (value === undefined) throw new PipelineError(`--${name} is required.\n${USAGE}`);
  return value;
}

function channels(value: string | undefined): Channel[] | undefined {
  if (value === undefined) return undefined;
  const list = value.split(',').map((c) => c.trim()) as Channel[];
  const unknown = list.filter((c) => !CHANNEL_ORDER.includes(c));
  if (unknown.length > 0) throw new PipelineError(`Unknown channel(s): ${unknown.join(', ')}. Known: ${CHANNEL_ORDER.join(', ')}.`);
  return list;
}

function run(argv: string[]): number {
  const { positional, values, flags } = parseArgs(argv);
  const cwd = process.cwd();
  const print = (lines: string[]): void => console.log(lines.join('\n'));
  const [command, sub] = positional;

  if (command === 'tdd') {
    const label = required(values, 'label');
    if (sub === 'start') print([...start(cwd, { label, base: one(values, 'base'), feature: one(values, 'feature') }), ...stepFor(cwd, 'tdd start', label)]);
    else if (sub === 'split') print([...split(cwd, label), ...stepFor(cwd, 'tdd split', label)]);
    else if (sub === 'join') {
      const lines = joinCycle(cwd, label);
      print(readState(mainRoot(cwd), label)?.phase === 'joined' ? [...lines, ...stepFor(cwd, 'tdd join', label)] : lines);
    } else if (sub === 'status') print(status(cwd, label));
    else if (sub === 'red') {
      const result = red(cwd, { label, commit: !flags.has('no-commit'), detail: flags.has('detail') });
      const proven = result.verdict.red && !flags.has('no-commit');
      print(proven ? [...result.lines, ...stepFor(cwd, 'tdd red', label)] : result.lines);
      return result.verdict.red ? 0 : 1;
    } else throw new PipelineError(USAGE);
    return 0;
  }
  if (command === 'verify') {
    const result = verify(cwd, {
      base: one(values, 'base'),
      only: channels(one(values, 'only')),
      noCache: flags.has('no-cache'),
      progress: (line) => console.log(`… ${line}`),
    });
    print(result.lines);
    return result.ok ? 0 : 1;
  }
  if (command === 'step') {
    const name = positional.slice(1).join(' ');
    if (name === '') throw new PipelineError(USAGE);
    print(step(cwd, required(values, 'label'), name, one(values, 'note'), flags.has('heavy')));
    return 0;
  }
  if (command === 'review-brief') {
    const labels = values.get('label');
    print([...reviewBrief(cwd, { base: one(values, 'base'), labels }), ...(labels?.[0] ? stepFor(cwd, 'review-brief', labels[0]) : [])]);
    return 0;
  }
  throw new PipelineError(USAGE);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('pipeline.ts')) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof PipelineError) && !(error instanceof GitError) && !(error instanceof StepError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}
