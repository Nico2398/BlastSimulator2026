/**
 * BlastSimulator2026 — Interaction Comparison Tool
 *
 * Compares baseline vs target replay output directories to detect visual
 * and state differences. Produces a structured CompareResult with per-step
 * pixel diff percentages, state field diffs, and an overall pass/fail.
 *
 * Usage:
 *   npx tsx scripts/interaction-compare.ts --baseline screenshots/replay-v1 --target screenshots/replay-v2
 *   npx tsx scripts/interaction-compare.ts --baseline ... --target ... --threshold 0.05
 *   npx tsx scripts/interaction-compare.ts --baseline ... --target ... --output compare-results
 *
 * Output: {outputDir}/compare-report.json
 *
 * @module interaction-compare
 */

import type { CompareResult } from './interaction-types.js';

// ── Options ──

/**
 * Options for configuring the comparison tool.
 */
export interface CompareOptions {
  /** Directory containing baseline screenshots and state dumps. */
  baselineDir: string;
  /** Directory containing target (new) screenshots and state dumps. */
  targetDir: string;
  /** Directory to write comparison report and diff images. */
  outputDir: string;
  /** Pixel diff percent threshold for pass/fail (default 0.01 = 1%). */
  threshold?: number;
}

// ── Functions ──

/**
 * Parses CLI arguments into a CompareOptions object.
 * Supports --baseline, --target, --output, --threshold flags.
 * Exits with code 1 on invalid or missing arguments.
 */
export function parseCompareArgs(): CompareOptions {
  throw new Error('Not implemented');
}

/**
 * Compares all step files (screenshots and state JSON) between a baseline
 * and a target replay output directory. Produces per-step diffs and an
 * overall CompareResult.
 *
 * @param options - Comparison configuration.
 * @returns A promise that resolves to the CompareResult.
 */
export async function compareDirectories(options: CompareOptions): Promise<CompareResult> {
  throw new Error('Not implemented');
}

/**
 * Entry point for CLI execution. Parses arguments and starts comparison.
 */
async function main(): Promise<void> {
  throw new Error('Not implemented');
}

// ── CLI Entry ──

main().catch((err: unknown) => {
  console.error('Comparison failed:', err);
  process.exit(1);
});
