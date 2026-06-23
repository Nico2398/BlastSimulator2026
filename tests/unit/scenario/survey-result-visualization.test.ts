// BlastSimulator2026 — Scenario test: survey result visualization (issue #386)
// Validates that the survey-result-visualization scenario definition is correct
// and that the overlay pipeline (GameState → confidence points → renderer) is connected.

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
const SCENARIO_NAME = 'survey-result-visualization';

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

describe('survey-result-visualization scenario definition', () => {
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

  it('description mentions overlay or visualization', () => {
    const scenario = loadScenario();
    const desc = scenario.description.toLowerCase();
    expect(desc).toMatch(/overlay|visual|render|display/);
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

// ── Overlay rendering validation ───────────────────────────────────────────

describe('survey-result-visualization — overlay rendering', () => {
  it('SurveyConfidenceOverlay can be instantiated with a THREE.Scene', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    expect(overlay).toBeInstanceOf(SurveyConfidenceOverlay);
    overlay.dispose();
  });

  it('overlay group is added to the scene on construction', () => {
    const scene = new THREE.Scene();
    expect(scene.children.length).toBe(0);
    const overlay = new SurveyConfidenceOverlay(scene);
    expect(scene.children.length).toBe(1);
    overlay.dispose();
  });

  it('overlay.show() makes the group visible', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.8, fresh: true },
    ];
    overlay.show({ points, opacity: 0.6 });
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(true);
    overlay.dispose();
  });

  it('overlay.hide() makes the group invisible', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.8, fresh: true },
    ];
    overlay.show({ points, opacity: 0.6 });
    overlay.hide();
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(false);
    overlay.dispose();
  });

  it('overlay.show() creates a mesh for each confidence point', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.8, fresh: true },
      { x: 10, z: 10, surfaceY: 6, confidence: 0.5, fresh: true },
      { x: 15, z: 15, surfaceY: 3, confidence: 0.3, fresh: false },
    ];
    overlay.show({ points, opacity: 0.6 });
    const group = scene.children[0] as THREE.Group;
    expect(group.children.length).toBe(3);
    overlay.dispose();
  });

  it('overlay.show() positions meshes at correct world coordinates', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 10, z: 20, surfaceY: 5, confidence: 0.9, fresh: true },
    ];
    overlay.show({ points, opacity: 0.7 });
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh.position.x).toBe(10);
    expect(mesh.position.z).toBe(20);
    expect(mesh.position.y).toBeCloseTo(5.05, 2); // surfaceY + offset
    overlay.dispose();
  });

  it('overlay.show() clears previous data before rendering new data', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);

    // First show
    const points1: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.8, fresh: true },
      { x: 10, z: 10, surfaceY: 4, confidence: 0.5, fresh: true },
    ];
    overlay.show({ points: points1, opacity: 0.5 });
    const countAfterFirst = (scene.children[0] as THREE.Group).children.length;

    // Second show with fewer points
    const points2: SurveyConfidencePoint[] = [
      { x: 15, z: 15, surfaceY: 4, confidence: 0.6, fresh: true },
    ];
    overlay.show({ points: points2, opacity: 0.5 });
    const countAfterSecond = (scene.children[0] as THREE.Group).children.length;

    // Should replace, not accumulate
    expect(countAfterSecond).toBe(1);
    expect(countAfterSecond).toBeLessThanOrEqual(countAfterFirst);
    overlay.dispose();
  });

  it('overlay.dispose() removes all children from the scene', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    overlay.show({
      points: [{ x: 5, z: 5, surfaceY: 4, confidence: 0.8, fresh: true }],
      opacity: 0.5,
    });
    overlay.dispose();
    expect(scene.children.length).toBe(0);
  });
});

// ── Visualization scenario coverage ────────────────────────────────────────

describe('survey-result-visualization — scenario coverage', () => {
  it('scenario runs all three survey methods for visualization comparison', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const hasSeismic = commands.some(c => c.includes('survey seismic'));
    const hasCoreSample = commands.some(c => c.includes('survey core_sample'));
    const hasAerial = commands.some(c => c.includes('survey aerial'));
    expect(hasSeismic).toBe(true);
    expect(hasCoreSample).toBe(true);
    expect(hasAerial).toBe(true);
  });

  it('scenario calls survey show after each survey to trigger overlay', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const showCount = commands.filter(c => c === 'survey show').length;
    // Should show after each method (3) plus initial/before states
    expect(showCount).toBeGreaterThanOrEqual(3);
  });

  it('scenario includes tick commands for survey completion', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const tickCount = commands.filter(c => c.startsWith('tick')).length;
    expect(tickCount).toBeGreaterThanOrEqual(4);
  });

  it('scenario ends with state inspection', () => {
    const scenario = loadScenario();
    const lastCmd = getCommand(scenario.steps[scenario.steps.length - 1]!);
    expect(lastCmd).toMatch(/state full|survey show/);
  });
});
