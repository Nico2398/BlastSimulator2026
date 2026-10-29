/**
 * BlastSimulator2026 — Pipeline step boundaries
 *
 * `npm run pipeline -- step <name> [--heavy]` closes the step in flight — one
 * line in the plan's `## Progress` — and opens the next by writing
 * `.agentic/step.json` with its start time and whether it is heavy.
 * `compact-at-step-boundary.mjs` reads it to allow the lead's automatic
 * compaction only in the first requests of a step, and only when the step
 * ahead is heavy or the context is near full. `step done` closes the last.
 * The pipeline commands that start a step open it themselves (`stepFor`),
 * so those boundaries do not depend on the lead remembering to mark them.
 *
 * @module pipeline/steps
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { git, mainRoot } from './git.js';
import { isValidLabel } from './paths.js';

export class StepError extends Error {}

interface StepMarker {
  label: string;
  name: string;
  since: string;
  heavy: boolean;
}

function stepPath(root: string): string {
  return join(root, '.agentic', 'step.json');
}

function planPath(root: string, label: string): string {
  return join(root, '.agentic', 'plan', `${label}.md`);
}

function readStep(root: string): StepMarker | undefined {
  try {
    return JSON.parse(readFileSync(stepPath(root), 'utf8')) as StepMarker;
  } catch {
    return undefined;
  }
}

/** The plan text with `line` appended under `## Progress`, the section created if absent. */
export function withProgressLine(plan: string, line: string): string {
  const body = plan.endsWith('\n') || plan === '' ? plan : `${plan}\n`;
  const match = /(^|\n)## Progress\n/.exec(body);
  if (!match) return `${body}${body === '' ? '' : '\n'}## Progress\n${line}\n`;
  const next = body.indexOf('\n## ', match.index + match[0].length - 1);
  if (next === -1) return `${body}${line}\n`;
  return `${body.slice(0, next)}\n${line}${body.slice(next)}`;
}

function closeStep(root: string, note: string | undefined): string | undefined {
  const current = readStep(root);
  if (!current) return undefined;
  const sha = git(root, 'rev-parse', '--short', 'HEAD');
  const line = `- ${current.name} done — ${sha}${note ? ` — ${note}` : ''}`;
  const path = planPath(root, current.label);
  mkdirSync(join(root, '.agentic', 'plan'), { recursive: true });
  writeFileSync(path, withProgressLine(existsSync(path) ? readFileSync(path, 'utf8') : '', line));
  rmSync(stepPath(root), { force: true });
  return line;
}

/** Close the step in flight (if any) and open `name`; `name === 'done'` only closes. */
export function step(cwd: string, label: string, name: string, note?: string, heavy = false): string[] {
  if (!isValidLabel(label)) throw new StepError(`Invalid label ${label}.`);
  if (!/^[\w .:/-]{1,80}$/.test(name)) throw new StepError(`Invalid step name ${JSON.stringify(name)}: letters, digits, spaces and . : / - only.`);
  const root = mainRoot(cwd);
  const closed = closeStep(root, note);
  const lines = closed ? [`Progress: ${closed.slice(2)}`] : [];
  if (name === 'done') {
    lines.push('No step in flight.');
    return lines;
  }
  mkdirSync(join(root, '.agentic'), { recursive: true });
  const marker: StepMarker = { label, name, since: new Date().toISOString(), heavy };
  writeFileSync(stepPath(root), `${JSON.stringify(marker)}\n`);
  lines.push(`Step in flight: ${name}${heavy ? ' (heavy: compaction may run before it starts)' : ''}.`);
  return lines;
}

/** The step each pipeline command opens when it finishes. */
const COMMAND_STEPS = {
  'tdd start': { name: 'tdd: plan and skeleton', heavy: false },
  'tdd split': { name: 'tdd: implement', heavy: true },
  'tdd join': { name: 'verify and finalize', heavy: false },
  'review-brief': { name: 'review: apply findings', heavy: true },
} as const;

/** Close the step in flight and open the one `command` starts. */
export function stepFor(cwd: string, command: keyof typeof COMMAND_STEPS, label: string): string[] {
  const next = COMMAND_STEPS[command];
  return step(cwd, label, next.name, undefined, next.heavy);
}
