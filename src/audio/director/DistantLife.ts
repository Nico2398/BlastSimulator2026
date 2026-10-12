// BlastSimulator2026 — Distant life
// Now and then something happens far away on the site: a clang, a horn, a thud.
// It plays on the ambient bus from a virtual position well away from the
// listener, so the spatial filter dulls and quiets it. Rare and subtle by
// design: it only makes the world feel inhabited.

import type { OneShotId } from '../SoundCatalog.js';
import { SOUND_CATALOG } from '../SoundCatalog.js';
import { LIFE_CONFIG } from '../../core/config/audio/game.js';
import { cullM, offsetPoint } from './listening.js';
import { pickWeighted } from './scalar.js';
import type { DirectorEnv } from './types.js';

/** The configured sounds that exist in the catalog as one-shots, with their odds. */
const CANDIDATES: readonly (readonly [OneShotId, number])[] = Object.entries(LIFE_CONFIG.sounds).flatMap(([id, weight]) => {
  const def = (SOUND_CATALOG as Record<string, { loop?: true } | undefined>)[id];
  return def && !def.loop ? [[id as OneShotId, weight] as const] : [];
});

export class DistantLife {
  private timerS: number | null = null;

  constructor(private readonly env: DirectorEnv) {}

  /** `active` is false while paused, behind a menu or with no game. */
  update(dtS: number, active: boolean): void {
    const listener = this.env.listener();
    if (!active || !listener) {
      this.timerS = null;
      return;
    }
    this.timerS ??= this.nextInterval();
    this.timerS -= dtS;
    if (this.timerS > 0) return;
    this.timerS = this.nextInterval();

    const sound = pickWeighted(this.env.random, CANDIDATES);
    if (!sound) return;
    const distance = Math.min(
      this.env.random.nextFloat(LIFE_CONFIG.minDistanceM, LIFE_CONFIG.maxDistanceM),
      cullM(listener.viewDistance) * LIFE_CONFIG.maxCullShare,
    );
    this.env.player.play(sound, {
      at: offsetPoint(listener, this.env.random.nextFloat(0, Math.PI * 2), distance),
      bus: 'ambient',
      gainDb: this.env.random.nextFloat(LIFE_CONFIG.minDb, LIFE_CONFIG.maxDb),
      key: 'life',
    });
  }

  reset(): void {
    this.timerS = null;
  }

  private nextInterval(): number {
    return this.env.random.nextFloat(LIFE_CONFIG.minIntervalS, LIFE_CONFIG.maxIntervalS);
  }
}
