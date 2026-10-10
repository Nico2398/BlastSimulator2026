// BlastSimulator2026 — Integration: host transitions never relocate a movement trail (#1588)
//
// Replays the interactive tutorial scenario headlessly (command mode, the same
// engine `npm run scenarios` uses) and, after every tick batch, checks that an
// employee who boarded, alighted, entered or left a host has an unrelocated
// trail carrying one marker per transition, and that every leave was announced
// with `employee:left_building`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createGameEngine } from '../../scripts/shared/command-runner.js';
import { findWaitUntilAction } from '../../scripts/shared/command-runner.js';
import { resolveRepeatCount } from '../../scripts/shared/scenario-utils.js';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { runCommand } from '../../src/console/createRunner.js';
import { serializeGameState } from '../../src/console-api.js';
import { hasLevelEnded } from '../../src/core/engine/GameOverConditions.js';
import { MOVEMENT_TRAIL_MAX_POINTS, type TrailHostEvent } from '../../src/core/entities/MovementTrail.js';

type Tally = Record<TrailHostEvent, Map<number, number>>;
const newTally = (): Tally => ({ board: new Map(), alight: new Map(), enter: new Map(), leave: new Map() });
const bump = (m: Map<number, number>, id: number) => m.set(id, (m.get(id) ?? 0) + 1);

describe('movement trail host transitions over the tutorial-interactive replay (#1588)', () => {
  it('no board/alight/enter/leave relocates a trail, and every leave emits employee:left_building', () => {
    const def = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/scenario-defs/tutorial-interactive.json'), 'utf8')) as { steps: ScenarioStepDef[] };
    const engine = createGameEngine();
    const { ctx } = engine;

    let events = newTally();
    ctx.emitter.on('employee:mounted', e => bump(events.board, e.employeeId));
    ctx.emitter.on('employee:alighted', e => bump(events.alight, e.employeeId));
    ctx.emitter.on('employee:entered_building', e => bump(events.enter, e.employeeId));
    ctx.emitter.on('employee:left_building', e => bump(events.leave, e.employeeId));

    const totals: Record<TrailHostEvent, number> = { board: 0, alight: 0, enter: 0, leave: 0 };
    const problems: string[] = [];

    const checkBatch = (label: string) => {
      const state = ctx.state;
      if (!state) return;
      for (const emp of state.employees.employees) {
        const trail = emp.walkTrail;
        if (!trail) continue;
        const markers = { board: 0, alight: 0, enter: 0, leave: 0 } as Record<TrailHostEvent, number>;
        for (const m of trail.hostMarkers) markers[m.event]++;
        const transitions = (['board', 'alight', 'enter', 'leave'] as const).reduce((n, k) => n + (events[k].get(emp.id) ?? 0), 0);
        if (transitions === 0) continue;
        for (const k of ['board', 'alight', 'enter', 'leave'] as const) totals[k] += events[k].get(emp.id) ?? 0;
        if (trail.relocated) problems.push(`${label}: employee ${emp.id} trail relocated across a host transition`);
        if (trail.points.length >= MOVEMENT_TRAIL_MAX_POINTS) continue; // markers may have been trimmed
        for (const k of ['board', 'alight', 'enter', 'leave'] as const) {
          const expected = events[k].get(emp.id) ?? 0;
          if (markers[k] !== expected) problems.push(`${label}: employee ${emp.id} has ${markers[k]} '${k}' marker(s), expected ${expected}`);
        }
      }
    };

    const runTracked = (cmd: string, label: string) => {
      events = newTally();
      // Re-point the listeners' target: handlers close over `events` by variable, so reassigning is enough.
      const insideBefore = new Set(
        (ctx.state?.employees.employees ?? []).filter(e => e.locomotion.kind === 'inside').map(e => e.id),
      );
      const result = runCommand(engine, cmd);
      if (cmd.startsWith('tick')) {
        checkBatch(label);
        // A one-tick batch: whoever was inside and is not any more must have announced leaving.
        if (cmd === 'tick 1') {
          for (const emp of ctx.state?.employees.employees ?? []) {
            if (insideBefore.has(emp.id) && emp.locomotion.kind !== 'inside' && emp.alive && !events.leave.get(emp.id)) {
              problems.push(`${label}: employee ${emp.id} left a building without employee:left_building`);
            }
          }
        }
      }
      return result;
    };

    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i]!;
      if (step.interactionOnly) continue;
      if (ctx.state && hasLevelEnded(ctx.state)) break;
      const wait = findWaitUntilAction(step);
      if (wait) {
        for (let n = 0; n < wait.maxTicks; n++) {
          runTracked('tick 1', `step ${i} wait tick ${n}`);
          const dump = serializeGameState(ctx) as Record<string, unknown> | null;
          if (dump && dump[wait.field] === wait.equals) break;
          if (ctx.state?.events.pendingEvent) runCommand(engine, 'event choose 0');
          if (ctx.state && hasLevelEnded(ctx.state)) break;
        }
        continue;
      }
      for (let r = 0; r < resolveRepeatCount(step); r++) runTracked(step.command, `step ${i} (${step.command})`);
    }

    expect(problems).toEqual([]);
    // The replay must actually exercise the transitions it claims to check.
    expect(totals.board).toBeGreaterThan(0);
    expect(totals.alight).toBeGreaterThan(0);
    expect(totals.enter).toBeGreaterThan(0);
    expect(totals.leave).toBeGreaterThan(0);
  }, 280_000);
});
