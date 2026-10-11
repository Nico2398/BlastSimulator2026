// BlastSimulator2026 — console `tick` after the level ended (#1313)

import { describe, it, expect, beforeEach } from 'vitest';
import { tickCommand } from '../../../src/console/commands/tick.js';
import { campaignCompleteCommand, campaignKeepPlayingCommand } from '../../../src/console/commands/campaign.js';
import { t } from '../../../src/core/i18n/I18n.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

beforeEach(() => setupEvents());

describe('tick after the level ended (#1313)', () => {
  it.each(['completed', 'bankruptcy'] as const)('advances 0 ticks and changes nothing after %s', (reason) => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
    const state = ctx.state!;
    state.levelEnded = true;
    state.levelEndReason = reason;
    state.cash = 12345;
    const tickBefore = state.tickCount;
    const scoresBefore = { ...state.scores };

    const result = tickCommand(ctx, ['20'], {});

    expect(result.success).toBe(true);
    expect(result.output).toBe(t('tick.level_ended'));
    expect(result.output).not.toBe('tick.level_ended');
    expect(state.tickCount).toBe(tickBefore);
    expect(state.cash).toBe(12345);
    expect(state.scores).toEqual(scoresBefore);
    expect(state.levelEndReason).toBe(reason);
  });

  it('still ticks normally while the level is running', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
    const before = ctx.state!.tickCount;
    tickCommand(ctx, ['1'], {});
    expect(ctx.state!.tickCount).toBe(before + 1);
  });

  it('has tick.level_ended in en and fr, translated differently', () => {
    const enMap = en as Record<string, string>;
    const frMap = fr as Record<string, string>;
    expect(typeof enMap['tick.level_ended']).toBe('string');
    expect(typeof frMap['tick.level_ended']).toBe('string');
    expect(enMap['tick.level_ended']).not.toBe(frMap['tick.level_ended']);
  });
});

describe('tick across keep-playing conversion (#1647)', () => {
  it('is refused after a win and accepted again after campaign keep_playing', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
    const state = ctx.state!;
    expect(campaignCompleteCommand(ctx, [], { level: 'dusty_hollow' }).success).toBe(true);
    expect(state.levelEndReason).toBe('completed');

    const frozen = state.tickCount;
    const refused = tickCommand(ctx, ['5'], {});
    expect(refused.output).toBe(t('tick.level_ended'));
    expect(state.tickCount).toBe(frozen);

    expect(campaignKeepPlayingCommand(ctx, [], {}).success).toBe(true);
    tickCommand(ctx, ['5'], {});
    expect(state.tickCount).toBe(frozen + 5);
    expect(state.levelEndReason).toBeNull();
    expect(state.levelEnded).toBe(false);
  });

  it('stays frozen after a defeat because keep_playing is refused', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
    const state = ctx.state!;
    state.levelEnded = true;
    state.levelEndReason = 'bankruptcy';
    expect(campaignKeepPlayingCommand(ctx, [], {}).success).toBe(false);
    const before = state.tickCount;
    expect(tickCommand(ctx, ['5'], {}).output).toBe(t('tick.level_ended'));
    expect(state.tickCount).toBe(before);
  });
});
