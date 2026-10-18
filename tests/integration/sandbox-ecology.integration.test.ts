// Sandbox ecology under ordinary play and neglect, through the real console runner (#1733).
//
// #1691 made ecology respond to play, but rubble dust sat at a cap while muck lay
// on the ground, so one ordinary 3x3 blast shut a Normal sandbox down about 700
// ticks later and the kit's single spoil heap could not offset it. These runs pin
// the intended scale: ordinary play (one blast every ~600 ticks, one heap) survives
// and its ecology dips then recovers; neglect still ends in ecological_shutdown;
// extra heaps help but do not immunise; the shutdown warning leaves room to act.
//
// Nothing here relies on the crew clearing the crater (#1723): the neglect and
// rapid-blast runs inject rubble the crew never touches, and the ordinary run holds
// whatever the crew does or does not haul.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
import { addBlastFragments } from '../../src/core/economy/Logistics.js';
import { ECOLOGICAL_SHUTDOWN_TICKS, ECOLOGICAL_WARNING_TICKS, EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';
import { playTick, type Run } from '../helpers/playthrough.js';
import { makeRubbleFragment } from '../helpers/blastFixtures.js';

const RUN_TICKS = 3000;
const BLAST_INTERVAL = 600;
const SAMPLE_EVERY = 50;
const GRID = 64;

interface Site {
  run: Run;
  state: GameState;
  /** Ecology sampled every SAMPLE_EVERY ticks, with the tick it was read at. */
  samples: Array<{ tick: number; ecology: number }>;
  warnings: number[];
}

function topUp(state: GameState): void {
  state.cash = 5_000_000;
  state.finances.cash = 5_000_000;
}

function heapCount(state: GameState): number {
  return state.buildings.buildings.filter(b => b.type === 'spoil_heap').length;
}

/** Places a building instantly on the first free tile of a coarse scan (the crew is not needed). */
function placeSomewhere(state: GameState, type: 'spoil_heap' | 'living_quarters'): void {
  for (let x = 4; x < GRID - 8; x += 6) {
    for (let z = 4; z < GRID - 8; z += 6) {
      if (placeBuilding(state.buildings, type, x, z, GRID, GRID, 1).success) return;
    }
  }
  throw new Error(`no free tile for ${type}`);
}

function startSite(opts: { heaps?: number } = {}): Site {
  const { runner, ctx } = createRunner();
  const run: Run = cmd => runner.run(cmd);
  expect(run('sandbox start biome:desert_badlands seed:42 difficulty:normal').success).toBe(true);
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0; // only the player's choices move ecology
  topUp(state);
  placeSomewhere(state, 'living_quarters');
  expect(heapCount(state), 'the Normal kit opens with one spoil heap').toBe(1);
  if (opts.heaps !== undefined) {
    while (heapCount(state) > opts.heaps) {
      const i = state.buildings.buildings.findIndex(b => b.type === 'spoil_heap');
      state.buildings.buildings.splice(i, 1);
    }
    while (heapCount(state) < opts.heaps) placeSomewhere(state, 'spoil_heap');
  }
  run('time resume');
  const site: Site = { run, state, samples: [], warnings: [] };
  return site;
}

/** One tick with fatigue and cash kept up, sampling ecology on the sample grid. */
function step(site: Site): void {
  const { state } = site;
  for (const e of state.employees.employees) e.fatigue = 100;
  // Only ecology is under test: keep the other lose conditions (revolt, bankruptcy) out of the way.
  state.scores.wellBeing = Math.max(state.scores.wellBeing, 80);
  state.scores.safety = Math.max(state.scores.safety, 80);
  if (state.cash < 1_000_000) topUp(state);
  playTick(site.run, state);
  if (state.tickCount % SAMPLE_EVERY === 0) site.samples.push({ tick: state.tickCount, ecology: state.scores.ecology });
  if (state.ecological.warningFired && site.warnings.length === 0) site.warnings.push(state.tickCount);
}

function ticks(site: Site, n: number, stop: () => boolean = () => false): void {
  for (let i = 0; i < n && !site.state.levelEnded && !stop(); i++) step(site);
}

/**
 * Drill, charge and fire the 3x3 krackle 8 kg pattern at (36,28) the way a player does, holding the
 * shot until `notBefore` so the pattern goes off about every BLAST_INTERVAL ticks. Drilling and
 * charging take as long as they take, so an interval can stretch past BLAST_INTERVAL.
 */
const PATTERN_STARTS = ['36,28', '24,28', '36,42', '24,42', '48,28'];
let patternIndex = 0;

/** Fires one pattern; returns the ecology the instant before the shot. */
function fireOrdinaryPattern(site: Site, notBefore: number): number {
  const { run, state } = site;
  const start = PATTERN_STARTS[patternIndex++ % PATTERN_STARTS.length]!; // fresh ground each shot: the last crater is not drillable
  const alive = (phase: string) => expect(state.levelEnded, `level ended during ${phase}: ${String(state.levelEndReason)}`).toBe(false);
  alive('start');
  const planned = run(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${start}`);
  expect(planned.success, planned.output).toBe(true);
  ticks(site, 1500, () => state.plannedDrillHoles.length === 0);
  alive('drilling');
  const charged = run('charge hole:* explosive:krackle amount:8 stemming:2');
  expect(charged.success, charged.output).toBe(true);
  ticks(site, EXPLOSIVE_DELIVERY_TICKS + 1500, () => Object.keys(state.plannedChargesByHole).length === 0);
  alive('charging');
  ticks(site, Math.max(0, notBefore - state.tickCount - 40));
  alive('waiting for the next shot');
  clearBlastZone(site);
  topUp(state);
  const pre = state.scores.ecology;
  const fired = run('blast');
  expect(fired.success, fired.output).toBe(true);
  return pre;
}

/**
 * Order everyone out of the blast radius and wait for the zone to read clear (the Blast panel's evacuate control).
 * Kept local rather than using helpers/playthrough.ts clearBlastZone: that one waits with bare playTick, while
 * this run needs step()'s per-tick fatigue/score/cash upkeep so the wait cannot trip another lose condition.
 */
function clearBlastZone(site: Site): void {
  const { run, state } = site;
  const xs = state.drillHoles.map(h => h.x);
  const zs = state.drillHoles.map(h => h.z);
  const m = 16;
  run(`zone clear x1:${Math.min(...xs) - m} y1:${Math.min(...zs) - m} x2:${Math.max(...xs) + m} y2:${Math.max(...zs) + m}`);
  ticks(site, 80, () => { const z = run('zone status').output; return z.includes('CLEAR') && !z.includes('NOT'); });
}

let nextFragmentId = 1_000_000;
/** A blast's worth of muck the crew never reaches, as a pile of 20 t pieces (fewer pieces keep the tick fast). */
function dropRubble(state: GameState, tonnes: number): void {
  const pieces = Array.from({ length: Math.ceil(tonnes / 20) }, () => makeRubbleFragment(nextFragmentId++, 20_000, { x: 40, y: 0, z: 30 }));
  addBlastFragments(state.logistics, pieces);
}

describe('sandbox ecology under ordinary play (#1733)', () => {
  it('a Normal kit firing the 3x3 pattern every ~600 ticks is not shut down within 3000 ticks, and ecology dips then recovers', () => {
    const site = startSite();
    const { state } = site;
    const windows: Array<{ pre: number; startSample: number }> = [];
    let notBefore = 0;
    while (!state.levelEnded && state.tickCount < RUN_TICKS) {
      const pre = fireOrdinaryPattern(site, notBefore);
      windows.push({ pre, startSample: site.samples.length });
      notBefore = state.tickCount + BLAST_INTERVAL;
    }
    ticks(site, Math.max(0, RUN_TICKS - state.tickCount));

    expect(state.levelEndReason, `ended ${String(state.levelEndReason)}`).not.toBe('ecological_shutdown');
    expect(state.ecological.shutdown).toBe(false);
    expect(state.levelEnded, `level ended: ${String(state.levelEndReason)}`).toBe(false);
    expect(windows.length, 'at least two blasts were fired').toBeGreaterThanOrEqual(2);
    let assertedWindows = 0;

    for (let w = 0; w < windows.length; w++) {
      const win = windows[w]!;
      const end = windows[w + 1]?.startSample ?? site.samples.length;
      const after = site.samples.slice(win.startSample, end);
      if (after.length < (w + 1 < windows.length ? 3 : 8)) continue; // a shot near the end leaves no room to recover
      const min = Math.min(...after.map(s => s.ecology));
      expect(min, `blast ${w + 1}: ecology dips below its pre-blast level ${win.pre.toFixed(1)}`).toBeLessThan(win.pre - 1);
      const minIdx = after.findIndex(s => s.ecology === min);
      const later = after.slice(minIdx + 1);
      expect(later.some(s => s.ecology > min + 1), `blast ${w + 1}: ecology recovers above its minimum ${min.toFixed(1)}`).toBe(true);
      assertedWindows++;
    }
    expect(assertedWindows, 'at least one blast window was long enough to assert dip and recovery').toBeGreaterThanOrEqual(1);
  }, 600_000);
});

describe('sandbox ecology under neglect (#1733)', () => {
  it('no heaps and a blast of rubble left lying reaches ecological_shutdown', () => {
    const site = startSite({ heaps: 0 });
    const { state } = site;
    ticks(site, 50);
    dropRubble(state, 2344);
    ticks(site, 4000, () => state.ecological.shutdown);
    expect(state.ecological.shutdown).toBe(true);
    expect(state.levelEndReason).toBe('ecological_shutdown');
  }, 600_000);

  it('the kit heap with a blast every ~100 ticks and no hauling reaches ecological_shutdown', () => {
    const site = startSite();
    const { state } = site;
    for (let i = 0; i < 40 && !state.ecological.shutdown; i++) {
      dropRubble(state, 2344);
      ticks(site, 100, () => state.ecological.shutdown);
    }
    expect(state.ecological.shutdown).toBe(true);
    expect(state.levelEndReason).toBe('ecological_shutdown');
  }, 600_000);

  it('three heaps and rapid blasting still decline: they do not hold ecology at 100', () => {
    const site = startSite({ heaps: 3 });
    const { state } = site;
    ticks(site, 400);
    expect(state.scores.ecology).toBeGreaterThan(95);
    for (let i = 0; i < 20 && !state.levelEnded; i++) {
      dropRubble(state, 2344);
      ticks(site, 100);
    }
    const min = Math.min(...site.samples.map(s => s.ecology));
    expect(min, 'rapid blasting with 3 heaps pulls ecology well down').toBeLessThan(60);
    expect(state.scores.ecology).toBeLessThan(100);
  }, 600_000);

  it('doing nothing after the warning still ends in shutdown', () => {
    const site = startSite({ heaps: 0 });
    const { state } = site;
    ticks(site, 50);
    dropRubble(state, 5000);
    ticks(site, 4000, () => state.ecological.shutdown);
    expect(site.warnings.length, 'the warning fired first').toBe(1);
    expect(state.ecological.shutdown).toBe(true);
  }, 600_000);
});

describe('sandbox ecology warning turnaround (#1733)', () => {
  it('after the warning fires, adding spoil heaps lifts ecology off 0, resets ticksAtZero and avoids shutdown', () => {
    const site = startSite({ heaps: 0 });
    const { state } = site;
    ticks(site, 50);
    dropRubble(state, 2344);
    ticks(site, 4000, () => state.ecological.warningFired);
    expect(state.ecological.warningFired, 'the shutdown warning fired').toBe(true);
    expect(state.ecological.shutdown).toBe(false);
    expect(state.ecological.ticksAtZero).toBeGreaterThanOrEqual(ECOLOGICAL_WARNING_TICKS);
    expect(state.ecological.ticksAtZero).toBeLessThan(ECOLOGICAL_SHUTDOWN_TICKS);

    for (let i = 0; i < 4; i++) placeSomewhere(state, 'spoil_heap');
    ticks(site, 5);
    expect(state.scores.ecology, 'heap gain counts again at 0').toBeGreaterThan(0);
    expect(state.ecological.ticksAtZero, 'ticksAtZero reset').toBe(0);

    ticks(site, ECOLOGICAL_SHUTDOWN_TICKS * 2);
    expect(state.ecological.shutdown).toBe(false);
    expect(state.levelEndReason).not.toBe('ecological_shutdown');
  }, 600_000);
});
