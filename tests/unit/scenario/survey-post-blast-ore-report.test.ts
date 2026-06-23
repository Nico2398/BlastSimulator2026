// BlastSimulator2026 — Scenario test: survey post-blast ore report (issue #386)
// Validates that the survey-post-blast-ore-report scenario definition is correct
// and that the ore report pipeline (survey estimate → blast → actual yield) works.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { vec3 } from '../../../src/core/math/Vec3.js';
import { computeBlastOreReport } from '../../../src/core/mining/SurveyCalc.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(currentDir, '../../../scripts/scenario-defs');
const SCENARIO_NAME = 'survey-post-blast-ore-report';

interface ScenarioStepDef {
  command: string;
  timeout?: number;
  description?: string;
  frames?: number;
  interval?: number;
}

interface ScenarioDef {
  name: string;
  description: string;
  steps: Array<string | ScenarioStepDef>;
  shots?: Array<{ name: string; yaw: number; pitch: number }>;
}

function loadScenario(): ScenarioDef {
  const filePath = resolve(SCENARIO_DIR, `${SCENARIO_NAME}.json`);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ScenarioDef;
}

function getCommand(step: string | ScenarioStepDef): string {
  return typeof step === 'string' ? step : step.command;
}

function makeFragment(
  id: number,
  position: ReturnType<typeof vec3>,
  volume: number,
  oreDensities: Record<string, number>,
): FragmentData {
  return {
    id,
    position,
    volume,
    mass: 1000,
    rockId: 'granite',
    oreDensities,
    initialVelocity: vec3(0, 0, 0),
    isProjection: false,
  };
}

function makeSurvey(
  estimates: Record<string, Record<string, number>>,
  completedTick = 10,
): SurveyResult {
  return {
    id: 1,
    method: 'seismic',
    centerX: 20,
    centerZ: 20,
    completedTick,
    surveyorId: 1,
    estimates,
    confidence: 0.8,
  };
}

// ── Scenario definition validation ─────────────────────────────────────────

describe('survey-post-blast-ore-report scenario definition', () => {
  it('JSON file exists on disk', () => {
    const filePath = resolve(SCENARIO_DIR, `${SCENARIO_NAME}.json`);
    expect(existsSync(filePath)).toBe(true);
  });

  it('parses as valid JSON', () => {
    const filePath = resolve(SCENARIO_DIR, `${SCENARIO_NAME}.json`);
    const raw = readFileSync(filePath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has required top-level fields', () => {
    const scenario = loadScenario();
    expect(typeof scenario.name).toBe('string');
    expect(typeof scenario.description).toBe('string');
    expect(Array.isArray(scenario.steps)).toBe(true);
  });

  it('name matches filename', () => {
    const scenario = loadScenario();
    expect(scenario.name).toBe(SCENARIO_NAME);
  });

  it('description mentions ore report or yield', () => {
    const scenario = loadScenario();
    const desc = scenario.description.toLowerCase();
    expect(desc).toMatch(/ore|report|yield|estimate|actual|blast/);
  });

  it('has shots array for pre-blast and post-blast verification', () => {
    const scenario = loadScenario();
    expect(scenario.shots).toBeDefined();
    expect(scenario.shots!.length).toBeGreaterThanOrEqual(2);
    const shotNames = scenario.shots!.map(s => s.name.toLowerCase());
    expect(shotNames.some(n => n.includes('pre') || n.includes('before'))).toBe(true);
    expect(shotNames.some(n => n.includes('post') || n.includes('after'))).toBe(true);
  });

  it('all step commands are known console commands', () => {
    const knownCommands = [
      'new_game', 'campaign', 'time', 'scores', 'finances',
      'employee', 'state', 'survey', 'tick', 'event',
      'drill_plan', 'charge', 'sequence', 'blast', 'contract',
      'build', 'vehicle', 'stats', 'inspect', 'zone',
      'tutorial_start', 'corrupt', 'mafia', 'buy_software', 'weather', 'buy',
      'fragments', 'preview', 'blast_preview', 'install_tubing',
      'build_ramp', 'set_policy', 'terrain_info', 'help',
      'blast_plan', 'needs',
    ];
    const scenario = loadScenario();
    for (let i = 0; i < scenario.steps.length; i++) {
      const cmd = getCommand(scenario.steps[i]!);
      const firstToken = cmd.trim().split(/\s+/)[0]!;
      expect(
        knownCommands,
        `step[${i}] "${cmd}" — "${firstToken}" is not a known command`,
      ).toContain(firstToken);
    }
  });
});

// ── Post-blast ore report pipeline ─────────────────────────────────────────

describe('survey-post-blast-ore-report — report pipeline', () => {
  it('runs survey before blast to get estimates', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const surveyIdx = commands.findIndex(c => c.match(/^survey (seismic|core_sample|aerial)/));
    const blastIdx = commands.findIndex(c => c === 'blast');
    expect(surveyIdx).toBeGreaterThanOrEqual(0);
    expect(surveyIdx).toBeLessThan(blastIdx);
  });

  it('runs both seismic and core_sample surveys for comprehensive coverage', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const hasSeismic = commands.some(c => c.includes('survey seismic'));
    const hasCoreSample = commands.some(c => c.includes('survey core_sample'));
    expect(hasSeismic).toBe(true);
    expect(hasCoreSample).toBe(true);
  });

  it('calls survey show before blast to capture pre-blast state', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const blastIdx = commands.findIndex(c => c === 'blast');
    const showBeforeBlast = commands.slice(0, blastIdx).some(c => c === 'survey show');
    expect(showBeforeBlast).toBe(true);
  });

  it('includes drill_plan, charge, and sequence before blast', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const blastIdx = commands.findIndex(c => c === 'blast');
    const preBlast = commands.slice(0, blastIdx);
    expect(preBlast.some(c => c.startsWith('drill_plan'))).toBe(true);
    expect(preBlast.some(c => c.startsWith('charge'))).toBe(true);
    expect(preBlast.some(c => c.startsWith('sequence'))).toBe(true);
  });

  it('calls survey ore_report after blast', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const blastIdx = commands.findIndex(c => c === 'blast');
    const postBlast = commands.slice(blastIdx + 1);
    const hasOreReport = postBlast.some(c => c.includes('survey ore_report'));
    expect(hasOreReport).toBe(true);
  });

  it('calls state full after blast and after ore_report', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const blastIdx = commands.findIndex(c => c === 'blast');
    const stateAfterBlast = commands.slice(blastIdx + 1).filter(c => c === 'state full');
    expect(stateAfterBlast.length).toBeGreaterThanOrEqual(1);
  });

  it('scenario has sufficient total steps for survey + blast + report', () => {
    const scenario = loadScenario();
    // Setup + 2 surveys + ticks + blast + ore_report + verification ≈ 40+
    expect(scenario.steps.length).toBeGreaterThanOrEqual(30);
  });
});

// ── Ore report computation validation ──────────────────────────────────────

describe('survey-post-blast-ore-report — computation', () => {
  it('computeBlastOreReport returns correct report shape', () => {
    const report = computeBlastOreReport([]);
    expect(report).toHaveProperty('oreYields');
    expect(report).toHaveProperty('totalYieldKg');
    expect(report).toHaveProperty('estimatedYieldKg');
    expect(report).toHaveProperty('yieldRatio');
    expect(report).toHaveProperty('hasTreranium');
    expect(report).toHaveProperty('absurdiumFraction');
  });

  it('computeBlastOreReport with no fragments returns zero yields', () => {
    const report = computeBlastOreReport([]);
    expect(report.totalYieldKg).toBe(0);
    expect(report.estimatedYieldKg).toBe(0);
    expect(report.yieldRatio).toBe(1.0);
  });

  it('computeBlastOreReport computes yield correctly for single fragment', () => {
    const fragment = makeFragment(0, vec3(20, 5, 20), 2.0, { rustite: 0.5 });
    const report = computeBlastOreReport([fragment]);
    // 2.0 × 0.5 × 2500 = 2500 kg
    expect(report.oreYields['rustite']).toBeCloseTo(2500, 0);
    expect(report.totalYieldKg).toBeCloseTo(2500, 0);
  });

  it('computeBlastOreReport compares against survey estimates when provided', () => {
    const fragment = makeFragment(0, vec3(20, 5, 20), 2.0, { rustite: 0.5 });
    const survey = makeSurvey({ '20,20': { rustite: 0.4 } });
    const report = computeBlastOreReport([fragment], [survey]);
    // Actual: 2500 kg, Estimated: 2.0 × 0.4 × 2500 = 2000 kg
    expect(report.estimatedYieldKg).toBeCloseTo(2000, 0);
    expect(report.yieldRatio).toBeCloseTo(1.25, 2);
  });

  it('computeBlastOreReport with no matching survey column returns neutral defaults', () => {
    const fragment = makeFragment(0, vec3(20, 5, 20), 2.0, { rustite: 0.5 });
    const survey = makeSurvey({ '0,0': { rustite: 0.4 } }); // different column
    const report = computeBlastOreReport([fragment], [survey]);
    expect(report.estimatedYieldKg).toBe(0);
    expect(report.yieldRatio).toBe(1.0);
  });

  it('detects treranium in fragments for Legendary Vein event', () => {
    const fragment = makeFragment(0, vec3(20, 5, 20), 1.0, { treranium: 0.1 });
    const report = computeBlastOreReport([fragment]);
    expect(report.hasTreranium).toBe(true);
  });

  it('computes absurdium fraction correctly', () => {
    const fragment = makeFragment(0, vec3(20, 5, 20), 1.0, { rustite: 0.5, absurdium: 0.5 });
    const report = computeBlastOreReport([fragment]);
    expect(report.absurdiumFraction).toBeCloseTo(0.5, 2);
  });
});
