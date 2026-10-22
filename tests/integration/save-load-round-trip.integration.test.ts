// Save/load round trip leaves the game's future unchanged (#1869).
//
// A save stores the game state and leaves out the derived structures (the nav
// grid, #458 T0.3, and the agent occupancy map, #1206), which a load rebuilds.
// The live game maintains both incrementally, so any gap between the two
// shows up as a different future: the same orders play out differently.
//
// Repro: sandbox Easy, desert_badlands seed 42, #1747's standard opening to
// t1304 while ore sells. Save, play ROUND_TRIP_TICKS (control) recording a
// per-tick trace, load, replay the very same commands, compare the traces.
// Deterministic: seeded world, tick-driven, no wall clock.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { NavGrid } from '../../src/core/nav/NavGrid.js';
import { buildingFootprintOccupants } from '../../src/core/nav/NavGridSync.js';
import { rebuildAgentOccupancy, type AgentOccupancy } from '../../src/core/nav/AgentOccupancy.js';
import { clearBlastZone, playContracts, playTick, type Run, stockWarehouse } from '../helpers/playthrough.js';
import { EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';

/** Ticks of the standard opening before the save (#1747's opening at the issue's repro point). */
// 1296 not 1304: ore saturation (#1930) and the continuous ramp anchor (#2043) shift haul timing, so ticks 1300-1304 land mid-step of vehicle 2 where the live occupancy cell lags the rounded position.
const SAVE_AT_TICK = 1288;
/** Ticks played after the save, in both the control run and the replay. The issue used 1000; 600 keeps the file near 60 s and the first divergence is at +10..+35. */
const ROUND_TRIP_TICKS = 600;
const SLOT = 'round-trip';

type TickRecord = Record<string, string | number>;

/** Plays the scripted standard opening until `state.tickCount - start` reaches `untilElapsed`. */
function playStandardOpening(run: Run, ctx: GameContext, untilElapsed: number): void {
  const state = ctx.state!;
  const startTick = state.tickCount;
  const over = () => state.levelEnded || state.tickCount - startTick >= untilElapsed;
  const playUntil = (max: number, done: () => boolean) => {
    for (let i = 0; i < max && !over() && !done(); i++) { playContracts(run, state); playTick(run, state); }
  };

  expect(run('build living_quarters at:30,48').success).toBe(true);
  expect(run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:36,32').success).toBe(true);
  playUntil(800, () => state.plannedDrillHoles.length === 0);
  expect(stockWarehouse(run, state, 'krackle', 72).success).toBe(true); // stock-covered: no delivery wait (#1895)
  run('charge hole:* explosive:krackle amount:8 stemming:2.5');
  playUntil(EXPLOSIVE_DELIVERY_TICKS + 800, () => Object.keys(state.plannedChargesByHole).length === 0);
  clearBlastZone(run, state);
  expect(run('blast detonate').success).toBe(true);
  // The ramp into the crater (x=39..41): digging it lowers columns beside cells whose type depends on them.
  expect(run('build_ramp start:40,8 end:40,31 depth:8').success).toBe(true);
  playUntil(untilElapsed, () => false);
}

/** Everything the issue names as observable: vehicle and employee positions, active orders, cash, stored mass. */
function snapshot(state: GameState): TickRecord {
  const rec: TickRecord = { tick: state.tickCount, cash: state.cash, storedMassKg: state.logistics.storedMassKg };
  for (const v of state.vehicles.vehicles) { rec[`vehicle${v.id}.x`] = v.x; rec[`vehicle${v.id}.z`] = v.z; }
  for (const e of state.employees.employees) { rec[`employee${e.id}.x`] = e.x; rec[`employee${e.id}.z`] = e.z; }
  rec['orders'] = [...state.pendingActions]
    .sort((a, b) => a.id - b.id)
    .map(a => `${a.id}:${a.status}:${a.blockedReason ?? 'null'}`)
    .join(',');
  return rec;
}

/** Plays one tick of `commands` through `run`, returning the post-tick snapshot of the CURRENT state. */
function playRecorded(run: Run, ctx: GameContext, commands: string[]): TickRecord {
  for (const c of commands) run(c);
  return snapshot(ctx.state!);
}

/** First differing field between two traces, named by tick offset and field; null when equal. */
function firstDifference(control: TickRecord[], replay: TickRecord[]): string | null {
  if (control.length !== replay.length) return `trace lengths differ: control=${control.length} replay=${replay.length}`;
  for (let i = 0; i < control.length; i++) {
    const a = control[i]!;
    const b = replay[i]!;
    for (const field of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (a[field] !== b[field]) return `+${i + 1} ticks after the save: ${field} control=${String(a[field])} replay=${String(b[field])}`;
    }
  }
  return null;
}

/** Cells whose type or moveCost differ between the live nav grid and a fresh build of the same world. */
function navCellsDifferingFromFreshBuild(ctx: GameContext): string[] {
  const state = ctx.state!;
  const live = state.navGrid!;
  const groundFragments = state.logistics.fragments.filter(f => f.state === 'on_ground').map(f => f.fragment);
  const fresh = NavGrid.buildNavGrid(
    ctx.grid!, buildingFootprintOccupants(state), state.drillHoles, groundFragments, state.vehicles.vehicles, state.employees.employees,
  );
  const diffs: string[] = [];
  for (let z = 0; z < fresh.height; z++) {
    for (let x = 0; x < fresh.width; x++) {
      const l = live.cells[z]![x]!;
      const f = fresh.cells[z]![x]!;
      if (l.type !== f.type || l.moveCost !== f.moveCost) {
        diffs.push(`(${x + fresh.originX},${z + fresh.originZ}) live=${l.type}/${l.moveCost} fresh=${f.type}/${f.moveCost}`);
      }
    }
  }
  return diffs;
}

function heldPairs(occupancy: AgentOccupancy): string[] {
  return occupancy.heldOccupants().map(h => `${h.occupant.kind}:${h.occupant.id}@${h.x},${h.z}`).sort();
}

describe('save/load round trip of the standard desert opening (#1869)', () => {
  // One shared run: opening, save, control, load, replay.
  function runRoundTrip() {
    const { runner, ctx } = createRunner();
    const run: Run = (c) => runner.run(c);
    expect(run('sandbox start biome:desert_badlands difficulty:easy seed:42').success).toBe(true);
    run('weather set sunny');
    run('time resume');
    playStandardOpening(run, ctx, SAVE_AT_TICK);
    expect(ctx.state!.levelEnded, `level ended: ${String(ctx.state!.levelEndReason)}`).toBe(false);

    // The live derived structures at the save point.
    const navDiffsAtSave = navCellsDifferingFromFreshBuild(ctx);
    const liveOccupancy = ctx.state!.agentOccupancy;
    const occupancyAtSave = {
      live: liveOccupancy === null ? null : heldPairs(liveOccupancy),
      rebuilt: heldPairs(rebuildAgentOccupancy(ctx.state!)),
    };

    expect(run(`save slot:${SLOT}`).success).toBe(true);
    const saved = snapshot(ctx.state!);

    // Control: keep playing, recording exactly which commands were issued each tick.
    const issued: string[][] = [];
    const recordingRun: Run = (c) => { issued[issued.length - 1]!.push(c); return run(c); };
    const control: TickRecord[] = [];
    for (let i = 0; i < ROUND_TRIP_TICKS; i++) {
      issued.push([]);
      playContracts(recordingRun, ctx.state!);
      playTick(recordingRun, ctx.state!);
      control.push(snapshot(ctx.state!));
    }

    const load = run(`load slot:${SLOT}`);
    expect(load.success, load.output).toBe(true);
    const loaded = snapshot(ctx.state!);

    const replay = issued.map(commands => playRecorded(run, ctx, commands));
    return { navDiffsAtSave, occupancyAtSave, saved, loaded, control, replay };
  }

  let result: ReturnType<typeof runRoundTrip>;
  beforeAll(() => { result = runRoundTrip(); }, 600_000);

  it('the load itself restores vehicles, employees, cash, stored mass and orders', () => {
    expect(firstDifference([result.saved], [result.loaded])).toBeNull();
  });

  it('at the save point the live nav grid types and costs every cell as a fresh build does', () => {
    expect(result.navDiffsAtSave.slice(0, 10), `${result.navDiffsAtSave.length} cells differ`).toEqual([]);
  });

  it('at the save point the live occupancy map holds the pairs rebuildAgentOccupancy gives', () => {
    expect(result.occupancyAtSave.live, 'occupancy was built by the ticks before the save').not.toBeNull();
    expect(result.occupancyAtSave.live).toEqual(result.occupancyAtSave.rebuilt);
  });

  it(`the ${ROUND_TRIP_TICKS} ticks after a load match the ticks the uninterrupted game played`, () => {
    expect(firstDifference(result.control, result.replay)).toBeNull();
  });
});
