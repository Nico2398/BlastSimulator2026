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
// 7a-2. repeat field is a valid positive integer when present (#696) — same
// pattern as frames/interval above: a real scenario file's own `repeat`
// (once one adopts it, e.g. converting blast-execution-visual.json's 24
// duplicate `employee hire role:driller` steps into one `repeat: 24` block)
// must be a positive integer, checked at JSON-authoring time before any
// runner ever loads the file. resolveRepeatCount (scenario-utils.ts) applies
// the identical positive-integer check at run time; this is the same rule
// caught earlier, as a lint over the files on disk.
// ──────────────────────────────────────────────
describe('Step repeat field is a valid positive integer when present (#696)', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — repeat is a positive integer when present`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'object' && step !== null) {
          const s = step as ScenarioStepDef;
          if (s.repeat !== undefined) {
            expect(Number.isInteger(s.repeat), `step[${i}] repeat must be integer`).toBe(true);
            expect(s.repeat, `step[${i}] repeat must be > 0`).toBeGreaterThan(0);
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

// ──────────────────────────────────────────────
// 11. skipBlastPlayback (#761) is a boolean when present, and absent from
//     every scenario except the explicit, individually-audited opt-in list
//     below — same "narrow, commented allowlist" shape as
//     BOOTSTRAP_COMMAND_ALLOWLIST (interaction-executor.ts), not a flag any
//     scenario can reach for on its own say-so.
// ──────────────────────────────────────────────
describe('Scenario skipBlastPlayback field is a boolean when present (#761)', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    it(`${name} — skipBlastPlayback is boolean, or absent`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR) as ScenarioDef;
      if (scenario.skipBlastPlayback === undefined) return; // absent is valid
      expect(typeof scenario.skipBlastPlayback).toBe('boolean');
    });
  }

  // Every entry here has to justify itself: a scenario whose own screenshots
  // only ever show the settled aftermath (no `frames`/`interval` multi-shot
  // capture of the collapse itself mid-fall) loses nothing by skipping the
  // animation — GameRenderer's own __skipBlastPlayback bridge comment
  // (main.ts) is explicit that skipping "changes nothing" for exactly that
  // case, since the animation only walks rock to where the blast already put
  // it. Left unset, that same collapse costs MINUTES of wall clock without a
  // GPU (#475) — real budget a scenario pays for nothing it actually checks.
  const SKIP_BLAST_PLAYBACK_SCENARIOS: Record<string, string> = {
    'tutorial-interactive': 'functional/bootstrap flow, no blast-visual checkpoint',
    'tutorial-steps-visual': 'per-step shots are static settled-aftermath orbits (no frames/interval mid-collapse capture) — identical shape to tutorial-interactive\'s own blast step, just via its own shots array instead of inline screenshot actions; without this its blast step (9 holes/994 fragments, same pattern as tutorial-interactive) blew its 65s effective timeout every run (CI regression)',
  };

  for (const [name, reason] of Object.entries(SKIP_BLAST_PLAYBACK_SCENARIOS)) {
    it(`${name} — opts in with skipBlastPlayback: true (${reason})`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR) as ScenarioDef;
      expect(scenario.skipBlastPlayback).toBe(true);
    });
  }

  it('every scenario outside the audited opt-in list omits skipBlastPlayback (interaction mode default: OBSERVE the collapse)', () => {
    for (const name of ALL_SCENARIO_NAMES) {
      if (name in SKIP_BLAST_PLAYBACK_SCENARIOS) continue;
      const scenario = loadScenarioDef(name, SCENARIO_DIR) as ScenarioDef;
      expect(scenario.skipBlastPlayback, `${name} unexpectedly sets skipBlastPlayback`).toBeUndefined();
    }
  });
});
