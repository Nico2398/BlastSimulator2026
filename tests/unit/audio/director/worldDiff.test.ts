import { describe, it, expect } from 'vitest';
import { diffWorld } from '../../../../src/audio/director/worldDiff.js';
import { takeSnapshot } from '../../../../src/audio/director/worldSnapshot.js';
import { DIFF_CONFIG } from '../../../../src/core/config/audio/game.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { addAction, addBuilding, addEmployee, addVehicle, advanceTicks, makeState, removeAction } from './helpers.js';

const noCategory = (): string | undefined => undefined;
const sounds = (state: GameState, prev: ReturnType<typeof takeSnapshot>, category = noCategory) => diffWorld(prev, state, category).cues.map(c => c.sound);

function income(state: GameState, amount: number, category: 'sales' | 'contracts' | 'bonus' | 'refund' | 'smuggling' = 'contracts'): void {
  state.finances.transactions.push({ tick: state.tickCount, amount, type: 'income', category, description: 'test' });
}

function landBlast(state: GameState): void {
  state.lastBlastReport = { tick: state.tickCount } as unknown as GameState['lastBlastReport'];
}

describe('diffWorld', () => {
  it('says nothing about an unchanged world', () => {
    const state = makeState();
    addBuilding(state, 'living_quarters', 1, 1);
    const diff = diffWorld(takeSnapshot(state), state, noCategory);
    expect(diff).toEqual({ cues: [], blastLanded: false, levelEnd: null, levelReopened: false, eventAlert: false });
  });

  describe('buildings and vehicles', () => {
    it('plays building_built at a new building, following it as an entity', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      const house = addBuilding(state, 'living_quarters', 12, 34);
      const [cue] = diffWorld(prev, state, noCategory).cues;
      expect(cue?.sound).toBe('building_built');
      expect(cue?.site).toEqual({ entity: { kind: 'building', id: house.id }, point: { x: 12, z: 34 } });
    });

    it('plays one building_built however many buildings appeared', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      addBuilding(state, 'living_quarters', 1, 1);
      addBuilding(state, 'management_office', 9, 9);
      expect(sounds(state, prev)).toEqual(['building_built']);
    });

    it('plays building_demolished where a building was when it vanishes without a blast', () => {
      const state = makeState();
      addBuilding(state, 'living_quarters', 7, 8);
      const prev = takeSnapshot(state);
      state.buildings.buildings.length = 0;
      const [cue] = diffWorld(prev, state, noCategory).cues;
      expect(cue?.sound).toBe('building_demolished');
      expect(cue?.site?.point).toEqual({ x: 7, z: 8 });
    });

    it('leaves buildings lost to a blast to the blast timeline', () => {
      const state = makeState();
      addBuilding(state, 'living_quarters', 7, 8);
      const prev = takeSnapshot(state);
      state.buildings.buildings.length = 0;
      landBlast(state);
      expect(sounds(state, prev)).toEqual([]);
    });

    it('plays vehicle_start for a bought vehicle and vehicle_scrap for a lost one', () => {
      const state = makeState();
      const old = addVehicle(state, 'debris_hauler', 3, 4);
      const prev = takeSnapshot(state);
      state.vehicles.vehicles.length = 0;
      const bought = addVehicle(state, 'drill_rig', 20, 30);
      const diff = diffWorld(prev, state, noCategory);
      expect(diff.cues.map(c => c.sound)).toEqual(['vehicle_start', 'vehicle_scrap']);
      expect(diff.cues[0]?.site?.entity).toEqual({ kind: 'vehicle', id: bought.id });
      expect(diff.cues[1]?.site?.point).toEqual({ x: old.x, z: old.z });
    });

    it('does not scrap-cue a vehicle destroyed by a blast', () => {
      const state = makeState();
      addVehicle(state, 'debris_hauler', 3, 4);
      const prev = takeSnapshot(state);
      state.vehicles.vehicles.length = 0;
      landBlast(state);
      expect(sounds(state, prev)).toEqual([]);
    });
  });

  describe('finished actions', () => {
    it('chimes once for a finished action that has no sound of its own', () => {
      const state = makeState();
      const a = addAction(state, 'dig_ramp_segment');
      const b = addAction(state, 'level_ground');
      const prev = takeSnapshot(state);
      removeAction(state, a.id);
      removeAction(state, b.id);
      advanceTicks(state, 3);
      expect(sounds(state, prev)).toEqual(['order_done']);
    });

    it('leaves actions that are heard through their result to that result', () => {
      const state = makeState();
      for (const type of ['drill_hole', 'charge_hole', 'place_building', 'demolish_building', 'survey'] as const) {
        const action = addAction(state, type);
        const prev = takeSnapshot(state);
        removeAction(state, action.id);
        advanceTicks(state, 1);
        expect(sounds(state, prev), type).toEqual([]);
      }
    });

    it('ignores bookkeeping actions and actions nobody claimed', () => {
      const state = makeState();
      const noise = [addAction(state, 'haul_debris'), addAction(state, 'rest'), addAction(state, 'repair_vehicle'), addAction(state, 'fragment_debris')];
      const queued = addAction(state, 'dig_ramp_segment', 'queued');
      const prev = takeSnapshot(state);
      for (const action of [...noise, queued]) removeAction(state, action.id);
      advanceTicks(state, 1);
      expect(sounds(state, prev)).toEqual([]);
    });

    it('counts an assigned action that finished inside a coalesced batch', () => {
      const state = makeState();
      const action = addAction(state, 'general_work', 'assigned');
      const prev = takeSnapshot(state);
      removeAction(state, action.id);
      advanceTicks(state, 8);
      expect(sounds(state, prev)).toEqual(['order_done']);
    });

    it('treats an action that vanished with no tick passing as cancelled, not finished', () => {
      const state = makeState();
      const action = addAction(state, 'dig_ramp_segment');
      const prev = takeSnapshot(state);
      removeAction(state, action.id);
      expect(sounds(state, prev)).toEqual([]);
    });

    it('does not chime for an action that is still there', () => {
      const state = makeState();
      addAction(state, 'dig_ramp_segment');
      const prev = takeSnapshot(state);
      advanceTicks(state, 2);
      expect(sounds(state, prev)).toEqual([]);
    });
  });

  describe('holes, charges and surveys', () => {
    it('plays drill_done at a newly drilled hole, once for a batch', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      state.drillHoles.push({ id: 'H1', x: 5, z: 6, depth: 8, diameter: 0.1 }, { id: 'H2', x: 7, z: 6, depth: 8, diameter: 0.1 });
      const diff = diffWorld(prev, state, noCategory);
      expect(diff.cues.map(c => c.sound)).toEqual(['drill_done']);
      expect(diff.cues[0]?.site?.point).toEqual({ x: 5, z: 6 });
    });

    it('plays charge_loaded at a newly charged hole, once for a batch', () => {
      const state = makeState();
      state.drillHoles.push({ id: 'H1', x: 5, z: 6, depth: 8, diameter: 0.1 }, { id: 'H2', x: 7, z: 6, depth: 8, diameter: 0.1 });
      const prev = takeSnapshot(state);
      state.chargesByHole['H2'] = { explosiveId: 'anfo', amountKg: 4, stemmingM: 2 };
      state.chargesByHole['H1'] = { explosiveId: 'anfo', amountKg: 4, stemmingM: 2 };
      const diff = diffWorld(prev, state, noCategory);
      expect(diff.cues.map(c => c.sound)).toEqual(['charge_loaded']);
    });

    it('stays silent for a charge on a hole that is not in the plan', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      state.chargesByHole['ghost'] = { explosiveId: 'anfo', amountKg: 4, stemmingM: 2 };
      expect(sounds(state, prev)).toEqual([]);
    });

    it('plays survey_done at the newest survey', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      state.surveyResults.push({ id: 1, method: 'seismic', centerX: 10, centerZ: 20, completedTick: 1, surveyorId: 1, estimates: {}, confidence: 0.5 });
      const [cue] = diffWorld(prev, state, noCategory).cues;
      expect(cue?.sound).toBe('survey_done');
      expect(cue?.site?.point).toEqual({ x: 10, z: 20 });
    });
  });

  describe('income', () => {
    const { minAmount, bigAmount, tillAmount } = DIFF_CONFIG.income;

    it.each([
      [minAmount - 1, []],
      [minAmount, ['coins_small']],
      [bigAmount - 1, ['coins_small']],
      [bigAmount, ['coins_big']],
      [tillAmount - 1, ['coins_big']],
      [tillAmount, ['cash_till']],
    ])('scales the cue with an income of %d', (amount, expected) => {
      const state = makeState();
      const prev = takeSnapshot(state);
      income(state, amount);
      expect(sounds(state, prev)).toEqual(expected);
    });

    it('adds up everything that came in, across categories worth a coin', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      income(state, 1500, 'contracts');
      income(state, 1500, 'bonus');
      expect(sounds(state, prev)).toEqual(['coins_big']);
    });

    it('stays silent for upkeep, refunds, smuggling and any category not worth a coin', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      state.finances.transactions.push({ tick: 1, amount: 50000, type: 'expense', category: 'salaries', description: 'Payroll' });
      income(state, 50000, 'refund');
      income(state, 50000, 'smuggling');
      income(state, 50000, 'sales');
      expect(sounds(state, prev)).toEqual([]);
    });

    it('ignores income that was already there at the last look', () => {
      const state = makeState();
      income(state, 50000);
      const prev = takeSnapshot(state);
      expect(sounds(state, prev)).toEqual([]);
    });

    it('uses a longer cooldown for the big sounds', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      income(state, bigAmount);
      const [cue] = diffWorld(prev, state, noCategory).cues;
      expect(cue?.cooldownS).toBe(DIFF_CONFIG.income.bigCooldownS);
    });
  });

  describe('accidents', () => {
    it('leaves every casualty and property accident to the blast timeline', () => {
      const state = makeState();
      const worker = addEmployee(state, 4, 5);
      const prev = takeSnapshot(state);
      for (const type of ['injury', 'death', 'building_damage', 'vehicle_damage'] as const) {
        state.damage.accidents.push({ tick: 1, type, entityId: worker.id, fragmentId: 0, kineticEnergy: 0 });
      }
      expect(sounds(state, prev)).toEqual([]);
    });
  });

  describe('level end', () => {
    it('reports a level that just ended, once', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      state.levelEndReason = 'bankruptcy';
      expect(diffWorld(prev, state, noCategory).levelEnd).toBe('lose');
      expect(diffWorld(takeSnapshot(state), state, noCategory).levelEnd).toBeNull();
    });

    it('reports a finished level that runs again (keep playing), and only then', () => {
      const state = makeState();
      state.levelEnded = true;
      state.levelEndReason = 'completed';
      const prev = takeSnapshot(state);
      expect(diffWorld(prev, state, noCategory).levelReopened).toBe(false);
      state.levelEnded = false;
      state.levelEndReason = null;
      const diff = diffWorld(prev, state, noCategory);
      expect(diff.levelReopened).toBe(true);
      expect(diff.levelEnd).toBeNull();
      expect(diffWorld(takeSnapshot(state), state, noCategory).levelReopened).toBe(false);
    });
  });

  describe('events', () => {
    it('rings an alert on the rising edge of a pending event, with a flourish for its category', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      state.events.pendingEvent = { eventId: 'strike', firedAtTick: 4 };
      const diff = diffWorld(prev, state, () => 'union');
      expect(diff.cues.map(c => c.sound)).toEqual(['notify_alert', 'event_union']);
      expect(diff.cues[1]?.delayS).toBe(DIFF_CONFIG.eventAlert.flourishDelayS);
      expect(diff.eventAlert).toBe(true);
    });

    it.each([['lawsuit', 'event_lawsuit'], ['mafia', 'event_mafia'], ['politics', 'event_politics']])('maps %s to %s', (category, sound) => {
      const state = makeState();
      const prev = takeSnapshot(state);
      state.events.pendingEvent = { eventId: 'x', firedAtTick: 1 };
      expect(sounds(state, prev, () => category)).toEqual(['notify_alert', sound]);
    });

    it('gives categories without a flourish the alert alone', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      state.events.pendingEvent = { eventId: 'x', firedAtTick: 1 };
      expect(sounds(state, prev, () => 'weather')).toEqual(['notify_alert']);
      expect(sounds(state, prev)).toEqual(['notify_alert']);
    });

    it('does not ring again while the same event is pending, but does for a new one', () => {
      const state = makeState();
      state.events.pendingEvent = { eventId: 'x', firedAtTick: 1 };
      const prev = takeSnapshot(state);
      expect(diffWorld(prev, state, noCategory).eventAlert).toBe(false);
      state.events.pendingEvent = { eventId: 'y', firedAtTick: 2 };
      expect(diffWorld(prev, state, noCategory).eventAlert).toBe(true);
    });

    it('does nothing when the event is resolved', () => {
      const state = makeState();
      state.events.pendingEvent = { eventId: 'x', firedAtTick: 1 };
      const prev = takeSnapshot(state);
      state.events.pendingEvent = null;
      expect(diffWorld(prev, state, noCategory).eventAlert).toBe(false);
    });
  });

  describe('level end and blasts', () => {
    it('reports a win and a loss once, on the transition', () => {
      const win = makeState();
      const prevWin = takeSnapshot(win);
      win.levelEndReason = 'completed';
      expect(diffWorld(prevWin, win, noCategory).levelEnd).toBe('win');
      expect(diffWorld(takeSnapshot(win), win, noCategory).levelEnd).toBeNull();

      for (const reason of ['bankruptcy', 'arrest', 'ecological_shutdown', 'worker_revolt'] as const) {
        const lose = makeState();
        const prev = takeSnapshot(lose);
        lose.levelEndReason = reason;
        expect(diffWorld(prev, lose, noCategory).levelEnd, reason).toBe('lose');
      }
    });

    it('flags a blast only when a new report object appears', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      landBlast(state);
      expect(diffWorld(prev, state, noCategory).blastLanded).toBe(true);
      expect(diffWorld(takeSnapshot(state), state, noCategory).blastLanded).toBe(false);
    });
  });

  describe('coalescing and jumps', () => {
    it('still reports changes across the full coalescing window', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      addBuilding(state, 'living_quarters', 1, 1);
      advanceTicks(state, 8);
      expect(sounds(state, prev)).toEqual(['building_built']);
    });

    it('plays nothing for a jump beyond the window or backwards: a load, not play', () => {
      const state = makeState();
      const prev = takeSnapshot(state);
      addBuilding(state, 'living_quarters', 1, 1);
      advanceTicks(state, 9);
      expect(diffWorld(prev, state, noCategory)).toEqual({ cues: [], blastLanded: false, levelEnd: null, levelReopened: false, eventAlert: false });
      state.tickCount = prev.tick - 1;
      expect(sounds(state, prev)).toEqual([]);
    });
  });
});

describe('takeSnapshot', () => {
  it('records ids, claimed actions and the total charge', () => {
    const state = makeState();
    addBuilding(state, 'living_quarters', 1, 2);
    const vehicle = addVehicle(state, 'drill_rig', 3, 4);
    const claimed = addAction(state, 'drill_hole', 'assigned');
    addAction(state, 'drill_hole', 'queued');
    addAction(state, 'haul_debris', 'in_progress');
    state.drillHoles.push({ id: 'H1', x: 0, z: 0, depth: 1, diameter: 0.1 });
    state.chargesByHole['H1'] = { explosiveId: 'anfo', amountKg: 6, stemmingM: 1 };
    state.chargesByHole['H2'] = { explosiveId: 'anfo', amountKg: 4, stemmingM: 1 };
    state.events.pendingEvent = { eventId: 'e', firedAtTick: 9 };
    const snap = takeSnapshot(state);
    expect(snap.buildings.get(1)).toEqual({ x: 1, z: 2 });
    expect(snap.vehicles.get(vehicle.id)).toEqual({ x: 3, z: 4 });
    expect([...snap.claimedActions]).toEqual([[claimed.id, 'drill_hole']]);
    expect([...snap.holeIds]).toEqual(['H1']);
    expect([...snap.chargedHoleIds].sort()).toEqual(['H1', 'H2']);
    expect(snap.chargeKg).toBe(10);
    expect(snap.pendingEventKey).toBe('e@9');
  });
});
