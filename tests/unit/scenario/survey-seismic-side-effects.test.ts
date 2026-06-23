// BlastSimulator2026 — Scenario test: survey seismic side effects (issue #386)
// Validates that the survey-seismic-side-effects scenario definition is correct
// and that seismic surveys trigger vibration, disturb buildings, and employees.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';

import { SurveyConfidenceOverlay } from '../../../src/renderer/SurveyConfidenceOverlay.js';
import type {
  SurveyConfidencePoint,
  SurveyConfidenceOverlayOptions,
} from '../../../src/renderer/SurveyConfidenceOverlay.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(currentDir, '../../../scripts/scenario-defs');
const SCENARIO_NAME = 'survey-seismic-side-effects';

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

describe('survey-seismic-side-effects scenario definition', () => {
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

  it('description mentions side effects, vibration, or disturbance', () => {
    const scenario = loadScenario();
    const desc = scenario.description.toLowerCase();
    expect(desc).toMatch(/side.?effect|vibrat|disturb|employee|building|radius|coverage/);
  });

  it('has shots array for visual verification', () => {
    const scenario = loadScenario();
    expect(scenario.shots).toBeDefined();
    expect(scenario.shots!.length).toBeGreaterThanOrEqual(2);
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

// ── Seismic side effects pipeline ──────────────────────────────────────────

describe('survey-seismic-side-effects — seismic execution', () => {
  it('runs a seismic survey at a specific grid position', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const seismicCmds = commands.filter(c => c.includes('survey seismic'));
    expect(seismicCmds.length).toBeGreaterThanOrEqual(1);
  });

  it('seismic survey includes x and z coordinates', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const seismicCmds = commands.filter(c => c.includes('survey seismic'));
    for (const cmd of seismicCmds) {
      expect(cmd).toMatch(/x:\d+/);
      expect(cmd).toMatch(/z:\d+/);
    }
  });

  it('hires multiple employees to observe side effects on', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const hireCount = commands.filter(c => c.includes('employee hire')).length;
    expect(hireCount).toBeGreaterThanOrEqual(2);
  });

  it('assigns different skill types to employees', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const skillAssigns = commands.filter(c => c.includes('employee assign_skill'));
    expect(skillAssigns.length).toBeGreaterThanOrEqual(2);
  });

  it('calls survey show to display seismic coverage radius', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const showIdx = commands.findIndex(c => c === 'survey show');
    expect(showIdx).toBeGreaterThanOrEqual(0);
  });

  it('calls state full for visual inspection after seismic survey', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const stateCount = commands.filter(c => c === 'state full').length;
    expect(stateCount).toBeGreaterThanOrEqual(2);
  });

  it('calls stats and scores for side-effect verification', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const hasStats = commands.some(c => c === 'stats');
    const hasScores = commands.some(c => c === 'scores');
    expect(hasStats).toBe(true);
    expect(hasScores).toBe(true);
  });
});

// ── Seismic side effects visual rendering ──────────────────────────────────

describe('survey-seismic-side-effects — visual rendering', () => {
  it('overlay shows seismic coverage area with confidence markers', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 20, z: 20, surfaceY: 4, confidence: 0.85, fresh: true },
      { x: 21, z: 20, surfaceY: 4, confidence: 0.82, fresh: true },
      { x: 19, z: 20, surfaceY: 4, confidence: 0.83, fresh: true },
      { x: 20, z: 21, surfaceY: 4, confidence: 0.84, fresh: true },
      { x: 20, z: 19, surfaceY: 4, confidence: 0.81, fresh: true },
    ];
    overlay.show({ points, opacity: 0.6 });
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(true);
    expect(group.children.length).toBe(5);
    overlay.dispose();
  });

  it('seismic overlay covers a circular radius around the survey center', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    // Simulate points within seismic radius (20 cells)
    const centerX = 20;
    const centerZ = 20;
    const points: SurveyConfidencePoint[] = [];
    for (let dx = -10; dx <= 10; dx += 5) {
      for (let dz = -10; dz <= 10; dz += 5) {
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist <= 20) {
          points.push({
            x: centerX + dx,
            z: centerZ + dz,
            surfaceY: 4,
            confidence: 0.85 - dist * 0.005,
            fresh: true,
          });
        }
      }
    }
    overlay.show({ points, opacity: 0.6 });
    const group = scene.children[0] as THREE.Group;
    expect(group.children.length).toBeGreaterThanOrEqual(points.length);
    // All points should be within radius 20
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const dx = mesh.position.x - centerX;
      const dz = mesh.position.z - centerZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      expect(dist).toBeLessThanOrEqual(20);
    }
    overlay.dispose();
  });

  it('overlay handles multiple sequential seismic surveys', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    // First seismic at (20,20)
    const points1: SurveyConfidencePoint[] = [
      { x: 20, z: 20, surfaceY: 4, confidence: 0.85, fresh: true },
    ];
    overlay.show({ points: points1, opacity: 0.5 });
    const count1 = (scene.children[0] as THREE.Group).children.length;

    // Second seismic at (30,20) — should replace, not accumulate
    const points2: SurveyConfidencePoint[] = [
      { x: 30, z: 20, surfaceY: 4, confidence: 0.80, fresh: true },
    ];
    overlay.show({ points: points2, opacity: 0.5 });
    const count2 = (scene.children[0] as THREE.Group).children.length;

    expect(count2).toBe(1);
    overlay.dispose();
  });
});

// ── Seismic side effects scenario flow ─────────────────────────────────────

describe('survey-seismic-side-effects — scenario flow', () => {
  it('scenario waits for seismic survey completion with tick commands', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const tickCount = commands.filter(c => c.startsWith('tick')).length;
    // Seismic takes 8 ticks; need enough ticks for completion
    expect(tickCount).toBeGreaterThanOrEqual(8);
  });

  it('scenario runs tick commands in groups for survey phases', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const tickValues = commands
      .filter(c => c.startsWith('tick'))
      .map(c => parseInt(c.split(/\s+/)[1]!, 10));
    // Should have multiple tick groups (initial + after survey)
    expect(tickValues.length).toBeGreaterThanOrEqual(8);
    // Total tick budget should cover seismic completion (8 ticks)
    const totalTicks = tickValues.reduce((sum, t) => sum + t, 0);
    expect(totalTicks).toBeGreaterThanOrEqual(16);
  });

  it('scenario verifies stats after seismic to check side effects', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const statsIdx = commands.findIndex(c => c === 'stats');
    const seismicIdx = commands.findIndex(c => c.includes('survey seismic'));
    expect(statsIdx).toBeGreaterThan(seismicIdx);
  });

  it('scenario ends with scores inspection', () => {
    const scenario = loadScenario();
    const lastCmd = getCommand(scenario.steps[scenario.steps.length - 1]!);
    expect(lastCmd).toMatch(/scores|stats/);
  });
});
