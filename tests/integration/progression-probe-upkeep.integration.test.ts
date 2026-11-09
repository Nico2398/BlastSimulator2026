// BlastSimulator2026 — Progression probe integration: upkeep through the low tail
//
// The probe strategies wait out a blasting ban, keep shots off their buildings and build only where the crew can climb. Split from progression-probe.integration.test.ts so the probe's
// long runs execute in parallel (tests/helpers/progressionProbe.ts says why).

import { describe, it, expect } from 'vitest';
import type { ProbeRunConfig } from '../../scripts/shared/probe-config.js';
import { runProbe } from '../../scripts/shared/probe-strategies.js';
import type { RunnerWithContext } from '../../src/console/createRunner.js';
import { pushModifier } from '../../src/core/events/ActiveModifiers.js';
import { startSandbox } from '../helpers/progressionProbe.js';

describe('probe upkeep through the low tail (#2126)', () => {
  /** Lifts after the opening shot is charged (about t250 on this site) and well inside one opening step. */
  const BAN_END_TICK = 600;

  it('the opening waits out an event\'s blasting ban and fires, instead of giving the run up', () => {
    const cfg: ProbeRunConfig = { seed: 42, biome: 'desert_badlands', kit: 'digger', strategy: 'opening', horizon: 900 };
    const r = runProbe(cfg, startSandbox(cfg, {}, (engine) => pushModifier(engine.ctx.state!.events, {
      kind: 'blast_ban', sourceEventId: '', role: null, targetId: null, category: null, magnitude: 1, startTick: 0, endTick: BAN_END_TICK,
    })));
    expect(r.endReason).toBeNull();
    expect(r.metrics.blastsFired).toBeGreaterThanOrEqual(1);
  }, 120000);

  it('reinvest keeps its shots off its own buildings', () => {
    // red_canyon digger seed 1 drilled its third shot across its depots at t2070 and lost every building at t2524.
    const cfg: ProbeRunConfig = { seed: 1, biome: 'red_canyon', kit: 'digger', strategy: 'reinvest', horizon: 2600, eventPolicy: 'cheapest' };
    const kept: { engine?: RunnerWithContext } = {};
    runProbe(cfg, startSandbox(cfg, kept));
    const types = kept.engine!.ctx.state!.buildings.buildings.map(b => b.type);
    expect(types).toContain('freight_warehouse');
    expect(types).toContain('spoil_heap');
  }, 240000);

  it('reinvest leaves no building order waiting on a site its crew cannot climb to', () => {
    // green_foothills digger seed 5 put its research centre on a terrace above the crew at t580.
    const cfg: ProbeRunConfig = { seed: 5, biome: 'green_foothills', kit: 'digger', strategy: 'reinvest', horizon: 900, eventPolicy: 'cheapest' };
    const kept: { engine?: RunnerWithContext } = {};
    runProbe(cfg, startSandbox(cfg, kept));
    const state = kept.engine!.ctx.state!;
    const stuck = state.pendingActions.filter(a => a.type === 'place_building' && a.blockedReason === 'target_unreachable');
    expect(stuck.map(a => `${a.targetX},${a.targetZ}`)).toEqual([]);
    expect([...state.buildings.buildings, ...state.plannedBuildings].some(b => b.type === 'research_center')).toBe(true);
  }, 180000);
});
