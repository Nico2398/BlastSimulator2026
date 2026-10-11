// BlastSimulator2026 — `campaign keep_playing` console command (#1647)

import { describe, it, expect, beforeEach } from 'vitest';
import { campaignCompleteCommand, campaignKeepPlayingCommand } from '../../../src/console/commands/campaign.js';
import { tickCommand } from '../../../src/console/commands/tick.js';
import { createRunner, runCommand } from '../../../src/console/createRunner.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { makeGameContext, makeEmptyGameContext } from '../../helpers/gameContext.js';
import { BANKRUPTCY_GRACE_TICKS } from '../../../src/core/campaign/Bankruptcy.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { t } from '../../../src/core/i18n/I18n.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

beforeEach(() => setupEvents());

function wonCtx(level = 'dusty_hollow') {
  const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
  expect(campaignCompleteCommand(ctx, [], { level }).success).toBe(true);
  return ctx;
}

describe('campaign keep_playing (#1647)', () => {
  it('converts a win into live free play on the same site', () => {
    const ctx = wonCtx();
    const s = ctx.state!;
    const snapshot = {
      cash: s.cash,
      employees: s.employees.length,
      vehicles: s.vehicles.length,
      buildings: s.buildings.length,
      levels: JSON.parse(JSON.stringify(s.campaign.levels)),
      grid: ctx.grid,
    };
    const r = campaignKeepPlayingCommand(ctx, [], {});
    expect(r.success).toBe(true);
    expect(r.output).toBe(t('campaign.keep_playing_success'));
    expect(r.output).not.toBe('campaign.keep_playing_success');
    expect(s.levelEnded).toBe(false);
    expect(s.levelEndReason).toBeNull();
    expect(s.campaign.activeLevelId).toBeNull();
    expect(s.cash).toBe(snapshot.cash);
    expect(s.employees.length).toBe(snapshot.employees);
    expect(s.vehicles.length).toBe(snapshot.vehicles);
    expect(s.buildings.length).toBe(snapshot.buildings);
    expect(ctx.grid).toBe(snapshot.grid);
    expect(s.campaign.levels).toEqual(snapshot.levels);
    expect(s.campaign.levels['dusty_hollow']!.completed).toBe(true);
  });

  it('is reachable through the runner as `campaign keep_playing`', () => {
    const engine = createRunner();
    runCommand(engine, 'new_game seed:1 mine_type:desert');
    runCommand(engine, 'campaign complete level:dusty_hollow');
    expect(engine.ctx.state!.levelEndReason).toBe('completed');
    const r = runCommand(engine, 'campaign keep_playing');
    expect(r.success).toBe(true);
    expect(engine.ctx.state!.levelEndReason).toBeNull();
    expect(runCommand(engine, 'tick 3').success).toBe(true);
  });

  it('works after a tutorial win', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
    campaignCompleteCommand(ctx, [], { level: 'tutorial_pit' });
    expect(ctx.state!.levelEndReason).toBe('completed');
    expect(campaignKeepPlayingCommand(ctx, [], {}).success).toBe(true);
    expect(ctx.state!.levelEndReason).toBeNull();
  });

  it('does not re-trigger the win with profit above the threshold', () => {
    const ctx = wonCtx();
    campaignKeepPlayingCommand(ctx, [], {});
    const s = ctx.state!;
    s.cash += getLevel('dusty_hollow')!.unlockThreshold * 3;
    tickCommand(ctx, ['10'], {});
    expect(s.levelEnded).toBe(false);
    expect(s.levelEndReason).toBeNull();
  });

  it('keeps defeat conditions active: bankruptcy still ends the session', () => {
    const ctx = wonCtx();
    campaignKeepPlayingCommand(ctx, [], {});
    ctx.state!.cash = 0;
    tickCommand(ctx, [String(BANKRUPTCY_GRACE_TICKS + 20)], {});
    expect(ctx.state!.levelEndReason).toBe('bankruptcy');
    expect(ctx.state!.levelEnded).toBe(true);
  });

  it.each(['bankruptcy', 'arrest', 'ecological_shutdown', 'worker_revolt'] as const)(
    'is refused after a %s defeat and changes nothing', reason => {
      const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
      const s = ctx.state!;
      s.campaign.activeLevelId = 'dusty_hollow';
      s.levelEnded = true;
      s.levelEndReason = reason;
      const r = campaignKeepPlayingCommand(ctx, [], {});
      expect(r.success).toBe(false);
      expect(r.output).toBe(t('campaign.keep_playing_refused'));
      expect(r.output).not.toBe('campaign.keep_playing_refused');
      expect(s.levelEnded).toBe(true);
      expect(s.levelEndReason).toBe(reason);
      expect(s.campaign.activeLevelId).toBe('dusty_hollow');
    });

  it('is refused while the level is still running', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
    const r = campaignKeepPlayingCommand(ctx, [], {});
    expect(r.success).toBe(false);
    expect(ctx.state!.levelEndReason).toBeNull();
  });

  it('is refused with no game loaded', () => {
    const r = campaignKeepPlayingCommand(makeEmptyGameContext(), [], {});
    expect(r.success).toBe(false);
  });

  it('is refused on a second call', () => {
    const ctx = wonCtx();
    expect(campaignKeepPlayingCommand(ctx, [], {}).success).toBe(true);
    expect(campaignKeepPlayingCommand(ctx, [], {}).success).toBe(false);
  });

  it('defines its i18n keys in en and fr, translated differently', () => {
    const e = en as Record<string, string>;
    const f = fr as Record<string, string>;
    for (const key of ['ui.level_end.keep_playing', 'campaign.keep_playing_success', 'campaign.keep_playing_refused']) {
      expect(typeof e[key]).toBe('string');
      expect(typeof f[key]).toBe('string');
      expect(e[key]).not.toBe(f[key]);
    }
  });
});
