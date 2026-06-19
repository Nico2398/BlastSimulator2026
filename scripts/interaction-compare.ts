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

import type {
  CompareResult,
  ScreenshotDiff,
  StateDiff,
} from './interaction-types.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

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

// ── Helpers ──

/**
 * Parses the step index from a filename like "step-00-click.png" or "step-01-keydown.json".
 *
 * @param filename - The filename to extract the step index from.
 * @returns The step index as a number, or -1 if not found.
 */
function parseStepIndex(filename: string): number {
  const match = filename.match(/^step-(\d+)-/);
  if (!match) return -1;
  return parseInt(match[1]!, 10);
}

/**
 * Recursively compares two arrays and returns field-level diffs.
 *
 * @param baseline - The baseline array.
 * @param target - The target array to compare against.
 * @param prefix - Current field path prefix (for nested indices).
 * @returns Array of field-level diffs.
 */
function compareArrays(
  baseline: unknown[],
  target: unknown[],
  prefix: string,
): StateDiff[] {
  const diffs: StateDiff[] = [];
  const maxLen = Math.max(baseline.length, target.length);

  for (let i = 0; i < maxLen; i++) {
    const bVal = baseline[i];
    const tVal = target[i];
    if (bVal === undefined && tVal === undefined) continue;
    const nestedDiffs = deepDiff(bVal, tVal, `${prefix}[${i}]`);
    diffs.push(...nestedDiffs);
  }

  return diffs;
}

/**
 * Recursively compares two plain objects and returns field-level diffs.
 *
 * @param baseline - The baseline object.
 * @param target - The target object to compare against.
 * @param prefix - Current field path prefix (for nested fields).
 * @returns Array of field-level diffs.
 */
function compareObjects(
  baseline: Record<string, unknown>,
  target: Record<string, unknown>,
  prefix: string,
): StateDiff[] {
  const diffs: StateDiff[] = [];
  const allKeys = new Set([...Object.keys(baseline), ...Object.keys(target)]);

  for (const key of allKeys) {
    const bVal = baseline[key];
    const tVal = target[key];

    if (bVal === undefined && tVal === undefined) continue;

    const fieldPath = prefix ? `${prefix}.${key}` : key;
    const nestedDiffs = deepDiff(bVal, tVal, fieldPath);
    diffs.push(...nestedDiffs);
  }

  return diffs;
}

/**
 * Deeply compares two JSON values and returns field-level diffs.
 * Handles primitives, objects, arrays, and null/undefined values.
 *
 * @param baseline - The baseline value.
 * @param target - The target value to compare against.
 * @param prefix - Current field path prefix (for nested fields).
 * @returns Array of field-level diffs.
 */
function deepDiff(
  baseline: unknown,
  target: unknown,
  prefix: string = '',
): StateDiff[] {
  const diffs: StateDiff[] = [];

  // Both are the same reference or value (including both null/undefined)
  if (baseline === target) return diffs;

  // One is null/undefined and the other is not
  if (baseline === null || baseline === undefined || target === null || target === undefined) {
    diffs.push({
      stepIndex: 0,
      field: prefix || '(root)',
      baselineValue: baseline,
      targetValue: target,
    });
    return diffs;
  }

  // Different types
  if (typeof baseline !== typeof target) {
    diffs.push({
      stepIndex: 0,
      field: prefix || '(root)',
      baselineValue: baseline,
      targetValue: target,
    });
    return diffs;
  }

  // Both are objects (including arrays)
  if (typeof baseline === 'object' && typeof target === 'object') {
    if (Array.isArray(baseline) && Array.isArray(target)) {
      return compareArrays(baseline, target, prefix);
    }
    // Both are plain objects
    return compareObjects(
      baseline as Record<string, unknown>,
      target as Record<string, unknown>,
      prefix,
    );
  }

  // Primitive values that differ
  if (baseline !== target) {
    diffs.push({
      stepIndex: 0,
      field: prefix || '(root)',
      baselineValue: baseline,
      targetValue: target,
    });
  }

  return diffs;
}

/**
 * Compares two screenshot PNG buffers and returns an estimated pixel
 * difference percentage. Uses byte-level buffer comparison.
 *
 * @param baselineBuffer - The baseline PNG file buffer.
 * @param targetBuffer - The target PNG file buffer.
 * @returns Percentage of bytes that differ (0-100).
 */
function comparePngBuffers(baselineBuffer: Buffer, targetBuffer: Buffer): number {
  if (baselineBuffer.length === 0 && targetBuffer.length === 0) return 0;
  if (baselineBuffer.length === 0 || targetBuffer.length === 0) return 100;

  const minLen = Math.min(baselineBuffer.length, targetBuffer.length);
  const maxLen = Math.max(baselineBuffer.length, targetBuffer.length);

  // Count differing bytes in the overlapping portion
  let differingBytes = 0;
  for (let i = 0; i < minLen; i++) {
    if (baselineBuffer[i] !== targetBuffer[i]) {
      differingBytes++;
    }
  }

  // The extra bytes in the longer buffer count as differences
  differingBytes += maxLen - minLen;

  // Calculate percentage relative to the larger file
  return (differingBytes / maxLen) * 100;
}

/**
 * Compares two state JSON objects and returns field-level diffs.
 *
 * @param stepIndex - The step index these states belong to.
 * @param baselineData - The parsed baseline JSON object.
 * @param targetData - The parsed target JSON object.
 * @returns Array of field-level StateDiff entries.
 */
function compareStateJson(
  stepIndex: number,
  baselineData: Record<string, unknown>,
  targetData: Record<string, unknown>,
): StateDiff[] {
  const rawDiffs = deepDiff(baselineData, targetData);
  return rawDiffs.map((d) => ({ ...d, stepIndex }));
}

/**
 * Scans a directory for step files, returning a map of step index to filename.
 *
 * @param dir - Directory to scan.
 * @param extension - File extension to filter by (e.g. 'png' or 'json').
 * @returns Map of step index to filename.
 */
function scanStepFiles(dir: string, extension: string): Map<number, string> {
  const result = new Map<number, string>();

  if (!existsSync(dir)) return result;

  const files = readdirSync(dir);
  for (const file of files) {
    if (!file.endsWith(`.${extension}`)) continue;
    const stepIdx = parseStepIndex(file);
    if (stepIdx >= 0) {
      // Only keep the first occurrence per step (the main step file)
      if (!result.has(stepIdx)) {
        result.set(stepIdx, file);
      }
    }
  }

  return result;
}

/**
 * Determines pass/fail based on max pixel diff and state diffs.
 *
 * @param maxPixelDiffPercent - The maximum pixel diff percentage across all screenshots.
 * @param stateDiffCount - Total number of state field diffs found.
 * @param threshold - Pixel diff threshold (as a fraction, e.g. 0.01 for 1%).
 * @returns True if all checks pass.
 */
function computePassFail(
  maxPixelDiffPercent: number,
  stateDiffCount: number,
  threshold: number,
): boolean {
  return maxPixelDiffPercent <= threshold * 100 && stateDiffCount === 0;
}

// ── Functions ──

/**
 * Parses CLI arguments into a CompareOptions object.
 * Supports --baseline, --target, --output, --threshold flags.
 * Exits with code 1 on invalid or missing arguments.
 *
 * @returns Parsed compare options.
 */
export function parseCompareArgs(): CompareOptions {
  const args = process.argv.slice(2);
  let baselineDir = '';
  let targetDir = '';
  let outputDir = 'compare-results';
  let threshold: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--baseline' && i + 1 < args.length) {
      baselineDir = args[++i]!;
    } else if (arg === '--target' && i + 1 < args.length) {
      targetDir = args[++i]!;
    } else if (arg === '--output' && i + 1 < args.length) {
      outputDir = args[++i]!;
    } else if (arg === '--threshold' && i + 1 < args.length) {
      threshold = parseFloat(args[++i]!);
    }
  }

  if (!baselineDir || !targetDir) {
    console.error('ERROR: --baseline and --target are required');
    process.exit(1);
  }

  const result: CompareOptions = { baselineDir, targetDir, outputDir, threshold: threshold ?? 0.01 };
  return result;
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
  const baselineDir = resolve(process.cwd(), options.baselineDir);
  const targetDir = resolve(process.cwd(), options.targetDir);
  const outputDir = resolve(process.cwd(), options.outputDir);

  const threshold = options.threshold ?? 0.01;

  // Validate directories exist
  if (!existsSync(baselineDir)) {
    throw new Error(`Baseline directory not found: ${baselineDir}`);
  }
  if (!existsSync(targetDir)) {
    throw new Error(`Target directory not found: ${targetDir}`);
  }

  mkdirSync(outputDir, { recursive: true });

  // Scan for PNG and JSON files in both directories
  const baselinePngs = scanStepFiles(baselineDir, 'png');
  const targetPngs = scanStepFiles(targetDir, 'png');
  const baselineJsons = scanStepFiles(baselineDir, 'json');
  const targetJsons = scanStepFiles(targetDir, 'json');

  // Collect all unique step indices from both PNG and JSON files
  const allStepIndices = new Set<number>();
  for (const idx of [...baselinePngs.keys(), ...targetPngs.keys(), ...baselineJsons.keys(), ...targetJsons.keys()]) {
    allStepIndices.add(idx);
  }

  const sortedStepIndices = [...allStepIndices].sort((a, b) => a - b);
  const totalSteps = Math.max(sortedStepIndices.length, 1);
  const screenshotDiffs: ScreenshotDiff[] = [];
  const stateDiffs: StateDiff[] = [];

  for (const stepIdx of sortedStepIndices) {
    // ── Compare Screenshots ──
    const baselinePngFile = baselinePngs.get(stepIdx);
    const targetPngFile = targetPngs.get(stepIdx);

    if (baselinePngFile && targetPngFile) {
      const baselinePath = resolve(baselineDir, baselinePngFile);
      const targetPath = resolve(targetDir, targetPngFile);

      const baselineBuffer = readFileSync(baselinePath);
      const targetBuffer = readFileSync(targetPath);

      const pixelDiffPercent = comparePngBuffers(baselineBuffer, targetBuffer);

      const diff: ScreenshotDiff = {
        stepIndex: stepIdx,
        baselineFile: baselinePngFile,
        targetFile: targetPngFile,
        pixelDiffPercent,
      };

      if (pixelDiffPercent > 0) {
        // Generate a simple diff indicator (just log for now)
        diff.diffImagePath = undefined;
        console.log(`  Step ${stepIdx} screenshot diff: ${pixelDiffPercent.toFixed(4)}%`);
      }

      screenshotDiffs.push(diff);
    } else if (baselinePngFile && !targetPngFile) {
      console.warn(`  Step ${stepIdx}: missing target screenshot (baseline has ${baselinePngFile})`);
    } else if (!baselinePngFile && targetPngFile) {
      console.warn(`  Step ${stepIdx}: missing baseline screenshot (target has ${targetPngFile})`);
    }

    // ── Compare State JSONs ──
    const baselineJsonFile = baselineJsons.get(stepIdx);
    const targetJsonFile = targetJsons.get(stepIdx);

    if (baselineJsonFile && targetJsonFile) {
      const baselinePath = resolve(baselineDir, baselineJsonFile);
      const targetPath = resolve(targetDir, targetJsonFile);

      const baselineRaw = readFileSync(baselinePath, 'utf-8');
      const targetRaw = readFileSync(targetPath, 'utf-8');

      let baselineData: Record<string, unknown>;
      let targetData: Record<string, unknown>;

      try {
        baselineData = JSON.parse(baselineRaw) as Record<string, unknown>;
        targetData = JSON.parse(targetRaw) as Record<string, unknown>;
      } catch {
        console.warn(`  Step ${stepIdx}: could not parse state JSON in one or both directories`);
        continue;
      }

      const stepStateDiffs = compareStateJson(stepIdx, baselineData, targetData);
      stateDiffs.push(...stepStateDiffs);

      if (stepStateDiffs.length > 0) {
        console.log(`  Step ${stepIdx} state diffs: ${stepStateDiffs.length}`);
        for (const d of stepStateDiffs) {
          console.log(`    ${d.field}: ${JSON.stringify(d.baselineValue)} \u2192 ${JSON.stringify(d.targetValue)}`);
        }
      }
    }
  }

  // Determine pass/fail
  const maxPixelDiff = screenshotDiffs.reduce(
    (max, d) => Math.max(max, d.pixelDiffPercent),
    0,
  );
  const pass = computePassFail(maxPixelDiff, stateDiffs.length, threshold);

  // Count matched vs diverged
  const divergedScreenshots = screenshotDiffs.filter((d) => d.pixelDiffPercent > 0).length;
  const matchedSteps = screenshotDiffs.length - divergedScreenshots;

  const result: CompareResult = {
    totalSteps,
    matchedSteps,
    divergedSteps: divergedScreenshots + stateDiffs.length,
    screenshotDiffs,
    stateDiffs,
    reportPath: resolve(outputDir, 'compare-report.json'),
    pass,
  };

  // Save report
  mkdirSync(outputDir, { recursive: true });
  const reportPath = resolve(outputDir, 'compare-report.json');
  writeFileSync(reportPath, JSON.stringify(result, null, 2));
  console.log(`\nComparison complete. Report: ${reportPath}`);
  console.log(`Total steps: ${totalSteps}, Matched: ${matchedSteps}, Diverged: ${result.divergedSteps}`);
  console.log(`Result: ${pass ? 'PASS' : 'FAIL'} (threshold: ${threshold * 100}%)`);

  return result;
}

/**
 * Entry point for CLI execution. Parses arguments and starts comparison.
 */
async function main(): Promise<void> {
  const options = parseCompareArgs();
  await compareDirectories(options);
}

// ── CLI Entry ──

// Only run main() when executed directly, not when imported by tests
if (!process.env.VITEST) {
  main().catch((err: unknown) => {
    console.error('Comparison failed:', err);
    process.exit(1);
  });
}
