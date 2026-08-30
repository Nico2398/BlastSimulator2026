// BlastSimulator2026 — tutorial_start console command (issue #585)
//
// `tutorial_start` is the console-mode entry point a scenario step drives
// instead of clicking the "Tutorial" button — it must pause the game exactly
// the way TutorialOverlay.start(ctx.state) does (see
// tests/integration/tutorial-pause.integration.test.ts, #371), so a scenario
// replaying `tutorial_start` sees the same isPaused:true a real player click
// produces, without needing a DOM.

import { describe, it, expect } from 'vitest';
import { campaignStartCommand, tutorialStartCommand } from '../../../src/console/commands/campaign.js';
import type { GameContext } from '../../../src/console/commands/world.js';
import { makeEmptyGameContext, makeGameContext } from '../../helpers/gameContext.js';

function makeCtx(): GameContext {
  return makeEmptyGameContext();
}

describe('tutorial_start command', () => {
  it('pauses the game and reports success once a level is active', () => {
    const ctx = makeGameContext({ seed: 42, size: 24 });
    campaignStartCommand(ctx, [], { level: 'tutorial_pit' });
    expect(ctx.state!.isPaused).toBe(false);

    const result = tutorialStartCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.isPaused).toBe(true);
  });

  it('does not report success without a loaded game', () => {
    const ctx = makeCtx();
    const result = tutorialStartCommand(ctx, [], {});
    expect(result.success).toBe(false);
  });
});
