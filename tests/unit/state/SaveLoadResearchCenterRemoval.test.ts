// BlastSimulator2026 — Loading a save from before the Research Center was removed (#2283 C7)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { Random } from '../../../src/core/math/Random.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { createQuestState } from '../../../src/core/economy/Quests.js';

/** The save version written while the Research Center still existed. */
const LEGACY_VERSION = 37;

type Raw = Record<string, any>;

function baseState(): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  expect(placeBuilding(s.buildings, 'living_quarters', 4, 4, 64, 64).success).toBe(true);
  s.cash = 200_000;
  return s;
}

function legacyRaw(s: GameState): Raw {
  const raw = JSON.parse(serialize(s)) as Raw;
  raw['version'] = LEGACY_VERSION;
  raw['buildings']['researchQueue'] = [];
  return raw;
}

function addCenter(raw: Raw, id: number, tier: 1 | 2 | 3, x = 30): void {
  raw['buildings']['buildings'].push({ id, type: 'research_center', tier, x, z: x, hp: 100, active: true, occupantIds: [] });
  raw['buildings']['nextId'] = Math.max(raw['buildings']['nextId'] as number, id + 1);
}

function task(over: Raw = {}): Raw {
  return { targetType: 'living_quarters', targetTier: 2, ticksRemaining: 0, cost: 500, conditions: [], ...over };
}

function load(raw: Raw): GameState {
  return deserialize(JSON.stringify(raw));
}

const typesOf = (s: GameState): string[] => s.buildings.buildings.map(b => b.type as string);

describe('a save holding a Research Center (#2283 C7)', () => {
  it.each([[1, 25_000], [2, 60_000], [3, 120_000]] as const)('removes a tier-%i Research Center and refunds %i', (tier, refund) => {
    const s = baseState();
    const raw = legacyRaw(s);
    addCenter(raw, 40, tier);
    const loaded = load(raw);
    expect(typesOf(loaded)).toEqual(['living_quarters']);
    expect(loaded.cash).toBe(s.cash + refund);
  });

  it('refunds every Research Center found, each by its own tier', () => {
    const s = baseState();
    const raw = legacyRaw(s);
    addCenter(raw, 40, 1, 20);
    addCenter(raw, 41, 3, 40);
    const loaded = load(raw);
    expect(typesOf(loaded)).toEqual(['living_quarters']);
    expect(loaded.cash).toBe(s.cash + 25_000 + 120_000);
  });

  it('keeps every other building, id and tier untouched', () => {
    const s = baseState();
    placeBuilding(s.buildings, 'geology_lab', 40, 4, 64, 64, 2);
    const raw = legacyRaw(s);
    addCenter(raw, 40, 1);
    const loaded = load(raw);
    expect(loaded.buildings.buildings).toEqual(s.buildings.buildings);
  });

  it('drops the researchQueue field from the loaded state', () => {
    const raw = legacyRaw(baseState());
    addCenter(raw, 40, 1);
    const loaded = load(raw);
    expect(Object.keys(loaded.buildings).sort()).toEqual(['buildings', 'nextId', 'unlockedTiers']);
    expect(JSON.stringify(loaded.buildings)).not.toContain('researchQueue');
  });

  it('drops the researchQueue field even from a save with no Research Center', () => {
    const raw = legacyRaw(baseState());
    raw['buildings']['researchQueue'] = [];
    const loaded = load(raw);
    expect('researchQueue' in loaded.buildings).toBe(false);
  });

  it('keeps unlockedTiers untouched', () => {
    const s = baseState();
    s.buildings.unlockedTiers['living_quarters'] = 2;
    s.buildings.unlockedTiers['geology_lab'] = 3;
    const raw = legacyRaw(s);
    addCenter(raw, 40, 2);
    const loaded = load(raw);
    expect(loaded.buildings.unlockedTiers).toEqual({ living_quarters: 2, geology_lab: 3 });
  });

  it('keeps unlockedTiers on a progression save too', () => {
    const s = baseState();
    s.grade = createGradeState();
    s.quests = createQuestState();
    s.buildings.unlockedTiers['driving_center'] = 2;
    const raw = legacyRaw(s);
    addCenter(raw, 40, 1);
    const loaded = load(raw);
    expect(loaded.buildings.unlockedTiers['driving_center']).toBe(2);
    expect(loaded.quests).toBeDefined();
  });
});

describe('queued research in a legacy save (#2283 C7)', () => {
  it('drops every queued task and refunds its cost', () => {
    const s = baseState();
    const raw = legacyRaw(s);
    addCenter(raw, 40, 1);
    raw['buildings']['researchQueue'] = [task({ cost: 700 }), task({ targetType: 'geology_lab', targetTier: 3, cost: 4_000, ticksRemaining: 25 })];
    const loaded = load(raw);
    expect('researchQueue' in loaded.buildings).toBe(false);
    expect(loaded.cash).toBe(s.cash + 25_000 + 700 + 4_000);
  });

  it('refunds a queued task even with no Research Center left to run it', () => {
    const s = baseState();
    const raw = legacyRaw(s);
    raw['buildings']['researchQueue'] = [task({ cost: 1_234 })];
    const loaded = load(raw);
    expect(loaded.cash).toBe(s.cash + 1_234);
    expect('researchQueue' in loaded.buildings).toBe(false);
  });

  it.each([Number.NaN, -50, 'lots', null])('a corrupt task cost (%s) is never refunded as such', (bad) => {
    const s = baseState();
    const raw = legacyRaw(s);
    raw['buildings']['researchQueue'] = [task({ cost: bad })];
    const loaded = load(raw);
    expect(Number.isFinite(loaded.cash)).toBe(true);
    expect(loaded.cash).toBeGreaterThanOrEqual(s.cash);
  });
});

describe('orders for a Research Center in a legacy save (#2283 C7)', () => {
  function plannedCenter(raw: Raw, over: Raw = {}): void {
    raw['plannedBuildings'] = [
      { id: 70, buildingId: 40, type: 'research_center', tier: 1, x: 30, z: 30, actionId: 500, cost: 25_000, ...over },
      { id: 71, buildingId: 41, type: 'management_office', tier: 1, x: 10, z: 30, actionId: 501, cost: 9_000 },
    ];
    raw['nextPlannedBuildingId'] = 72;
    raw['buildings']['nextId'] = 42;
    const base = { requiredSkill: null, requiredVehicleRole: null, targetY: 0, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0 };
    raw['pendingActions'] = [
      { ...base, id: 500, type: 'place_building', targetX: 30, targetZ: 30, payload: { buildingOrderId: 70 } },
      { ...base, id: 501, type: 'place_building', targetX: 10, targetZ: 30, payload: { buildingOrderId: 71 } },
    ];
  }

  it('removes a planned Research Center and its place_building action, keeping other orders', () => {
    const raw = legacyRaw(baseState());
    plannedCenter(raw);
    const loaded = load(raw);
    expect(loaded.plannedBuildings.map(p => p.type as string)).toEqual(['management_office']);
    expect(loaded.pendingActions.map(a => a.id)).toEqual([501]);
  });

  it('removes an in-place upgrade order for a standing Research Center', () => {
    const s = baseState();
    const raw = legacyRaw(s);
    addCenter(raw, 40, 1);
    plannedCenter(raw, { tier: 2, upgrade: true, cost: 47_500 });
    const loaded = load(raw);
    expect(typesOf(loaded)).toEqual(['living_quarters']);
    expect(loaded.plannedBuildings.map(p => p.type as string)).toEqual(['management_office']);
    expect(loaded.pendingActions.map(a => a.id)).toEqual([501]);
    expect(loaded.cash).toBeGreaterThanOrEqual(s.cash + 25_000);
  });

  it('never loses cash for a planned Research Center', () => {
    const s = baseState();
    const raw = legacyRaw(s);
    plannedCenter(raw);
    expect(load(raw).cash).toBeGreaterThanOrEqual(s.cash);
  });
});

describe('a legacy save plays on (#2283 C7)', () => {
  it('ticks normally after the migration', () => {
    const s = baseState();
    const raw = legacyRaw(s);
    addCenter(raw, 40, 2);
    raw['buildings']['researchQueue'] = [task()];
    const loaded = load(raw);
    const before = loaded.tickCount;
    expect(() => {
      for (let i = 0; i < 5; i++) runTick(loaded, null, new Random(loaded.seed + loaded.tickCount), new EventEmitter(), { checkInvariants: false });
    }).not.toThrow();
    expect(loaded.tickCount).toBe(before + 5);
  });

  it('round-trips again without a second refund', () => {
    const s = baseState();
    const raw = legacyRaw(s);
    addCenter(raw, 40, 3);
    raw['buildings']['researchQueue'] = [task({ cost: 900 })];
    const once = load(raw);
    const twice = deserialize(serialize(once));
    expect(twice.cash).toBe(once.cash);
    expect(typesOf(twice)).toEqual(['living_quarters']);
  });
});

describe('a save with no Research Center (#2283 C7)', () => {
  it('is unaffected: cash, buildings and unlockedTiers load as written', () => {
    const s = baseState();
    s.buildings.unlockedTiers['living_quarters'] = 2;
    const loaded = deserialize(serialize(s));
    expect(loaded.cash).toBe(s.cash);
    expect(loaded.buildings.buildings).toEqual(s.buildings.buildings);
    expect(loaded.buildings.unlockedTiers).toEqual({ living_quarters: 2 });
    expect(Object.keys(loaded.buildings).sort()).toEqual(['buildings', 'nextId', 'unlockedTiers']);
  });

  it('a legacy-version save with an empty queue and no center refunds nothing', () => {
    const s = baseState();
    const loaded = load(legacyRaw(s));
    expect(loaded.cash).toBe(s.cash);
    expect(typesOf(loaded)).toEqual(['living_quarters']);
  });
});
