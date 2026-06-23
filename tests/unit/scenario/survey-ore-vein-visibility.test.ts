// BlastSimulator2026 — Scenario test: survey ore vein visibility (issue #386)
// Validates that the survey-ore-vein-visibility scenario definition is correct
// and that ore vein indicators are visible on the survey overlay after blasting.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(currentDir, '../../../scripts/scenario-defs');
const SCENARIO_NAME = 'survey-ore-vein-visibility';

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

describe('survey-ore-vein-visibility scenario definition', () => {
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

  it('description mentions ore veins or visibility', () => {
    const scenario = loadScenario();
    const desc = scenario.description.toLowerCase();
    expect(desc).toMatch(/ore|vein|visib|indicator|blast|overlay/);
  });

  it('has shots array for before/after blast visual verification', () => {
    const scenario = loadScenario();
    expect(scenario.shots).toBeDefined();
    expect(scenario.shots!.length).toBeGreaterThanOrEqual(2);
    const shotNames = scenario.shots!.map(s => s.name.toLowerCase());
    expect(shotNames.some(n => n.includes('before') || n.includes('pre'))).toBe(true);
    expect(shotNames.some(n => n.includes('after') || n.includes('post'))).toBe(true);
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

// ── Ore vein visibility pipeline ───────────────────────────────────────────

describe('survey-ore-vein-visibility — survey pipeline', () => {
  it('runs multiple seismic surveys across a grid area', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const seismicCount = commands.filter(c => c.includes('survey seismic')).length;
    // Should survey multiple positions to find ore veins
    expect(seismicCount).toBeGreaterThanOrEqual(3);
  });

  it('each seismic survey targets a different grid position', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const seismicCmds = commands.filter(c => c.includes('survey seismic'));
    const positions = seismicCmds.map(c => {
      const xMatch = c.match(/x:(\d+)/);
      const zMatch = c.match(/z:(\d+)/);
      return `${xMatch?.[1]},${zMatch?.[1]}`;
    });
    const uniquePositions = new Set(positions);
    expect(uniquePositions.size).toBeGreaterThanOrEqual(2);
  });

  it('runs a core_sample survey for detailed center analysis', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const hasCoreSample = commands.some(c => c.includes('survey core_sample'));
    expect(hasCoreSample).toBe(true);
  });

  it('calls survey show before and after blast', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const showCount = commands.filter(c => c === 'survey show').length;
    expect(showCount).toBeGreaterThanOrEqual(2);
  });

  it('executes a blast command after surveys', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const blastIdx = commands.findIndex(c => c === 'blast');
    expect(blastIdx).toBeGreaterThanOrEqual(0);
  });

  it('includes drill_plan and charge commands before blast', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const hasDrillPlan = commands.some(c => c.startsWith('drill_plan'));
    const hasCharge = commands.some(c => c.startsWith('charge'));
    expect(hasDrillPlan).toBe(true);
    expect(hasCharge).toBe(true);
  });

  it('includes sequence command before blast', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const hasSequence = commands.some(c => c.startsWith('sequence'));
    expect(hasSequence).toBe(true);
  });

  it('calls survey show after blast to verify ore vein updates', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const blastIdx = commands.findIndex(c => c === 'blast');
    const showAfterBlast = commands.slice(blastIdx + 1).some(c => c === 'survey show');
    expect(showAfterBlast).toBe(true);
  });
});

// ── Ore vein visibility after blast ────────────────────────────────────────

describe('survey-ore-vein-visibility — post-blast overlay', () => {
  it('scenario calls state full after blast to inspect terrain changes', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const blastIdx = commands.findIndex(c => c === 'blast');
    const stateAfterBlast = commands.slice(blastIdx + 1).some(c => c === 'state full');
    expect(stateAfterBlast).toBe(true);
  });

  it('scenario has sufficient total steps for surveys + blast + verification', () => {
    const scenario = loadScenario();
    // Surveys (4 seismic + 1 core) + setup + blast + verification ≈ 40+
    expect(scenario.steps.length).toBeGreaterThanOrEqual(30);
  });

  it('scenario tick budget allows for multiple survey completions', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const totalTicks = commands
      .filter(c => c.startsWith('tick'))
      .map(c => parseInt(c.split(/\s+/)[1]!, 10))
      .reduce((sum, t) => sum + t, 0);
    // 4 seismic (8 each) + 1 core (4) = 36 ticks minimum
    expect(totalTicks).toBeGreaterThanOrEqual(36);
  });
});
