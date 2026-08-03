// BlastSimulator2026 — Integration tests: Research Center tier-unlock pipeline (#410, #442)
//
// #442 adds a hard placement prerequisite: queueResearchTask (and the console
// `research queue` command) now reject with code 'no_research_center' unless an
// active research_center building is placed on the map. Every test below that
// queues research places one first via buildCommand, unless it is specifically
// testing the no-research-center rejection path.
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
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32', cash: '500000' });
  return ctx;
}

/**
 * Place an active research_center via the console build command, asserting
 * success. Coordinates must sit on the 32x32 site makeCtx creates — building
 * past its edge is refused rather than silently accepted (#473 D5).
 */
function placeResearchCenter(ctx: GameContext, at = '20,20'): void {
  const result = buildCommand(ctx, ['research_center'], { at });
  if (!result.success) {
    throw new Error(`test setup: failed to place research_center: ${result.output}`);
  }
}

// ── tickResearch wired into the tick command ─────────────────────────────────

describe('Research Center — tick loop wiring (#410, #442)', () => {
  let ctx: GameContext;
  beforeEach(() => {
    ctx = makeCtx();
    placeResearchCenter(ctx);
  });

  it('completes a tier-2 (first upgrade) task on the very next tick — 0 duration', () => {
    const q = queueResearchTask(ctx.state!.buildings, 'driving_center', 2);
    expect(q.success, JSON.stringify(q)).toBe(true);
    expect(ctx.state!.buildings.researchQueue[0]!.ticksRemaining).toBe(0);

    tickCommand(ctx, ['1'], {});

    expect(isTierUnlocked(ctx.state!.buildings, 'driving_center', 2)).toBe(true);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
  });

  it('advances a queued tier-3 research task ticksRemaining by 1 per game tick', () => {
    queueResearchTask(ctx.state!.buildings, 'driving_center', 2);
    tickCommand(ctx, ['1'], {}); // completes tier-2 instantly
    queueResearchTask(ctx.state!.buildings, 'driving_center', 3);
    const before = ctx.state!.buildings.researchQueue[0]!.ticksRemaining;
    expect(before).toBeGreaterThan(0);

    tickCommand(ctx, ['1'], {});

    expect(ctx.state!.buildings.researchQueue[0]!.ticksRemaining).toBe(before - 1);
  });

  it('advances ticksRemaining by N over N ticks for a tier-3 task', () => {
    queueResearchTask(ctx.state!.buildings, 'driving_center', 2);
    tickCommand(ctx, ['1'], {});
    queueResearchTask(ctx.state!.buildings, 'driving_center', 3);
    const before = ctx.state!.buildings.researchQueue[0]!.ticksRemaining;

    tickCommand(ctx, ['4'], {});

    expect(ctx.state!.buildings.researchQueue[0]!.ticksRemaining).toBe(before - 4);
  });

  it('unlocks tier 3 once ticksRemaining reaches 0 via the tick command', () => {
    queueResearchTask(ctx.state!.buildings, 'driving_center', 2);
    tickCommand(ctx, ['1'], {});
    queueResearchTask(ctx.state!.buildings, 'driving_center', 3);
    expect(isTierUnlocked(ctx.state!.buildings, 'driving_center', 3)).toBe(false);

    const ticksNeeded = ctx.state!.buildings.researchQueue[0]!.ticksRemaining;
    tickCommand(ctx, [String(ticksNeeded)], {});

    expect(isTierUnlocked(ctx.state!.buildings, 'driving_center', 3)).toBe(true);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
  });

  it('does nothing (and does not throw) when the queue is empty', () => {
    expect(() => tickCommand(ctx, ['5'], {})).not.toThrow();
    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
  });
});

// ── research command — queue: placement prerequisite (#442) ──────────────────

describe('research command — queue: placement prerequisite (#442)', () => {
  let ctx: GameContext;
  beforeEach(() => { ctx = makeCtx(); });

  it('rejects with a clear error when no research_center is placed anywhere', () => {
    const result = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('no_research_center');
    expect(result.output.toLowerCase()).toMatch(/research center|research_center/);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
  });

  it('does not deduct cash when rejected for lack of a research_center', () => {
    const cashBefore = ctx.state!.cash;
    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(ctx.state!.cash).toBe(cashBefore);
  });

  it('succeeds once a research_center is placed', () => {
    placeResearchCenter(ctx);
    const result = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(result.success, result.output).toBe(true);
  });

  it('no_research_center wins over insufficient_funds when both apply', () => {
    ctx.state!.cash = 0;
    const result = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('no_research_center');
  });
});

// ── research command — queue: tier gating (#442) ──────────────────────────────

describe('research command — queue: tier gating (#442)', () => {
  let ctx: GameContext;
  beforeEach(() => {
    ctx = makeCtx();
    placeResearchCenter(ctx);
  });

  it('queues a tier-2 (first upgrade) research task on cost alone', () => {
    const result = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(result.success, result.output).toBe(true);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(1);
    expect(ctx.state!.buildings.researchQueue[0]!.targetType).toBe('driving_center');
    expect(ctx.state!.buildings.researchQueue[0]!.targetTier).toBe(2);
    expect(ctx.state!.buildings.researchQueue[0]!.ticksRemaining).toBe(0);
    // 0-duration (tier-2) tasks omit tick count from the success message.
    expect(result.output).not.toMatch(/ticks/);
    expect(result.output).toContain('$5000');
  });

  it('rejects a tier-3 request with a clear error when the type\'s tier-2 research has not completed', () => {
    const result = researchCommand(ctx, ['queue'], { type: 'geology_lab', tier: '3' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('conditions_not_met');
    expect(result.output.toLowerCase()).toMatch(/prerequisite|condition/);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
  });

  it('queues a tier-3 research task once the type\'s tier-2 research has completed', () => {
    researchCommand(ctx, ['queue'], { type: 'geology_lab', tier: '2' });
    tickCommand(ctx, ['1'], {}); // tier-2 is 0-ticks — completes on the next tick

    const result = researchCommand(ctx, ['queue'], { type: 'geology_lab', tier: '3' });
    expect(result.success, result.output).toBe(true);
    expect(ctx.state!.buildings.researchQueue[0]!.targetTier).toBe(3);
    const ticks = ctx.state!.buildings.researchQueue[0]!.ticksRemaining;
    expect(ticks).toBeGreaterThan(0);
    // Non-zero duration (tier-3) tasks report their tick count in the success message.
    expect(result.output).toContain(`${ticks} ticks`);
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

  // ── #410 finding 1 — double-charge on repeated "Queue Research" clicks ─────

  it('rejects a second queue request for the same {type, tier} already pending', () => {
    const first = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(first.success, first.output).toBe(true);

    const second = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(second.success).toBe(false);
    expect(second.code).toBe('already_queued');
  });

  it('does not double-charge cash when the same task is queued twice', () => {
    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    const cashAfterFirst = ctx.state!.cash;

    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });

    expect(ctx.state!.cash).toBe(cashAfterFirst);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(1);
  });

  it('still allows queuing tier-2 for a DIFFERENT type while one is pending', () => {
    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    const result = researchCommand(ctx, ['queue'], { type: 'geology_lab', tier: '2' });
    expect(result.success, result.output).toBe(true);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(2);
  });

  it('rejects tier-3 for the same type while its own tier-2 research is still pending (not yet completed)', () => {
    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    // tier-2 is queued but NOT yet ticked to completion.
    const result = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '3' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('conditions_not_met');
  });

  it('sets code:"insufficient_funds" when cash is too low', () => {
    ctx.state!.cash = 0;
    const result = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('insufficient_funds');
  });

  it('sets code:"already_unlocked" when the tier is already researched', () => {
    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    tickCommand(ctx, ['500'], {});
    const result = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('already_unlocked');
  });
});

// ── research command — status ─────────────────────────────────────────────────

describe('research command — status (#410)', () => {
  let ctx: GameContext;
  beforeEach(() => {
    ctx = makeCtx();
    placeResearchCenter(ctx);
  });

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

// ── Research Center — destroyed mid-research cancels + refunds (#461) ────────
//
// Reverses the earlier queue-time-only decision (see the removed "research
// center check is queue-time only" unit-test block): once no active
// research_center remains, tickResearch cancels the in-flight head task and
// the tick loop (events.ts tickCommand) must credit the refund to cash and
// log a 'refund'-category finance transaction.

describe('Research Center — destroyed mid-research cancels + refunds (#461)', () => {
  it('cancels an in-flight tier-3 task and refunds its exact cost when the sole Research Center is destroyed', () => {
    const ctx = makeCtx();
    placeResearchCenter(ctx);
    const centerId = ctx.state!.buildings.buildings.find((b) => b.type === 'research_center')!.id;

    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    tickCommand(ctx, ['1'], {}); // completes tier-2 instantly

    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '3' });
    const cost = ctx.state!.buildings.researchQueue[0]!.cost;
    expect(cost).toBeGreaterThan(0);

    tickCommand(ctx, ['5'], {}); // partway through the tier-3 task
    expect(ctx.state!.buildings.researchQueue).toHaveLength(1);
    expect(isTierUnlocked(ctx.state!.buildings, 'driving_center', 3)).toBe(false);

    buildCommand(ctx, ['destroy', String(centerId)], {});
    expect(ctx.state!.buildings.buildings.some((b) => b.type === 'research_center')).toBe(false);

    const cashBefore = ctx.state!.cash;
    tickCommand(ctx, ['1'], {}); // cancellation tick
    const cashAfter = ctx.state!.cash;

    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
    expect(isTierUnlocked(ctx.state!.buildings, 'driving_center', 3)).toBe(false);
    expect(cashAfter - cashBefore).toBe(cost);

    const refundTx = ctx.state!.finances.transactions.find((t) => t.category === 'refund');
    expect(refundTx).toBeDefined();
    expect(refundTx!.amount).toBe(cost);
  });

  it('keeps a task progressing to normal completion when one of two Research Centers is destroyed', () => {
    const ctx = makeCtx();
    placeResearchCenter(ctx, '10,10');
    placeResearchCenter(ctx, '4,4');
    const centerIds = ctx.state!.buildings.buildings
      .filter((b) => b.type === 'research_center')
      .map((b) => b.id);

    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    tickCommand(ctx, ['1'], {});
    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '3' });

    buildCommand(ctx, ['destroy', String(centerIds[0])], {});
    expect(ctx.state!.buildings.buildings.some((b) => b.type === 'research_center')).toBe(true);

    tickCommand(ctx, ['500'], {});

    expect(isTierUnlocked(ctx.state!.buildings, 'driving_center', 3)).toBe(true);
    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
    expect(ctx.state!.finances.transactions.some((t) => t.category === 'refund')).toBe(false);
  });

  it('cancels and refunds a queued tier-2 (0-tick) task destroyed before the next tick', () => {
    const ctx = makeCtx();
    placeResearchCenter(ctx);
    const centerId = ctx.state!.buildings.buildings.find((b) => b.type === 'research_center')!.id;

    researchCommand(ctx, ['queue'], { type: 'geology_lab', tier: '2' });
    const cost = ctx.state!.buildings.researchQueue[0]!.cost;

    buildCommand(ctx, ['destroy', String(centerId)], {});

    tickCommand(ctx, ['1'], {});

    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
    expect(isTierUnlocked(ctx.state!.buildings, 'geology_lab', 2)).toBe(false);

    const refundTx = ctx.state!.finances.transactions.find((t) => t.category === 'refund');
    expect(refundTx).toBeDefined();
    expect(refundTx!.amount).toBe(cost);
  });

  it('drains multiple queued tasks one cancellation per tick, refunding each, once the center is destroyed', () => {
    const ctx = makeCtx();
    placeResearchCenter(ctx);
    const centerId = ctx.state!.buildings.buildings.find((b) => b.type === 'research_center')!.id;

    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    const cost1 = ctx.state!.buildings.researchQueue[0]!.cost;
    researchCommand(ctx, ['queue'], { type: 'blasting_academy', tier: '2' });
    const cost2 = ctx.state!.buildings.researchQueue[1]!.cost;
    expect(ctx.state!.buildings.researchQueue).toHaveLength(2);

    buildCommand(ctx, ['destroy', String(centerId)], {});

    const cashBefore = ctx.state!.cash;
    tickCommand(ctx, ['10'], {});
    const cashAfter = ctx.state!.cash;

    expect(ctx.state!.buildings.researchQueue).toHaveLength(0);
    expect(isTierUnlocked(ctx.state!.buildings, 'driving_center', 2)).toBe(false);
    expect(isTierUnlocked(ctx.state!.buildings, 'blasting_academy', 2)).toBe(false);
    expect(cashAfter - cashBefore).toBe(cost1 + cost2);

    const refundTxs = ctx.state!.finances.transactions.filter((t) => t.category === 'refund');
    expect(refundTxs).toHaveLength(2);
  });
});

// ── research → tick → unlock end-to-end ───────────────────────────────────────

describe('research → tick → unlock end-to-end (#410, #442)', () => {
  it('a queued tier-2 stays locked until ticked, then permits placement', () => {
    const ctx = makeCtx();
    placeResearchCenter(ctx);
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

  it('a queued tier-3 stays locked until enough ticks pass, then permits placement', () => {
    const ctx = makeCtx();
    placeResearchCenter(ctx);
    researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '2' });
    tickCommand(ctx, ['1'], {}); // completes tier-2 instantly

    const queueResult = researchCommand(ctx, ['queue'], { type: 'driving_center', tier: '3' });
    expect(queueResult.success, queueResult.output).toBe(true);

    const early = buildCommand(ctx, ['driving_center'], { at: '5,5', tier: '3' });
    expect(early.success).toBe(false);

    tickCommand(ctx, ['500'], {});

    expect(isTierUnlocked(ctx.state!.buildings, 'driving_center', 3)).toBe(true);
    const late = buildCommand(ctx, ['driving_center'], { at: '5,5', tier: '3' });
    expect(late.success, late.output).toBe(true);
  });

  it('research status reflects progress: queued, then empty once complete', () => {
    const ctx = makeCtx();
    placeResearchCenter(ctx);
    researchCommand(ctx, ['queue'], { type: 'geology_lab', tier: '2' });
    expect(researchCommand(ctx, ['status'], {}).output).toContain('geology_lab');

    tickCommand(ctx, ['500'], {});

    const finalStatus = researchCommand(ctx, ['status'], {});
    expect(finalStatus.output.toLowerCase()).toMatch(/no.*research|empty|none/);
  });
});
