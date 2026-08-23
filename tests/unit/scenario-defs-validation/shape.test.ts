import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { ScenarioDef, ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import {
  ALL_SCENARIO_NAMES,
  PLAYTHROUGH_SCENARIO_NAMES,
  VISUAL_SCENARIO_NAMES,
  INSPECTION_COMMANDS,
} from './fixtures.js';

// Generic existence/shape checks (scenario JSON parses, required fields,
// step shape, etc.) — split out of the former scenario-defs.test.ts (#703).

// ──────────────────────────────────────────────
// 1. File existence & valid JSON
// ──────────────────────────────────────────────
describe('Scenario JSON files exist and parse', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — JSON file exists on disk`, () => {
      const filePath = resolve(SCENARIO_DIR, `${name}.json`);
      expect(existsSync(filePath)).toBe(true);
    });

    it(`${name} — parses as valid JSON`, () => {
      const filePath = resolve(SCENARIO_DIR, `${name}.json`);
      const raw = readFileSync(filePath, 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  }
});

// ──────────────────────────────────────────────
// 2. Required fields
// ──────────────────────────────────────────────
describe('Scenario has required top-level fields', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — has "name" field (string)`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      expect(scenario).toHaveProperty('name');
      expect(typeof scenario.name).toBe('string');
    });

    it(`${name} — has "description" field (string)`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      expect(scenario).toHaveProperty('description');
      expect(typeof scenario.description).toBe('string');
    });

    it(`${name} — has "steps" field (array)`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      expect(scenario).toHaveProperty('steps');
      expect(Array.isArray(scenario.steps)).toBe(true);
    });
  }
});

// ──────────────────────────────────────────────
// 3. name matches filename
// ──────────────────────────────────────────────
describe('Scenario name matches filename', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — JSON name field matches filename`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      expect(scenario.name).toBe(name);
    });
  }
});

// ──────────────────────────────────────────────
// 4. Steps array is not empty
// ──────────────────────────────────────────────
describe('Scenario steps are non-empty', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — has non-empty steps array`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      expect(scenario.steps.length).toBeGreaterThan(0);
    });
  }
});

// ──────────────────────────────────────────────
// 5. Minimum step count for playthrough
// ──────────────────────────────────────────────
describe('Playthrough scenarios have sufficient steps', () => {
  for (const name of PLAYTHROUGH_SCENARIO_NAMES) {
    it(`${name} — has at least 15 steps`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      expect(scenario.steps.length).toBeGreaterThanOrEqual(15);
    });
  }
});

// ──────────────────────────────────────────────
// 6. All steps are objects with command field (strings not allowed after dual-play conversion)
// ──────────────────────────────────────────────
describe('All steps are objects with command field', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — every step is an object with a command field (no plain strings)`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        expect(typeof step !== 'string',
          `step[${i}] is a plain string "${step}". All steps must be objects with a command field.`,
        ).toBe(true);
        const isStepObj = typeof step === 'object' && step !== null && typeof (step as ScenarioStepDef).command === 'string';
        expect(
          isStepObj,
          `step[${i}] should be an object with a command field, got ${typeof step}`,
        ).toBe(true);
      }
    });
  }
});

// ──────────────────────────────────────────────
// 7a. frames/interval fields are valid positive integers
// ──────────────────────────────────────────────
describe('Step frames/interval fields are valid', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — frames and interval are positive integers when present`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'object' && step !== null) {
          const s = step as ScenarioStepDef;
          if (s.frames !== undefined) {
            expect(Number.isInteger(s.frames), `step[${i}] frames must be integer`).toBe(true);
            expect(s.frames, `step[${i}] frames must be > 0`).toBeGreaterThan(0);
          }
          if (s.interval !== undefined) {
            expect(Number.isInteger(s.interval), `step[${i}] interval must be integer`).toBe(true);
            expect(s.interval, `step[${i}] interval must be > 0`).toBeGreaterThan(0);
          }
        }
      }
    });
  }
});

// ──────────────────────────────────────────────
// 7b. Description is meaningful (>20 chars)
// ──────────────────────────────────────────────
describe('Scenario description is meaningful', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — description length > 20 characters`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      expect(scenario.description.length).toBeGreaterThan(20);
    });
  }
});

// ──────────────────────────────────────────────
// 9. Last step is a state inspection command
// ──────────────────────────────────────────────
describe('Playthrough last step is a state inspection command', () => {
  for (const name of PLAYTHROUGH_SCENARIO_NAMES) {
    it(`${name} — final step is an inspection command`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      const lastStep = scenario.steps[scenario.steps.length - 1];
      const cmdStr = typeof lastStep === 'string' ? lastStep : (lastStep as any).command;
      const firstToken = cmdStr.trim().split(/\s+/)[0];
      expect(
        INSPECTION_COMMANDS,
        `last step: "${cmdStr}" — "${firstToken}" is not an inspection command`,
      ).toContain(firstToken);
    });
  }
});

// ──────────────────────────────────────────────
// 10. Visual scenarios have valid shots array
// ──────────────────────────────────────────────
describe('Visual scenarios have valid shots array', () => {
  for (const name of VISUAL_SCENARIO_NAMES) {
    it(`${name} — shots array contains objects with name, yaw, pitch`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR) as ScenarioDef;
      expect(scenario.shots).toBeDefined();
      expect(Array.isArray(scenario.shots)).toBe(true);
      expect(scenario.shots!.length).toBeGreaterThan(0);
      for (const shot of scenario.shots!) {
        expect(typeof shot.name).toBe('string');
        expect(typeof shot.yaw).toBe('number');
        expect(typeof shot.pitch).toBe('number');
      }
    });
  }
});
