// BlastSimulator2026 — The world-sound budget of a played game
// One place for "how many world sounds may a busy mine ask for", so every game run in the crowding tests is
// held to the same ceilings. World sounds are what the director plays on its own: everything except the
// blast timeline and the cues that answer the player's own commands.

import { expect } from 'vitest';
import type { CrowdSim, PlayRecord } from '../../../helpers/audioCrowding.js';
import { isBlastSound, peakIn } from '../../../helpers/audioCrowdingStats.js';

export const worldPlays = (sim: CrowdSim): PlayRecord[] => sim.recorder.heard.filter(p => p.source === 'director' && !isBlastSound(p.id));

/**
 * Most plays of one kind of world sound in any 30 real seconds. Each is the measured worst over the played games
 * with headroom (work_drill 8, work_hammer 13, vehicle_start 6, drill_done 6, charge_loaded 6, boulder_break 10,
 * haul_load 7, haul_dump 7, shift_bell 2, worker_collapse 4); a kind not listed was never heard more than twice.
 * vehicle_start, shift_bell, worker_collapse, drill_done and charge_loaded are spaced in real time by the director
 * (EVENT_CUES.spacingS, FLAG_CUES, DIFF_CONFIG), so these ceilings hold at any game speed.
 */
const CEILING_PER_30S: Readonly<Record<string, number>> = {
  work_drill: 12,
  work_hammer: 18,
  vehicle_start: 7,
  drill_done: 8,
  charge_loaded: 8,
  boulder_break: 12,
  haul_load: 8,
  haul_dump: 8,
  shift_bell: 2,
  worker_collapse: 5,
};
const DEFAULT_CEILING_PER_30S = 3;

interface WorldWindowLimits {
  /** Most world sounds starting in any one second, ten and thirty. */
  readonly per1s: number;
  readonly per10s: number;
  readonly per30s: number;
}

/**
 * The world never exceeds the window limits, and no kind of sound exceeds its own ceiling. `raised` lifts the
 * ceiling of a kind for a game that is known to provoke it (a purchase spree); it never lowers one.
 */
export function expectWorldWithinBudget(sim: CrowdSim, limits: WorldWindowLimits, raised: Readonly<Record<string, number>> = {}): void {
  const world = worldPlays(sim);
  expect(peakIn(world, 1), 'world sounds in one second').toBeLessThanOrEqual(limits.per1s);
  expect(peakIn(world, 10), 'world sounds in ten seconds').toBeLessThanOrEqual(limits.per10s);
  expect(peakIn(world, 30), 'world sounds in thirty seconds').toBeLessThanOrEqual(limits.per30s);
  for (const id of new Set(world.map(p => p.id))) {
    expect(peakIn(world.filter(p => p.id === id), 30), `${id} in thirty seconds`).toBeLessThanOrEqual(Math.max(raised[id] ?? 0, CEILING_PER_30S[id] ?? DEFAULT_CEILING_PER_30S));
  }
}
