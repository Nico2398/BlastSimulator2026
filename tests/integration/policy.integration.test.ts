// BlastSimulator2026 — Integration: applying a site policy
//
// The tutorial's Site Policy step used to hang because "did the player set a
// policy?" was answered by comparing values, and applying the policy already in
// force changes none of them. These tests pin the signal that replaced it.

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { setPolicyCommand } from '../../src/console/commands/policy.js';
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
    setPolicyCommand(ctx, [], { mode: 'shift_12h', hunger: '40', fatigue: '25' });
    const after = ctx.state!.sitePolicy.revision;

    setPolicyCommand(ctx, [], { mode: 'shift_12h', hunger: '40', fatigue: '25' });

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

describe('the tutorial Site Policy step', () => {
  const step = TUTORIAL_STEPS.find(s => s.id === 'set-policy')!;

  it('completes when the player presses Apply with the settings unchanged', () => {
    const ctx = makeCtx();
    // Whatever the policy currently is, that is what the form shows.
    const current = ctx.state!.sitePolicy;
    const snapshot = step.captureSnapshot!(ctx.state!);

    setPolicyCommand(ctx, [], {
      mode: current.shiftMode,
      hunger: String(current.hungerRestThreshold),
      fatigue: String(current.fatigueRestThreshold),
    });

    expect(step.isComplete(ctx.state!, snapshot)).toBe(true);
  });

  it('completes when the player changes the shift schedule first', () => {
    const ctx = makeCtx();
    const snapshot = step.captureSnapshot!(ctx.state!);

    setPolicyCommand(ctx, [], { mode: 'shift_12h', hunger: '40', fatigue: '25' });

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
