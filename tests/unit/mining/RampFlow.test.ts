// BlastSimulator2026 — Unit tests: one-way ramps, the traffic setting and the field vehicle routes read it from.

import { describe, it, expect } from 'vitest';
import {
  isRampFlowSetting, nextRampFlowSetting, rampFlowField, rampFlowSetting, setRampFlow, RAMP_FLOW_SETTINGS,
} from '../../../src/core/mining/RampFlow.js';
import { createGame, type BuiltRamp, type GameState } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { deserialize, serialize } from '../../../src/core/state/SaveLoad.js';

const W = 20;
const H = 20;

function grid(): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < H; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < W; x++) row.push({ type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false, clearance: 2 });
    cells.push(row);
  }
  return new NavGrid(W, H, cells);
}

/** A straight 3-wide ramp running south from (x, 2), 8 tiles long. */
function ramp(id: number, x: number): BuiltRamp {
  return {
    id, def: { originX: x, originZ: 2, direction: 'south', length: 8, targetDepth: 3, width: 3 }, width: 3,
    footprint: { minX: x - 1, maxX: x + 1, minZ: 2, maxZ: 9 },
  };
}

function site(...ramps: BuiltRamp[]): GameState {
  setLocale('en');
  const state = createGame({ seed: 42 });
  state.navGrid = grid();
  state.builtRamps.push(...ramps);
  return state;
}

const at = (field: Int8Array, x: number, z: number): number => field[z * W + x]!;

describe('ramp traffic settings', () => {
  it('names two-way, down only and up only, and nothing else', () => {
    expect([...RAMP_FLOW_SETTINGS]).toEqual(['both', 'down', 'up']);
    expect(isRampFlowSetting('down')).toBe(true);
    expect(isRampFlowSetting('sideways')).toBe(false);
  });

  it('reads a ramp with no flow as two-way', () => {
    expect(rampFlowSetting(ramp(1, 5))).toBe('both');
    expect(rampFlowSetting({ ...ramp(1, 5), flow: 'up' })).toBe('up');
  });

  it('cycles two-way, down only, up only, then two-way again', () => {
    expect(nextRampFlowSetting('both')).toBe('down');
    expect(nextRampFlowSetting('down')).toBe('up');
    expect(nextRampFlowSetting('up')).toBe('both');
  });
});

describe('setRampFlow', () => {
  it('sets a ramp one-way, and back to two-way with no flow left on it', () => {
    const state = site(ramp(1, 5));
    expect(setRampFlow(state, 1, 'down')).toEqual({ success: true });
    expect(state.builtRamps[0]!.flow).toBe('down');
    expect(setRampFlow(state, 1, 'both')).toEqual({ success: true });
    expect('flow' in state.builtRamps[0]!).toBe(false);
  });

  it('survives a save and load, and a two-way ramp loads two-way', () => {
    const state = site({ ...ramp(1, 5), flow: 'up' }, ramp(2, 12));
    const loaded = deserialize(serialize(state));
    expect(loaded.builtRamps.map(rampFlowSetting)).toEqual(['up', 'both']);
  });

  it('refuses a ramp that is not built', () => {
    const result = setRampFlow(site(ramp(1, 5)), 7, 'up');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('7');
  });
});

describe('rampFlowField', () => {
  it('is null while every ramp is two-way, and with no nav grid', () => {
    expect(rampFlowField(site(ramp(1, 5)))).toBeNull();
    const state = site({ ...ramp(1, 5), flow: 'down' });
    state.navGrid = null;
    expect(rampFlowField(state)).toBeNull();
  });

  it('marks a down-only corridor 1 and an up-only corridor -1, and leaves the rest 0', () => {
    const field = rampFlowField(site({ ...ramp(1, 5), flow: 'down' }, { ...ramp(2, 12), flow: 'up' }))!;
    expect(at(field, 4, 2)).toBe(1);
    expect(at(field, 6, 9)).toBe(1);
    expect(at(field, 11, 5)).toBe(-1);
    expect(at(field, 13, 9)).toBe(-1);
    expect(at(field, 5, 10)).toBe(0);
    expect(at(field, 8, 5)).toBe(0);
  });

  it('gives a tile two corridors share the older ramp\'s direction', () => {
    const field = rampFlowField(site({ ...ramp(1, 5), flow: 'down' }, { ...ramp(2, 6), flow: 'up' }))!;
    expect(at(field, 5, 5)).toBe(1);
    expect(at(field, 7, 5)).toBe(-1);
  });

  it('is reused while nothing changes and rebuilt when a ramp\'s direction does', () => {
    const state = site({ ...ramp(1, 5), flow: 'down' });
    const first = rampFlowField(state);
    expect(rampFlowField(state)).toBe(first);
    setRampFlow(state, 1, 'up');
    const second = rampFlowField(state)!;
    expect(second).not.toBe(first);
    expect(at(second, 5, 5)).toBe(-1);
  });
});
