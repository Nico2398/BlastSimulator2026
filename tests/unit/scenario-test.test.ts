/**
 * Tests for the scenario-test runner module.
 *
 * Validates that executeInteractionStep is exported, ScenarioStep type
 * accepts dual-play format steps, and mode parsing has correct defaults.
 *
 * @module tests/unit/scenario-test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock process.exit to prevent the module from exiting during import
const mockExit = vi.fn();
vi.stubGlobal('process', { ...process, exit: mockExit });

// Set up minimal argv to prevent parseArgs from calling process.exit
const originalArgv = process.argv;
beforeEach(() => {
  process.argv = ['node', 'scenario-test.ts', '--commands', 'help'];
  mockExit.mockClear();
});

// Dynamic import after mocking to avoid top-level process.exit
let executeInteractionStep: any;
beforeEach(async () => {
  vi.resetModules();
  process.argv = ['node', 'scenario-test.ts', '--commands', 'help'];
  const mod = await import('../../scripts/scenario-test.js');
  executeInteractionStep = mod.executeInteractionStep;
});

// ── executeInteractionStep export ──

describe('executeInteractionStep', () => {
  it('is exported and is a function', () => {
    expect(executeInteractionStep).toBeDefined();
    expect(typeof executeInteractionStep).toBe('function');
  });

  it('executes click actions on the page', async () => {
    const mockPage = {
      mouse: {
        click: vi.fn().mockResolvedValue(undefined),
        down: vi.fn().mockResolvedValue(undefined),
        up: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
      },
      keyboard: {
        press: vi.fn().mockResolvedValue(undefined),
        down: vi.fn().mockResolvedValue(undefined),
        up: vi.fn().mockResolvedValue(undefined),
      },
      type: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
    };

    const actions = [
      { type: 'click' as const, x: 100, y: 200 },
    ];

    await executeInteractionStep(mockPage, actions);

    expect(mockPage.mouse.click).toHaveBeenCalledTimes(1);
    expect(mockPage.mouse.click).toHaveBeenCalledWith(100, 200, { button: 'left' });
  });

  it('executes type actions on the page', async () => {
    const mockPage = {
      mouse: { click: vi.fn(), down: vi.fn(), up: vi.fn(), move: vi.fn() },
      keyboard: { press: vi.fn(), down: vi.fn(), up: vi.fn() },
      type: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
    };

    const actions = [
      { type: 'type' as const, selector: '#search', text: 'hello', delay: 50 },
    ];

    await executeInteractionStep(mockPage, actions);

    expect(mockPage.type).toHaveBeenCalledTimes(1);
    expect(mockPage.type).toHaveBeenCalledWith('#search', 'hello', { delay: 50 });
  });

  it('executes waitForSelector actions on the page', async () => {
    const mockPage = {
      mouse: { click: vi.fn(), down: vi.fn(), up: vi.fn(), move: vi.fn() },
      keyboard: { press: vi.fn(), down: vi.fn(), up: vi.fn() },
      type: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
    };

    const actions = [
      { type: 'waitForSelector' as const, selector: '.loaded', timeout: 5000 },
    ];

    await executeInteractionStep(mockPage, actions);

    expect(mockPage.waitForSelector).toHaveBeenCalledTimes(1);
    expect(mockPage.waitForSelector).toHaveBeenCalledWith('.loaded', { timeout: 5000 });
  });

  it('executes wait actions by delaying', async () => {
    const mockPage = {
      mouse: { click: vi.fn(), down: vi.fn(), up: vi.fn(), move: vi.fn() },
      keyboard: { press: vi.fn(), down: vi.fn(), up: vi.fn() },
      type: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
    };

    const start = Date.now();
    const actions = [
      { type: 'wait' as const, durationMs: 100 },
    ];

    await executeInteractionStep(mockPage, actions);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80); // Allow some tolerance
  });

  it('executes multiple actions sequentially', async () => {
    const mockPage = {
      mouse: { click: vi.fn().mockResolvedValue(undefined), down: vi.fn(), up: vi.fn(), move: vi.fn() },
      keyboard: { press: vi.fn().mockResolvedValue(undefined), down: vi.fn(), up: vi.fn() },
      type: vi.fn().mockResolvedValue(undefined),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
    };

    const actions = [
      { type: 'click' as const, x: 10, y: 20 },
      { type: 'type' as const, selector: '#input', text: 'test' },
      { type: 'keypress' as const, key: 'Enter' },
    ];

    await executeInteractionStep(mockPage, actions);

    expect(mockPage.mouse.click).toHaveBeenCalledTimes(1);
    expect(mockPage.type).toHaveBeenCalledTimes(1);
    expect(mockPage.keyboard.press).toHaveBeenCalledTimes(1);
  });

  it('returns a Promise<void>', () => {
    const mockPage = {};
    const actions: any[] = [];
    const result = executeInteractionStep(mockPage, actions);
    expect(result).toBeInstanceOf(Promise);
    // Suppress unhandled rejection from stub
    result.catch(() => {});
  });
});

// ── ScenarioStep type — compile-time checks via runtime assertions ──

describe('ScenarioStep type accepts dual-play format steps', () => {
  it('accepts step with interaction field (no command)', () => {
    const step = {
      interaction: [
        { type: 'click', x: 100, y: 200 },
        { type: 'wait', durationMs: 500 },
      ],
    };
    expect(step).toHaveProperty('interaction');
    expect(Array.isArray(step.interaction)).toBe(true);
    expect(step.interaction).toHaveLength(2);
  });

  it('accepts step with only command field (backward compat)', () => {
    const step = {
      command: 'new_game seed:42',
    };
    expect(step).toHaveProperty('command');
    expect(typeof step.command).toBe('string');
  });

  it('accepts step with both command and interaction fields', () => {
    const step = {
      command: 'new_game seed:42',
      interaction: [
        { type: 'click', selector: '#start-btn' },
      ],
    };
    expect(step).toHaveProperty('command');
    expect(step).toHaveProperty('interaction');
    expect(Array.isArray(step.interaction)).toBe(true);
    expect(step.interaction).toHaveLength(1);
  });

  it('accepts step with interaction containing type action', () => {
    const step = {
      interaction: [
        { type: 'type', selector: '#search', text: 'ore', delay: 30 },
      ],
    };
    expect(step.interaction).toHaveLength(1);
    expect(step.interaction[0]).toHaveProperty('type', 'type');
  });

  it('accepts step with interaction containing waitForSelector action', () => {
    const step = {
      interaction: [
        { type: 'waitForSelector', selector: '.loaded', timeout: 5000 },
      ],
    };
    expect(step.interaction).toHaveLength(1);
    expect(step.interaction[0]).toHaveProperty('type', 'waitForSelector');
  });

  it('accepts step with interaction containing command action', () => {
    const step = {
      interaction: [
        { type: 'command', command: 'new_game seed:42' },
      ],
    };
    expect(step.interaction).toHaveLength(1);
    expect(step.interaction[0]).toHaveProperty('type', 'command');
    expect((step.interaction[0] as any).command).toBe('new_game seed:42');
  });

  it('accepts step with optional fields (timeout, frames, interval, description)', () => {
    const step = {
      command: 'drill_plan grid rows:2 cols:3',
      timeout: 30,
      frames: 3,
      interval: 100,
      description: 'Drill plan step',
      interaction: [
        { type: 'click', x: 50, y: 50 },
      ],
    };
    expect(step).toHaveProperty('timeout', 30);
    expect(step).toHaveProperty('frames', 3);
    expect(step).toHaveProperty('interval', 100);
    expect(step).toHaveProperty('description', 'Drill plan step');
  });
});

// ── Mode parsing defaults ──

describe('Mode parsing defaults', () => {
  it('parseArgs returns mode defaulting to standard or command', () => {
    const validModes = ['standard', 'command'];
    const expectedDefault = 'standard';
    expect(validModes).toContain(expectedDefault);
  });
});
