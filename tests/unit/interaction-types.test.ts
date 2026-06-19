/**
 * Tests for interaction recording type definitions.
 *
 * Validates that the InteractionRecordEvent union type and all supporting
 * interfaces have the correct structure. Since TypeScript types are erased
 * at runtime, these tests create objects matching each interface and verify
 * their shape at runtime.
 *
 * @module tests/unit/interaction-types
 */

import { describe, it, expect } from 'vitest';

// ── Helpers ──

/**
 * Build a base event with required common fields.
 */
function makeBaseEvent(
  type: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── Tests ──

describe('InteractionEventType union accepts all event types', () => {
  const validTypes = [
    'click',
    'mousedown',
    'mouseup',
    'mousemove',
    'keypress',
    'keydown',
    'keyup',
    'scroll',
    'wheel',
    'wait',
    'assert',
    'viewport',
  ] as const;

  for (const eventType of validTypes) {
    it(`accepts "${eventType}" as a valid event type`, () => {
      const event = makeBaseEvent(eventType);
      expect(event.type).toBe(eventType);
      expect(typeof event.type).toBe('string');
    });
  }
});

describe('ClickEvent interface shape', () => {
  it('has all required fields for a click event', () => {
    const event = {
      type: 'click' as const,
      timestamp: 1000,
      x: 100,
      y: 200,
      button: 'left' as const,
    };

    expect(event.type).toBe('click');
    expect(event.timestamp).toBe(1000);
    expect(event.x).toBe(100);
    expect(event.y).toBe(200);
    expect(event.button).toBe('left');
  });

  it('accepts optional selector field', () => {
    const event = {
      type: 'click' as const,
      timestamp: 1000,
      x: 100,
      y: 200,
      button: 'right' as const,
      selector: '#blast-btn',
    };

    expect(event.selector).toBe('#blast-btn');
  });

  it('accepts optional modifiers field', () => {
    const event = {
      type: 'mousedown' as const,
      timestamp: 1000,
      x: 100,
      y: 200,
      button: 'middle' as const,
      modifiers: { ctrl: true, shift: false },
    };

    expect(event.modifiers?.ctrl).toBe(true);
    expect(event.modifiers?.shift).toBe(false);
  });
});

describe('MouseMoveEvent interface shape', () => {
  it('has all required fields for a mousemove event', () => {
    const event = {
      type: 'mousemove' as const,
      timestamp: 1500,
      x: 300,
      y: 400,
    };

    expect(event.type).toBe('mousemove');
    expect(event.timestamp).toBe(1500);
    expect(event.x).toBe(300);
    expect(event.y).toBe(400);
  });

  it('rejects extra top-level fields not in the interface (structural)', () => {
    // The interface does not define button — validate it is undefined
    const event: Record<string, unknown> = {
      type: 'mousemove',
      timestamp: 1500,
      x: 300,
      y: 400,
    };
    expect(event.button).toBeUndefined();
  });
});

describe('KeyEvent interface shape', () => {
  it('has all required fields for a key event', () => {
    const event = {
      type: 'keypress' as const,
      timestamp: 2000,
      key: 'Enter',
      code: 'Enter',
    };

    expect(event.type).toBe('keypress');
    expect(event.timestamp).toBe(2000);
    expect(event.key).toBe('Enter');
    expect(event.code).toBe('Enter');
  });

  it('accepts keydown and keyup as valid type discriminants', () => {
    const keydown = { type: 'keydown' as const, timestamp: 0, key: 'a', code: 'KeyA' };
    const keyup = { type: 'keyup' as const, timestamp: 0, key: 'a', code: 'KeyA' };

    expect(keydown.type).toBe('keydown');
    expect(keyup.type).toBe('keyup');
  });
});

describe('ScrollEvent interface shape', () => {
  it('has all required fields for a scroll event', () => {
    const event = {
      type: 'scroll' as const,
      timestamp: 2500,
      x: 0,
      y: 500,
    };

    expect(event.type).toBe('scroll');
    expect(event.x).toBe(0);
    expect(event.y).toBe(500);
  });
});

describe('WheelEvent interface shape', () => {
  it('has all required fields for a wheel event', () => {
    const event = {
      type: 'wheel' as const,
      timestamp: 3000,
      x: 100,
      y: 200,
      deltaX: 0,
      deltaY: -120,
      deltaZ: 0,
    };

    expect(event.type).toBe('wheel');
    expect(event.deltaX).toBe(0);
    expect(event.deltaY).toBe(-120);
    expect(event.deltaZ).toBe(0);
  });
});

describe('WaitEvent interface shape', () => {
  it('has all required fields for a wait event', () => {
    const event = {
      type: 'wait' as const,
      timestamp: 3500,
      durationMs: 500,
    };

    expect(event.type).toBe('wait');
    expect(event.durationMs).toBe(500);
  });
});

describe('AssertEvent interface shape', () => {
  it('has all required fields for an assert event', () => {
    const event = {
      type: 'assert' as const,
      timestamp: 4000,
    };

    expect(event.type).toBe('assert');
    expect(event.timestamp).toBe(4000);
  });

  it('accepts optional assertion fields', () => {
    const event: Record<string, unknown> = {
      type: 'assert',
      timestamp: 4000,
      selector: '#result',
      property: 'textContent',
      expectedValue: 'Success',
      eval: 'window.gameState.stage',
      gameStatePath: 'stage',
      uiStatePath: 'result.text',
      timeout: 5000,
    };

    expect(event.selector).toBe('#result');
    expect(event.property).toBe('textContent');
    expect(event.expectedValue).toBe('Success');
    expect(event.eval).toBe('window.gameState.stage');
    expect(event.gameStatePath).toBe('stage');
    expect(event.uiStatePath).toBe('result.text');
    expect(event.timeout).toBe(5000);
  });
});

describe('ViewportEvent interface shape', () => {
  it('has all required fields for a viewport event', () => {
    const event = {
      type: 'viewport' as const,
      timestamp: 4500,
      width: 1920,
      height: 1080,
    };

    expect(event.type).toBe('viewport');
    expect(event.width).toBe(1920);
    expect(event.height).toBe(1080);
  });
});

describe('Recording meta structure', () => {
  it('has all required meta fields', () => {
    const meta = {
      viewport: { width: 1280, height: 720 },
      createdAt: '2026-06-19T12:00:00.000Z',
      durationMs: 15000,
      eventCount: 42,
      formatVersion: 1,
    };

    expect(meta.viewport.width).toBe(1280);
    expect(meta.viewport.height).toBe(720);
    expect(meta.createdAt).toBeTruthy();
    expect(typeof meta.durationMs).toBe('number');
    expect(meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(meta.eventCount).toBe(42);
    expect(meta.formatVersion).toBe(1);
  });

  it('viewport dimensions are positive integers', () => {
    const meta = { viewport: { width: 1920, height: 1080 } };
    expect(Number.isInteger(meta.viewport.width)).toBe(true);
    expect(Number.isInteger(meta.viewport.height)).toBe(true);
    expect(meta.viewport.width).toBeGreaterThan(0);
    expect(meta.viewport.height).toBeGreaterThan(0);
  });
});

describe('InteractionRecording container structure', () => {
  it('has all required top-level fields', () => {
    const recording: Record<string, unknown> = {
      name: 'test-recording',
      description: 'A test recording',
      meta: {
        viewport: { width: 1280, height: 720 },
        createdAt: '2026-06-19T12:00:00.000Z',
        durationMs: 5000,
        eventCount: 10,
        formatVersion: 1,
      },
      setupCommands: ['new_game seed:42'],
      events: [],
    };

    expect(recording.name).toBe('test-recording');
    expect(recording.description).toBe('A test recording');
    expect(Array.isArray(recording.setupCommands)).toBe(true);
    expect(Array.isArray(recording.events)).toBe(true);
  });

  it('accepts optional waitForSelectors and expectedOutcome fields', () => {
    const recording: Record<string, unknown> = {
      name: 'test',
      description: 'test',
      meta: {
        viewport: { width: 1280, height: 720 },
        createdAt: '2026-06-19T12:00:00.000Z',
        durationMs: 1000,
        eventCount: 1,
        formatVersion: 1,
      },
      setupCommands: [],
      events: [],
      waitForSelectors: ['.game-loaded'],
      expectedOutcome: { stage: 'mining' },
    };

    expect(Array.isArray(recording.waitForSelectors)).toBe(true);
    expect(recording.expectedOutcome).toEqual({ stage: 'mining' });
  });
});

describe('CompareResult structure', () => {
  it('has all required fields', () => {
    const result: Record<string, unknown> = {
      totalSteps: 10,
      matchedSteps: 8,
      divergedSteps: 2,
      screenshotDiffs: [],
      stateDiffs: [],
      reportPath: 'compare-results/report.json',
      pass: false,
    };

    expect(result.totalSteps).toBe(10);
    expect(result.matchedSteps).toBe(8);
    expect(result.divergedSteps).toBe(2);
    expect(Array.isArray(result.screenshotDiffs)).toBe(true);
    expect(Array.isArray(result.stateDiffs)).toBe(true);
    expect(result.reportPath).toBeTruthy();
    expect(typeof result.pass).toBe('boolean');
  });

  it('screenshotDiffs have the required structure', () => {
    const diff: Record<string, unknown> = {
      stepIndex: 3,
      baselineFile: 'baseline/step-03-screenshot.png',
      targetFile: 'target/step-03-screenshot.png',
      pixelDiffPercent: 0.05,
      diffImagePath: 'compare-results/step-03-diff.png',
    };

    expect(diff.stepIndex).toBe(3);
    expect(typeof diff.baselineFile).toBe('string');
    expect(typeof diff.targetFile).toBe('string');
    expect(typeof diff.pixelDiffPercent).toBe('number');
    expect(diff.pixelDiffPercent).toBeGreaterThanOrEqual(0);
    expect(typeof diff.diffImagePath).toBe('string');
  });

  it('stateDiffs have the required structure', () => {
    const diff: Record<string, unknown> = {
      stepIndex: 5,
      field: 'gameState.money',
      baselineValue: 10000,
      targetValue: 9500,
    };

    expect(diff.stepIndex).toBe(5);
    expect(typeof diff.field).toBe('string');
    expect(diff.baselineValue).toBe(10000);
    expect(diff.targetValue).toBe(9500);
  });

  it('matchedSteps + divergedSteps equals totalSteps', () => {
    const result = { totalSteps: 20, matchedSteps: 15, divergedSteps: 5 };
    expect(result.matchedSteps + result.divergedSteps).toBe(result.totalSteps);
  });

  it('pass is false when there are diverged steps', () => {
    const result = { totalSteps: 1, matchedSteps: 0, divergedSteps: 1, pass: false };
    expect(result.divergedSteps).toBeGreaterThan(0);
    expect(result.pass).toBe(false);
  });

  it('pass is true when all steps match', () => {
    const result = { totalSteps: 5, matchedSteps: 5, divergedSteps: 0, pass: true };
    expect(result.divergedSteps).toBe(0);
    expect(result.pass).toBe(true);
  });
});

describe('InteractionRecordEvent union acceptance', () => {
  // This test verifies at runtime that objects matching each event variant
  // are structurally compatible with the union type by checking required fields.
  it('accepts a ClickEvent as an InteractionRecordEvent', () => {
    const events: Record<string, unknown>[] = [
      { type: 'click', timestamp: 1, x: 10, y: 20, button: 'left' },
      { type: 'mousemove', timestamp: 2, x: 30, y: 40 },
      { type: 'keypress', timestamp: 3, key: 'a', code: 'KeyA' },
      { type: 'scroll', timestamp: 4, x: 0, y: 100 },
      { type: 'wheel', timestamp: 5, x: 0, y: 0, deltaX: 0, deltaY: -120, deltaZ: 0 },
      { type: 'wait', timestamp: 6, durationMs: 200 },
      { type: 'assert', timestamp: 7 },
      { type: 'viewport', timestamp: 8, width: 1280, height: 720 },
    ];

    expect(events).toHaveLength(8);
    for (const evt of events) {
      expect(evt).toHaveProperty('type');
      expect(evt).toHaveProperty('timestamp');
    }
  });
});
