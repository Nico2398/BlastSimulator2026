// BlastSimulator2026 — shared integration fixtures: a real single-hole blast on
// tutorial_pit that leaves a climb-disconnected pocket (#1302, #1306).

import { expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';

/** Keeps every living employee's fatigue topped up so a long drill/haul run is never derailed by a needs collapse mid-drive (mirrors blast-report-modal-save-load.integration.test.ts's fireBlast helper). */
function refreshFatigue(state: GameState): void {
  for (const emp of state.employees.employees) emp.fatigue = 100;
}

/** Runs `tick 1` up to `maxTicks` times, refreshing fatigue every round, until `predicate()` holds. */
export function tickUntilFresh(run: (cmd: string) => unknown, state: GameState, predicate: () => boolean, maxTicks: number): void {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    refreshFatigue(state);
    run('tick 1');
  }
}

/**
 * Hires a driver on a level with a scripted hiring pool (#1600): the pool offers one
 * candidate per role, so a second driver needs the next daily refresh, which restores
 * the scripted candidate. Ticks one at a time (fatigue refreshed) until one is on offer.
 */
export function hireDriver(run: (cmd: string) => unknown, state: GameState): void {
  tickUntilFresh(run, state, () => state.hiringPool.candidates.some(c => c.role === 'driver'), 100);
  expect(run('employee hire role:driver')).toMatchObject({ success: true });
}

/** The tutorial_pit NavGrid cells a direct trace confirmed permanently climb-disconnected (NAV_CLEARANCE_VEHICLE_CELLS) from the freight_warehouse's approach cell, for the (18,10) amount:5 blast (#1723). */
export const POCKET_CELLS: ReadonlySet<string> = new Set(['18,8', '17,9', '18,9', '19,9', '17,10', '18,10', '19,10', '18,11', '19,11']);
export function isPocketCell(x: number, z: number): boolean {
  return POCKET_CELLS.has(`${x},${z}`);
}

/** Buys a charging truck and makes `employeeId` a blasting + driving.truck charger (#1649). */
export function buyChargingTruck(run: (cmd: string) => unknown, state: GameState, employeeId: number): void {
  expect(run('vehicle buy charging_truck')).toMatchObject({ success: true });
  expect(run(`employee assign_skill ${employeeId} skill:driving.truck level:1`)).toMatchObject({ success: true });
  expect(run(`employee assign_skill ${employeeId} skill:blasting level:1`)).toMatchObject({ success: true });
  expect(state.vehicles.vehicles.some(v => v.type === 'charging_truck')).toBe(true);
}

/**
 * Hires a driller, licenses them for the drill_rig, drills+charges
 * a single hole at (startX, startZ) with the given charge amount (spacing:3
 * depth:6 diameter:0.089, stemming:2 — this file's own verified parameters),
 * then detonates it. Returns the runner/state plus a bound `run` so callers
 * can continue driving ticks afterward.
 */
export function drillChargeAndBlast(startX: number, startZ: number, amount: number, cash = 250000): { run: (cmd: string) => unknown; state: GameState } {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);

  expect(run(`campaign start level:tutorial_pit cash:${cash}`)).toMatchObject({ success: true });
  const state = ctx.state!;

  expect(run('employee hire role:driller')).toMatchObject({ success: true });
  const driller = state.employees.employees.find(e => e.role === 'driller')!;

  expect(run('vehicle buy drill_rig')).toMatchObject({ success: true });
  expect(run(`employee assign_skill ${driller.id} skill:driving.drill_rig level:1`)).toMatchObject({ success: true });
  // Charging is worked from a charging truck by a blasting + driving.truck crew member (#1649).
  buyChargingTruck(run, state, driller.id);

  expect(run(`drill_plan grid rows:1 cols:1 spacing:3 depth:6 start:${startX},${startZ} diameter:0.089`)).toMatchObject({ success: true });
  tickUntilFresh(run, state, () => state.plannedDrillHoles.length === 0, 400);
  expect(state.plannedDrillHoles.length).toBe(0);
  expect(state.drillHoles.length).toBe(1);

  expect(run(`charge hole:* explosive:boomite amount:${amount} stemming:2`)).toMatchObject({ success: true });
  tickUntilFresh(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 400);
  expect(Object.keys(state.plannedChargesByHole).length).toBe(0);

  expect(run('blast')).toMatchObject({ success: true });
  expect(state.lastBlastReport).not.toBeNull();

  return { run, state };
}

/** Hires an excavator-licensed driver, buys a rock_digger and crews it, so a built ramp actually gets carved. */
export function crewRockDigger(run: (cmd: string) => unknown, state: GameState): void {
  hireDriver(run, state);
  const diggerDriver = [...state.employees.employees].reverse().find(e => e.role === 'driver')!;
  expect(run(`employee assign_skill ${diggerDriver.id} skill:driving.excavator level:5`)).toMatchObject({ success: true });
  expect(run('vehicle buy rock_digger')).toMatchObject({ success: true });
  const digger = state.vehicles.vehicles.find(v => v.type === 'rock_digger')!;
  expect(run(`vehicle driver ${digger.id} ${diggerDriver.id}`)).toMatchObject({ success: true });
}

/** A sandite rubble fragment of `massKg` resting beside `origin`, for fixtures that inject muck without firing a blast. */
export function makeRubbleFragment(id: number, massKg: number, origin: { x: number; y: number; z: number }): FragmentData {
  return {
    id,
    position: { x: origin.x + (id % 5), y: origin.y, z: origin.z + Math.floor(id / 5) },
    volume: massKg / 2500,
    mass: massKg,
    rockId: 'sandite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
    origin,
  };
}
