// BlastSimulator2026 — command-runner.ts unit coverage
//
// Covers the drift-report unit itself (issue #679): formatDriftReport,
// writeDriftReportFile, and runScenario's own driftRecords population.
// runSteps's wiring into a real game engine (drift suppresses .error,
// scenario runs to completion) is covered in
// tests/integration/scenario-expect.integration.test.ts — this file is the
// pure/IO-adjacent half.

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import {
  formatDriftReport,
  writeDriftReportFile,
  createGameEngine,
  runScenario,
  type DriftRecord,
} from '../../scripts/shared/command-runner.js';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';

const SAMPLE_RECORDS: DriftRecord[] = [
  {
    scenario: 'blast-basic',
    step: 2,
    command: 'blast',
    field: 'cash',
    goalType: 'equals',
    expected: 70000,
    actual: 80000,
  },
  {
    scenario: 'blast-basic',
    step: 4,
    command: 'employee hire role:driller',
    field: 'employeeCount',
    goalType: 'changedBy',
    expected: 1,
    actual: 2,
  },
];

describe('formatDriftReport', () => {
  it('produces a string containing scenario, step, field, expected, and actual for each record', () => {
    const report = formatDriftReport(SAMPLE_RECORDS);
    for (const rec of SAMPLE_RECORDS) {
      expect(report).toContain(rec.scenario);
      expect(report).toContain(String(rec.step));
      expect(report).toContain(rec.field);
      expect(report).toContain(String(rec.expected));
      expect(report).toContain(String(rec.actual));
    }
  });

  it('returns an empty-ish report (no crash, no leftover field text) for an empty record list', () => {
    const report = formatDriftReport([]);
    expect(typeof report).toBe('string');
    expect(report).not.toContain('undefined');
  });
});

describe('writeDriftReportFile', () => {
  it('writes valid JSON parseable back into the same records', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'bs2026-drift-report-'));
    const path = resolve(dir, 'drift-report.json');
    writeDriftReportFile(SAMPLE_RECORDS, path);
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(parsed).toEqual(SAMPLE_RECORDS);
  });
});

describe('runScenario — driftRecords (issue #679)', () => {
  it('populates ScenarioResult.driftRecords with scenario/step/command plus the GoalMismatch fields when reportDrift finds mismatches', () => {
    const engine = createGameEngine();
    const outDir = resolve(tmpdir(), `bs2026-run-scenario-drift-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const steps: ScenarioStepDef[] = [
      { command: 'new_game seed:42', expect: { equals: { cash: 1 } } },
    ];
    const result = runScenario(engine, 'drift-test-scenario', steps, outDir, true);

    expect(result.driftRecords).toBeDefined();
    expect(result.driftRecords!.length).toBeGreaterThan(0);
    const rec = result.driftRecords!.find(r => r.field === 'cash')!;
    expect(rec).toBeDefined();
    expect(rec.scenario).toBe('drift-test-scenario');
    expect(rec.step).toBe(0);
    expect(rec.command).toBe('new_game seed:42');
    expect(rec.goalType).toBe('equals');
    expect(rec.expected).toBe(1);
  });

  it('leaves driftRecords absent/empty when there are no mismatches', () => {
    const engine = createGameEngine();
    const outDir = resolve(tmpdir(), `bs2026-run-scenario-no-drift-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const steps: ScenarioStepDef[] = [
      { command: 'new_game seed:42', expect: { equals: { cash: 50000, buildingCount: 0 } } },
    ];
    const result = runScenario(engine, 'no-drift-test-scenario', steps, outDir, true);

    expect(result.driftRecords ?? []).toEqual([]);
  });
});
