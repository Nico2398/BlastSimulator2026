// BlastSimulator2026 — Public Node.js API surface
// `serializeGameState` is the bridge the scenario channel asserts against. It must
// produce the same shape as window.__gameState() in the browser, so the command-mode
// and interaction-mode runs of a scenario stay comparable.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRunner, serializeGameState } from '../../src/console-api.js';
import type { MiningContext } from '../../src/console-api.js';
import { killEmployee } from '../../src/core/entities/Employee.js';

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
 * pendingActionCount (state.pendingActions.length) closes the same gap for
 * queued-but-unclaimed actions, including auto-inserted rest tasks — a
 * scenario proving a proactive rest was queued had no field to check either.
 * stuckEmployeeCount closes the same gap for the isMoveStuck state — a
 * scenario proving pathfinding genuinely got an employee stuck (and later
 * un-stuck) had no field to check either. activeContractCount closes the
 * same gap for state.contracts.active — a scenario proving a contract
 * accept/decline/deliver-completion actually moved a contract had no field
 * to check either. timeScale closes the same gap for the HUD's speed
 * buttons (1x/2x/4x/8x) — a scenario proving `time speed` genuinely changed
 * the simulation rate, not just accepted the command, had no field to check.
 * weather closes the same gap for WeatherCycle.ts — a scenario proving
 * `weather set`/`weather advance` genuinely changed the HUD's weather icon
 * had no field to check; null until ctx.weatherCycle exists, which happens
 * lazily on the first weather command here but eagerly in the browser
 * (main.ts re-seeds it whenever ctx.state is replaced), so a scenario must
 * not assert on it before its own first weather command runs. deathCount
 * closes the same gap for state.damage.deathCount — a scenario proving a
 * blast's projections genuinely killed an employee standing in the cleared
 * columns had no field to check beyond inferring it from a flat
 * employeeCount (which still counts dead employees, since killEmployee
 * marks alive:false rather than removing the roster entry).
 * orderedHoleCount (state.plannedDrillHoles.length) closes the same gap for
 * a confirmed drill plan's holes still in flight (#553) — drill_plan
 * grid/add now queues one drill_hole action per hole instead of writing it
 * straight into state.drillHoles, so a scenario proving a plan was queued
 * but not yet drilled had no field to check before this.
 * orderedChargeCount (Object.keys(state.plannedChargesByHole).length) closes
 * the same gap for a charge order still in flight (#554) — `charge` now
 * queues one charge_hole action per hole instead of writing it straight into
 * state.chargesByHole, so a scenario proving a charge was ordered but not
 * yet loaded had no field to check before this. collectedOreTotal (sum of
 * every material key in state.collectedOre) closes the same gap for ore
 * actually delivered to a depot — a scenario proving a haul delivered ore
 * (not just spoil) had no field to check before this; a single summed
 * number rather than the raw per-material record because expect's
 * increased/decreased/equals/changedBy only compare flat numeric fields, and
 * a scenario can't pin which material id a real blast's RNG happened to
 * expose (#671).
 */
const SERIALIZED_FIELDS = [
  'seed', 'time', 'tickCount', 'isPaused', 'timeScale', 'mineType', 'weather',
  'worldSizeX', 'worldSizeZ', 'worldMinX', 'worldMinZ',
  'drillHoles', 'chargesByHole', 'sequenceDelays', 'finances', 'holeCount', 'orderedHoleCount', 'orderedChargeCount', 'orderedRampSegmentCount', 'chargedCount',
  'sequencedCount', 'surveyCount', 'pendingActionCount', 'buildingCount', 'vehicleCount', 'employeeCount',
  'qualificationCount', 'proficiencyTotal', 'trainingCount', 'collapsedCount', 'minFatigue',
  'stuckEmployeeCount', 'activeContractCount', 'deathCount',
  'levelEnded', 'levelEndReason', 'bankrupt', 'revolted', 'ecologicalShutdown',
  'arrested', 'cash', 'profit', 'wellBeing', 'safety', 'ecology', 'nuisance', 'muckPile',
  'storedMassKg', 'collectedOreTotal',
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

    it('reports timeScale of 1 for a fresh game', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.timeScale).toBe(1);
    });

    it('reports the new timeScale after `time speed` changes it', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      runner.runner.run('time speed 4');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.timeScale).toBe(4);
    });

    it('reports weather as null before any weather command has run (ctx.weatherCycle not yet created)', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.weather).toBeNull();
    });

    it('reports weather as sunny (createWeatherCycle\'s initial state) once the first weather command creates the cycle', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      runner.runner.run('weather');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.weather).toBe('sunny');
    });

    it('reports the new weather after `weather set` changes it', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      runner.runner.run('weather set storm');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.weather).toBe('storm');
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

    it('reports zero stuckEmployeeCount for a fresh game with no employees', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.stuckEmployeeCount).toBe(0);
    });

    it('counts an employee as stuck once boxed in by buildings, then un-stuck once demolished', () => {
      runner.runner.run('new_game seed:42');
      runner.runner.run('employee hire role:driller');
      runner.runner.run('employee dispatch 1 x:0 z:0');
      runner.runner.run('tick 19');
      runner.runner.run('build management_office at:2,0');
      runner.runner.run('build management_office at:0,2');
      runner.runner.run('build management_office at:2,2');
      runner.runner.run('tick 5');

      const stuckState = serializeGameState(runner.ctx as MiningContext)!;
      expect(stuckState.stuckEmployeeCount).toBe(1);

      runner.runner.run('build destroy 1');
      runner.runner.run('build destroy 2');
      runner.runner.run('build destroy 3');
      runner.runner.run('tick 15');

      const freedState = serializeGameState(runner.ctx as MiningContext)!;
      expect(freedState.stuckEmployeeCount).toBe(0);
    });

    it('reports zero activeContractCount for a fresh game with no contracts accepted', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.activeContractCount).toBe(0);
    });

    it('counts an accepted contract as active (state.contracts.active)', () => {
      runner.runner.run('new_game seed:42');
      runner.runner.run('campaign start level:dusty_hollow');
      runner.runner.run('contract accept id:1');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.activeContractCount).toBe(1);
    });

    it('reports zero deathCount for a fresh game with no employees', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.deathCount).toBe(0);
    });

    it('counts an employee killed by a blast standing in the cleared columns', () => {
      runner.runner.run('new_game seed:42');
      runner.runner.run('campaign start level:tutorial_pit');
      runner.runner.run('employee hire role:driller');
      const empId = runner.ctx.state!.employees.employees[0]!.id;
      // The hired driller starts qualified 'blasting' (ROLE_STARTING_QUALIFICATION,
      // Employee.ts) but drill_plan grid now queues one drill_hole PendingAction
      // per hole instead of writing them straight into state.drillHoles (#553) —
      // it also needs a drill_rig vehicle (and a driving.drill_rig licence) to
      // ever complete one. Buying/assigning both and ticking to completion sends
      // the driller walking to (and standing at) each ordered hole in turn,
      // which is squarely inside the blasted grid — an even more direct proof
      // of "standing in the cleared columns" than the pre-#553 instant-drill
      // version.
      runner.runner.run(`employee assign_skill ${empId} skill:driving.drill_rig level:1`);
      runner.runner.run('vehicle buy drill_rig');
      runner.runner.run('drill_plan grid rows:4 cols:4 spacing:3 depth:8 start:15,15');
      for (let i = 0; i < 600 && runner.ctx.state!.plannedDrillHoles.length > 0; i++) {
        // Tops up needs each tick — this solo multi-hole drive would otherwise
        // run long enough to trip an unrelated needs collapse mid-task (out of
        // scope for this test; see mining-commands.test.ts's equivalent helper).
        for (const emp of runner.ctx.state!.employees.employees) {
          emp.hunger = 100;
          emp.fatigue = 100;
          emp.breakNeed = 100;
        }
        runner.runner.run('tick 1');
      }
      runner.runner.run('charge hole:* explosive:boomite amount:5 stemming:2');
      // #554: charging is real work too — drain the ordered charges the same
      // way the drill plan above was drained before blasting.
      for (let i = 0; i < 600 && Object.keys(runner.ctx.state!.plannedChargesByHole).length > 0; i++) {
        for (const emp of runner.ctx.state!.employees.employees) {
          emp.hunger = 100;
          emp.fatigue = 100;
          emp.breakNeed = 100;
        }
        runner.runner.run('tick 1');
      }
      runner.runner.run('sequence auto delay_step:25');
      runner.runner.run('blast');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.deathCount).toBe(1);
      expect(state.employeeCount).toBe(1);
    });

    it('computes qualificationCount/proficiencyTotal/trainingCount/collapsedCount/minFatigue/stuckEmployeeCount over the living roster only, excluding a corpse\'s frozen state (#592)', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      runner.runner.run('employee hire role:driller');
      runner.runner.run('employee hire role:driller');
      const [survivor, corpse] = runner.ctx.state!.employees.employees;

      // Survivor: alive, ordinary fatigue, only its starting qualification —
      // none of the extra states below.
      survivor!.fatigue = 40;

      // Corpse: carries every one of these states at the moment of death — a
      // second qualification, an in-progress training course, collapsing,
      // near-zero fatigue, and stuck pathfinding — then killEmployee flips
      // alive:false without clearing any of it (killEmployee, Employee.ts,
      // only touches alive/injured). A reader that doesn't filter to the
      // living roster keeps counting all of this forever, exactly like the
      // avgMorale bug this issue is a sibling of.
      runner.runner.run(`employee assign_skill ${corpse!.id} skill:geology level:3`);
      corpse!.trainingState = { buildingId: 1, skill: 'blasting', ticksRemaining: 5, fee: 500 };
      corpse!.collapsing = true;
      corpse!.fatigue = 5;
      corpse!.isMoveStuck = true;
      killEmployee(runner.ctx.state!.employees, corpse!.id);

      const state = serializeGameState(runner.ctx as MiningContext)!;

      // employeeCount is intentionally NOT filtered — the flat headcount
      // includes the corpse.
      expect(state.employeeCount).toBe(2);
      // Every other aggregate below should reflect the survivor alone.
      expect(state.qualificationCount).toBe(survivor!.qualifications.length);
      expect(state.proficiencyTotal).toBe(
        survivor!.qualifications.reduce((sum, q) => sum + q.proficiencyLevel, 0),
      );
      expect(state.trainingCount).toBe(0);
      expect(state.collapsedCount).toBe(0);
      expect(state.minFatigue).toBe(40);
      expect(state.stuckEmployeeCount).toBe(0);
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

    it('reports zero pendingActionCount for a fresh game with nothing queued', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.pendingActionCount).toBe(0);
    });

    it('counts a queued-but-not-yet-completed survey as a pending action (arrival-gated, #437)', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      runner.runner.run('employee hire role:surveyor');
      runner.runner.run('survey seismic x:20 z:20');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.pendingActionCount).toBe(1);
    });

    it('reports zero storedMassKg for a fresh game with nothing hauled', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.storedMassKg).toBe(0);
    });

    it('reports zero collectedOreTotal for a fresh game with nothing delivered', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.collectedOreTotal).toBe(0);
    });

    it('sums every material key in state.collectedOre into collectedOreTotal', () => {
      runner.runner.run('new_game mine_type:desert seed:42');
      runner.ctx.state!.collectedOre = { dirtite: 30, blingite: 12.5 };
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.collectedOreTotal).toBe(42.5);
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
      // Staffed (#553): drill_plan grid now queues one drill_hole
      // PendingAction per hole instead of writing them straight into
      // state.drillHoles — a 'blasting'-qualified employee and a drill_rig
      // vehicle are needed for any hole to actually land.
      runner.runner.run('new_game mine_type:desert seed:42 staffed:true');
      runner.runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15');
      expect(serializeGameState(runner.ctx as MiningContext)!.orderedHoleCount).toBe(6);

      for (let i = 0; i < 300 && runner.ctx.state!.plannedDrillHoles.length > 0; i++) {
        // Tops up needs each tick — a solo multi-hole drive can otherwise run
        // long enough to trip an unrelated needs collapse mid-task (out of
        // scope here; see mining-commands.test.ts's equivalent helper).
        for (const emp of runner.ctx.state!.employees.employees) {
          emp.hunger = 100;
          emp.fatigue = 100;
          emp.breakNeed = 100;
        }
        runner.runner.run('tick 1');
      }
      const state = serializeGameState(runner.ctx as MiningContext)!;

      expect(state.holeCount).toBe(6);
      expect(state.drillHoles).toHaveLength(6);
      expect(state.orderedHoleCount).toBe(0);
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
