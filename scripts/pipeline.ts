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
 *   npm run pipeline -- tdd red    --label <label> [--no-commit]     (the test-writer runs this)
 *   npm run pipeline -- tdd join   --label <label>
 *   npm run pipeline -- tdd status --label <label>
 *   npm run pipeline -- verify [--base origin/main] [--only static,logic] [--no-cache]
 *   npm run pipeline -- review-brief [--base origin/main] [--label <label>]...
 *
 * `verify` outlives one Bash call on a full change: run it through
 * `npm run long -- start verify -- npm run pipeline -- verify`.
 *
 * @module pipeline
 */

import { GitError } from './lib/pipeline/git.js';
import { CHANNEL_ORDER, type Channel } from './lib/pipeline/paths.js';
import { reviewBrief } from './lib/pipeline/review-brief.js';
import { joinCycle, PipelineError, red, split, start, status } from './lib/pipeline/tdd.js';
import { verify } from './lib/pipeline/verify.js';

const USAGE = `Usage:
  npm run pipeline -- tdd start|split|red|join|status --label <label> [--base <ref>] [--feature <branch>] [--no-commit]
  npm run pipeline -- verify [--base <ref>] [--only <channel,...>] [--no-cache]
  npm run pipeline -- review-brief [--base <ref>] [--label <label>]...`;

/** Values of `--name value` (repeatable) and the presence of bare `--flag`s. */
export function parseArgs(argv: string[]): { positional: string[]; values: Map<string, string[]>; flags: Set<string> } {
  const positional: string[] = [];
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
    } else if (['--no-commit', '--no-cache'].includes(arg)) {
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
    if (sub === 'start') print(start(cwd, { label, base: one(values, 'base'), feature: one(values, 'feature') }));
    else if (sub === 'split') print(split(cwd, label));
    else if (sub === 'join') print(joinCycle(cwd, label));
    else if (sub === 'status') print(status(cwd, label));
    else if (sub === 'red') {
      const result = red(cwd, { label, commit: !flags.has('no-commit') });
      print(result.lines);
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
  if (command === 'review-brief') {
    print(reviewBrief(cwd, { base: one(values, 'base'), labels: values.get('label') }));
    return 0;
  }
  throw new PipelineError(USAGE);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('pipeline.ts')) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof PipelineError) && !(error instanceof GitError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
  }
}
