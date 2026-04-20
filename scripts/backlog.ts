#!/usr/bin/env node
/**
 * BlastSimulator2026 — Backlog CLI (Developer)
 *
 * Human-readable, colour-formatted output for local development use.
 * Wraps the same backlog-core operations as the agent script, with richer
 * presentation: chapter grouping, status icons, colour coding, and stats bar.
 *
 * Usage:  npx tsx scripts/backlog.ts <command> [args]
 *
 * Commands:
 *   list [--status <s>] [--chapter <n>]  List tasks grouped by chapter
 *   next                                  Show the next available pending task
 *   start <id>                            Set task in-progress
 *   done <id> [--pr <number>]             Set task done, record PR number
 *   block <id>                            Set task blocked
 *   reset <id>                            Reset task to pending
 *   stats                                 Print summary bar
 */

import {
  loadBacklog,
  saveBacklog,
  findTask,
  getNextTask,
  setStatus,
  computeStats,
  filterTasks,
  resolvedBlockers,
  type BacklogTask,
  type TaskStatus,
} from '../.github/skills/backlog/backlog-core.js';

// ---------------------------------------------------------------------------
// ANSI colours (no external deps)
// ---------------------------------------------------------------------------

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
  white:  '\x1b[37m',
};

function c(color: keyof typeof C, text: string): string {
  return `${C[color]}${text}${C.reset}`;
}

// ---------------------------------------------------------------------------
// Status presentation
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<TaskStatus, string> = {
  'done':        c('green',  '✓'),
  'in-progress': c('yellow', '⏳'),
  'pending':     c('white',  '○'),
  'blocked':     c('red',    '✗'),
};

const STATUS_COLOR: Record<TaskStatus, keyof typeof C> = {
  'done':        'green',
  'in-progress': 'yellow',
  'pending':     'white',
  'blocked':     'red',
};

function statusLabel(status: TaskStatus): string {
  return c(STATUS_COLOR[status], status.padEnd(11));
}

// ---------------------------------------------------------------------------
// Task formatting
// ---------------------------------------------------------------------------

const CHAPTER_NAMES: Record<number, string> = {
  1: 'Buildings System',
  2: 'Vehicle Fleet',
  3: 'Employee Skills & Task Queue',
  4: 'Rock Composition & Survey System',
  5: 'Blast Algorithm — Full Pipeline',
  6: 'NavMesh & Pathfinding',
  7: 'Employee Needs',
  8: 'Testing Strategy',
};

function formatTask(t: BacklogTask): string {
  const icon = STATUS_ICON[t.status];
  const id   = c('cyan', t.id.padEnd(8));
  const stat = statusLabel(t.status);
  const title = t.title.length > 70 ? t.title.slice(0, 67) + '…' : t.title;
  const pr    = t.closedInPR ? c('dim', ` [PR #${t.closedInPR}]`) : '';
  const blockers = t.blockedBy.length
    ? c('dim', ` ← blocked by: ${t.blockedBy.join(', ')}`)
    : '';
  return `  ${icon}  ${id}  ${stat}  ${title}${pr}${blockers}`;
}

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const [cmd, arg1] = args;

switch (cmd) {
  case 'list': {
    const statusFilter = flag('--status') as TaskStatus | undefined;
    const chapterRaw = flag('--chapter');
    let chapterFilter: number | undefined;
    if (chapterRaw !== undefined) {
      const parsed = Number(chapterRaw);
      if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
        console.error(c('red', `Invalid --chapter value: ${chapterRaw}`));
        process.exit(1);
      }
      chapterFilter = parsed;
    }
    const tasks = filterTasks(loadBacklog(), { status: statusFilter, chapter: chapterFilter });

    if (tasks.length === 0) {
      console.log(c('dim', '  No tasks match the given filters.'));
      break;
    }

    // Group by chapter
    const chapters = [...new Set(tasks.map(t => t.chapter))].sort((a, b) => a - b);
    for (const ch of chapters) {
      const chTasks = tasks.filter(t => t.chapter === ch);
      const chName = CHAPTER_NAMES[ch] ?? `Chapter ${ch}`;
      console.log(`\n${c('bold', `── Chapter ${ch}: ${chName} ──`)}`);
      for (const t of chTasks) console.log(formatTask(t));
    }
    console.log('');

    // Mini stats for the filtered view
    const s = computeStats(tasks);
    console.log(
      c('dim', `  Showing ${tasks.length} task(s) — `) +
      c('green',  `${s.done} done`) + c('dim', ' / ') +
      c('yellow', `${s.inProgress} in-progress`) + c('dim', ' / ') +
      c('white',  `${s.pending} pending`) + c('dim', ' / ') +
      c('red',    `${s.blocked} blocked`),
    );
    break;
  }

  case 'next': {
    const tasks = loadBacklog();
    const next = getNextTask(tasks);
    if (!next) {
      console.log(c('green', '🎉  No pending tasks remaining — backlog is clear!'));
    } else {
      console.log(`\n${c('bold', 'Next task:')}\n`);
      console.log(formatTask(next));
      if (next.files.length) {
        console.log(c('dim', `\n  Files:    ${next.files.join(', ')}`));
      }
      if (next.testFile) {
        console.log(c('dim', `  Test:     ${next.testFile}`));
      }
      console.log('');
      console.log(c('dim', `  To start: npx tsx scripts/backlog.ts start ${next.id}`));
    }
    break;
  }

  case 'start': {
    if (!arg1) { console.error(c('red', 'usage: start <id>')); process.exit(1); }
    const tasks = loadBacklog();
    const task = findTask(tasks, arg1);
    if (!task) {
      console.error(c('red', `Task ${arg1} not found.`));
      process.exit(1);
    }
    if (task.status === 'done' || task.status === 'blocked') {
      console.error(c('red', `Cannot start ${arg1}: task is already ${task.status}.`));
      process.exit(1);
    }
    const active = tasks.find(t => t.status === 'in-progress');
    if (active) {
      console.error(c('red', `Cannot start ${arg1}: task ${active.id} is already in-progress.`));
      console.error(c('dim', `  Finish it first: npx tsx scripts/backlog.ts done ${active.id} --pr <number>`));
      process.exit(1);
    }
    if (!resolvedBlockers(tasks, task)) {
      const unresolved = task.blockedBy.filter(
        id => !tasks.find(t => t.id === id && t.status === 'done'),
      );
      console.error(c('red', `Cannot start ${arg1}: unresolved dependencies: ${unresolved.join(', ')}`));
      process.exit(1);
    }
    saveBacklog(setStatus(tasks, arg1, 'in-progress'));
    console.log(c('yellow', `⏳  Started: ${arg1} — ${task.title}`));
    break;
  }

  case 'done': {
    if (!arg1) { console.error(c('red', 'usage: done <id> [--pr <number>]')); process.exit(1); }
    const prRaw = flag('--pr');
    let pr: number | undefined;
    if (prRaw !== undefined) {
      const parsed = Number(prRaw);
      if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
        console.error(c('red', `Invalid --pr value: ${prRaw}`));
        process.exit(1);
      }
      pr = parsed;
    }
    const tasks = loadBacklog();
    const task = findTask(tasks, arg1);
    if (!task) {
      console.error(c('red', `Task ${arg1} not found.`));
      process.exit(1);
    }
    if (task.status !== 'in-progress') {
      console.error(c('yellow', `Warning: task ${arg1} was not in-progress (status: ${task.status}).`));
    }
    saveBacklog(setStatus(tasks, arg1, 'done', pr));
    const prNote = pr ? c('dim', ` (PR #${pr})`) : '';
    console.log(c('green', `✓  Done: ${arg1} — ${task.title}`) + prNote);

    // Show tasks that were waiting on this task and are now fully unblocked
    const fresh = loadBacklog();
    const unblocked = fresh.filter(
      t => t.status === 'pending' && t.blockedBy.includes(arg1) && resolvedBlockers(fresh, t),
    );
    if (unblocked.length) {
      console.log(c('dim', `\n  Unblocked by completing this task:`));
      for (const u of unblocked) console.log(formatTask(u));
    }
    break;
  }

  case 'block': {
    if (!arg1) { console.error(c('red', 'usage: block <id>')); process.exit(1); }
    const tasks = loadBacklog();
    const task = findTask(tasks, arg1);
    if (!task) {
      console.error(c('red', `Task ${arg1} not found.`));
      process.exit(1);
    }
    saveBacklog(setStatus(tasks, arg1, 'blocked'));
    console.log(c('red', `✗  Blocked: ${arg1} — ${task.title}`));
    break;
  }

  case 'reset': {
    if (!arg1) { console.error(c('red', 'usage: reset <id>')); process.exit(1); }
    const tasks = loadBacklog();
    const task = findTask(tasks, arg1);
    if (!task) {
      console.error(c('red', `Task ${arg1} not found.`));
      process.exit(1);
    }
    saveBacklog(setStatus(tasks, arg1, 'pending'));
    console.log(c('white', `○  Reset to pending: ${arg1} — ${task.title}`));
    break;
  }

  case 'stats': {
    const s = computeStats(loadBacklog());
    const bar = (n: number, total: number, color: keyof typeof C): string => {
      const width = 30;
      const filled = total > 0 ? Math.round((n / total) * width) : 0;
      return c(color, '█'.repeat(filled)) + c('dim', '░'.repeat(width - filled));
    };
    console.log(`\n${c('bold', 'Backlog Stats')}\n`);
    console.log(`  ${c('green',  '✓ Done        ')}  ${bar(s.done,       s.total, 'green' )}  ${c('green',  String(s.done).padStart(3))}`);
    console.log(`  ${c('yellow', '⏳ In-progress ')}  ${bar(s.inProgress, s.total, 'yellow')}  ${c('yellow', String(s.inProgress).padStart(3))}`);
    console.log(`  ${c('white',  '○ Pending     ')}  ${bar(s.pending,    s.total, 'white' )}  ${c('white',  String(s.pending).padStart(3))}`);
    console.log(`  ${c('red',    '✗ Blocked     ')}  ${bar(s.blocked,    s.total, 'red'   )}  ${c('red',    String(s.blocked).padStart(3))}`);
    console.log(`\n  ${c('dim', `Total: ${s.total} tasks`)}`);
    console.log('');
    break;
  }

  default:
    console.log(`
${c('bold', 'BlastSimulator2026 — Backlog')}

${c('bold', 'Usage:')} npx tsx scripts/backlog.ts <command> [options]

${c('bold', 'Commands:')}
  ${c('cyan', 'list')}   [--status <s>] [--chapter <n>]   List tasks grouped by chapter
  ${c('cyan', 'next')}                                     Show the next available task
  ${c('cyan', 'start')}  <id>                              Mark a task in-progress
  ${c('cyan', 'done')}   <id> [--pr <number>]              Mark a task done
  ${c('cyan', 'block')}  <id>                              Mark a task blocked
  ${c('cyan', 'reset')}  <id>                              Reset a task to pending
  ${c('cyan', 'stats')}                                    Show summary bar

${c('bold', 'Status values:')}  pending | in-progress | done | blocked
`);
    process.exit(1);
}
