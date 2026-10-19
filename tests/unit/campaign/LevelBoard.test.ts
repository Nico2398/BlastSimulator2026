// BlastSimulator2026 — createGameForLevel wires a level's board of directors (#1946)

import { describe, it, expect, vi } from 'vitest';
import type { LevelDef } from '../../../src/core/campaign/Level.js';

const FIXTURE_ID = 'board_fixture';
const FIXTURE_BOARD = { quarterTicks: 48, oreTargetT: 1, profitTarget: 1000 };

vi.mock('../../../src/core/campaign/Level.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/core/campaign/Level.js')>();
  const base = real.getLevel('dusty_hollow')!;
  const fixture: LevelDef = {
    ...base,
    id: 'board_fixture',
    difficultyTier: 1,
    unlockThreshold: 1e9,
    board: { quarterTicks: 48, oreTargetT: 1, profitTarget: 1000 },
  };
  const all = [...real.getAllLevels(), fixture];
  return {
    ...real,
    getAllLevels: () => all,
    getLevel: (id: string) => all.find(l => l.id === id),
  };
});

import { createGameForLevel } from '../../../src/core/campaign/LevelTransition.js';
import { createCampaignState } from '../../../src/core/campaign/Campaign.js';
import { getLevel } from '../../../src/core/campaign/Level.js';

describe('createGameForLevel — board (#1946)', () => {
  it('attaches a fresh board built from the level config', () => {
    const campaign = createCampaignState();
    const state = createGameForLevel(campaign, FIXTURE_ID)!;
    expect(state).not.toBeNull();
    expect(state.board).toBeDefined();
    expect(state.board!.config).toMatchObject(FIXTURE_BOARD);
    expect(state.board!.quarter).toBe(1);
    expect(state.board!.confidence).toBe(60);
    expect(state.board!.quarterStartTick).toBe(state.tickCount);
    expect(state.board!.oreDeliveredKg).toBe(0);
  });

  it('copies the config instead of aliasing the level definition', () => {
    const campaign = createCampaignState();
    const state = createGameForLevel(campaign, FIXTURE_ID)!;
    expect(state.board!.config).not.toBe(getLevel(FIXTURE_ID)!.board);
    state.board!.config.oreTargetT = 999;
    expect(getLevel(FIXTURE_ID)!.board!.oreTargetT).toBe(1);
    // a second game is unaffected by the first one's mutation
    const second = createGameForLevel(createCampaignState(), FIXTURE_ID)!;
    expect(second.board!.config.oreTargetT).toBe(1);
  });

  it('gives each game its own board object', () => {
    const a = createGameForLevel(createCampaignState(), FIXTURE_ID)!;
    const b = createGameForLevel(createCampaignState(), FIXTURE_ID)!;
    a.board!.confidence = 5;
    expect(b.board!.confidence).toBe(60);
  });

  it.each(['tutorial_pit', 'dusty_hollow'])('level %s (no board) has no board key', (id) => {
    const campaign = createCampaignState();
    const state = createGameForLevel(campaign, id)!;
    expect(state).not.toBeNull();
    expect('board' in state).toBe(false);
  });

  it('no shipped level defines a board', () => {
    const real = createCampaignState();
    for (const id of Object.keys(real.levels)) {
      if (id === FIXTURE_ID) continue;
      expect(getLevel(id)?.board, id).toBeUndefined();
    }
  });
});
