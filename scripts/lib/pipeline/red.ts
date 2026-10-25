/**
 * BlastSimulator2026 — Reading a RED proof out of a Vitest JSON report
 *
 * RED means the new tests load, type-check and fail against the stubs. A file
 * that fails to load is not RED, it is broken: it would also "fail" against a
 * correct implementation. A file whose every test passes on the stubs is
 * allowed (a regression guard can legitimately pass before the change) but
 * named, so the test-writer looks at it twice.
 *
 * @module pipeline/red
 */

import { relative } from 'path';

interface VitestAssertion {
  fullName?: string;
  status?: string;
}

interface VitestFileResult {
  name?: string;
  status?: string;
  message?: string;
  assertionResults?: VitestAssertion[];
}

export interface VitestJsonReport {
  testResults?: VitestFileResult[];
}

interface RedFileSummary {
  file: string;
  total: number;
  failed: number;
  /** Set when the file never ran its tests: an import, syntax or setup error. */
  loadError?: string;
}

export interface RedVerdict {
  red: boolean;
  files: RedFileSummary[];
  /** Human-readable problems, one per line, empty when RED is proven. */
  problems: string[];
  /** Files that passed entirely on the stubs. Reported, not fatal. */
  passingOnStubs: string[];
}

/** Per-file counts for the files in `wanted`, read from a Vitest JSON report. */
export function summarizeVitest(report: VitestJsonReport, root: string, wanted: string[]): RedFileSummary[] {
  const byFile = new Map<string, VitestFileResult>();
  for (const result of report.testResults ?? []) {
    if (result.name) byFile.set(relative(root, result.name).split('\\').join('/'), result);
  }
  return wanted.map((file) => {
    const result = byFile.get(file);
    if (!result) return { file, total: 0, failed: 0, loadError: 'not in the Vitest report (not collected)' };
    const assertions = result.assertionResults ?? [];
    const failed = assertions.filter((a) => a.status === 'failed').length;
    if (assertions.length === 0 && result.status === 'failed') {
      const firstLine = (result.message ?? 'failed to load').split('\n').find((line) => line.trim() !== '');
      return { file, total: 0, failed: 0, loadError: firstLine?.trim() ?? 'failed to load' };
    }
    return { file, total: assertions.length, failed };
  });
}

/** Type errors `tsc` reported in any of `files`, one line each. */
export function typeErrorsIn(tscOutput: string, files: string[]): string[] {
  return tscOutput
    .split('\n')
    .filter((line) => files.some((file) => line.startsWith(`${file}(`) || line.startsWith(`${file}:`)))
    .map((line) => line.trim());
}

/**
 * The verdict on the new test files. `guards` are suites that must pass (the
 * scenario-definition validation, when scenario JSON changed): a definition
 * that fails validation is broken, not RED.
 */
export function judgeRed(files: RedFileSummary[], typeErrors: string[], guards: RedFileSummary[] = []): RedVerdict {
  const problems: string[] = [];
  if (files.length === 0) problems.push('no new Vitest file under tests/ — RED needs at least one failing test');
  for (const file of files) {
    if (file.loadError) problems.push(`${file.file}: did not load — ${file.loadError}`);
  }
  for (const guard of guards) {
    if (guard.loadError || guard.failed > 0) {
      problems.push(`${guard.file}: must pass and does not (${guard.loadError ?? `${guard.failed} failing`})`);
    }
  }
  problems.push(...typeErrors.map((line) => `type error: ${line}`));
  const failing = files.reduce((sum, file) => sum + file.failed, 0);
  if (files.length > 0 && failing === 0 && problems.length === 0) {
    problems.push('no new test fails against the stubs — nothing proves the behaviour is missing');
  }
  const passingOnStubs = files.filter((file) => !file.loadError && file.total > 0 && file.failed === 0).map((f) => f.file);
  return { red: problems.length === 0 && failing > 0, files, problems, passingOnStubs };
}
