/**
 * BlastSimulator2026 — Playtest definition loading
 *
 * Kept separate from the runner so tests can validate the definitions without
 * launching a browser.
 *
 * @module shared/playtest-utils
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import type { PlaytestDef } from './playtest-types.js';

export const PLAYTEST_DIR = resolve(process.cwd(), 'scripts/playtests');

/** File names of every playtest definition, sorted. */
export function playtestFiles(dir: string = PLAYTEST_DIR): string[] {
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort();
}

/** Load one definition by file name. */
export function loadPlaytestFile(file: string, dir: string = PLAYTEST_DIR): PlaytestDef {
  return JSON.parse(readFileSync(resolve(dir, file), 'utf-8')) as PlaytestDef;
}

/** Load every definition, optionally filtered by a substring of its name. */
export function loadPlaytests(filter?: string, dir: string = PLAYTEST_DIR): PlaytestDef[] {
  const defs = playtestFiles(dir).map(f => loadPlaytestFile(f, dir));
  return filter ? defs.filter(d => d.name.includes(filter)) : defs;
}
