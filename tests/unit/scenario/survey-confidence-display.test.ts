// BlastSimulator2026 — Scenario test: survey confidence display (issue #386)
// Validates that the survey-confidence-display scenario definition is correct
// and that confidence markers with colour-coded indicators render correctly.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';

import {
  SurveyConfidenceOverlay,
  confidenceToColor,
} from '../../../src/renderer/SurveyConfidenceOverlay.js';
import type {
  SurveyConfidencePoint,
  SurveyConfidenceOverlayOptions,
} from '../../../src/renderer/SurveyConfidenceOverlay.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = resolve(currentDir, '../../../scripts/scenario-defs');
const SCENARIO_NAME = 'survey-confidence-display';

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

describe('survey-confidence-display scenario definition', () => {
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

  it('description mentions confidence, colour, or indicators', () => {
    const scenario = loadScenario();
    const desc = scenario.description.toLowerCase();
    expect(desc).toMatch(/confidence|colour|color|indicator|green|yellow|red|marker/);
  });

  it('has shots array for visual verification', () => {
    const scenario = loadScenario();
    expect(scenario.shots).toBeDefined();
    expect(scenario.shots!.length).toBeGreaterThanOrEqual(1);
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

// ── Confidence color mapping validation ────────────────────────────────────

describe('confidenceToColor — color mapping', () => {
  it('confidence 1.0 maps to green (0, 1, 0)', () => {
    const color = confidenceToColor(1.0);
    expect(color.r).toBeCloseTo(0, 5);
    expect(color.g).toBeCloseTo(1, 5);
    expect(color.b).toBeCloseTo(0, 5);
  });

  it('confidence 0.0 maps to red (1, 0, 0)', () => {
    const color = confidenceToColor(0.0);
    expect(color.r).toBeCloseTo(1, 5);
    expect(color.g).toBeCloseTo(0, 5);
    expect(color.b).toBeCloseTo(0, 5);
  });

  it('confidence 0.5 maps to yellow (1, 1, 0)', () => {
    const color = confidenceToColor(0.5);
    expect(color.r).toBeCloseTo(1, 5);
    expect(color.g).toBeCloseTo(1, 5);
    expect(color.b).toBeCloseTo(0, 5);
  });

  it('confidence 0.25 maps to orange (1, 0.5, 0)', () => {
    const color = confidenceToColor(0.25);
    expect(color.r).toBeCloseTo(1, 5);
    expect(color.g).toBeCloseTo(0.5, 5);
    expect(color.b).toBeCloseTo(0, 5);
  });

  it('confidence 0.75 maps to yellow-green (0.5, 1, 0)', () => {
    const color = confidenceToColor(0.75);
    expect(color.r).toBeCloseTo(0.5, 5);
    expect(color.g).toBeCloseTo(1, 5);
    expect(color.b).toBeCloseTo(0, 5);
  });

  it('confidence values outside [0,1] are clamped', () => {
    const colorHigh = confidenceToColor(1.5);
    const colorLow = confidenceToColor(-0.5);
    // Should not crash and should produce valid colors
    expect(colorHigh.r).toBeGreaterThanOrEqual(0);
    expect(colorHigh.g).toBeGreaterThanOrEqual(0);
    expect(colorLow.r).toBeGreaterThanOrEqual(0);
    expect(colorLow.g).toBeGreaterThanOrEqual(0);
  });
});

// ── Confidence display with multiple points ────────────────────────────────

describe('confidence display — multiple surveyors', () => {
  it('scenario hires two surveyors with different skill levels', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const hireCount = commands.filter(c => c.includes('employee hire role:surveyor')).length;
    expect(hireCount).toBeGreaterThanOrEqual(2);
  });

  it('scenario assigns different geology skill levels', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const skillAssigns = commands.filter(c => c.includes('employee assign_skill') && c.includes('geology'));
    expect(skillAssigns.length).toBeGreaterThanOrEqual(2);
  });

  it('scenario runs surveys at multiple positions', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const surveyCmds = commands.filter(c => c.match(/^survey (seismic|core_sample|aerial)/));
    expect(surveyCmds.length).toBeGreaterThanOrEqual(3);
  });

  it('scenario calls survey show to display all confidence markers', () => {
    const scenario = loadScenario();
    const commands = scenario.steps.map(getCommand);
    const showIdx = commands.findIndex(c => c === 'survey show');
    expect(showIdx).toBeGreaterThanOrEqual(0);
  });
});

// ── Overlay with mixed confidence levels ───────────────────────────────────

describe('confidence display — mixed confidence overlay', () => {
  it('overlay renders green markers for high confidence points', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.95, fresh: true },
    ];
    overlay.show({ points, opacity: 1.0 });
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    // High confidence → green dominant
    expect(mat.color.g).toBeGreaterThan(mat.color.r);
    overlay.dispose();
  });

  it('overlay renders yellow markers for medium confidence points', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.5, fresh: true },
    ];
    overlay.show({ points, opacity: 1.0 });
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    // Medium confidence → yellow (r=1, g=1, b=0)
    expect(mat.color.r).toBeCloseTo(1, 1);
    expect(mat.color.g).toBeCloseTo(1, 1);
    expect(mat.color.b).toBeCloseTo(0, 1);
    overlay.dispose();
  });

  it('overlay renders red markers for low confidence points', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.1, fresh: true },
    ];
    overlay.show({ points, opacity: 1.0 });
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    // Low confidence → red dominant
    expect(mat.color.r).toBeGreaterThan(mat.color.g);
    overlay.dispose();
  });

  it('overlay renders grey markers for stale points regardless of confidence', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.9, fresh: false },
    ];
    overlay.show({ points, opacity: 0.6 });
    const group = scene.children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    // Stale → grey (all channels ~0.5)
    expect(mat.color.r).toBeCloseTo(0.5, 1);
    expect(mat.color.g).toBeCloseTo(0.5, 1);
    expect(mat.color.b).toBeCloseTo(0.5, 1);
    overlay.dispose();
  });

  it('overlay renders mixed colors when points have varying confidence', () => {
    const scene = new THREE.Scene();
    const overlay = new SurveyConfidenceOverlay(scene);
    const points: SurveyConfidencePoint[] = [
      { x: 5, z: 5, surfaceY: 4, confidence: 0.95, fresh: true },   // green
      { x: 10, z: 10, surfaceY: 4, confidence: 0.5, fresh: true },   // yellow
      { x: 15, z: 15, surfaceY: 4, confidence: 0.1, fresh: true },   // red
      { x: 20, z: 20, surfaceY: 4, confidence: 0.8, fresh: false },  // grey
    ];
    overlay.show({ points, opacity: 0.7 });
    const group = scene.children[0] as THREE.Group;
    expect(group.children.length).toBe(4);

    // Verify each mesh has different color characteristics
    const colors = group.children.map(child => {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      return { r: mat.color.r, g: mat.color.g, b: mat.color.b };
    });

    // First point (green): g > r
    expect(colors[0]!.g).toBeGreaterThan(colors[0]!.r);
    // Third point (red): r > g
    expect(colors[2]!.r).toBeGreaterThan(colors[2]!.g);

    overlay.dispose();
  });
});
