// BlastSimulator2026 — Public Node.js API surface
// `serializeGameState` is the bridge the scenario channel asserts against. It must
// produce the same shape as window.__gameState() in the browser, so the command-mode
// and interaction-mode runs of a scenario stay comparable.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRunner, serializeGameState } from '../../src/console-api.js';
import type { MiningContext } from '../../src/console-api.js';

/**
 * Field set window.__gameState() emits, restricted to the state-derived
 * subset serializeGameState can also produce — keep in lockstep with
 * src/main.ts. window.__gameState() emits more than this (lastCommandOutput,
 * frameCount, ctxGridId, consoleLogs, gridSample, gridCrossSection): those
 * are browser/render-only and have no command-mode equivalent, by design —
 * not a gap to close, since a scenario's expect never asserts on them.
 * Everything below this comment line up to now WAS missing from
 * serializeGameState until this field-parity fix: worldSizeX/Z/minX/minZ and
 * qualificationCount/proficiencyTotal/trainingCount are all derivable from
 * ctx.state alone, so a scenario step's expect.equals/increased on any of
 * them used to be checkable in interaction mode only — command mode had no
 * way to report them at all, silently failing any such assertion there.
 * wellBeing/safety/ecology/nuisance (ScoreState) were never exposed on
 * either side at all — added together so a scenario can finally assert on
 * the four scores that gate events/contracts/lawsuits, not just guess at
 * them from a screenshot. collapsedCount/minFatigue (needs mechanics,
 * Employee.ts) followed the same gap for the same reason — a scenario
 * driving fatigue to collapse had no field to prove either one happened.
 * fatigue is inverted (100 = fully rested, 0 = exhausted), so the field
 * tracks the minimum across the roster — the employee closest to collapse
 * — not the maximum. storedMassKg (LogisticsState) closes the same gap for
 * warehouse storage — a scenario proving a hauled fragment actually got
 * delivered had no field to check before this. surveyCount
 * (state.surveyResults.length) closes the same gap for surveys.
 */
const SERIALIZED_FIELDS = [
  'seed', 'time', 'tickCount', 'isPaused', 'mineType',
  'worldSizeX', 'worldSizeZ', 'worldMinX', 'worldMinZ',
  'drillHoles', 'chargesByHole', 'sequenceDelays', 'finances', 'holeCount', 'chargedCount',
  'sequencedCount', 'surveyCount', 'buildingCount', 'vehicleCount', 'employeeCount',
  'qualificationCount', 'proficiencyTotal', 'trainingCount', 'collapsedCount', 'minFatigue',
  'levelEnded', 'levelEndReason', 'bankrupt', 'revolted', 'ecologicalShutdown',
  'arrested', 'cash', 'profit', 'wellBeing', 'safety', 'ecology', 'nuisance', 'muckPile',
  'storedMassKg',
] as const;

describe('console-api', () => {
  let runner: ReturnType<typeof createRunner>;

  beforeEach(() => {
    runner = createRunner();
  });

  describe('createRunner', () => {
    it('exposes a context whose state starts empty', () => {
      expect(runner.ctx.state).toBeNull();
    });

    it('executes a command against that context', () => {
      const result = runner.runner.run('new_game mine_type:desert seed:42');
      expect(result.success).toBe(true);
      expect(runner.ctx.state).not.toBeNull();
    });
  });

  describe('serializeGameState', () => {
    it('returns null before a game exists', () => {
      expect(serializeGameState(runner.ctx as MiningContext)).toBeNull();
    });

    it('emits every field window.__gameState() emits', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext);

      expect(state).not.toBeNull();
      expect(Object.keys(state!).sort()).toEqual([...SERIALIZED_FIELDS].sort());
    });

    it('reports the seed and mine type the game was created with', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.seed).toBe(42);
      expect(state.mineType).toBe('desert');
    });

    it('reports zero counts for a fresh game', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.holeCount).toBe(0);
      expect(state.chargedCount).toBe(0);
      expect(state.sequencedCount).toBe(0);
      expect(state.levelEnded).toBe(false);
      expect(state.levelEndReason).toBeNull();
    });

    it('reports no terminal loss condition for a fresh game', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.bankrupt).toBe(false);
      expect(state.revolted).toBe(false);
      expect(state.ecologicalShutdown).toBe(false);
      expect(state.arrested).toBe(false);
    });

    it('mirrors cash in both the flat field and the finances object', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.finances.cash).toBe(state.cash);
      expect(state.cash).toBeGreaterThan(0);
    });

    it('reports zero qualifications/proficiency/training for a fresh game with no employees', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.qualificationCount).toBe(0);
      expect(state.proficiencyTotal).toBe(0);
      expect(state.trainingCount).toBe(0);
    });

    it('counts qualifications and proficiency across the roster once employees are hired', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      runner.runner.run('employee hire role:driller');

      const state = serializeGameState(runner.ctx as MiningContext)!;

      // Hiring grants the role's starting qualification(s) at proficiency 1
      // (ROLE_STARTING_QUALIFICATION, Employee.ts) — a driller starts with at
      // least one, so this is real coverage, not a vacuous zero-vs-zero check.
      expect(state.employeeCount).toBe(1);
      expect(state.qualificationCount).toBeGreaterThan(0);
      expect(state.proficiencyTotal).toBeGreaterThan(0);
    });

    it('reports zero collapsedCount and 100 (fully rested) minFatigue for a fresh game with no employees', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.collapsedCount).toBe(0);
      expect(state.minFatigue).toBe(100);
    });

    it('reports a freshly-hired employee\'s starting fatigue of 100 (fully rested, hireEmployee)', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      runner.runner.run('employee hire role:driller');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.minFatigue).toBe(100);
      expect(state.collapsedCount).toBe(0);
    });

    it('reports zero surveyCount for a fresh game with no surveys run', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.surveyCount).toBe(0);
    });

    it('counts a completed survey once the surveyor has walked there and finished (arrival-gated, #437)', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      runner.runner.run('employee hire role:surveyor');
      runner.runner.run('survey seismic x:20 z:20');
      runner.runner.run('tick 50');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.surveyCount).toBe(1);
    });

    it('reports zero storedMassKg for a fresh game with nothing hauled', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.storedMassKg).toBe(0);
    });

    it('starts all four scores at 50 (createScoreState) for a fresh game', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.wellBeing).toBe(50);
      expect(state.safety).toBe(50);
      expect(state.ecology).toBe(50);
      expect(state.nuisance).toBe(50);
    });

    it('reports the world bounding box once a game exists', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.worldSizeX).not.toBeNull();
      expect(state.worldSizeZ).not.toBeNull();
      expect(typeof state.worldMinX).toBe('number');
      expect(typeof state.worldMinZ).toBe('number');
    });

    it('tracks drill holes added after creation', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      runner.runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.holeCount).toBe(6);
      expect(state.drillHoles).toHaveLength(6);
    });

    it('is deterministic for a given seed', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const first = serializeGameState(runner.ctx as MiningContext);

      const second = createRunner();
      second.runner.run('new_game mine_type:desert seed:42');

      expect(serializeGameState(second.ctx as MiningContext)).toEqual(first);
    });
  });
});
