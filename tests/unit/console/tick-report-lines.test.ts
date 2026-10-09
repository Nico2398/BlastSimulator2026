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
    contractsDelivered: [],
    smuggling: { income: 0, audit: null },
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
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({}));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(true);
    expect(result.output).not.toContain('course was cancelled');
  });
});

describe('tick.ts — automatic contract delivery lines (#1367)', () => {
  it('prints a line naming the contract and the kg delivered for each automatic delivery', () => {
    const ctx = makeGameContext();
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({
      contractsDelivered: [{ contractId: 7, kg: 120, payment: 1440, bonus: 0, completed: false }],
    }));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.output).toMatch(/#7\b/);
    expect(result.output).toContain('120');
    expect(result.output).toMatch(/1,?440/);
  });

  it('flags a completed delivery and mentions the early bonus', () => {
    const ctx = makeGameContext();
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({
      contractsDelivered: [{ contractId: 8, kg: 100, payment: 1000, bonus: 150, completed: true }],
    }));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.output).toMatch(/#8\b/);
    expect(result.output).toMatch(/complete/i);
    expect(result.output).toContain('150');
  });

  it('prints one line per delivered contract', () => {
    const ctx = makeGameContext();
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({
      contractsDelivered: [
        { contractId: 1, kg: 10, payment: 100, bonus: 0, completed: false },
        { contractId: 2, kg: 20, payment: 200, bonus: 0, completed: false },
      ],
    }));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.output).toMatch(/#1\b/);
    expect(result.output).toMatch(/#2\b/);
  });

  it('prints no delivery line when nothing was delivered', () => {
    const ctx = makeGameContext();
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({}));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.output).not.toMatch(/deliver/i);
  });

  it('an expiry after a part delivery states the reduced penalty, kg delivered and amount paid', () => {
    const ctx = makeGameContext();
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({
      contractsExpired: [{ contractId: 9, penalty: 180, deliveredKg: 40, paid: 400 }],
    }));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.output).toContain('expired');
    expect(result.output).toContain('180');
    expect(result.output).toContain('40');
    expect(result.output).toContain('400');
  });

  it('a full-penalty expiry keeps the plain penalty line', () => {
    const ctx = makeGameContext();
    vi.spyOn(TickPipelineModule, 'runTick').mockReturnValue(baseReport({
      contractsExpired: [{ contractId: 9, penalty: 300, deliveredKg: 0, paid: 0 }],
    }));

    const result = tickCommand(ctx, ['1'], {});

    expect(result.output).toContain('Contract expired! Penalty: $300');
  });
});
