// BlastSimulator2026 — Integration tests: Research Center tier-unlock pipeline (#410)
//
// Two things are currently unwired:
//   1. The tick loop (tickCommand in src/console/commands/events.ts) never calls
//      tickResearch — a queued research task never advances, no matter how many
//      ticks pass.
//   2. researchCommand (src/console/commands/research.ts) is a stub that throws
//      "not implemented" — there is no player-facing way to queue research or
//      check its status.
//
// DO NOT implement anything here — only add implementation to src/.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { tickCommand } from '../../src/console/commands/events.js';
import { researchCommand } from '../../src/console/commands/research.js';
import { buildCommand } from '../../src/console/commands/entities.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { queueResearchTask, isTierUnlocked } from '../../src/core/entities/Building.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

// ── tickResearch wired into the tick command ─────────────────────────────────

describe('Research Center — tick loop wiring (#410)', () => {
  let ctx: GameContext;
  beforeEach(() => { ctx = makeCtx(); });

  it('advances a queued research task ticksRemaining by 1 per game tick', () => {
    queueResearchTask(ctx.state!.buildings, 'driving_center', 2, 10, 5000);
    expect(ctx.state!.buildings.researchQueue[0]!.ticksRemaining).toBe(10);

    tickCommand(ctx, ['1'], {});

    expect(ctx.state!.buildings.researchQueue[0]!.ticksRemaining).toBe(9);
  });

  it('advances ticksRemaining by N over N ticks', () => {
    queueResearchTask(ctx.state!.buildings, 'driving_center', 2, 10, 5000);

    tickCommand(ctx, ['4'], {});

    expect(ctx.state!.buildings.researchQueue[0]!.ticksRemaining).toBe(6);
  });

  it('unlocks the tier once ticksRemaining reaches 0 via the tick command', () => {
    queueResearchTask(ctx.state!.buildings, 'driving_center', 2, 3, 5000);
    expect(isTierUnlocked(ctx.state!.buildings, 'driving_center', 2)).toBe(false);

    tickCommand(ctx, ['3'], {});

    expect(isTierUnlocked(ctx.state!.buildings, 'driving_center', 2)).toBe(true);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
  });

  it('does nothing (and does not throw) when the queue is empty', () => {
    expect(() => tickCommand(ctx, ['5'], {})).not.toThrow();
    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
  });
});

// ── research command — queue ──────────────────────────────────────────────────

describe('research command — queue (#410)', () => {
  let ctx: GameContext;
  beforeEach(() => { ctx = makeCtx(); });

  it('queues a tier-2 research task for a building type', () => {
    const result = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(result.success, result.output).toBe(true);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(1);
    expect(ctx.state!.buildings.researchQueue[0]!.targetType).toBe('driving_center');
    expect(ctx.state!.buildings.researchQueue[0]!.targetTier).toBe(2);
  });

  it('queues a tier-3 research task for a building type', () => {
    const result = researchCommand(ctx, ['queue'], { type: 'geology_lab', tier: '3' });
    expect(result.success, result.output).toBe(true);
    expect(ctx.state!.buildings.researchQueue[0]!.targetTier).toBe(3);
  });

  it('deducts cash for the queued research task', () => {
    const cashBefore = ctx.state!.cash;
    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(ctx.state!.cash).toBeLessThan(cashBefore);
  });

  it('rejects an unknown building type', () => {
    const result = researchCommand(ctx, ['queue'], { type: 'not_a_building', tier: '2' });
    expect(result.success).toBe(false);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
  });

  it('rejects an invalid tier value', () => {
    const result = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '9' });
    expect(result.success).toBe(false);
  });

  it('rejects tier:1 — always unlocked, nothing to research', () => {
    const result = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '1' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing type argument', () => {
    const result = researchCommand(ctx, ['queue'], { tier: '2' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown subcommand', () => {
    const result = researchCommand(ctx, ['bogus'], {});
    expect(result.success).toBe(false);
  });
});

// ── research command — status ─────────────────────────────────────────────────

describe('research command — status (#410)', () => {
  let ctx: GameContext;
  beforeEach(() => { ctx = makeCtx(); });

  it('reports no active research when the queue is empty', () => {
    const result = researchCommand(ctx, ['status'], {});
    expect(result.success).toBe(true);
    expect(result.output.toLowerCase()).toMatch(/no.*research|empty|none/);
  });

  it('reports the queued task type and tier after research queue', () => {
    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    const result = researchCommand(ctx, ['status'], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('driving_center');
    expect(result.output).toContain('2');
  });
});

// ── research → tick → unlock end-to-end ───────────────────────────────────────

describe('research → tick → unlock end-to-end (#410)', () => {
  it('a queued tier stays locked until enough ticks pass, then permits placement', () => {
    const ctx = makeCtx();
    const queueResult = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(queueResult.success, queueResult.output).toBe(true);

    // Tier 2 is not yet buildable — the research task has not completed.
    const early = buildCommand(ctx, ['driving_center'], { at: '5,5', tier: '2' });
    expect(early.success).toBe(false);

    // Generously tick-pad past any plausible research duration.
    tickCommand(ctx, ['500'], {});

    expect(isTierUnlocked(ctx.state!.buildings, 'driving_center', 2)).toBe(true);

    const late = buildCommand(ctx, ['driving_center'], { at: '5,5', tier: '2' });
    expect(late.success, late.output).toBe(true);
  });

  it('research status reflects progress: queued, then empty once complete', () => {
    const ctx = makeCtx();
    researchCommand(ctx, ['queue'], { type: 'geology_lab', tier: '2' });
    expect(researchCommand(ctx, ['status'], {}).output).toContain('geology_lab');

    tickCommand(ctx, ['500'], {});

    const finalStatus = researchCommand(ctx, ['status'], {});
    expect(finalStatus.output.toLowerCase()).toMatch(/no.*research|empty|none/);
  });
});
