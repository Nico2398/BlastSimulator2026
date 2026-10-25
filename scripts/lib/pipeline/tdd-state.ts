/**
 * BlastSimulator2026 — TDD cycle state on disk
 *
 * One JSON file per label under `<main root>/.agentic/tdd/`, plus `blind.json`
 * while a blind phase is open. `blind.json` is the contract with the
 * `blind-to-tests.mjs` hook: while it exists, every session except the
 * test-writer is refused the tests worktree and the tests branch.
 *
 * `.agentic/` is gitignored — this is runner-local bookkeeping, never a
 * deliverable.
 *
 * @module pipeline/tdd-state
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

type TddPhase = 'skeleton' | 'tests' | 'red' | 'joining-tests' | 'joining-impl' | 'joined';

export interface TddState {
  label: string;
  issue: string;
  /** Branch the cycle started from (`main`, or the feature branch for a later multi section). */
  base: string;
  baseSha: string;
  implBranch: string;
  testsBranch: string;
  featureBranch: string;
  phase: TddPhase;
  /** The commit holding the stubs both sides build on. Set by `split`. */
  skeleton?: string;
  /** Absolute path of the test-writer's worktree. Set by `split`, cleared by `join`. */
  worktree?: string | undefined;
  /** The tests commit RED was proven on. Set by `red`; the reviewer's tamper audit diffs against it. */
  red?: string;
  /** Test files the RED commit added or changed. */
  redFiles?: string[];
  /** The feature branch head the join picks onto, and how many commits it picks. */
  joinFrom?: string;
  joinCommits?: number;
}

interface BlindMarker {
  label: string;
  testsBranch: string;
  worktree: string;
}

function tddDir(root: string): string {
  return join(root, '.agentic', 'tdd');
}

function statePath(root: string, label: string): string {
  return join(tddDir(root), `${label}.json`);
}

function blindPath(root: string): string {
  return join(tddDir(root), 'blind.json');
}

export function readState(root: string, label: string): TddState | undefined {
  const path = statePath(root, label);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as TddState) : undefined;
}

export function writeState(root: string, state: TddState): void {
  mkdirSync(tddDir(root), { recursive: true });
  writeFileSync(statePath(root, state.label), `${JSON.stringify(state, null, 2)}\n`);
}

export function readBlind(root: string): BlindMarker | undefined {
  const path = blindPath(root);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as BlindMarker) : undefined;
}

export function openBlindPhase(root: string, marker: BlindMarker): void {
  mkdirSync(tddDir(root), { recursive: true });
  writeFileSync(blindPath(root), `${JSON.stringify(marker, null, 2)}\n`);
}

export function closeBlindPhase(root: string): void {
  rmSync(blindPath(root), { force: true });
}
