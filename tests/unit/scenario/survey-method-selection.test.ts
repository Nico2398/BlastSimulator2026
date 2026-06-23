// BlastSimulator2026 — Scenario test: survey method selection (issue #386)
// Validates that the survey-method-selection scenario definition is correct
// and that the survey method selection pipeline (seismic/core_sample/aerial)
// produces correct console commands and state transitions.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(currentDir, '../../../scripts/scenario-defs');
const SCENARIO_NAME = 'survey-method-selection';

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

// ── Scenario definition validation ─────────────────────────────────────────

describe('survey-method-selection scenario definition', () => {
  it('JSON file exists on disk', () => {
    const filePath = resolve(SCENARIO_DIR, `${SCENARIO_NAME}.json`);
    expect(existsSync(filePath)).toBe(true);
  });

  it('parses as valid JSON', () => {
    const filePath = resolve(SCENARIO_DIR, `${SCENARIO_NAME}.json`);
    const raw = readFileSync(filePath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has required top-level fields: name, description, steps', () => {
    const scenario = loadScenario();
    expect(typeof scenario.name).toBe('string');
    expect(typeof scenario.description).toBe('string');
    expect(Array.isArray(scenario.steps)).toBe(true);
  });

  it('name matches filename', () => {
    const scenario = loadScenario();
    expect(scenario.name).toBe(SCENARIO_NAME);
  });

  it('description is meaningful (>20 chars)', () => {
    const scenario = loadScenario();
    expect(scenario.description.length).toBeGreaterThan(20);
  });

  it('has non-empty steps array', () => {
    const scenario = loadScenario();
    expect(scenario.steps.length).toBeGreaterThan(0);
  });

  it('has shots array with camera angles for visual inspection', () => {
    const scenario = loadScenario();
    expect(scenario.shots).toBeDefined();
    expect(Array.isArray(scenario.shots)).toBe(true);
    expect(scenario.shots!.length).toBeGreaterThan(0);
    for (const shot of scenario.shots!) {
      expect(typeof shot.name).toBe('string');
      expect(typeof shot.yaw).toBe('number');
      expect(typeof shot.pitch).toBe('number');
    }
  });
});

// ── Survey method command sequence validation ──────────────────────────────

describe('survey-method-selection — command sequence', () => {
  it('starts with new_game seed command', () => {
    const scenario = loadScenario();
    const firstCmd = getCommand(scenario.steps[0]!);
    expect(firstCmd).toMatch(/^new_game/);
  });

  it('includes campaign start before any survey commands', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const campaignIdx = commands.findIndex(c => c.startsWith('campaign'));
    const surveyIdx = commands.findIndex(c => c.startsWith('survey'));
    expect(campaignIdx).toBeGreaterThanOrEqual(0);
    expect(surveyIdx).toBeGreaterThan(campaignIdx);
  });

  it('hires a surveyor before running surveys', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const hireIdx = commands.findIndex(c => c.includes('employee hire role:surveyor'));
    const surveyIdx = commands.findIndex(c => c.startsWith('survey'));
    expect(hireIdx).toBeGreaterThanOrEqual(0);
    expect(hireIdx).toBeLessThan(surveyIdx);
  });

  it('assigns geology skill to surveyor', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const assignIdx = commands.findIndex(c => c.includes('employee assign_skill') && c.includes('geology'));
    expect(assignIdx).toBeGreaterThanOrEqual(0);
  });

  it('runs survey seismic command', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const seismicIdx = commands.findIndex(c => c.includes('survey seismic'));
    expect(seismicIdx).toBeGreaterThanOrEqual(0);
  });

  it('runs survey core_sample command', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const coreIdx = commands.findIndex(c => c.includes('survey core_sample'));
    expect(coreIdx).toBeGreaterThanOrEqual(0);
  });

  it('runs survey aerial command', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const aerialIdx = commands.findIndex(c => c.includes('survey aerial'));
    expect(aerialIdx).toBeGreaterThanOrEqual(0);
  });

  it('seismic survey runs before core_sample', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const seismicIdx = commands.findIndex(c => c.includes('survey seismic'));
    const coreIdx = commands.findIndex(c => c.includes('survey core_sample'));
    expect(seismicIdx).toBeLessThan(coreIdx);
  });

  it('core_sample survey runs before aerial', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const coreIdx = commands.findIndex(c => c.includes('survey core_sample'));
    const aerialIdx = commands.findIndex(c => c.includes('survey aerial'));
    expect(coreIdx).toBeLessThan(aerialIdx);
  });

  it('includes tick commands for survey completion wait', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const tickCount = commands.filter(c => c.startsWith('tick')).length;
    // Each survey takes time; need multiple tick commands
    expect(tickCount).toBeGreaterThanOrEqual(4);
  });

  it('calls survey show to display results', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const showIdx = commands.findIndex(c => c === 'survey show');
    expect(showIdx).toBeGreaterThanOrEqual(0);
  });

  it('calls state full for visual state inspection', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const stateCount = commands.filter(c => c === 'state full').length;
    expect(stateCount).toBeGreaterThan(0);
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

// ── Survey method selection integration ────────────────────────────────────

describe('survey-method-selection — method type validation', () => {
  it('scenario tests all three survey methods: seismic, core_sample, aerial', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const hasSeismic = commands.some(c => c.includes('survey seismic'));
    const hasCoreSample = commands.some(c => c.includes('survey core_sample'));
    const hasAerial = commands.some(c => c.includes('survey aerial'));
    expect(hasSeismic).toBe(true);
    expect(hasCoreSample).toBe(true);
    expect(hasAerial).toBe(true);
  });

  it('each survey command includes x and z coordinates', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const surveyCmds = commands.filter(c => c.match(/^survey (seismic|core_sample|aerial)/));
    for (const cmd of surveyCmds) {
      expect(cmd).toMatch(/x:\d+/);
      expect(cmd).toMatch(/z:\d+/);
    }
  });

  it('has sufficient steps for three surveys with completion waits', () => {
    const scenario = loadScenario();
    // 3 surveys × ~5 steps each (command + 4 ticks) + setup + show = ~25+
    expect(scenario.steps.length).toBeGreaterThanOrEqual(20);
  });
});
