// BlastSimulator2026 — cheatCommand unit tests (issue #631)
// `cheat disable_revolt` is a temporary, tracked test-only override — see
// cheats.ts's own doc comment. Covers the guard, the happy path, and the
// unknown-subcommand rejection.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import { cheatCommand } from '../../../src/console/commands/cheats.js';
import type { GameContext } from '../../../src/console/commands/world.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';

function makeCtx(): GameContext {
  const ctx: GameContext = {
    state: null,
    grid: null,
    emitter: new EventEmitter(),
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '16' });
  return ctx;
}

beforeEach(() => resetHoleIds());

describe('cheatCommand', () => {
  it('requires a loaded game', () => {
    const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
    const result = cheatCommand(ctx, ['disable_revolt'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });

  it('disable_revolt sets state.revoltDisabled to true', () => {
    const ctx = makeCtx();
    expect(ctx.state!.revoltDisabled).toBe(false);

    const result = cheatCommand(ctx, ['disable_revolt'], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.revoltDisabled).toBe(true);
  });

  it('rejects an unknown subcommand without touching state', () => {
    const ctx = makeCtx();
    const result = cheatCommand(ctx, ['not_a_real_cheat'], {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage: cheat disable_revolt');
    expect(ctx.state!.revoltDisabled).toBe(false);
  });

  it('rejects a bare "cheat" with no subcommand', () => {
    const ctx = makeCtx();
    const result = cheatCommand(ctx, [], {});

    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage: cheat disable_revolt');
  });
});
