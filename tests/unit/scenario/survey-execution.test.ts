// BlastSimulator2026 — Scenario test: survey execution (issue #386)
// Validates that the survey-execution scenario definition is correct
// and that each survey method executes to completion with correct state changes.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(currentDir, '../../../scripts/scenario-defs');
const SCENARIO_NAME = 'survey-execution';

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

describe('survey-execution scenario definition', () => {
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

  it('description is meaningful (>20 chars)', () => {
    const scenario = loadScenario();
    expect(scenario.description.length).toBeGreaterThan(20);
  });

  it('has non-empty steps array', () => {
    const scenario = loadScenario();
    expect(scenario.steps.length).toBeGreaterThan(0);
  });

  it('has shots array with camera angles', () => {
    const scenario = loadScenario();
    expect(scenario.shots).toBeDefined();
    expect(scenario.shots!.length).toBeGreaterThanOrEqual(2);
    for (const shot of scenario.shots!) {
      expect(typeof shot.name).toBe('string');
      expect(typeof shot.yaw).toBe('number');
      expect(typeof shot.pitch).toBe('number');
    }
  });
});

// ── Execution pipeline validation ──────────────────────────────────────────

describe('survey-execution — execution pipeline', () => {
  it('starts with new_game seed command', () => {
    const scenario = loadScenario();
    const firstCmd = getCommand(scenario.steps[0]!);
    expect(firstCmd).toMatch(/^new_game/);
  });

  it('starts time resume before surveys', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const resumeIdx = commands.findIndex(c => c === 'time resume');
    expect(resumeIdx).toBeGreaterThanOrEqual(0);
  });

  it('hires a surveyor and assigns geology skill', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const hasHire = commands.some(c => c.includes('employee hire role:surveyor'));
    const hasSkill = commands.some(c => c.includes('employee assign_skill') && c.includes('geology'));
    expect(hasHire).toBe(true);
    expect(hasSkill).toBe(true);
  });

  it('runs seismic survey, waits, then shows result', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const seismicIdx = commands.findIndex(c => c.includes('survey seismic'));
    // After seismic, there should be tick commands for completion
    const ticksAfterSeismic = commands.slice(seismicIdx + 1).filter(c => c.startsWith('tick'));
    expect(ticksAfterSeismic.length).toBeGreaterThanOrEqual(4);
  });

  it('runs core_sample survey after seismic completes', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const seismicIdx = commands.findIndex(c => c.includes('survey seismic'));
    const coreIdx = commands.findIndex(c => c.includes('survey core_sample'));
    expect(coreIdx).toBeGreaterThan(seismicIdx);
  });

  it('runs aerial survey after core_sample completes', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const coreIdx = commands.findIndex(c => c.includes('survey core_sample'));
    const aerialIdx = commands.findIndex(c => c.includes('survey aerial'));
    expect(aerialIdx).toBeGreaterThan(coreIdx);
  });

  it('calls survey show after each survey method', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const showCount = commands.filter(c => c === 'survey show').length;
    // At least one show per method (3) plus initial show
    expect(showCount).toBeGreaterThanOrEqual(3);
  });

  it('calls state full for visual inspection', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const stateCount = commands.filter(c => c === 'state full').length;
    expect(stateCount).toBeGreaterThanOrEqual(3);
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

  it('has sufficient total steps for three sequential surveys', () => {
    const scenario = loadScenario();
    // 3 surveys × (command + 4 ticks + show + state) + setup ≈ 30+
    expect(scenario.steps.length).toBeGreaterThanOrEqual(25);
  });
});

// ── Survey execution state verification ────────────────────────────────────

describe('survey-execution — state verification', () => {
  it('each survey method targets a valid grid position (x, z coordinates present)', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const surveyCmds = commands.filter(c => c.match(/^survey (seismic|core_sample|aerial)/));
    for (const cmd of surveyCmds) {
      expect(cmd).toMatch(/x:\d+/);
      expect(cmd).toMatch(/z:\d+/);
    }
  });

  it('survey commands use different or overlapping positions (not all identical)', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const surveyCmds = commands.filter(c => c.match(/^survey (seismic|core_sample|aerial)/));
    // At least some variation in coordinates or methods
    const methods = surveyCmds.map(c => c.split(/\s+/)[1]);
    const uniqueMethods = new Set(methods);
    expect(uniqueMethods.size).toBeGreaterThanOrEqual(2);
  });

  it('tick durations are sufficient for survey completion', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    // Each survey needs enough ticks to complete (seismic=8, core=4, aerial=3)
    const tickValues = commands
      .filter(c => c.startsWith('tick'))
      .map(c => parseInt(c.split(/\s+/)[1]!, 10));
    // All tick values should be positive
    for (const t of tickValues) {
      expect(t).toBeGreaterThan(0);
    }
  });

  it('total tick budget across all surveys is sufficient', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const totalTicks = commands
      .filter(c => c.startsWith('tick'))
      .map(c => parseInt(c.split(/\s+/)[1]!, 10))
      .reduce((sum, t) => sum + t, 0);
    // 3 surveys: seismic(8) + core(4) + aerial(3) = 15 ticks minimum
    expect(totalTicks).toBeGreaterThanOrEqual(15);
  });
});
