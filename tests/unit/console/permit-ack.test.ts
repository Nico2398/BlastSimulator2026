// BlastSimulator2026 — `permit ack` console command (#1926)
import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';

function sandbox() {
  const { runner, ctx } = createRunner();
  expect(runner.run('sandbox start biome:desert_badlands seed:42').success).toBe(true);
  ctx.state!.events.eventFreqMultiplier = 0;
  return { runner, state: ctx.state! };
}

describe('permit ack (#1926)', () => {
  beforeAll(() => setLocale('en'));

  it('clears the unseen approval and resumes the paused game', () => {
    const { runner, state } = sandbox();
    state.grade!.unseenApproval = 1;
    state.isPaused = true;
    const r = runner.run('permit ack');
    expect(r.success, r.output).toBe(true);
    expect(state.grade!.unseenApproval).toBeNull();
    expect(state.isPaused).toBe(false);
  });

  it('keeps the game paused while an event is still pending', () => {
    const { runner, state } = sandbox();
    state.grade!.unseenApproval = 2;
    state.isPaused = true;
    state.events.pendingEvent = { eventId: 'any_event', firedAtTick: state.tickCount } as never;
    const r = runner.run('permit ack');
    expect(r.success, r.output).toBe(true);
    expect(state.grade!.unseenApproval).toBeNull();
    expect(state.isPaused).toBe(true);
  });

  it('is refused when nothing is pending, changing nothing', () => {
    const { runner, state } = sandbox();
    state.isPaused = false;
    const r = runner.run('permit ack');
    expect(r.success).toBe(false);
    expect(r.output.length).toBeGreaterThan(0);
    expect(r.output).not.toMatch(/^permit\./);
    expect(state.isPaused).toBe(false);
  });

  it('a second ack right after the first is refused', () => {
    const { runner, state } = sandbox();
    state.grade!.unseenApproval = 1;
    expect(runner.run('permit ack').success).toBe(true);
    expect(runner.run('permit ack').success).toBe(false);
  });

  it('is refused on a site without a permit ladder', () => {
    const { runner } = createRunner();
    runner.run('new_game seed:42');
    expect(runner.run('permit ack').success).toBe(false);
  });

  it('end to end: applying, ticking to approval pauses, ack resumes', () => {
    const { runner, state } = sandbox();
    state.grade!.pending = { toGrade: 1, ticksLeft: 2 };
    runner.run('tick 2');
    expect(state.grade!.grade).toBe(1);
    expect(state.grade!.unseenApproval).toBe(1);
    expect(state.isPaused).toBe(true);
    expect(runner.run('permit ack').success).toBe(true);
    expect(state.isPaused).toBe(false);
  });
});
