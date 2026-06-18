// BlastSimulator2026 — Integration tests: Tutorial pause behaviour
// Verifies that tutorial.start(ctx.state) pauses the game (isPaused = true).

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { campaignStartCommand } from '../../src/console/commands/campaign.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { TutorialOverlay } from '../../src/ui/TutorialOverlay.js';

// TODO: implement tests
describe('Tutorial pause behaviour', () => {
  // TODO: implement tests
  it.todo('tutorial.start(ctx.state) pauses the game');
});
