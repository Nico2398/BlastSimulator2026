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
 * `node agent-processes.cjs stop <name>...` kills every process with one of
 * those command names and all of its descendants, deepest first.
 */

const { execFileSync } = require('node:child_process');

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
function treesToStop(rows, names, self = process.pid) {
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
  return order;
}

function stop(names) {
  const rows = parsePs(execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' }));
  const pids = treesToStop(rows, names);
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
  const [command, ...names] = process.argv.slice(2);
  if (command !== 'stop' || names.length === 0) {
    console.error('usage: agent-processes.cjs stop <name>...');
    process.exit(2);
  }
  const count = stop(names);
  console.log(count === 0 ? 'No agent process was left running.' : `Stopped ${count} process(es) the attempt left running.`);
}

module.exports = { parsePs, treesToStop };
