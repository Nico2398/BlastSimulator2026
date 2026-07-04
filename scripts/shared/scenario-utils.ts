/**
 * BlastSimulator2026 — Shared Scenario Utilities
 *
 * Common functions used by scenario-test.ts, command-runner.ts,
 * and run-all-scenarios.ts to avoid code duplication.
 *
 * @module shared/scenario-utils
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { ScenarioDef } from './scenario-types.js';

export const SCENARIO_DIR = resolve(import.meta.dirname ?? process.cwd(), '..', 'scenario-defs');

/**
 * Format a zero-padded step index (e.g., 0 → "00", 12 → "12").
 */
export function formatStepIndex(i: number): string {
  return String(i).padStart(2, '0');
}

/**
 * Extract a filesystem-safe slug from a command string.
 * Takes the first token and strips non-alphanumeric characters.
 */
export function formatCommandSlug(command: string): string {
  return command.split(/\s+/)[0]!.replace(/[^a-z0-9_-]/gi, '');
}

/**
 * Report entry generated from scenario step results.
 */
export interface ReportEntry {
  step: number;
  command: string;
  output: string;
  error?: string;
  warning?: string;
  holes: number;
  charged: number;
  sequenced: number;
  screenshot?: string;
}

/**
 * Minimal step result needed for report building.
 */
export interface ReportableStep {
  step: number;
  command: string;
  commandOutput: string;
  error?: string;
  warning?: string;
  gameState: { holeCount?: number; chargedCount?: number; sequencedCount?: number } | null;
  screenshotPath?: string;
}

const MAX_REPORT_OUTPUT = 2000;

/**
 * Build a report array from step results, truncating large commandOutput
 * strings to avoid V8 string length limits in JSON.stringify.
 * Full output is preserved in per-step state JSON files.
 */
export function buildScenarioReport(results: ReportableStep[]): ReportEntry[] {
  return results.map(r => ({
    step: r.step,
    command: r.command,
    output: r.commandOutput.length > MAX_REPORT_OUTPUT
      ? r.commandOutput.slice(0, MAX_REPORT_OUTPUT) + `... [truncated, ${r.commandOutput.length} chars total]`
      : r.commandOutput,
    ...(r.error !== undefined ? { error: r.error } : {}),
    ...(r.warning !== undefined ? { warning: r.warning } : {}),
    holes: r.gameState?.holeCount ?? 0,
    charged: r.gameState?.chargedCount ?? 0,
    sequenced: r.gameState?.sequencedCount ?? 0,
    ...(r.screenshotPath !== undefined ? { screenshot: r.screenshotPath } : {}),
  }));
}

/**
 * Load a scenario definition from disk.
 * Returns the full ScenarioDef including steps and optional shots.
 */
export function loadScenarioDef(name: string, dir?: string): ScenarioDef {
  const scenarioDir = dir ?? SCENARIO_DIR;
  const defPath = resolve(scenarioDir, `${name}.json`);
  if (!existsSync(defPath)) {
    throw new Error(`Scenario not found: ${defPath}`);
  }
  return JSON.parse(readFileSync(defPath, 'utf-8')) as ScenarioDef;
}
