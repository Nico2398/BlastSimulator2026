// Tests for the shared ConsoleRunner factory (used by both console.ts and main.ts)

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';

describe('createRunner', () => {
  it('creates a runner that responds to help', () => {
    const { runner } = createRunner();
    const result = runner.run('help');
    expect(result.success).toBe(true);
    expect(result.output).toContain('Available commands');
    expect(result.output).toContain('new_game');
    expect(result.output).toContain('blast');
    expect(result.output).toContain('campaign');
  });

  it('returns error for unknown command', () => {
    const { runner } = createRunner();
    const result = runner.run('not_a_real_command');
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown command');
  });

  it('context state starts as null before new_game', () => {
    const { ctx } = createRunner();
    expect(ctx.state).toBeNull();
    expect(ctx.grid).toBeNull();
  });

  it('new_game initializes game state', () => {
    const { runner, ctx } = createRunner();
    const result = runner.run('new_game mine_type:desert seed:42');
    expect(result.success).toBe(true);
    expect(ctx.state).not.toBeNull();
    expect(ctx.grid).not.toBeNull();
  });

  it('empty input returns success with no output', () => {
    const { runner } = createRunner();
    const result = runner.run('');
    expect(result.success).toBe(true);
    expect(result.output).toBe('');
  });

  it('multiple runner instances are independent', () => {
    const { runner: r1, ctx: c1 } = createRunner();
    const { runner: r2, ctx: c2 } = createRunner();

    r1.run('new_game mine_type:desert seed:1');
    // r2 state should still be null
    expect(c1.state).not.toBeNull();
    expect(c2.state).toBeNull();
  });
});
