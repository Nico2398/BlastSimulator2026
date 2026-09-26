// BlastSimulator2026 — tick.ts TickReport → console-line branches (#1086)
//
// tick.ts formats several TickReport fields into console lines
// (mafiaExposed, abandonedActions, boardingCancelled) that a normal fresh-
// game tick never populates. Rather than contrive a real end-to-end fixture
// for mafia exposure/a stuck claim/a cancelled boarding, this mocks
// TickPipeline's runTick — the same vi.spyOn-on-the-module pattern already
// used by tick-i18n-guards.test.ts to mock tickEventSystem via
// EventSystemModule — and feeds tickCommand a hand-built TickReport that
// exercises exactly these branches.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { tickCommand } from '../../../src/console/commands/tick.js';
import * as TickPipelineModule from '../../../src/core/engine/TickPipeline.js';
import type { TickReport } from '../../../src/core/engine/TickPipeline.js';
import { makeGameContext } from '../../helpers/gameContext.js';

function baseReport(overrides: Partial<TickReport>): TickReport {
  return {
    tick: 1,
    contractsExpired: [],
    smuggling: { income: 0, exposed: false },
    mafiaExposed: false,
    needEvents: [],
    trainingCompletions: [],
    researchCancelled: undefined,
    taskCompletions: [],
    stuckEmployees: [],
    abandonedActions: [],
    boardingCancelled: [],
    worldInvariantViolations: [],
    firedEvent: null,
    gameOver: {
      levelCompleted: false,
      bankrupted: false,
      ecoShutdown: false,
      arrested: false,
      revolted: false,
      levelEndReason: null,
    },
    paused: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tick.ts — mafiaExposed line', () => {
  it('pushes a MAFIA EXPOSURE line when report.mafiaExposed is true', () => {
    const ctx = makeGameContext();
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({ mafiaExposed: true }));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('MAFIA EXPOSURE! Criminal charges may follow.');
  });
});

describe('tick.ts — abandonedActions lines', () => {
  it('pushes an ACTION ABANDONED line per abandoned claim, falling back to "employee #<id>" for an unknown employee', () => {
    const ctx = makeGameContext();
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({
      abandonedActions: [{ employeeId: 9999, actionId: 3 }],
    }));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('ACTION ABANDONED: employee #9999 released a stuck claim back to the pool.');
  });
});

describe('tick.ts — boardingCancelled lines', () => {
  it('pushes a BOARDING CANCELLED line per cancelled boarding, including its reason', () => {
    const ctx = makeGameContext();
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({
      boardingCancelled: [{ employeeId: 4242, reason: 'vehicle_gone' }],
    }));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('BOARDING CANCELLED: employee #4242 (vehicle_gone).');
  });
});

describe('tick.ts — trainingCancellations lines', () => {
  it('pushes a course-cancelled line per cancelled training when the school was destroyed', () => {
    const ctx = makeGameContext();
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({
      trainingCancellations: [
        { employeeId: 7, employeeName: 'Jonas', skill: 'geology', buildingId: 3, refund: 250 },
      ],
    }));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain(
      "Jonas's geology course was cancelled — school #3 was destroyed. $250 refunded."
    );
  });

  it('does not push a course-cancelled line when trainingCancellations is undefined', () => {
    const ctx = makeGameContext();
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({
      trainingCancellations: undefined,
    }));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(true);
    expect(result.output).not.toContain('course was cancelled');
  });
});
