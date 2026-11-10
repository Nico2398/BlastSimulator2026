'use strict';

/**
 * Stops what an agent attempt left running when its step ended.
 *
 * A step's `timeout-minutes` ends the step, not the processes it started:
 * on run 40822508814 (issue #2116) the first attempt's `claude` process kept
 * working for 59 minutes after its step timed out, alongside the retry that
 * the unsettled issue had started, and it was the one that opened the pull
 * request. Two sessions on one issue can push to the same branch. The runner
 * calls this between an attempt and whatever reads or retries after it.
 *
 * `node agent-processes.cjs stop <name>... [--handles <dir>]` kills every
 * process with one of those command names and all of its descendants, deepest
 * first. With `--handles`, it also stops every `npm run long` command the
 * attempt left unfinished in that handle directory: `npm run long` detaches each
 * one into its own process group, so it is no descendant of `claude` and
 * survived the stop above. On issue 2118's retry (run 40887420372) a timed-out
 * first attempt's long runs were still going, and the retry's visual-tester,
 * held by the settled-turn hook, waited 19 minutes on handles it never started.
 */

const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

/** Rows of `ps -eo pid=,ppid=,comm=`. */
function parsePs(text) {
  return text
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map(([, pid, ppid, comm]) => ({ pid: Number(pid), ppid: Number(ppid), comm: comm.trim() }));
}

/**
 * The pids to kill: every process named in `names`, with all its descendants,
 * children before parents, never `self` or its ancestors.
 */
function treesToStop(rows, names, self = process.pid, roots = []) {
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }
  const parent = new Map(rows.map((row) => [row.pid, row.ppid]));
  const protectedPids = new Set();
  for (let pid = self; pid !== undefined && !protectedPids.has(pid); pid = parent.get(pid)) protectedPids.add(pid);

  const order = [];
  const seen = new Set();
  const visit = (pid) => {
    if (seen.has(pid) || protectedPids.has(pid)) return;
    seen.add(pid);
    for (const child of children.get(pid) ?? []) visit(child);
    order.push(pid);
  };
  for (const row of rows) if (names.includes(row.comm)) visit(row.pid);
  for (const root of roots) visit(root);
  return order;
}

/**
 * The detached shells of the `npm run long` handles in `dir` that never wrote
 * their exit file. A pid counts only while its command line still names that
 * handle's exit file — the line the detached shell was started with — so a pid
 * the system has since given to another process is never touched.
 */
function unfinishedHandlePids(dir, commandLineOf = readCommandLine) {
  if (!existsSync(dir)) return [];
  const pids = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.pid')) continue;
    const exitPath = join(dir, `${name.slice(0, -'.pid'.length)}.exit`);
    if (existsSync(exitPath)) continue;
    const pid = Number.parseInt(readFileSync(join(dir, name), 'utf8').trim(), 10);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    if ((commandLineOf(pid) ?? '').includes(exitPath)) pids.push(pid);
  }
  return pids;
}

/** A process's command line, or undefined once it is gone. */
function readCommandLine(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ');
  } catch {
    return undefined;
  }
}

function stop(names, handleDir) {
  const rows = parsePs(execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' }));
  const handles = handleDir === undefined ? [] : unfinishedHandlePids(handleDir);
  // Each handle's whole process group too: a process whose parent exited
  // before it was reparented out of the shell's tree, and only its process
  // group still ties it to the handle.
  for (const pid of handles) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // No such group left.
    }
  }
  const pids = treesToStop(rows, names, process.pid, handles);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  return pids.length;
}

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const at = rest.indexOf('--handles');
  const handleDir = at === -1 ? undefined : rest[at + 1];
  const names = at === -1 ? rest : rest.filter((_, i) => i !== at && i !== at + 1);
  if (command !== 'stop' || names.length === 0 || (at !== -1 && !handleDir)) {
    console.error('usage: agent-processes.cjs stop <name>... [--handles <npm run long handle dir>]');
    process.exit(2);
  }
  const count = stop(names, handleDir);
  console.log(count === 0 ? 'No agent process was left running.' : `Stopped ${count} process(es) the attempt left running.`);
}

module.exports = { parsePs, treesToStop, unfinishedHandlePids };
