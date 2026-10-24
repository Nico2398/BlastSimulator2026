/**
 * BlastSimulator2026 — Export a pipeline run's metrics, and report on many
 *
 * `extract` reads the Claude Code transcripts a run left under
 * `~/.claude/projects/`, writes one sanitized JSON record per session, and
 * prints that run's summary as Markdown (the runner appends it to the job's
 * step summary). `report` reads accumulated records — the `runs.jsonl` the
 * runner appends to the `agentic-metrics` branch — and prints the tables a
 * pipeline change is weighed against.
 *
 * Records hold numbers and names from fixed vocabularies only (agent types,
 * skill and tool names, shell commands by category). Never a prompt, a file's
 * content or a command line: they leave the runner as an artifact and as a
 * line on a public branch. The transcripts themselves never leave the VM.
 *
 * Usage:
 *   npm run metrics -- extract --out <dir> [--projects ~/.claude/projects] [--since <epoch seconds>]
 *                              [--issue N] [--entity "issue N"] [--run-id R] [--run-attempt A]
 *                              [--workflow W] [--repo owner/name] [--conclusion success] [--terminal true]
 *   npm run metrics -- report <runs.jsonl | dir of records>...
 *   npm run metrics -- publish --dir <dir> --remote <url> [--branch agentic-metrics]
 *
 * Exit 0 always for `extract` with nothing to read (a session that never
 * started has no metrics, and that is not this script's failure); 2 on bad
 * arguments.
 *
 * @module agentic-metrics
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { extractMetrics, type RunContext, type RunMetrics } from './lib/metrics/extract.js';
import { aggregateReport, runSummary } from './lib/metrics/report.js';
import { publish } from './lib/metrics/publish.js';
import { readSessions } from './lib/metrics/transcripts.js';

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function npmScripts(): Set<string> {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    return new Set(Object.keys(pkg.scripts ?? {}));
  } catch {
    return new Set();
  }
}

/** Records from JSONL files and directories of `.json` records. */
export function readRecords(paths: string[]): RunMetrics[] {
  const runs: RunMetrics[] = [];
  const parse = (text: string): void => {
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        runs.push(JSON.parse(line) as RunMetrics);
      } catch {
        // A truncated line is skipped, not fatal: the report is over many runs.
      }
    }
  };
  for (const path of paths) {
    if (!existsSync(path)) continue;
    if (statSync(path).isDirectory()) {
      for (const file of readdirSync(path).filter((f) => f.endsWith('.json'))) parse(readFileSync(join(path, file), 'utf8').replace(/\n/g, ' '));
    } else {
      parse(readFileSync(path, 'utf8'));
    }
  }
  return runs;
}

function extract(argv: string[]): number {
  const out = option(argv, 'out');
  if (!out) {
    console.error('extract needs --out <dir>');
    return 2;
  }
  const since = Number(option(argv, 'since') ?? '0');
  const context: RunContext = {
    repo: option(argv, 'repo'),
    workflow: option(argv, 'workflow'),
    runId: option(argv, 'run-id'),
    runAttempt: option(argv, 'run-attempt'),
    issue: option(argv, 'issue'),
    entity: option(argv, 'entity'),
    conclusion: option(argv, 'conclusion'),
    terminal: option(argv, 'terminal'),
  };
  const sessions = readSessions(option(argv, 'projects') ?? join(homedir(), '.claude', 'projects'), Number.isFinite(since) ? since * 1000 : 0);
  mkdirSync(out, { recursive: true });
  const scripts = npmScripts();
  const summaries: string[] = [];
  for (const session of sessions) {
    const run = extractMetrics(session, context, scripts);
    if (run.agents.every((agent) => agent.requests === 0)) continue;
    writeFileSync(join(out, `${run.sessionId}.json`), `${JSON.stringify(run)}\n`);
    summaries.push(runSummary(run));
  }
  console.log(summaries.length > 0 ? summaries.join('\n\n') : 'No Claude Code session transcript found for this run.');
  return 0;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === 'extract') return extract(rest);
  if (command === 'report') {
    console.log(aggregateReport(readRecords(rest)));
    return 0;
  }
  if (command === 'publish') {
    const dir = option(rest, 'dir');
    const remote = option(rest, 'remote');
    if (!dir || !remote) {
      console.error('publish needs --dir <dir> and --remote <url>');
      return 2;
    }
    console.log(`Appended ${publish({ dir, remote, branch: option(rest, 'branch') ?? 'agentic-metrics' })} record(s).`);
    return 0;
  }
  console.error('Usage: npm run metrics -- extract --out <dir> [...] | report <files>... | publish --dir <dir> --remote <url>');
  return 2;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('agentic-metrics.ts')) {
  process.exitCode = main(process.argv.slice(2));
}
