// BlastSimulator2026 — Integration tests: Tutorial flow
// Verifies the console commands invoked by the Tutorial button in main.ts
// produce the expected game state: new_game seed:42 size:24 + campaign start level:tutorial_pit.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { campaignStartCommand } from '../../src/console/commands/campaign.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCtx(): GameContext {
  return { state: null, grid: null, emitter: new EventEmitter() };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Tutorial flow', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  // ── 1. new_game with tutorial params ──────────────────────────────────────

  it('new_game seed:42 size:24 creates game with correct params', () => {
    const result = newGameCommand(ctx, [], { seed: '42', size: '24' });

    expect(result.success).toBe(true);
    expect(ctx.state).not.toBeNull();
    expect(ctx.state!.seed).toBe(42);
    expect(ctx.state!.world).not.toBeNull();
    expect(ctx.state!.world!.sizeX).toBe(24);
    expect(ctx.state!.world!.sizeZ).toBe(24);

    // Grid should be generated with matching dimensions
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.sizeX).toBe(24);
    expect(ctx.grid!.sizeZ).toBe(24);
  });

  // ── 2. campaign start on new_game'd context ───────────────────────────────

  it('followed by campaign start level:tutorial_pit sets up tutorial level', () => {
    // First set up the game environment
    newGameCommand(ctx, [], { seed: '42', size: '24' });

    // Then start the tutorial level
    const result = campaignStartCommand(ctx, [], { level: 'tutorial_pit' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('tutorial_pit');
    expect(result.output).toContain('24×12×24');
    expect(result.output).toContain('$20,000');

    // State should reflect the tutorial_pit level config
    expect(ctx.state).not.toBeNull();
    expect(ctx.state!.campaign.activeLevelId).toBe('tutorial_pit');
    expect(ctx.state!.cash).toBe(20000);

    // World should be set up with tutorial_pit dimensions (24×12×24)
    expect(ctx.state!.world).not.toBeNull();
    expect(ctx.state!.world!.sizeX).toBe(24);
    expect(ctx.state!.world!.sizeY).toBe(12);
    expect(ctx.state!.world!.sizeZ).toBe(24);
    expect(ctx.state!.world!.gridReady).toBe(true);
  });

  // ── 3. Full tutorial flow produces playable state ─────────────────────────

  it('full tutorial flow (new_game + campaign start) produces playable state', () => {
    // Simulate what the Tutorial button handler does:
    //   mainMenu.hide()
    //   window.__gameConsole('new_game seed:42 size:24')
    //   window.__gameConsole('campaign start level:tutorial_pit')
    //   tutorial.start()

    newGameCommand(ctx, [], { seed: '42', size: '24' });
    campaignStartCommand(ctx, [], { level: 'tutorial_pit' });

    // Verify game context is fully set up
    expect(ctx.state).not.toBeNull();
    expect(ctx.grid).not.toBeNull();

    // Campaign state is active
    expect(ctx.state!.campaign.activeLevelId).toBe('tutorial_pit');

    // Seed from new_game is preserved through the level transition
    expect(ctx.state!.seed).toBe(42);

    // Grid matches tutorial_pit dimensions from Level.ts
    expect(ctx.grid!.sizeX).toBe(24);
    expect(ctx.grid!.sizeY).toBe(12);
    expect(ctx.grid!.sizeZ).toBe(24);

    // World state matches
    expect(ctx.state!.world!.sizeX).toBe(24);
    expect(ctx.state!.world!.sizeY).toBe(12);
    expect(ctx.state!.world!.sizeZ).toBe(24);
    expect(ctx.state!.world!.gridReady).toBe(true);

    // Nav grid should be built
    expect(ctx.state!.navGrid).not.toBeNull();

    // Starting cash matches tutorial_pit config
    expect(ctx.state!.cash).toBe(20000);
  });
});
