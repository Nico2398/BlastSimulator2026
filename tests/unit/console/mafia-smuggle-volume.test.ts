// #1409 — `mafia smuggle volume:<k>` picks the smuggled share of operating income.
import { describe, it, expect, afterEach } from 'vitest';
import { mafiaCommand } from '../../../src/console/commands/mafia.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { SMUGGLING_VOLUME_LEVELS } from '../../../src/core/config/balance.js';
import { makeGameContext, type GameContext } from '../../helpers/gameContext.js';

function unlockedCtx(seed = 1): GameContext {
  const ctx = makeGameContext({ mineType: 'desert', seed, size: 24 });
  ctx.state!.corruption.mafiaUnlocked = true;
  return ctx;
}

afterEach(() => setLocale('en'));

describe('mafia smuggle volume (#1409)', () => {
  it('sets every configured volume', () => {
    for (const level of SMUGGLING_VOLUME_LEVELS) {
      const ctx = unlockedCtx();
      const result = mafiaCommand(ctx, ['smuggle'], { volume: String(level) });
      expect(result.success).toBe(true);
      expect(ctx.state!.mafia.smugglingVolume).toBe(level);
    }
  });

  it('volume:0 switches smuggling off', () => {
    const ctx = unlockedCtx();
    mafiaCommand(ctx, ['smuggle'], { volume: '0.5' });
    const result = mafiaCommand(ctx, ['smuggle'], { volume: '0' });
    expect(result.success).toBe(true);
    expect(ctx.state!.mafia.smugglingVolume).toBe(0);
  });

  it('refuses a volume that is not a configured level and keeps the old one', () => {
    const ctx = unlockedCtx();
    mafiaCommand(ctx, ['smuggle'], { volume: '0.25' });
    for (const bad of ['0.3', '-1', '7', 'abc', '']) {
      const result = mafiaCommand(ctx, ['smuggle'], { volume: bad });
      expect(result.success).toBe(false);
      expect(result.output.length).toBeGreaterThan(0);
      expect(ctx.state!.mafia.smugglingVolume).toBe(0.25);
    }
  });

  it('with no volume argument it does not toggle smuggling', () => {
    const ctx = unlockedCtx();
    const before = ctx.state!.mafia.smugglingVolume;
    mafiaCommand(ctx, ['smuggle'], {});
    expect(ctx.state!.mafia.smugglingVolume).toBe(before);
    mafiaCommand(ctx, ['smuggle'], { volume: '0.5' });
    mafiaCommand(ctx, ['smuggle'], {});
    expect(ctx.state!.mafia.smugglingVolume).toBe(0.5);
  });

  it('is refused before the mafia is unlocked', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
    const result = mafiaCommand(ctx, ['smuggle'], { volume: '0.25' });
    expect(result.success).toBe(false);
    expect(ctx.state!.mafia.smugglingVolume).toBe(0);
  });

  it('choosing a volume costs no exposure', () => {
    const ctx = unlockedCtx();
    mafiaCommand(ctx, ['smuggle'], { volume: '1' });
    expect(ctx.state!.mafia.exposureRisk).toBe(0);
  });

  it('status reports the exposure but no audit probability or risk number for smuggling', () => {
    const ctx = unlockedCtx();
    mafiaCommand(ctx, ['smuggle'], { volume: '0.25' });
    const lines = mafiaCommand(ctx, ['status'], {}).output.split('\n');
    const smugglingLines = lines.filter(l => /smuggl/i.test(l));
    expect(smugglingLines.length).toBeGreaterThan(0);
    for (const l of smugglingLines) {
      expect(l).not.toMatch(/audit|risk|probab/i);
    }
  });
});
