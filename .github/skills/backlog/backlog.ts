#!/usr/bin/env node
/**
 * BlastSimulator2026 — Backlog CLI (Agent)
 *
 * Machine-readable output designed for consumption by the Copilot coding agent.
 * Outputs are intentionally terse and structured (key:value or JSON lines).
 *
 * Usage:  npx tsx .github/skills/backlog/backlog.ts <command> [args]
 *
 * Commands:
 *   list [--status <s>] [--chapter <n>]  List tasks (one per line, key:value format)
 *   next                                  Print the next available pending task
 *   start <id>                            Set task in-progress
 *   done <id> [--pr <number>]             Set task done, record PR number
 *   block <id>                            Set task blocked
 *   reset <id>                            Reset task to pending
 *   stats                                 Print summary counts
 */

import {
  loadBacklog,
  saveBacklog,
  findTask,
  getNextTask,
  setStatus,
  computeStats,
  filterTasks,
  type TaskStatus,
} from './backlog-core.js';

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

// ---------------------------------------------------------------------------
// Formatters (terse, machine-readable)
// ---------------------------------------------------------------------------

function taskLine(t: ReturnType<typeof loadBacklog>[number]): string {
  const blocked = t.blockedBy.length ? ` blockedBy:${t.blockedBy.join(',')}` : '';
  const pr = t.closedInPR ? ` pr:${t.closedInPR}` : '';
  return `id:${t.id} chapter:${t.chapter} status:${t.status}${blocked}${pr} title:${t.title}`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const [cmd, arg1] = args;

switch (cmd) {
  case 'list': {
    const statusFilter = flag('--status') as TaskStatus | undefined;
    const chapterFilter = flag('--chapter') ? Number(flag('--chapter')) : undefined;
    const tasks = filterTasks(loadBacklog(), { status: statusFilter, chapter: chapterFilter });
    for (const t of tasks) console.log(taskLine(t));
    break;
  }

  case 'next': {
    const tasks = loadBacklog();
    const next = getNextTask(tasks);
    if (!next) {
      console.log('NONE');
    } else {
      console.log(taskLine(next));
    }
    break;
  }

  case 'start': {
    if (!arg1) { console.error('usage: start <id>'); process.exit(1); }
    const tasks = loadBacklog();
    const task = findTask(tasks, arg1);
    if (!task) { console.error(`NOT_FOUND id:${arg1}`); process.exit(1); }
    if (tasks.some(t => t.status === 'in-progress')) {
      console.error('CONFLICT another task is already in-progress');
      process.exit(1);
    }
    saveBacklog(setStatus(tasks, arg1, 'in-progress'));
    console.log(`OK id:${arg1} status:in-progress`);
    break;
  }

  case 'done': {
    if (!arg1) { console.error('usage: done <id> [--pr <number>]'); process.exit(1); }
    const pr = flag('--pr') ? Number(flag('--pr')) : undefined;
    const tasks = loadBacklog();
    saveBacklog(setStatus(tasks, arg1, 'done', pr));
    const prNote = pr ? ` pr:${pr}` : '';
    console.log(`OK id:${arg1} status:done${prNote}`);
    break;
  }

  case 'block': {
    if (!arg1) { console.error('usage: block <id>'); process.exit(1); }
    const tasks = loadBacklog();
    saveBacklog(setStatus(tasks, arg1, 'blocked'));
    console.log(`OK id:${arg1} status:blocked`);
    break;
  }

  case 'reset': {
    if (!arg1) { console.error('usage: reset <id>'); process.exit(1); }
    const tasks = loadBacklog();
    saveBacklog(setStatus(tasks, arg1, 'pending'));
    console.log(`OK id:${arg1} status:pending`);
    break;
  }

  case 'stats': {
    const s = computeStats(loadBacklog());
    console.log(`done:${s.done} in-progress:${s.inProgress} pending:${s.pending} blocked:${s.blocked} total:${s.total}`);
    break;
  }

  default:
    console.error('unknown command. available: list next start done block reset stats');
    process.exit(1);
}
