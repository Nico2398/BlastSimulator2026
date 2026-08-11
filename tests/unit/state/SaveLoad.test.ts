import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createGame } from '../../../src/core/state/GameState.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import { FilePersistence } from '../../../src/persistence/FilePersistence.js';

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

// ── v7 → v8 migration for PendingAction lifecycle fields (#547) ────────────
describe('deserialize — v7→v8 migration for PendingAction lifecycle (#547)', () => {
  /** A minimal, valid v7 save — every field GameState requires as of v7, with no `status`/`assignedEmployeeId`/`claimed`. */
  function v7Save(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      version: 7,
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
      collectedOre: {},
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
      softwareTier: 0,
      tubingState: { inventory: 0, installedHoles: [] },
      ...overrides,
    });
  }

  it('a pending action with no `status` field defaults to status: "queued", assignedEmployeeId: null', () => {
    const save = v7Save({
      pendingActions: [
        { id: 1, type: 'survey', requiredSkill: 'geology', requiredVehicleRole: null, targetX: 5, targetZ: 5, targetY: 0, payload: {}, targetEmployeeId: null },
      ],
    });
    const restored = deserialize(save);
    expect(restored.pendingActions).toHaveLength(1);
    expect(restored.pendingActions[0]!.status).toBe('queued');
    expect(restored.pendingActions[0]!.assignedEmployeeId).toBeNull();
  });

  it('a ghost preview with no `claimed` field defaults to false', () => {
    const save = v7Save({
      ghostPreviews: [{ id: 1, type: 'survey', targetX: 5, targetZ: 5, targetY: 0 }],
    });
    const restored = deserialize(save);
    expect(restored.ghostPreviews).toHaveLength(1);
    expect(restored.ghostPreviews[0]!.claimed).toBe(false);
  });

  it('re-links a migrated action to "assigned" when an employee\'s activeActionId matches it', () => {
    const save = v7Save({
      pendingActions: [
        { id: 5, type: 'survey', requiredSkill: 'geology', requiredVehicleRole: null, targetX: 5, targetZ: 5, targetY: 0, payload: {}, targetEmployeeId: null },
      ],
      employees: {
        employees: [
          { id: 3, name: 'Rex Digby', role: 'surveyor', salary: 400, morale: 60, unionized: false, injured: false, alive: true, x: 5, z: 5, qualifications: [], trainingState: null, activeActionId: 5, hunger: 100, fatigue: 100, breakNeed: 100, collapsing: false, interruptedActionPayload: null },
        ],
      },
    });
    const restored = deserialize(save);
    const action = restored.pendingActions.find(a => a.id === 5)!;
    expect(action.status).toBe('assigned');
    expect(action.assignedEmployeeId).toBe(3);
  });

  it('leaves a migrated action "queued" when no employee\'s activeActionId matches it, and the state still loads without throwing', () => {
    const save = v7Save({
      pendingActions: [
        { id: 9, type: 'survey', requiredSkill: 'geology', requiredVehicleRole: null, targetX: 5, targetZ: 5, targetY: 0, payload: {}, targetEmployeeId: null },
      ],
      employees: {
        employees: [
          { id: 3, name: 'Rex Digby', role: 'surveyor', salary: 400, morale: 60, unionized: false, injured: false, alive: true, x: 5, z: 5, qualifications: [], trainingState: null, activeActionId: null, hunger: 100, fatigue: 100, breakNeed: 100, collapsing: false, interruptedActionPayload: null },
        ],
      },
    });
    expect(() => deserialize(save)).not.toThrow();
    const restored = deserialize(save);
    const action = restored.pendingActions.find(a => a.id === 9)!;
    expect(action.status).toBe('queued');
    expect(action.assignedEmployeeId).toBeNull();
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
