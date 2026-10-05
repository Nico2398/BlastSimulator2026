// BlastSimulator2026 — Fixture for #1380: a site whose only surveyor died with a survey queued.
//
// Shared by the unqualified-task effect, resolver and detection unit tests. The survey is ordered
// through runSurvey (so the $3000 order-time fee is really spent) and the surveyor is killed
// afterwards, which leaves exactly the state the issue reproduces: a queued `survey` action
// nobody on the roster can perform.

import { createGame, type GameState } from '../../src/core/state/GameState.js';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { hireEmployee, killEmployee, type Employee } from '../../src/core/entities/Employee.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
import { runSurvey } from '../../src/core/mining/SurveyCalc.js';
import { NavGrid } from '../../src/core/nav/NavGrid.js';
import { Random } from '../../src/core/math/Random.js';
import { classifyQueuedOrders } from '../../src/core/engine/OrderReachability.js';
import type { EventWorld } from '../../src/core/events/TrafficJamEffects.js';
import { SURVEY_COSTS } from '../../src/core/config/balance.js';

export const SIZE = 40;
export const SURVEY_FEE = SURVEY_COSTS.seismic;

export function makeFlatGrid(sizeX: number, sizeZ: number, surfaceY: number): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeZ);
  for (let z = 0; z < sizeZ; z++)
    for (let x = 0; x < sizeX; x++)
      for (let y = 0; y <= surfaceY; y++)
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
          density: 1.0, oreDensities: {}, fractureModifier: 1.0,
        });
  return grid;
}

export interface UnqualifiedSetup {
  world: EventWorld;
  state: GameState;
  /** The survey action nobody can perform. */
  actionId: number;
  surveyor: Employee;
  /** An alive, idle driver: the only possible trainee. Absent when `candidate: false`. */
  driver: Employee | null;
  /** Cash right after the survey was ordered (order fee already spent). */
  cashAfterOrder: number;
}

export interface UnqualifiedOptions {
  /** Build a geology_lab (the school for the missing `geology` skill). Default false. */
  school?: boolean;
  /** Keep an alive driver on the roster who could be trained. Default true. */
  candidate?: boolean;
  /** Cash before the survey order. Default 200000. */
  cash?: number;
  /** What happens to the surveyor after the order. Default 'dead'. */
  surveyorFate?: 'dead' | 'alive';
}

export function setupUnqualified(opts: UnqualifiedOptions = {}): UnqualifiedSetup {
  const { school = false, candidate = true, cash = 200000, surveyorFate = 'dead' } = opts;
  const state = createGame({ seed: 42 });
  state.cash = cash;
  state.finances.cash = cash;
  const grid = makeFlatGrid(SIZE, SIZE, 10);
  const rng = new Random(7);
  const { employee: surveyor } = hireEmployee(state.employees, 'surveyor', rng, 5.5, 5.5);
  const driver = candidate ? hireEmployee(state.employees, 'driver', rng, 8.5, 8.5).employee : null;
  if (school) {
    const placed = placeBuilding(state.buildings, 'geology_lab', 20, 20, SIZE, SIZE);
    if (!placed.success) throw new Error(`fixture: geology_lab not placeable: ${placed.error}`);
  }
  state.navGrid = NavGrid.buildNavGrid(grid, state.buildings.buildings, []);

  const ordered = runSurvey(state, { method: 'seismic', centerX: 12, centerZ: 12 });
  if (!ordered.success || ordered.actionId === undefined) throw new Error('fixture: survey order failed');
  if (surveyorFate === 'dead') killEmployee(state.employees, surveyor.id);
  classifyQueuedOrders(state);
  return {
    world: { state, grid }, state, actionId: ordered.actionId,
    surveyor, driver, cashAfterOrder: state.cash,
  };
}

/** Everything a resolution took out of the player's pocket: cash already moved plus cash the caller still applies. */
export function totalDebit(cashBefore: number, state: GameState, result: { cashChange: number }): number {
  return cashBefore - state.cash - result.cashChange;
}
