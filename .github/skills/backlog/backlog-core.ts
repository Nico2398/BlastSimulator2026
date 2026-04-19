/**
 * BlastSimulator2026 — Backlog Core
 *
 * Shared data model and operations used by both the agent CLI
 * (.github/skills/backlog/backlog.ts) and the user CLI (scripts/backlog.ts).
 *
 * No external dependencies — only Node built-ins.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to backlog.json, co-located with this file. */
export const BACKLOG_PATH = resolve(__dirname, 'backlog.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'blocked';

export interface BacklogTask {
  id: string;
  chapter: number;
  title: string;
  files: string[];
  testFile: string | null;
  status: TaskStatus;
  blockedBy: string[];
  closedInPR: number | null;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

export function loadBacklog(): BacklogTask[] {
  if (!existsSync(BACKLOG_PATH)) {
    console.error(`backlog.json not found at ${BACKLOG_PATH}`);
    console.error('Run the populate script or create the file manually.');
    process.exit(1);
  }
  const raw = readFileSync(BACKLOG_PATH, 'utf-8');
  return JSON.parse(raw) as BacklogTask[];
}

export function saveBacklog(tasks: BacklogTask[]): void {
  writeFileSync(BACKLOG_PATH, JSON.stringify(tasks, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function findTask(tasks: BacklogTask[], id: string): BacklogTask | undefined {
  return tasks.find(t => t.id === id);
}

/** Returns tasks whose blockedBy IDs are all resolved (done). */
export function resolvedBlockers(tasks: BacklogTask[], task: BacklogTask): boolean {
  const doneIds = new Set(tasks.filter(t => t.status === 'done').map(t => t.id));
  return task.blockedBy.every(id => doneIds.has(id));
}

/**
 * Returns the next pending task whose blockers are all resolved,
 * ordered by chapter then original array position.
 */
export function getNextTask(tasks: BacklogTask[]): BacklogTask | undefined {
  return tasks
    .filter(t => t.status === 'pending' && resolvedBlockers(tasks, t))
    .sort((a, b) => a.chapter - b.chapter)[0];
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function setStatus(
  tasks: BacklogTask[],
  id: string,
  status: TaskStatus,
  closedInPR?: number,
): BacklogTask[] {
  const task = findTask(tasks, id);
  if (!task) {
    console.error(`Task ${id} not found.`);
    process.exit(1);
  }
  task.status = status;
  if (closedInPR !== undefined) {
    task.closedInPR = closedInPR;
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface BacklogStats {
  done: number;
  inProgress: number;
  pending: number;
  blocked: number;
  total: number;
}

export function computeStats(tasks: BacklogTask[]): BacklogStats {
  return {
    done: tasks.filter(t => t.status === 'done').length,
    inProgress: tasks.filter(t => t.status === 'in-progress').length,
    pending: tasks.filter(t => t.status === 'pending').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
    total: tasks.length,
  };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export function filterTasks(
  tasks: BacklogTask[],
  opts: { status?: TaskStatus; chapter?: number },
): BacklogTask[] {
  let result = tasks;
  if (opts.status) result = result.filter(t => t.status === opts.status);
  if (opts.chapter !== undefined) result = result.filter(t => t.chapter === opts.chapter);
  return result;
}
