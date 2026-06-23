// BlastSimulator2026 — Scenario test: survey stale handling (issue #386)
// Validates that the survey-stale-handling scenario definition is correct
// and that stale surveys are visually distinguished from fresh ones.

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
import { isSurveyStale } from '../../../src/core/mining/SurveyCalc.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(currentDir, '../../../scripts/scenario-defs');
const SCENARIO_NAME = 'survey-stale-handling';

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

function makeSurvey(completedTick: number): SurveyResult {
  return {
    id: 1,
    method: 'seismic',
    centerX: 20,
    centerZ: 20,
    completedTick,
    surveyorId: 99,
    estimates: { '20,20': { gold: 0.5 } },
    confidence: 0.85,
  };
}

// ── Scenario definition validation ─────────────────────────────────────────

describe('survey-stale-handling scenario definition', () => {
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

  it('description mentions stale, expiry, or grey', () => {
    const scenario = loadScenario();
    const desc = scenario.description.toLowerCase();
    expect(desc).toMatch(/stale|expir|grey|gray|refresh|age|obsolete/);
  });

  it('has shots array for visual verification', () => {
    const scenario = loadScenario();
    expect(scenario.shots).toBeDefined();
    expect(scenario.shots!.length).toBeGreaterThanOrEqual(2);
    // Should have shots for fresh, stale, and refreshed states
    const shotNames = scenario.shots!.map(s => s.name.toLowerCase());
    expect(shotNames.some(n => n.includes('fresh'))).toBe(true);
    expect(shotNames.some(n => n.includes('stale'))).toBe(true);
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

// ── Stale handling pipeline validation ─────────────────────────────────────

describe('survey-stale-handling — stale detection', () => {
  it('survey completed at tick 0 is fresh at tick 100', () => {
    const survey = makeSurvey(0);
    expect(isSurveyStale(survey, 100)).toBe(false);
  });

  it('survey completed at tick 0 is stale at tick 101', () => {
    const survey = makeSurvey(0);
    expect(isSurveyStale(survey, 101)).toBe(true);
  });

  it('fresh survey has fresh=true in confidence points', () => {
    const survey = makeSurvey(50);
    const fresh = !isSurveyStale(survey, 100);
    expect(fresh).toBe(true);
  });

  it('stale survey has fresh=false in confidence points', () => {
    const survey = makeSurvey(0);
    const fresh = !isSurveyStale(survey, 200);
    expect(fresh).toBe(false);
  });
});

// ── Stale visual rendering ─────────────────────────────────────────────────

describe('survey-stale-handling — stale visual rendering', () => {
  it('fresh survey renders with confidence-coloured marker', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.85, fresh: true },
    ];
    overlay.show({ points, opacity: 0.6 });
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    // High confidence → green dominant (g > r)
    expect(mat.color.g).toBeGreaterThan(mat.color.r);
    overlay.dispose();
  });

  it('stale survey renders with grey marker', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.85, fresh: false },
    ];
    overlay.show({ points, opacity: 0.6 });
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    // Grey → all channels ~0.5
    expect(mat.color.r).toBeCloseTo(0.5, 1);
    expect(mat.color.g).toBeCloseTo(0.5, 1);
    expect(mat.color.b).toBeCloseTo(0.5, 1);
    overlay.dispose();
  });

  it('stale survey renders with lower opacity than fresh survey', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);

    // Fresh point
    const freshPoints: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.8, fresh: true },
    ];
    overlay.show({ points: freshPoints, opacity: 0.7 });
    const group = scene.children[0] as THREE.Group;
    const freshMesh = group.children[0] as THREE.Mesh;
    const freshMat = freshMesh.material as THREE.MeshBasicMaterial;
    const freshOpacity = freshMat.opacity;

    // Stale point
    const stalePoints: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.8, fresh: false },
    ];
    overlay.show({ points: stalePoints, opacity: 0.7 });
    const staleMesh = group.children[0] as THREE.Mesh;
    const staleMat = staleMesh.material as THREE.MeshBasicMaterial;
    const staleOpacity = staleMat.opacity;

    // Stale should have lower effective opacity (0.25 multiplier)
    expect(staleOpacity).toBeLessThan(freshOpacity);
    overlay.dispose();
  });

  it('mixed fresh and stale surveys render different visual markers', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.85, fresh: true },
      { x: 10, z: 10, surfaceY: 4, confidence: 0.85, fresh: false },
    ];
    overlay.show({ points, opacity: 0.6 });
    const group = scene.children[0] as THREE.Group;
    expect(group.children.length).toBe(2);

    // Fresh point should be green-dominant
    const freshMesh = group.children[0] as THREE.Mesh;
    const freshMat = freshMesh.material as THREE.MeshBasicMaterial;
    expect(freshMat.color.g).toBeGreaterThan(freshMat.color.r);

    // Stale point should be grey
    const staleMesh = group.children[1] as THREE.Mesh;
    const staleMat = staleMesh.material as THREE.MeshBasicMaterial;
    expect(staleMat.color.r).toBeCloseTo(0.5, 1);

    overlay.dispose();
  });
});

// ── Stale handling scenario flow ───────────────────────────────────────────

describe('survey-stale-handling — scenario flow', () => {
  it('scenario runs initial survey and waits for stale expiry', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const tickCount = commands.filter(c => c.startsWith('tick')).length;
    // Must tick past 100 ticks to make survey stale
    expect(tickCount).toBeGreaterThanOrEqual(8);
  });

  it('scenario runs a second survey after staleness to refresh', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const surveyCount = commands.filter(c => c.match(/^survey (seismic|core_sample|aerial)/)).length;
    expect(surveyCount).toBeGreaterThanOrEqual(2);
  });

  it('scenario calls survey show to display stale and refreshed states', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const showCount = commands.filter(c => c === 'survey show').length;
    // Should show: fresh, stale, refreshed
    expect(showCount).toBeGreaterThanOrEqual(3);
  });

  it('scenario has shots for fresh, stale, and refreshed states', () => {
    const scenario = loadScenario();
    expect(scenario.shots).toBeDefined();
    const shotNames = scenario.shots!.map(s => s.name.toLowerCase());
    expect(shotNames.some(n => n.includes('fresh'))).toBe(true);
    expect(shotNames.some(n => n.includes('stale'))).toBe(true);
    expect(shotNames.some(n => n.includes('refresh') || n.includes('new'))).toBe(true);
  });
});
