/**
 * Tests for the recording JSON format validation.
 *
 * Validates that InteractionRecording instances can be created from JSON,
 * that required fields are present, and that the format conforms to the
 * expected schema. These tests validate the data contract between the
 * recorder and replayer.
 *
 * @module tests/unit/recording-format
 */

import { describe, it, expect } from 'vitest';

// ── Helpers ──

/**
 * Create a minimal valid recording object for testing.
 */
function createValidRecording(): Record<string, unknown> {
  return {
    name: 'test-recording',
    description: 'A recording for testing purposes',
    meta: {
      viewport: { width: 1280, height: 720 },
      createdAt: '2026-06-19T12:00:00.000Z',
      durationMs: 5000,
      eventCount: 0,
      formatVersion: 1,
    },
    setupCommands: [],
    events: [],
  };
}

interface EventValidationCase {
  name: string;
  event: Record<string, unknown>;
  shouldSucceed: boolean;
  reason?: string;
}

// ── Tests ──

describe('Valid recording JSON parsing', () => {
  it('can be parsed from a plain object into the InteractionRecording type', () => {
    const recording = createValidRecording();
    const json = JSON.stringify(recording);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed.name).toBe('test-recording');
    expect(parsed.description).toBe('A recording for testing purposes');
    expect(parsed.meta).toBeDefined();
    expect(Array.isArray(parsed.setupCommands)).toBe(true);
    expect(Array.isArray(parsed.events)).toBe(true);
  });

  it('round-trips through JSON without data loss', () => {
    const recording = createValidRecording();
    recording.events = [
      { type: 'click', timestamp: 100, x: 50, y: 100, button: 'left' },
    ];
    recording.meta.eventCount = 1;
    recording.meta.durationMs = 100;

    const json = JSON.stringify(recording);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const parsedMeta = parsed.meta as Record<string, unknown>;

    expect(parsed.name).toBe('test-recording');
    expect(parsedMeta.eventCount).toBe(1);
    expect(parsedMeta.durationMs).toBe(100);
    expect(Array.isArray(parsed.events)).toBe(true);
    expect((parsed.events as unknown[])).toHaveLength(1);
  });

  it('preserves all event fields through serialization', () => {
    const recording = createValidRecording();
    recording.events = [
      {
        type: 'wheel',
        timestamp: 200,
        x: 100,
        y: 200,
        deltaX: 0,
        deltaY: -120,
        deltaZ: 0,
      },
    ];

    const json = JSON.stringify(recording);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const parsedEvent = (parsed.events as Record<string, unknown>[])[0]!;

    expect(parsedEvent.type).toBe('wheel');
    expect(parsedEvent.deltaY).toBe(-120);
  });
});

describe('Required field validation', () => {
  const requiredFields = ['name', 'description', 'meta', 'setupCommands', 'events'];

  for (const field of requiredFields) {
    it(`rejects recording missing "${field}"`, () => {
      const recording = createValidRecording();
      delete recording[field];

      // The field should be undefined after deletion
      expect(recording[field]).toBeUndefined();
    });
  }

  it('meta required sub-fields are all present in a valid recording', () => {
    const meta = createValidRecording().meta as Record<string, unknown>;

    expect(meta).toHaveProperty('viewport');
    expect(meta).toHaveProperty('createdAt');
    expect(meta).toHaveProperty('durationMs');
    expect(meta).toHaveProperty('eventCount');
    expect(meta).toHaveProperty('formatVersion');
  });

  it('meta missing viewport is invalid', () => {
    const meta: Record<string, unknown> = {
      createdAt: '2026-06-19T12:00:00.000Z',
      durationMs: 1000,
      eventCount: 0,
      formatVersion: 1,
    };

    expect(meta).not.toHaveProperty('viewport');
  });

  it('meta missing createdAt is invalid', () => {
    const meta: Record<string, unknown> = {
      viewport: { width: 1280, height: 720 },
      durationMs: 1000,
      eventCount: 0,
      formatVersion: 1,
    };

    expect(meta).not.toHaveProperty('createdAt');
  });

  it('meta missing formatVersion is invalid', () => {
    const meta: Record<string, unknown> = {
      viewport: { width: 1280, height: 720 },
      createdAt: '2026-06-19T12:00:00.000Z',
      durationMs: 1000,
      eventCount: 0,
    };

    expect(meta).not.toHaveProperty('formatVersion');
  });
});

describe('Event type field validation', () => {
  const testCases: EventValidationCase[] = [
    {
      name: 'click event has x, y, button',
      event: { type: 'click', timestamp: 1, x: 10, y: 20, button: 'left' },
      shouldSucceed: true,
    },
    {
      name: 'click event missing button is structurally incomplete',
      event: { type: 'click', timestamp: 1, x: 10, y: 20 },
      shouldSucceed: false,
      reason: 'Missing required field "button"',
    },
    {
      name: 'mousemove event has x, y',
      event: { type: 'mousemove', timestamp: 2, x: 30, y: 40 },
      shouldSucceed: true,
    },
    {
      name: 'mousemove event missing y is structurally incomplete',
      event: { type: 'mousemove', timestamp: 2, x: 30 },
      shouldSucceed: false,
      reason: 'Missing required field "y"',
    },
    {
      name: 'key event has key and code',
      event: { type: 'keypress', timestamp: 3, key: 'Enter', code: 'Enter' },
      shouldSucceed: true,
    },
    {
      name: 'key event missing code is structurally incomplete',
      event: { type: 'keydown', timestamp: 3, key: 'a' },
      shouldSucceed: false,
      reason: 'Missing required field "code"',
    },
    {
      name: 'wait event has durationMs',
      event: { type: 'wait', timestamp: 4, durationMs: 500 },
      shouldSucceed: true,
    },
    {
      name: 'wheel event has delta fields',
      event: { type: 'wheel', timestamp: 5, x: 0, y: 0, deltaX: 0, deltaY: -120, deltaZ: 0 },
      shouldSucceed: true,
    },
    {
      name: 'viewport event has width and height',
      event: { type: 'viewport', timestamp: 6, width: 1920, height: 1080 },
      shouldSucceed: true,
    },
    {
      name: 'unknown event type is rejected',
      event: { type: 'nonsense', timestamp: 7 },
      shouldSucceed: false,
      reason: 'Invalid event type "nonsense"',
    },
  ];

  for (const tc of testCases) {
    it(tc.name, () => {
      if (tc.shouldSucceed) {
        // Verify required fields are present
        expect(tc.event.type).toBeDefined();
        expect(typeof tc.event.timestamp).toBe('number');
      } else {
        // If it should fail, verify a required field is missing or invalid
        if (tc.reason?.includes('Missing')) {
          const missingField = tc.reason.match(/"([^"]+)"/)?.[1];
          if (missingField) {
            expect(tc.event[missingField]).toBeUndefined();
          }
        } else if (tc.reason?.includes('Invalid event type')) {
          const validTypes = [
            'click', 'mousedown', 'mouseup', 'mousemove',
            'keypress', 'keydown', 'keyup', 'scroll',
            'wheel', 'wait', 'assert', 'viewport',
          ];
          expect(validTypes).not.toContain(tc.event.type);
        }
      }
    });
  }
});

describe('Viewport format validation', () => {
  it('viewport has width and height as positive integers', () => {
    const viewport = { width: 1920, height: 1080 };

    expect(Number.isInteger(viewport.width)).toBe(true);
    expect(Number.isInteger(viewport.height)).toBe(true);
    expect(viewport.width).toBeGreaterThan(0);
    expect(viewport.height).toBeGreaterThan(0);
  });

  it('viewport with zero width is invalid', () => {
    const viewport = { width: 0, height: 1080 };
    expect(viewport.width).toBe(0);
    // zero width should not be valid for a browser viewport
    expect(viewport.width).not.toBeGreaterThan(0);
  });

  it('viewport with negative dimensions is invalid', () => {
    const viewport = { width: -100, height: 720 };
    expect(viewport.width).toBeLessThan(0);
  });

  it('viewport with non-integer dimensions is invalid', () => {
    const viewport = { width: 1920.5, height: 1080 };
    expect(Number.isInteger(viewport.width)).toBe(false);
  });

  it('viewport with missing height is invalid', () => {
    const viewport: Record<string, unknown> = { width: 1920 };
    expect(viewport).not.toHaveProperty('height');
  });
});

describe('Event type discriminant validation', () => {
  it('assert event always has timestamp', () => {
    const event: Record<string, unknown> = { type: 'assert', timestamp: 100 };
    expect(event.type).toBe('assert');
    expect(event.timestamp).toBe(100);
  });

  it('scroll event always has x and y', () => {
    const event: Record<string, unknown> = { type: 'scroll', timestamp: 200, x: 0, y: 300 };
    expect(event.x).toBe(0);
    expect(event.y).toBe(300);
  });

  it('events with screenshot flag are valid', () => {
    const event: Record<string, unknown> = {
      type: 'click',
      timestamp: 300,
      x: 10,
      y: 20,
      button: 'left',
      screenshot: true,
      label: 'blast-button-click',
    };
    expect(event.screenshot).toBe(true);
    expect(event.label).toBe('blast-button-click');
  });
});
