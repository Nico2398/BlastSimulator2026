import { describe, it, expect } from 'vitest';
import type { InteractionStepAction, ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { loadScenarioDef, scenarioFiles, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import { KNOWN_INTERACTION_ACTION_TYPES } from './fixtures.js';

// hoverSelector action + explain-tooltip-visual scenario (issue #2188).

const NAME = 'explain-tooltip-visual';

function stepsOf(): ScenarioStepDef[] {
  return loadScenarioDef(NAME, SCENARIO_DIR).steps.map((s) => s as ScenarioStepDef);
}

function hovers(step: ScenarioStepDef): Array<Extract<InteractionStepAction, { type: 'hoverSelector' }>> {
  return (step.interaction ?? []).filter(
    (a): a is Extract<InteractionStepAction, { type: 'hoverSelector' }> => a.type === 'hoverSelector',
  );
}

describe('hoverSelector in scenario-def validation (#2188)', () => {
  it('is a known interaction action type', () => {
    expect(KNOWN_INTERACTION_ACTION_TYPES).toContain('hoverSelector');
  });
});

describe(`${NAME}.json (#2188)`, () => {
  it('exists in the scenario directory', () => {
    expect(scenarioFiles(SCENARIO_DIR)).toContain(NAME);
  });

  it('has a role "player" step hovering a candidate skill chip', () => {
    const found = stepsOf().some(
      (s) => s.role === 'player' && hovers(s).some((a) => a.selector.includes('[data-candidate-skill')),
    );
    expect(found).toBe(true);
  });

  it('has a role "player" step hovering the crew morale value', () => {
    const found = stepsOf().some(
      (s) => s.role === 'player' && hovers(s).some((a) => a.selector.includes('.bs-crew-morale-value')),
    );
    expect(found).toBe(true);
  });

  it('screenshots the tooltip after hovering, in the same step', () => {
    const hoverSteps = stepsOf().filter((s) => hovers(s).length > 0);
    expect(hoverSteps.length).toBeGreaterThanOrEqual(2);
    for (const step of hoverSteps) {
      const types = (step.interaction ?? []).map((a) => a.type);
      const firstHover = types.indexOf('hoverSelector');
      expect(types.slice(firstHover + 1), `step "${step.description ?? step.command}"`).toContain('screenshot');
    }
  });

  it('every hover step is a player step with no console command in its interaction', () => {
    for (const step of stepsOf().filter((s) => hovers(s).length > 0)) {
      expect(step.role).toBe('player');
      expect((step.interaction ?? []).some((a) => a.type === 'command')).toBe(false);
    }
  });

  it('every hoverSelector targets a non-empty selector string', () => {
    for (const step of stepsOf()) {
      for (const a of hovers(step)) {
        expect(typeof a.selector).toBe('string');
        expect(a.selector.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses only known interaction action types and a recognised role on every step', () => {
    for (const step of stepsOf()) {
      expect(['player', 'setup', 'observe', 'bootstrap', 'guard']).toContain(step.role);
      for (const a of step.interaction ?? []) {
        expect(KNOWN_INTERACTION_ACTION_TYPES).toContain(a.type);
      }
    }
  });
});
