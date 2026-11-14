// BlastSimulator2026 — a console double for the water fixes (#2267)
//
// Applies the three commands the water fixes may send (`drain_hole`, `install_tubing`, `buy`)
// to a state through the same core operations the real console uses, and records every command.

import { vi } from 'vitest';
import type { GameState } from '../../src/core/state/GameState.js';
import { drainHoles } from '../../src/core/mining/HoleDrain.js';
import { buyTubing, installTubing } from '../../src/core/mining/Tubing.js';
import { createGame } from '../../src/core/state/GameState.js';
import { addHole } from '../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../src/core/mining/ChargePlan.js';
import { setHoleWater } from './holeWater.js';

export function waterFixConsole(state: GameState) {
  return vi.fn((cmd: string) => {
    const hole = /hole:(\S+)/.exec(cmd)?.[1];
    if (cmd.startsWith('drain_hole') && hole) {
      const r = drainHoles(state, [hole]);
      return { success: r.drained.length > 0, output: '' };
    }
    if (cmd.startsWith('install_tubing') && hole) {
      const r = installTubing(state.tubingState, hole, state.drillHoles.map(h => h.id));
      return { success: r.success, output: r.message };
    }
    const amount = /^buy amount:(\d+)/.exec(cmd)?.[1];
    if (amount) {
      const r = buyTubing(state.tubingState, Number(amount), state.cash);
      if (r.success) state.cash -= r.cost;
      return { success: r.success, output: r.message };
    }
    return { success: false, output: `unexpected command: ${cmd}` };
  });
}

export interface WaterScene {
  holes: number;
  /** Explosive on every hole; null leaves them uncharged. */
  explosive?: string | null;
  /** Hole water level; omit for dry holes. */
  wetLevel?: number;
  porosity?: number;
  cash?: number;
  stock?: number;
  weather?: GameState['weather']['current'];
}

/** A desert game whose holes, charges, water, cash, tubing stock and weather follow `scene`. */
export function waterScene(scene: WaterScene): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  const counter = { nextHoleId: 1 };
  const explosive = scene.explosive === undefined ? 'boomite' : scene.explosive;
  for (let i = 0; i < scene.holes; i++) {
    const hole = addHole(counter, state.drillHoles, 20 + i * 3, 20, 8, 0.15);
    if (explosive === null) continue;
    const c = createCharge(explosive, 5, 2, hole.depth);
    if ('charge' in c) state.chargesByHole[hole.id] = c.charge;
  }
  if (scene.wetLevel !== undefined) setHoleWater(state, state.drillHoles.map(h => h.id), scene.wetLevel, scene.porosity ?? 0.03);
  state.cash = scene.cash ?? 10_000;
  state.tubingState.inventory = scene.stock ?? 0;
  state.weather.current = scene.weather ?? 'sunny';
  return state;
}
