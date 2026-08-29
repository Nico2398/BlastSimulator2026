import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createGame } from '../../../src/core/state/GameState.js';
import { createBuildingState } from '../../../src/core/entities/Building.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import { FilePersistence } from '../../../src/persistence/FilePersistence.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { updateScores } from '../../../src/core/scores/ScoreManager.js';
import { SCORE_DECAY_RATE } from '../../../src/core/config/balance.js';

const TEST_SAVE_DIR = path.join(process.cwd(), 'tmp-test-saves');

afterAll(() => {
  // Cleanup test directory
  if (fs.existsSync(TEST_SAVE_DIR)) {
    fs.rmSync(TEST_SAVE_DIR, { recursive: true });
  }
});

describe('deserialize — v4→v5 migration for collectedOre (task 5.18)', () => {
  it('deserializes v4 save without collectedOre to v5 with empty collectedOre', () => {
    const v4save = JSON.stringify({
      version: 4,
      seed: 42,
      time: 0,
      tickCount: 0,
      timeScale: 1,
      isPaused: false,
      mineType: 'desert',
      world: null,
      surveyedPositions: [],
      surveyResults: [],
      nextSurveyId: 1,
      cash: 10000,
      drillHoles: [],
      chargesByHole: {},
      sequenceDelays: {},
      savedPlans: {},
      finances: { cash: 10000, revenue: 0, expenses: 0, transactions: [], isBankrupt: false, bankruptcyGraceTicks: 0 },
      contracts: { available: [], active: [], completedHistory: [], nextId: 1, lastRefreshTick: 0 },
      logistics: { fragments: [], storageCapacityKg: 5000, storedMassKg: 0 },
      buildings: { buildings: [] },
      vehicles: { vehicles: [] },
      employees: { employees: [] },
      scores: { ecology: 50, safety: 50, nuisance: 0, wellBeing: 50, blastCount: 0 },
      damage: { deathCount: 0, injuryCount: 0, blastCount: 0, damageEvents: [], deathEvents: [] },
      zone: { zones: [] },
      events: { firedEventIds: [], timers: {}, pendingQueue: [], followUpQueue: [] },
      corruption: { exposure: 0, bribes: [], mafiaUnlocked: false, exposureHistory: [] },
      mafia: { exposure: 0, smugglingActive: false, frames: [] },
      campaign: { unlockedLevels: ['level1'], levelResults: {}, selectedLevel: 'level1' },
      bankruptcy: { missedPayments: 0, graceTicksRemaining: 0, warningGiven: false },
      arrest: { investigationPoints: 0, exposureLevel: 0, warningGiven: false },
      ecological: { damageEvents: [], shutdownTicksRemaining: 0, warningGiven: false },
      revolt: { unrestLevel: 0, revoltTicksRemaining: 0, warningGiven: false },
      levelStats: { totalWealth: 0, maxDepthReached: 0, uniqueOresExtracted: [], totalVolumeBlasted: 0, blastsPerformed: 0, casualties: 0, bestEcology: 50, bestSafety: 50 },
      sitePolicy: { shiftDuration: 'shift_8h', restThreshold: 40, hungerRest: 40, fatigueRest: 25, socialBreak: 20 },
      levelEnded: false,
      levelEndReason: null,
      pendingActions: [],
      nextPendingActionId: 1,
      ghostPreviews: [],
    });
    const restored = deserialize(v4save);
    expect(restored.collectedOre).toEqual({});
  });
});

// ── v7→v8 migration for PendingAction lifecycle (#547) ──────────────────────
// SAVE_VERSION bumped 7→8 when PendingAction gained status/holderId. A save
// written before that has pendingActions entries with neither field — they
// must load as status:'queued', holderId:null (the pre-#547 semantics: an
// entry in the array always meant "still waiting to be claimed"). An
// employee whose activeActionId pointed at an action that isn't present after
// migration must have that reference cleared to null rather than dangling.

describe('deserialize — v7→v8 migration for PendingAction lifecycle (#547)', () => {
  it('a pre-v8 pendingActions entry with no status field loads as status:"queued", holderId:null', () => {
    const state = createGame({ seed: 42 });
    state.pendingActions.push({
      id: 1, type: 'survey', requiredSkill: null, requiredVehicleRole: null,
      targetX: 3, targetZ: 4, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null,
    });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 7;
    // Simulate a genuine pre-#547 save: no status/holderId field at all.
    const pending = parsed['pendingActions'] as Array<Record<string, unknown>>;
    delete pending[0]!['status'];
    delete pending[0]!['holderId'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.pendingActions).toHaveLength(1);
    expect(restored.pendingActions[0]!.status).toBe('queued');
    expect(restored.pendingActions[0]!.holderId).toBeNull();
  });

  it('multiple pre-v8 entries all migrate to queued/null independently', () => {
    const state = createGame({ seed: 42 });
    state.pendingActions.push(
      {
        id: 1, type: 'survey', requiredSkill: null, requiredVehicleRole: null,
        targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
        status: 'queued', holderId: null,
      },
      {
        id: 2, type: 'rest', requiredSkill: null, requiredVehicleRole: null,
        targetX: 1, targetZ: 1, targetY: 0, payload: {}, targetEmployeeId: null,
        status: 'queued', holderId: null,
      },
    );
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 7;
    const pending = parsed['pendingActions'] as Array<Record<string, unknown>>;
    for (const p of pending) {
      delete p['status'];
      delete p['holderId'];
    }

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.pendingActions).toHaveLength(2);
    for (const p of restored.pendingActions) {
      expect(p.status).toBe('queued');
      expect(p.holderId).toBeNull();
    }
  });

  it('an employee whose activeActionId refers to an action absent from the migrated list has activeActionId cleared to null', () => {
    const state = createGame({ seed: 42 });
    const rng = new Random(42);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // Points at an action id that never made it into this save at all.
    employee.activeActionId = 999;

    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 7;

    const restored = deserialize(JSON.stringify(parsed));

    const restoredEmployee = restored.employees.employees.find(e => e.id === employee.id)!;
    expect(restoredEmployee.activeActionId).toBeNull();
  });

  it('leaves activeActionId untouched when it refers to a pendingAction that survives migration', () => {
    const state = createGame({ seed: 42 });
    const rng = new Random(42);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    state.pendingActions.push({
      id: 5, type: 'survey', requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: employee.id,
      status: 'assigned', holderId: employee.id,
    });
    employee.activeActionId = 5;

    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 7;
    const pending = parsed['pendingActions'] as Array<Record<string, unknown>>;
    delete pending[0]!['status'];
    delete pending[0]!['holderId'];

    const restored = deserialize(JSON.stringify(parsed));

    const restoredEmployee = restored.employees.employees.find(e => e.id === employee.id)!;
    expect(restoredEmployee.activeActionId).toBe(5);
    // The surviving record's own status/holderId were stripped to simulate a
    // pre-#547 save; migration re-derives them from the employee's
    // activeActionId, so the action comes back 'assigned' to that employee.
    expect(restored.pendingActions[0]!.status).toBe('assigned');
    expect(restored.pendingActions[0]!.holderId).toBe(employee.id);
  });

  it('a v8+ save (already carrying status/holderId) is left untouched by the migration', () => {
    const state = createGame({ seed: 42 });
    state.pendingActions.push({
      id: 1, type: 'survey', requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'in_progress', holderId: 3,
    });
    const json = serialize(state);

    const restored = deserialize(json);

    expect(restored.pendingActions[0]!.status).toBe('in_progress');
    expect(restored.pendingActions[0]!.holderId).toBe(3);
  });
});

// ── GameState.ghostPreviewsRevision backward compat (#761) ──────────────────
// ghostPreviewsRevision (renderer dirty-check counter, bumped by TaskDispatch
// on every ghostPreviews mutation) was introduced alongside the v7→v8
// PendingAction-lifecycle migration — a save from before it existed has no
// counter at all and must default to 0, matching createGame's own default,
// rather than deserializing to undefined (which would make every
// `!==`-based dirty comparison in GameRenderer.syncEntities() true forever).

describe('deserialize — GameState.ghostPreviewsRevision backward compat (#761)', () => {
  it('a pre-v8 save with no ghostPreviewsRevision field at all deserializes with it defaulting to 0', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 7;
    delete parsed['ghostPreviewsRevision'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.ghostPreviewsRevision).toBe(0);
  });

  it('a pre-v8 save never deserializes ghostPreviewsRevision as undefined', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 7;
    delete parsed['ghostPreviewsRevision'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.ghostPreviewsRevision).not.toBeUndefined();
    expect(typeof restored.ghostPreviewsRevision).toBe('number');
  });

  it('a v8+ save that already carries a non-zero ghostPreviewsRevision is left untouched by the migration', () => {
    const state = createGame({ seed: 42 });
    state.ghostPreviewsRevision = 7;
    const json = serialize(state);

    const restored = deserialize(json);

    expect(restored.ghostPreviewsRevision).toBe(7);
  });
});

// ── v8→v9 migration for Employee.taskQueue (#549) ───────────────────────────
// SAVE_VERSION bumped 8→9 when Employee gained a `taskQueue: number[]` field
// (cost-based per-employee action selection). A save written before that has
// no taskQueue at all on any employee — it must load with `taskQueue: []`,
// exactly as a fresh hire would have, so a pre-#549 save works with the new
// dispatch code instead of crashing on a missing array.

describe('deserialize — v8→v9 migration for Employee.taskQueue (#549)', () => {
  it('a v8 fixture with employees missing taskQueue loads with taskQueue: [] on every employee', () => {
    const state = createGame({ seed: 42 });
    const rng = new Random(42);
    hireEmployee(state.employees, 'driller', rng);
    hireEmployee(state.employees, 'blaster', rng);

    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 8;
    // Simulate a genuine pre-#549 save: no taskQueue field at all.
    const employeesRaw = parsed['employees'] as Record<string, unknown>;
    const employeeList = employeesRaw['employees'] as Array<Record<string, unknown>>;
    expect(employeeList).toHaveLength(2);
    for (const e of employeeList) {
      delete e['taskQueue'];
    }

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.employees.employees).toHaveLength(2);
    for (const e of restored.employees.employees) {
      expect(e.taskQueue).toEqual([]);
    }
  });

  it('a single-employee v8 fixture migrates that employee to taskQueue: [] (boundary: one employee)', () => {
    const state = createGame({ seed: 42 });
    const rng = new Random(42);
    hireEmployee(state.employees, 'surveyor', rng);

    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 8;
    const employeesRaw = parsed['employees'] as Record<string, unknown>;
    const employeeList = employeesRaw['employees'] as Array<Record<string, unknown>>;
    delete employeeList[0]!['taskQueue'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.employees.employees).toHaveLength(1);
    expect(restored.employees.employees[0]!.taskQueue).toEqual([]);
  });

  it('a v8 save with no employees at all migrates cleanly to an empty roster (boundary: zero employees)', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 8;

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.employees.employees).toEqual([]);
  });

  it('a v9+ save (already carrying a populated taskQueue) is left untouched by the migration (regression)', () => {
    const state = createGame({ seed: 42 });
    const rng = new Random(42);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.taskQueue = [7, 8];

    const json = serialize(state);

    const restored = deserialize(json);

    const restoredEmployee = restored.employees.employees.find(e => e.id === employee.id)!;
    expect(restoredEmployee.taskQueue).toEqual([7, 8]);
  });
});

// ── v10→v11 migration for GameState.plannedDrillHoles (#553) ───────────────
// SAVE_VERSION bumped 10→11 when GameState gained a `plannedDrillHoles:
// PlannedHole[]` field — confirming a drill plan now queues one drill_hole
// action per hole instead of writing DrillHole records straight into
// state.drillHoles. A save written before that has no plannedDrillHoles
// field at all; it must load with plannedDrillHoles: [].

describe('deserialize — v10→v11 migration for GameState.plannedDrillHoles (#553)', () => {
  it('a v10 save without plannedDrillHoles migrates to v11 with plannedDrillHoles: []', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 10;
    delete parsed['plannedDrillHoles'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.plannedDrillHoles).toEqual([]);
  });

  it('a v9 (or earlier) save without plannedDrillHoles also migrates cleanly to plannedDrillHoles: [] (migration chain)', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 9;
    delete parsed['plannedDrillHoles'];
    // Simulate a genuine pre-#549 save missing taskQueue too, so the full
    // migration chain (v9->v10->v11) runs, not just the last link.
    const employeesRaw = parsed['employees'] as Record<string, unknown>;
    const employeeList = employeesRaw['employees'] as Array<Record<string, unknown>>;
    for (const e of employeeList) delete e['taskQueue'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.plannedDrillHoles).toEqual([]);
  });

  it('a v11+ save with plannedDrillHoles populated round-trips serialize/deserialize unchanged', () => {
    const state = createGame({ seed: 42 });
    state.plannedDrillHoles.push(
      { id: 'H1', x: 3, z: 4, depth: 8, diameter: 0.15 },
      { id: 'H2', x: 6, z: 4, depth: 8, diameter: 0.15 },
    );

    const json = serialize(state);
    const restored = deserialize(json);

    expect(restored.plannedDrillHoles).toEqual([
      { id: 'H1', x: 3, z: 4, depth: 8, diameter: 0.15 },
      { id: 'H2', x: 6, z: 4, depth: 8, diameter: 0.15 },
    ]);
  });

  it('an empty v11+ save (no planned holes) round-trips to an empty array (boundary)', () => {
    const state = createGame({ seed: 42 });

    const json = serialize(state);
    const restored = deserialize(json);

    expect(restored.plannedDrillHoles).toEqual([]);
  });
});

describe('deserialize — v11→v12 migration for GameState.plannedChargesByHole (#554)', () => {
  it('a v11 save without plannedChargesByHole migrates to v12 with plannedChargesByHole: {}', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 11;
    delete parsed['plannedChargesByHole'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.plannedChargesByHole).toEqual({});
  });

  it('a v10 (or earlier) save without plannedChargesByHole also migrates cleanly (migration chain)', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 10;
    delete parsed['plannedChargesByHole'];
    delete parsed['plannedDrillHoles'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.plannedChargesByHole).toEqual({});
    expect(restored.plannedDrillHoles).toEqual([]);
  });

  it('a v12+ save with plannedChargesByHole populated round-trips serialize/deserialize unchanged', () => {
    const state = createGame({ seed: 42 });
    state.plannedChargesByHole['H1'] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };

    const json = serialize(state);
    const restored = deserialize(json);

    expect(restored.plannedChargesByHole).toEqual({
      H1: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 },
    });
  });

  it('an empty v12+ save (no planned charges) round-trips to an empty object (boundary)', () => {
    const state = createGame({ seed: 42 });

    const json = serialize(state);
    const restored = deserialize(json);

    expect(restored.plannedChargesByHole).toEqual({});
  });
});

// ── v12→v13 migration for ScoreState.decayRate (#555, immune removed #681) ──
// SAVE_VERSION bumped 12→13 for GameState.plannedRamps/nextPlannedRampId, but
// the same #555 branch also added ScoreState.decayRate, persisted verbatim
// with no dedicated version bump. A pre-v13 save has no decayRate field — it
// must default to the global SCORE_DECAY_RATE constant (matching
// createScoreState's own default), or a later tick's applyDecay computes
// `value +/- undefined` and pins the score at NaN forever.
//
// #555 also added RevoltState.immune; #681 removed the field entirely (the
// tutorial's revolt exemption is gone now that #680 rebalanced well-being to
// be survivable without it). The migration must not touch `immune` in any
// way — old saves carrying a stray `immune` key are simply left with a
// `revolt` object that has no such field once deserialized.

describe('deserialize — v12→v13 migration for ScoreState.decayRate (#555)', () => {
  it('a v12 save missing scores.decayRate migrates to the createGame default', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 12;
    const scoresRaw = parsed['scores'] as Record<string, unknown>;
    delete scoresRaw['decayRate'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.scores.decayRate).toBe(SCORE_DECAY_RATE);
  });

  it('a tick after migration never drives a score to NaN', () => {
    const state = createGame({ seed: 42 });
    // Push a score off neutral so applyDecay's undefined-rate branch would
    // actually fire (decay is a no-op exactly at 50).
    state.scores.wellBeing = 40;
    state.scores.safety = 60;
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 12;
    const scoresRaw = parsed['scores'] as Record<string, unknown>;
    delete scoresRaw['decayRate'];

    const restored = deserialize(JSON.stringify(parsed));
    updateScores(restored.scores, {
      buildings: createBuildingState(),
      avgMorale: 50,
      recentAccidents: 0,
      hasSafetyEquipment: false,
      maxRecentVibration: 0,
      employeeCount: 0,
    });

    expect(Number.isNaN(restored.scores.wellBeing)).toBe(false);
    expect(Number.isNaN(restored.scores.safety)).toBe(false);
    expect(Number.isNaN(restored.scores.ecology)).toBe(false);
    expect(Number.isNaN(restored.scores.nuisance)).toBe(false);
  });

  it('a pre-v12 save (never had decayRate at all) migrates cleanly through the full chain', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 10;
    delete parsed['plannedDrillHoles'];
    delete parsed['plannedChargesByHole'];
    delete parsed['plannedRamps'];
    delete parsed['nextPlannedRampId'];
    const scoresRaw = parsed['scores'] as Record<string, unknown>;
    delete scoresRaw['decayRate'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.scores.decayRate).toBe(SCORE_DECAY_RATE);
  });

  it('a v13+ save with decayRate already set is left untouched by the migration (regression)', () => {
    const state = createGame({ seed: 42 });
    state.scores.decayRate = 0.01;

    const json = serialize(state);
    const restored = deserialize(json);

    expect(restored.scores.decayRate).toBe(0.01);
  });

  it('a save carrying a stray legacy revolt.immune key deserializes to a revolt object with no immune field (#681)', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const revoltRaw = parsed['revolt'] as Record<string, unknown>;
    revoltRaw['immune'] = false;

    const restored = deserialize(JSON.stringify(parsed));

    expect('immune' in restored.revolt).toBe(false);
  });

  it('a freshly created GameState.revolt has no immune property (#681)', () => {
    const state = createGame({ seed: 42 });
    expect('immune' in state.revolt).toBe(false);
  });
});

// ── v13→v14 migration for GameState.plannedBuildings (#556) ──────────────────
// SAVE_VERSION bumped 13→14 for `plannedBuildings: PlannedBuilding[]` and
// `nextPlannedBuildingId: number` — ordering a building queues a
// `place_building` PendingAction instead of creating the building instantly,
// mirroring #553/#554/#555's own version bumps for plannedDrillHoles/
// plannedChargesByHole/plannedRamps.

describe('deserialize — v13→v14 migration for GameState.plannedBuildings (#556)', () => {
  it('a v13 save without plannedBuildings/nextPlannedBuildingId migrates to plannedBuildings: [] and nextPlannedBuildingId: 1', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 13;
    delete parsed['plannedBuildings'];
    delete parsed['nextPlannedBuildingId'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.plannedBuildings).toEqual([]);
    expect(restored.nextPlannedBuildingId).toBe(1);
  });

  it('a pre-v13 save (missing every planned-work field back through plannedDrillHoles) migrates cleanly through the full chain to plannedBuildings: []', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    parsed['version'] = 10;
    delete parsed['plannedDrillHoles'];
    delete parsed['plannedChargesByHole'];
    delete parsed['plannedRamps'];
    delete parsed['nextPlannedRampId'];
    delete parsed['plannedBuildings'];
    delete parsed['nextPlannedBuildingId'];

    const restored = deserialize(JSON.stringify(parsed));

    expect(restored.plannedDrillHoles).toEqual([]);
    expect(restored.plannedChargesByHole).toEqual({});
    expect(restored.plannedRamps).toEqual([]);
    expect(restored.plannedBuildings).toEqual([]);
    expect(restored.nextPlannedBuildingId).toBe(1);
  });

  it('a v14+ save with plannedBuildings populated round-trips serialize/deserialize unchanged, including its in-flight PendingAction', () => {
    const state = createGame({ seed: 42 });
    const rng = new Random(42);
    // holderId must reference a real employee (state.employees) for the
    // fixture to be internally consistent — a hand-picked id with no
    // matching employee record can't happen from real dispatch. Also gives
    // the holder actual in-progress work fields (taskTicksRemaining,
    // activeActionId) so the round-trip proves remaining work itself
    // survives, not just the static PendingAction shape.
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.activeActionId = 100;
    employee.taskTicksRemaining = 17;
    employee.activeTaskTotalTicks = 40;
    state.plannedBuildings.push({
      id: 1, buildingId: 1, type: 'freight_warehouse', tier: 1, x: 5, z: 5, actionId: 100, cost: 15000,
    });
    state.pendingActions.push({
      id: 100, type: 'place_building', requiredSkill: null, requiredVehicleRole: null,
      targetX: 5, targetZ: 5, targetY: 0,
      payload: { buildingOrderId: 1, cost: 15000, footprint: [[0, 0], [1, 0], [0, 1], [1, 1]], durationTicks: 40 },
      targetEmployeeId: null, status: 'in_progress', holderId: employee.id,
    });
    state.nextPlannedBuildingId = 2;

    const json = serialize(state);
    const restored = deserialize(json);

    expect(restored.plannedBuildings).toEqual([
      { id: 1, buildingId: 1, type: 'freight_warehouse', tier: 1, x: 5, z: 5, actionId: 100, cost: 15000 },
    ]);
    expect(restored.nextPlannedBuildingId).toBe(2);

    const restoredAction = restored.pendingActions.find(a => a.id === 100);
    expect(restoredAction).toBeDefined();
    expect(restoredAction!.status).toBe('in_progress');
    expect(restoredAction!.holderId).toBe(employee.id);
    expect(restoredAction!.payload).toEqual({
      buildingOrderId: 1, cost: 15000, footprint: [[0, 0], [1, 0], [0, 1], [1, 1]], durationTicks: 40,
    });

    // The employee doing the work — and how much of it is left — survives too.
    const restoredEmployee = restored.employees.employees.find(e => e.id === employee.id);
    expect(restoredEmployee).toBeDefined();
    expect(restoredEmployee!.activeActionId).toBe(100);
    expect(restoredEmployee!.taskTicksRemaining).toBe(17);
  });

  it('an empty v14+ save (no buildings under construction) round-trips to an empty array (boundary)', () => {
    const state = createGame({ seed: 42 });

    const json = serialize(state);
    const restored = deserialize(json);

    expect(restored.plannedBuildings).toEqual([]);
    expect(restored.nextPlannedBuildingId).toBe(1);
  });

  it('a v14+ save with nextPlannedBuildingId already advanced is left untouched by the migration (regression)', () => {
    const state = createGame({ seed: 42 });
    state.nextPlannedBuildingId = 9;

    const json = serialize(state);
    const restored = deserialize(json);

    expect(restored.nextPlannedBuildingId).toBe(9);
  });
});

describe('serialize / deserialize', () => {
  it('round-trip produces an equivalent state', () => {
    const state = createGame({ seed: 42 });
    state.time = 5000;
    state.timeScale = 2;
    const json = serialize(state);
    const restored = deserialize(json);
    expect(restored).toEqual(state);
  });

  it('serialized output is valid JSON', () => {
    const state = createGame({ seed: 42 });
    const json = serialize(state);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('deserialization of unknown future version throws a clear error', () => {
    const futureState = JSON.stringify({ version: 9999, seed: 1 });
    expect(() => deserialize(futureState)).toThrow(/unknown save version.*9999/i);
  });

  it('deserialization of invalid data throws', () => {
    expect(() => deserialize('"not an object"')).toThrow(/expected a JSON object/i);
  });

  it('deserialization of missing version throws', () => {
    expect(() => deserialize('{"seed":1}')).toThrow(/missing version/i);
  });
});

describe('FilePersistence', () => {
  let backend: FilePersistence;

  beforeEach(() => {
    // Clean directory between tests
    if (fs.existsSync(TEST_SAVE_DIR)) {
      fs.rmSync(TEST_SAVE_DIR, { recursive: true });
    }
    backend = new FilePersistence(TEST_SAVE_DIR);
  });

  it('save and load round-trip', async () => {
    const state = createGame({ seed: 42 });
    const data = serialize(state);
    await backend.save('slot1', 'My Save', data, 'Level 1 in progress', 'dusty_hollow');

    const loaded = await backend.load('slot1');
    expect(loaded).not.toBeNull();
    expect(loaded!.data).toBe(data);
    expect(loaded!.meta.name).toBe('My Save');
    expect(loaded!.meta.slotId).toBe('slot1');
    expect(loaded!.meta.campaignSummary).toBe('Level 1 in progress');
    expect(loaded!.meta.timestamp).toBeGreaterThan(0);
  });

  it('load returns null for nonexistent slot', async () => {
    const result = await backend.load('nonexistent');
    expect(result).toBeNull();
  });

  it('list returns all saved slots with metadata', async () => {
    await backend.save('slot1', 'Save A', '{}', 'L1', 'dusty_hollow');
    await backend.save('slot2', 'Save B', '{}', 'L2', 'grumpstone_ridge');

    const metas = await backend.list();
    expect(metas).toHaveLength(2);
    const ids = metas.map(m => m.slotId).sort();
    expect(ids).toEqual(['slot1', 'slot2']);
  });

  it('delete removes a save slot', async () => {
    await backend.save('slot1', 'Temp', '{}', '', null);
    await backend.delete('slot1');
    const loaded = await backend.load('slot1');
    expect(loaded).toBeNull();
  });

  it('metadata includes version', async () => {
    await backend.save('slot1', 'Test', '{}', '', null);
    const loaded = await backend.load('slot1');
    expect(loaded!.meta.version).toBeDefined();
    expect(typeof loaded!.meta.version).toBe('number');
  });

  it('metadata preserves the active campaign level id', async () => {
    await backend.save('slot1', 'Test', '{}', '', 'dusty_hollow');
    const loaded = await backend.load('slot1');
    expect(loaded!.meta.levelId).toBe('dusty_hollow');
  });

  it('metadata records a null level id for a sandbox game', async () => {
    await backend.save('slot1', 'Test', '{}', '', null);
    const loaded = await backend.load('slot1');
    expect(loaded!.meta.levelId).toBeNull();
  });
});
