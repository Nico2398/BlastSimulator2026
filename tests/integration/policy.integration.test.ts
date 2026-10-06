// BlastSimulator2026 — Integration: applying a site policy
//
// The tutorial's Site Policy step used to hang because "did the player set a
// policy?" was answered by comparing values, and applying the policy already in
// force changes none of them. These tests pin the signal that replaced it.

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { setPolicyCommand } from '../../src/console/commands/policy.js';
import { tickCommand, eventCommand } from '../../src/console/commands/events.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
import { TUTORIAL_STEPS } from '../../src/ui/tutorialSteps.js';
import { makeGameContext } from '../helpers/gameContext.js';

function makeCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: '42', size: '24' });
}

describe('set_policy', () => {
  let ctx: GameContext;

  beforeEach(() => { ctx = makeCtx(); });

  it('bumps the revision when values change', () => {
    const before = ctx.state!.sitePolicy.revision;
    const result = setPolicyCommand(ctx, [], { mode: 'shift_12h' });

    expect(result.success).toBe(true);
    expect(ctx.state!.sitePolicy.shiftMode).toBe('shift_12h');
    expect(ctx.state!.sitePolicy.revision).toBe(before + 1);
  });

  it('bumps the revision even when nothing changes', () => {
    // The reported case: the settings form mirrors the policy in force, so
    // pressing Apply without touching anything is the common path.
    setPolicyCommand(ctx, [], { mode: 'shift_12h', fatigue: '25' });
    const after = ctx.state!.sitePolicy.revision;

    setPolicyCommand(ctx, [], { mode: 'shift_12h', fatigue: '25' });

    expect(ctx.state!.sitePolicy.revision).toBe(after + 1);
  });

  it('does not bump the revision when the command is rejected', () => {
    const before = ctx.state!.sitePolicy.revision;
    const result = setPolicyCommand(ctx, [], { mode: 'not_a_mode' });

    expect(result.success).toBe(false);
    expect(ctx.state!.sitePolicy.revision).toBe(before);
  });

  it('counts up across repeated applications', () => {
    const before = ctx.state!.sitePolicy.revision;
    for (let i = 0; i < 3; i++) setPolicyCommand(ctx, [], { mode: 'continuous' });
    expect(ctx.state!.sitePolicy.revision).toBe(before + 3);
  });
});

describe('the tutorial early Site Policy step', () => {
  const step = TUTORIAL_STEPS.find(s => s.id === 'set-early-policy')!;

  it('completes when the player presses Apply with the settings unchanged', () => {
    const ctx = makeCtx();
    // Whatever the policy currently is, that is what the form shows.
    const current = ctx.state!.sitePolicy;
    const snapshot = step.captureSnapshot!(ctx.state!);

    setPolicyCommand(ctx, [], {
      mode: current.shiftMode,
      fatigue: String(current.fatigueRestThreshold),
    });

    expect(step.isComplete(ctx.state!, snapshot)).toBe(true);
  });

  it('completes when the player changes the shift schedule first', () => {
    const ctx = makeCtx();
    const snapshot = step.captureSnapshot!(ctx.state!);

    setPolicyCommand(ctx, [], { mode: 'shift_12h', fatigue: '25' });

    expect(step.isComplete(ctx.state!, snapshot)).toBe(true);
  });

  it('stays incomplete until Apply is pressed', () => {
    const ctx = makeCtx();
    const snapshot = step.captureSnapshot!(ctx.state!);
    expect(step.isComplete(ctx.state!, snapshot)).toBe(false);
  });

  it('stays incomplete when the command was rejected', () => {
    const ctx = makeCtx();
    const snapshot = step.captureSnapshot!(ctx.state!);

    setPolicyCommand(ctx, [], { mode: 'nonsense' });

    expect(step.isComplete(ctx.state!, snapshot)).toBe(false);
  });
});

describe('the default site policy is in force without any set_policy call (#1379)', () => {
  const UNTOUCHED_TICKS = 1000;

  function makeUntouchedGame(): GameContext {
    const ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
    const state = ctx.state!;
    state.cash = 10_000_000;
    for (let i = 0; i < 4; i++) {
      const hired = employeeCommand(ctx, ['hire'], { role: 'driller' });
      if (!hired.success) throw new Error(`Setup: hire failed — ${hired.output}`);
    }
    state.buildings.unlockedTiers.living_quarters = state.buildings.unlockedTiers.living_quarters ?? 1;
    const placed = placeBuilding(state.buildings, 'living_quarters', 2, 6, 100, 100, 1);
    if (!placed.success) throw new Error('Setup: living_quarters placement failed');
    return ctx;
  }

  it('a new game starts on shift_8h, threshold 60, revision 0', () => {
    const policy = makeUntouchedGame().state!.sitePolicy;
    expect(policy.shiftMode).toBe('shift_8h');
    expect(policy.fatigueRestThreshold).toBe(60);
    expect(policy.revision).toBe(0);
  });

  it('an untouched game does not end in worker_revolt and wellbeing stays above 0 over 1000 ticks', () => {
    const ctx = makeUntouchedGame();
    const state = ctx.state!;
    expect(state.sitePolicy.revision).toBe(0);

    let minWellBeing = Infinity;
    for (let i = 0; i < UNTOUCHED_TICKS && state.levelEndReason === null; i++) {
      tickCommand(ctx, ['1'], {});
      if (state.events.pendingEvent) eventCommand(ctx, ['choose', '0'], {});
      if (state.isPaused) state.isPaused = false;
      minWellBeing = Math.min(minWellBeing, state.scores.wellBeing);
    }

    expect(state.levelEndReason).not.toBe('worker_revolt');
    expect(minWellBeing).toBeGreaterThan(0);
    expect(state.sitePolicy.revision).toBe(0); // nothing applied a policy
  });

  it('forces shift rest on the default policy before any set_policy call', () => {
    const ctx = makeUntouchedGame();
    const state = ctx.state!;
    let shiftChanges = 0;
    ctx.emitter.on('employee:shift_change', () => { shiftChanges++; });

    for (const emp of state.employees.employees) {
      employeeCommand(ctx, ['dispatch', String(emp.id)], { x: String(emp.x), z: String(emp.z) });
    }
    for (let i = 0; i < 60; i++) {
      for (const emp of state.employees.employees) {
        if (emp.alive && emp.activeActionId === null && emp.restTicksRemaining === null && emp.pendingRestDuration === null) {
          employeeCommand(ctx, ['dispatch', String(emp.id)], { x: String(emp.x), z: String(emp.z) });
        }
      }
      tickCommand(ctx, ['1'], {});
      if (state.events.pendingEvent) eventCommand(ctx, ['choose', '0'], {});
      if (state.isPaused) state.isPaused = false;
    }

    expect(state.sitePolicy.revision).toBe(0);
    expect(shiftChanges).toBeGreaterThan(0);
  });

  it('set_policy mode:shift_8h on the default policy bumps the revision 0 -> 1', () => {
    const ctx = makeUntouchedGame();
    expect(ctx.state!.sitePolicy.revision).toBe(0);

    const result = setPolicyCommand(ctx, [], { mode: 'shift_8h' });

    expect(result.success).toBe(true);
    expect(ctx.state!.sitePolicy.shiftMode).toBe('shift_8h');
    expect(ctx.state!.sitePolicy.revision).toBe(1);
  });

  it('set_policy mode:continuous still changes behaviour: no shift-length rest after the default boundary', () => {
    const ctx = makeUntouchedGame();
    const state = ctx.state!;
    expect(setPolicyCommand(ctx, [], { mode: 'continuous', fatigue: '0' }).success).toBe(true);
    expect(state.sitePolicy.shiftMode).toBe('continuous');
    expect(state.sitePolicy.revision).toBe(1);

    let shiftChanges = 0;
    ctx.emitter.on('employee:shift_change', () => { shiftChanges++; });

    for (const emp of state.employees.employees) {
      emp.activeActionId = null;
      employeeCommand(ctx, ['dispatch', String(emp.id)], { x: String(emp.x), z: String(emp.z) });
    }
    for (let i = 0; i < 20; i++) {
      for (const emp of state.employees.employees) emp.fatigue = 100;
      tickCommand(ctx, ['1'], {});
      if (state.events.pendingEvent) eventCommand(ctx, ['choose', '0'], {});
      if (state.isPaused) state.isPaused = false;
    }

    // 20 ticks of work with fatigue held full: shift_8h would have rested
    // everyone at tick 8; continuous never does.
    expect(shiftChanges).toBe(0);
  });
});
