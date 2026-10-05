// BlastSimulator2026 — Effects of the player's answer to a traffic jam (#1208)

import type { GameState } from '../state/GameState.js';
import type { ScoreState } from '../scores/ScoreManager.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { TrafficJam } from './TrafficJams.js';
import { respreadLegDestination } from '../engine/Locomotion.js';
import { nextRampWidth, orderRampWiden, rampFootprint } from '../mining/RampWidening.js';
import { clampScore } from '../scores/ScoreManager.js';
import {
  TRAFFIC_JAM_IGNORE_SILENCE_TICKS,
  TRAFFIC_JAM_IGNORE_WELLBEING_PENALTY,
  TRAFFIC_JAM_REROUTE_SILENCE_TICKS,
  TRAFFIC_JAM_WIDEN_SILENCE_TICKS,
} from '../config/balance.js';

/** What a jam effect handler may touch. */
export interface EventWorld {
  state: GameState;
  grid: VoxelGrid | null;
}

export interface EffectOutcome {
  effects: string[];
  /** Cash for the caller to apply to the flat cash field. */
  cashChange: number;
  /** Cash this handler already debited itself; reported for the outcome chip only. */
  cashSettled: number;
  /** Score deltas this handler already applied; reported for the outcome chip only. */
  scoreChanges: Partial<Record<keyof ScoreState, number>>;
  /** '_alt' when the handler could not do what was asked and the fallback result text applies. */
  resultKeySuffix: '' | '_alt';
}

type JamEffectHandler = (jam: TrafficJam, world: EventWorld, tick: number) => EffectOutcome;

const UNCHANGED = { cashChange: 0, cashSettled: 0, scoreChanges: {} } as const;

function silence(world: EventWorld, jam: TrafficJam, tick: number, ticks: number): void {
  world.state.events.jamSilencedUntil[jam.key] = tick + ticks;
}

const rerouteVehicles: JamEffectHandler = (jam, world, tick) => {
  const ids = new Set(jam.agentIds);
  for (const emp of world.state.employees.employees) {
    if (!ids.has(emp.id)) continue;
    emp.vehicleWaitingTicks = 0;
    emp.isMoveStuck = false;
    respreadLegDestination(world.state, emp);
  }
  silence(world, jam, tick, TRAFFIC_JAM_REROUTE_SILENCE_TICKS);
  return { ...UNCHANGED, effects: [], resultKeySuffix: '' };
};

/**
 * Orders the ramp one width wider; orderRampWiden does the debit, so the cost is reported as cashSettled, not cashChange (the console mirror would double-debit).
 * Only widens within ground the site already owns. A widen that cannot be ordered still silences the chokepoint for the reroute duration: the queue is still there, and
 * without a cooldown the event re-fires on the very next tick and pauses the game again.
 */
const widenRamp: JamEffectHandler = (jam, world, tick) => {
  const { state, grid } = world;
  const failed = (): EffectOutcome => {
    silence(world, jam, tick, TRAFFIC_JAM_REROUTE_SILENCE_TICKS);
    return { ...UNCHANGED, effects: [], resultKeySuffix: '_alt' };
  };
  const ramp = jam.rampId === null ? undefined : state.builtRamps.find(r => r.id === jam.rampId);
  const toWidth = ramp ? nextRampWidth(ramp.width) : null;
  if (!ramp || toWidth === null || !grid || state.plannedRamps.some(p => p.widenOf === ramp.id)) return failed();
  // Claiming new ground (site expansion) is the console's job; an event answer
  // only widens within ground the site already owns.
  const f = rampFootprint(ramp.def, toWidth);
  for (let z = f.minZ; z <= f.maxZ; z++) for (let x = f.minX; x <= f.maxX; x++) if (!grid.containsColumn(x, z)) return failed();
  const ordered = orderRampWiden(state, grid, ramp.id, toWidth);
  if (!ordered.success) return failed();
  silence(world, jam, tick, TRAFFIC_JAM_WIDEN_SILENCE_TICKS);
  return { ...UNCHANGED, effects: [`Lost $${ordered.data.cost}`], cashSettled: -ordered.data.cost, resultKeySuffix: '' };
};

const ignoreJam: JamEffectHandler = (jam, world, tick) => {
  const scores = world.state.scores;
  const before = scores.wellBeing;
  scores.wellBeing = clampScore(before - TRAFFIC_JAM_IGNORE_WELLBEING_PENALTY);
  silence(world, jam, tick, TRAFFIC_JAM_IGNORE_SILENCE_TICKS);
  const delta = scores.wellBeing - before;
  return { ...UNCHANGED, effects: [], scoreChanges: delta === 0 ? {} : { wellBeing: delta }, resultKeySuffix: '' };
};

/** Handlers keyed by the event option's effect id. */
export const TRAFFIC_JAM_EFFECTS: Readonly<Record<string, JamEffectHandler>> = {
  reroute_vehicles: rerouteVehicles,
  widen_ramp: widenRamp,
  ignore_jam: ignoreJam,
};
