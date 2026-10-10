// @vitest-environment jsdom
//
// BlastSimulator2026 — Integration test: tutorial drill route (#1586)
//
// Human playtest: "the drill rig moves around and doesn't go straight to its
// target". selectBestActionForEmployee ranked by octile estimate, broke ties on
// lowest id and returned the first REACHABLE candidate, so from (26,24) it chose a
// hole 52.8 away over a tied hole 4.0 away (measured whole-route cost 243 vs 100).
//
// This replays the commands of scripts/scenario-defs/tutorial-interactive.json
// steps 0-20 (campaign start, hires, living quarters, vehicles, box-cut, 3x3
// drill plan) headlessly through the console runner, spies on every drill_hole
// selection the dispatcher makes, and asserts (a) each chosen hop is the cheapest
// real cost among its top-ACTION_SELECTION_MAX_PATH_ATTEMPTS shortlist, and
// (b) the whole 9-hole route cost is near the ~100 optimum, not the 243 baseline.
// The scenario file is read as data so the replay cannot drift from it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRunner } from '../../src/console/createRunner.js';
import * as ActionSelectionModule from '../../src/core/engine/ActionSelection.js';
import {
  estimateActionCost,
  resolveActionCost,
  computeActionWorkTicks,
} from '../../src/core/engine/ActionSelection.js';
import { ACTION_SELECTION_MAX_PATH_ATTEMPTS } from '../../src/core/config/balance.js';
import type { PendingAction } from '../../src/core/state/GameState.js';
import type { Run } from '../helpers/playthrough.js';

interface ScenarioStep { command?: string }

/** Upper bound for the whole 9-hole route (travel ticks); baseline 243, optimum ~100. */
const MAX_ROUTE_COST = 110;
const EPS = 1e-6;

interface Hop {
  actionId: number;
  fromX: number;
  fromZ: number;
  chosenReal: number;
  shortlistMinReal: number;
  travel: number;
}

afterEach(() => { vi.restoreAllMocks(); });

function replayTutorialDrillPlan(): { hops: Map<number, Hop>; holes: number } {
  const steps = (JSON.parse(readFileSync('scripts/scenario-defs/tutorial-interactive.json', 'utf8')) as { steps: ScenarioStep[] }).steps;
  const { runner, ctx } = createRunner();
  const run: Run = (cmd) => runner.run(cmd);
  const state = () => ctx.state!;

  const hops = new Map<number, Hop>();
  const original = ActionSelectionModule.selectBestActionForEmployee;
  vi.spyOn(ActionSelectionModule, 'selectBestActionForEmployee').mockImplementation(
    (st, employee, candidates, isClaimable) => {
      const result = original(st, employee, candidates, isClaimable);
      if (result !== null && result.action.type === 'drill_hole') {
        const claimable = candidates.filter((a: PendingAction) => (isClaimable ? isClaimable(a) : true));
        const shortlist = claimable
          .map((a: PendingAction) => ({ a, est: estimateActionCost(st, employee, a) }))
          .sort((p, q) => p.est - q.est || p.a.id - q.a.id)
          .slice(0, ACTION_SELECTION_MAX_PATH_ATTEMPTS);
        const reals = shortlist
          .map(({ a }) => resolveActionCost(st, employee, a)?.totalTicks)
          .filter((v): v is number => v !== undefined);
        // Last selection per action wins: that is the one that was executed.
        hops.set(result.action.id, {
          actionId: result.action.id,
          fromX: employee.x,
          fromZ: employee.z,
          chosenReal: result.totalTicks,
          shortlistMinReal: Math.min(...reals),
          travel: result.totalTicks - computeActionWorkTicks(st, employee, result.action),
        });
      }
      return result;
    },
  );

  const tick = (n: number, done: () => boolean = () => false) => {
    for (let i = 0; i < n && !done(); i++) {
      if (state().events.pendingEvent) run('event choose 0');
      run('tick 1');
    }
  };

  for (let i = 0; i <= 20; i++) {
    const command = steps[i]!.command!;
    const wait = /^wait_until field:(\w+) equals:(\d+) max_ticks:(\d+)/.exec(command);
    if (wait) {
      const [, field, value, max] = wait;
      const read = () => field === 'holeCount' ? state().drillHoles.length : state().buildings.buildings.length;
      tick(Number(max), () => read() === Number(value));
      continue;
    }
    if (command === 'state') continue;
    const result = run(command);
    expect(result.success, `step ${i} "${command}": ${result.output}`).toBe(true);
    if (command.startsWith('survey ')) tick(90);
  }
  return { hops, holes: state().drillHoles.length };
}

describe('tutorial drill route (#1586)', () => {
  const replay = replayTutorialDrillPlan();
  const hops = [...replay.hops.values()];

  it('drills all nine holes of the tutorial plan', () => {
    expect(replay.holes).toBe(9);
    expect(hops.length).toBe(9);
  });

  it('every chosen hop costs no more than the cheapest real cost in its top-5 shortlist', () => {
    for (const hop of hops) {
      expect(hop.chosenReal, `action ${hop.actionId} from ${hop.fromX},${hop.fromZ}`)
        .toBeLessThanOrEqual(hop.shortlistMinReal + EPS);
    }
  });

  it(`the whole 9-hole route costs at most ${MAX_ROUTE_COST} travel ticks (baseline 243)`, () => {
    const total = hops.reduce((sum, h) => sum + h.travel, 0);
    expect(total).toBeLessThanOrEqual(MAX_ROUTE_COST);
  });
});
