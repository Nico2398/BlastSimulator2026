/**
 * BlastSimulator2026 — Wait for a pull request's CI to report
 *
 * A pipeline run's last act is opening its PR, and the channels CI owns —
 * command-mode `scenario` on every push, the interaction-mode `visual` suite
 * behind `full-ci`, the production `build` behind `build-check` — report minutes
 * after the session that would have read them has exited. PR #581 is what that
 * costs: green on every channel the session ran itself, marked `READY TO MERGE`,
 * and two interaction shards red in CI. `agentic-auto-merge.yml` skips a failed
 * CI run by design, so nothing merged it, nothing chained, and issue #552 held
 * `in-progress` with the whole queue behind it.
 *
 * This script is how a run reads that verdict instead of guessing at it: it
 * listens to the workflow runs on the PR head until they finish. Listening, not
 * re-running — the channels have already been paid for once, and a second local
 * run answers a different question anyway (a sandbox without a GPU cannot
 * reproduce the interaction-mode suite CI runs).
 *
 * **No deadline by default, deliberately.** A duration budget is the wrong shape
 * for this: one long enough for today's CI is a premature verdict once a shard
 * count or a scenario suite grows, and every early exit reproduces #581 exactly
 * — a run ending on a channel nothing read. So the wait ends when the runs end.
 * Its real bound is the runner's own `timeout-minutes: 360`, and hitting *that*
 * is safe rather than silent: the job dies, no runner run is live any more, and
 * `agentic-ci-failure.yml` hands the pull request back. `--timeout-minutes` stays
 * available for a human at a CLI who wants to stop looking.
 *
 * The poll interval is not that kind of clock. It is how often a question is
 * asked, not a threshold any decision is taken on — GitHub pushes nothing to a
 * terminal, so something has to ask. No verdict depends on its value.
 *
 * Usage:
 *   npm run ci:await -- --pr 581
 *   npm run ci:await -- --head pipeline/feature-552-18273645
 *   npm run ci:await -- --pr 581 --interval-seconds 15
 *   npm run ci:await -- --pr 581 --timeout-minutes 20   # opt-in, for a human
 *
 * Exit codes — the whole point of the script, since the caller branches on them:
 *   0  GREEN    every workflow run on the head reported success (or the PR merged),
 *               and — for a `full-ci`/`build-check` PR — the job(s) those labels
 *               gate actually ran and succeeded, not merely skipped without failing
 *   1  RED      at least one reported failure, or a full-ci/build-check PR whose
 *               gated job never ran despite the label (#615). The failing jobs are
 *               printed with their log URLs, which is the input a fix needs
 *   2  TIMEOUT  only reachable with an explicit `--timeout-minutes`. Not a verdict
 *   3  GONE     the PR is closed unmerged, or no PR exists for that head
 *   4  USAGE    bad arguments, or `gh` could not answer
 *
 * @module await-pr-ci
 */

import { execFileSync } from 'child_process';

/** A workflow run on the head, reduced to what the verdict depends on. */
export interface WorkflowRun {
  id: number;
  /** `.github/workflows/<file>.yml` — how a run names the workflow that owns it. */
  path: string;
  name: string;
  /** Grouping key for "latest run of this workflow", stable across re-runs. */
  workflow_id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
}

export type Verdict = 'green' | 'red' | 'pending';

/** A job on a workflow run, reduced to what a label-gate check depends on. */
export interface WorkflowJob {
  name: string;
  conclusion: string | null;
}

/**
 * A label that gates a job (`full-ci` -> the interaction-mode shards,
 * `build-check` -> the production build) makes a CI run's own `success`
 * conclusion insufficient evidence on its own: the run reports `success` the
 * moment every job in it either passed or was skipped, and a job skipped
 * because its `if:` guard was evaluated before the label existed is
 * indistinguishable from that at the run level. PR #615 merged exactly that
 * way. Kept in step with the same-named check in
 * `.github/actions/agentic-auto-merge/action.yml` — the two decide whether a
 * PR may end a run and whether it may merge, and must not disagree about it.
 */
const LABEL_GATED_JOBS: { label: string; jobNamePrefix: string }[] = [
  { label: 'full-ci', jobNamePrefix: 'Scenarios (interaction mode)' },
  { label: 'build-check', jobNamePrefix: 'Production build' },
];

/** Gated labels whose job did not fully report `success` among `jobs`. */
export function missingGatedJobs(labels: string[], jobs: WorkflowJob[]): string[] {
  const wanted = LABEL_GATED_JOBS.filter((g) => labels.includes(g.label));
  return wanted
    .filter((g) => {
      const matches = jobs.filter((j) => j.name.startsWith(g.jobNamePrefix));
      return matches.length === 0 || !matches.every((j) => j.conclusion === 'success');
    })
    .map((g) => g.label);
}

/**
 * Which of `LABEL_GATED_JOBS`' labels a PR carries — the fail-closed answer
 * for when no `ci.yml` run exists on the head at all to ask `missingGatedJobs`
 * about (a workflow-file syntax error, or a run not yet indexed by the runs
 * API). Mirrors `agentic-auto-merge/action.yml`'s own `ciRuns.length === 0`
 * branch, which already treats "no run found" as every wanted label missing
 * rather than as a pass — the two must not disagree about it, and reporting
 * green on a run that never happened is exactly the absence-of-evidence gap
 * this whole check exists to close.
 */
export function wantedGatedLabels(labels: string[]): string[] {
  return LABEL_GATED_JOBS.filter((g) => labels.includes(g.label)).map((g) => g.label);
}

/**
 * Conclusions that mean nothing is going to repeat this run. `cancelled` and
 * `stale` sit with the failures because the dedup below already drops a
 * superseded run — one that survives it was cancelled for good. `skipped` and
 * `neutral` are not failures: `claude-code-review.yml` reports `skipped` on
 * every pipeline PR, and `Production build` does the same without `build-check`.
 *
 * Kept in step with `RUN_FAILURES` in `.github/actions/agentic-auto-merge`: the
 * action decides whether the PR merges, this script decides whether the run
 * that opened it may end, and the two must not disagree about what red means.
 */
const RUN_FAILURES = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure', 'stale']);

/**
 * Workflows that are the merge machinery rather than a verification channel.
 *
 * `agentic-auto-merge.yml` runs on `workflow_run`, so its own run carries the
 * head SHA of the CI run that woke it and shows up in this list. Counting it
 * would be circular twice over: it is pending until CI has been read, and it
 * fails the step on a marked PR it could not arm — which is a report about the
 * merge, not about the code. The runners are here for the sharper version of
 * the same circularity: this script runs *inside* the runner job, so counting
 * that job's own run would make every wait pend until the 360-minute timeout.
 *
 * **Named one by one, never by prefix.** This was `/^\.github\/workflows\/
 * (agentic-|auto-assign-next|handle-failure)/` and it failed open: every new
 * workflow whose file happened to start with `agentic-` exempted itself from
 * the verdict by its name alone. `agentic-closing-keyword-guard.yml` (#765) is
 * a verification check that did exactly that, and PR #773 is the bill — its
 * guard job failed at 23:52, this script read GREEN at 00:06 because the run
 * was filtered out here, the session ended having done everything it was told,
 * and the pull request sat `unstable` and unmergeable with nobody watching.
 *
 * So the direction is inverted: a workflow counts as a channel unless it is
 * named below. A new verification workflow is read with no edit here; a new
 * machinery workflow that forgets this list costs a wait, which is the safe
 * half of the mistake.
 */
const MACHINERY_WORKFLOWS: ReadonlySet<string> = new Set([
  'agentic-auto-merge.yml',
  'agentic-ci-failure.yml',
  'agentic-intake.yml',
  'agentic-trigger.yml',
  'agentic-watchdog.yml',
  'auto-assign-next.yml',
  'claude-runner.yml',
  'handle-failure.yml',
  'opencode-runner.yml',
]);

export const isMachineryWorkflow = (path: string): boolean =>
  MACHINERY_WORKFLOWS.has(path.replace(/^\.github\/workflows\//, ''));

/**
 * One run per workflow: the newest. CI declares `cancel-in-progress: true`, so a
 * pushed fix leaves the superseded run on the same head, `cancelled` forever. Read
 * without this dedup, every fix a run pushes makes its own PR permanently red.
 */
export function latestRunPerWorkflow(runs: WorkflowRun[]): WorkflowRun[] {
  const latest = new Map<number, WorkflowRun>();
  for (const run of runs) {
    if (isMachineryWorkflow(run.path)) continue;
    const seen = latest.get(run.workflow_id);
    if (!seen || run.id > seen.id) latest.set(run.workflow_id, run);
  }
  return [...latest.values()];
}

/**
 * `pending` on an empty list, deliberately. A head read in the second before its
 * CI run is created has nothing failing and nothing running, and calling that
 * green reports a pass on channels no machine ever ran — the same trap
 * `agentic-auto-merge`'s `total === 0` guard exists for.
 */
export function verdictOf(runs: WorkflowRun[]): Verdict {
  const latest = latestRunPerWorkflow(runs);
  if (latest.length === 0) return 'pending';
  if (latest.some((run) => run.status === 'completed' && RUN_FAILURES.has(run.conclusion ?? ''))) {
    return 'red';
  }
  if (latest.some((run) => run.status !== 'completed')) return 'pending';
  return 'green';
}

export interface Options {
  pr?: number;
  head?: string;
  /** Undefined means no deadline — the wait ends when the runs do. */
  timeoutMinutes?: number;
  intervalSeconds: number;
}

/**
 * No `timeoutMinutes` default: every value would be a guess about how long CI
 * takes, and a wrong guess turns "still running" into a reported outcome. See
 * the module comment.
 */
export function parseArgs(argv: string[]): Options | { error: string } {
  const options: Options = { intervalSeconds: 30 };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--pr' || flag === '--head' || flag === '--timeout-minutes' || flag === '--interval-seconds') {
      if (value === undefined) return { error: `${flag} needs a value` };
      i += 1;
      if (flag === '--head') {
        options.head = value;
      } else {
        const numeric = Number.parseInt(value, 10);
        if (!Number.isFinite(numeric) || numeric <= 0) return { error: `${flag} needs a positive number, got \`${value}\`` };
        if (flag === '--pr') options.pr = numeric;
        else if (flag === '--timeout-minutes') options.timeoutMinutes = numeric;
        else options.intervalSeconds = numeric;
      }
      continue;
    }
    return { error: `unknown argument \`${flag}\`` };
  }

  if (options.pr === undefined && options.head === undefined) {
    return { error: 'pass --pr <number> or --head <branch>' };
  }
  return options;
}

/** `gh api` output, parsed. Throws with gh's own stderr, which names the real problem. */
function gh<T>(args: string[]): T {
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out) as T;
}

interface PullRequest {
  number: number;
  state: string;
  merged_at: string | null;
  draft: boolean;
  head: { ref: string; sha: string };
  labels: { name: string }[];
}

function resolvePr(options: Options): PullRequest | undefined {
  if (options.pr !== undefined) {
    return gh<PullRequest>(['api', `repos/{owner}/{repo}/pulls/${options.pr}`]);
  }
  const { owner } = gh<{ owner: { login: string } }>(['repo', 'view', '--json', 'owner']);
  const open = gh<PullRequest[]>([
    'api',
    `repos/{owner}/{repo}/pulls?state=open&head=${owner.login}:${options.head}&per_page=10`,
  ]);
  return open[0];
}

function runsOnHead(sha: string): WorkflowRun[] {
  const page = gh<{ workflow_runs: WorkflowRun[] }>([
    'api',
    `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`,
  ]);
  return page.workflow_runs ?? [];
}

function jobsForRun(runId: number): WorkflowJob[] {
  const page = gh<{ jobs: WorkflowJob[] }>([
    'api',
    `repos/{owner}/{repo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`,
  ]);
  return page.jobs ?? [];
}

/** Failing jobs, so the caller reads what to fix rather than that something broke. */
function reportFailure(runs: WorkflowRun[]): void {
  for (const run of latestRunPerWorkflow(runs)) {
    if (run.status !== 'completed' || !RUN_FAILURES.has(run.conclusion ?? '')) continue;
    console.log(`  ✗ ${run.name} — ${run.conclusion}`);
    console.log(`    ${run.html_url}`);
    try {
      const { jobs } = gh<{ jobs: { name: string; conclusion: string | null; html_url: string }[] }>([
        'api',
        `repos/{owner}/{repo}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`,
      ]);
      for (const job of jobs) {
        if (job.conclusion && RUN_FAILURES.has(job.conclusion)) {
          console.log(`      job: ${job.name} — ${job.html_url}`);
        }
      }
    } catch {
      console.log('      (jobs could not be listed; open the run URL above)');
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`await-pr-ci: ${parsed.error}`);
    console.error('Usage: npm run ci:await -- --pr <number> | --head <branch> [--timeout-minutes N] [--interval-seconds N]');
    return 4;
  }

  const deadline = parsed.timeoutMinutes === undefined
    ? undefined
    : Date.now() + parsed.timeoutMinutes * 60_000;

  for (;;) {
    let pr: PullRequest | undefined;
    let runs: WorkflowRun[];
    try {
      pr = resolvePr(parsed);
      if (!pr) {
        console.log(`CI GONE — no open pull request from ${parsed.head}.`);
        return 3;
      }
      runs = runsOnHead(pr.head.sha);
    } catch (error) {
      // ENOENT here means no `gh` on PATH, which is a capability gap rather
      // than a verdict: the channels CI owns went unread, and saying so is the
      // only honest outcome. Both runners have `gh` and an authenticated
      // `GH_TOKEN`; a sandbox may have neither.
      console.error(`await-pr-ci: gh failed — ${(error as Error).message}`);
      console.error('The CI verdict was not read. `gh` must be on PATH and authenticated (GH_TOKEN).');
      return 4;
    }

    // Auto-merge fires the moment CI reports green, so a merged PR is the
    // ordinary way this loop ends on a run that was about to pass anyway.
    if (pr.merged_at) {
      console.log(`CI GREEN — pull request #${pr.number} is merged.`);
      return 0;
    }
    if (pr.state !== 'open') {
      console.log(`CI GONE — pull request #${pr.number} is ${pr.state} and unmerged.`);
      return 3;
    }

    const verdict = verdictOf(runs);
    const latest = latestRunPerWorkflow(runs);
    const pending = latest.filter((run) => run.status !== 'completed').length;

    if (verdict === 'red') {
      console.log(`CI RED — pull request #${pr.number} on ${pr.head.sha.slice(0, 7)}:`);
      reportFailure(runs);
      console.log('Fix the failure on this branch, push, and wait again. Never end the run on this verdict.');
      return 1;
    }
    if (verdict === 'green') {
      const ciRun = latest.find((run) => run.path === '.github/workflows/ci.yml');
      const labels = (pr.labels ?? []).map((l) => l.name);
      // No gated label at all -- most PRs -- skips the jobs fetch entirely
      // rather than paying a `gh api` round trip for a check that's a no-op.
      // No `ci.yml` run on the head at all is not a pass on the labels it
      // does gate -- fails closed, matching agentic-auto-merge's own
      // `ciRuns.length === 0` branch (see wantedGatedLabels's doc comment).
      const wanted = wantedGatedLabels(labels);
      const missing = wanted.length === 0 ? []
        : ciRun ? missingGatedJobs(labels, jobsForRun(ciRun.id))
        : wanted;

      if (missing.length > 0) {
        // Every workflow run on the head reported success -- but a run
        // reports `success` the moment every job in it either passed or was
        // skipped, and a job a label gates can be skipped for the same
        // reason it never ran at all: the label did not exist yet when its
        // `if:` guard was evaluated. #615 merged on the run-level fact alone
        // with its interaction shards silently absent; this is what reads
        // that gap instead of reporting green on an absence of evidence.
        console.log(
          `CI RED — pull request #${pr.number}: every workflow run reported success, `
          + `but the job(s) gated behind ${missing.join(', ')} did not fully run`
          + (ciRun ? '.' : ' (no ci.yml run found on this head at all).')
        );
        if (ciRun) console.log(`  ${ciRun.html_url}`);
        console.log('Re-push (or re-run the CI workflow) so the label is evaluated against a live run.');
        return 1;
      }

      console.log(`CI GREEN — pull request #${pr.number}: ${latest.length} workflow run(s) reported success.`);
      return 0;
    }

    const state = latest.length === 0
      ? `no workflow run on ${pr.head.sha.slice(0, 7)} yet`
      : `${pending} of ${latest.length} workflow run(s) still going`;

    if (deadline !== undefined && Date.now() >= deadline) {
      console.log(
        `CI TIMEOUT — pull request #${pr.number}: ${state}, and the ${parsed.timeoutMinutes}m ` +
        'budget you asked for is spent. This is not a verdict — the channels are still unread.'
      );
      return 2;
    }

    const budget = deadline === undefined
      ? ''
      : ` (${Math.round((deadline - Date.now()) / 60_000)}m of the requested budget left)`;
    console.log(`waiting — ${state}${budget}`);
    await sleep(parsed.intervalSeconds * 1000);
  }
}

// Importable for unit tests: the pure verdict logic above is the part worth
// pinning, and importing it must not start a polling loop.
if (process.argv[1] && process.argv[1].includes('await-pr-ci')) {
  main().then((code) => process.exit(code));
}
