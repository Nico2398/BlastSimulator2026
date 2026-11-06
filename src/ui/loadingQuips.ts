// BlastSimulator2026 — Loading screen quips
//
// The load takes a few seconds of blocked main thread, and naming the actual
// work ("Generating terrain", "Building the site") made that wait feel like a
// progress report on somebody else's job. The game is a satire of open-pit
// mining management; the loading screen is free real estate for it.
//
// The text lives in the locale catalog (loading.quip.N / loading.tip.N) and is
// read at bag refill, so the pool follows the active locale.
//
// Drawn without replacement, so a single load never repeats a line, and the
// bag reshuffles once it runs dry.

import { t } from '../core/i18n/I18n.js';

function poolFor(prefix: string, count: number): readonly string[] {
  return Array.from({ length: count }, (_, i) => t(`${prefix}.${i}`));
}

export const LOADING_QUIP_COUNT = 34;
export const LOADING_TIP_COUNT = 14;

/** Quips in the current locale, keys `loading.quip.<i>`. */
export function loadingQuips(): readonly string[] { return poolFor('loading.quip', LOADING_QUIP_COUNT); }

/** Tips in the current locale, keys `loading.tip.<i>`. */
export function loadingTips(): readonly string[] { return poolFor('loading.tip', LOADING_TIP_COUNT); }

/**
 * Shared shuffle-without-repeat implementation behind both QuipBag and
 * TipBag: draws from `pool()` until it is empty, then reshuffles. The two
 * bags differ only in which locale-backed pool they draw from (#493).
 */
abstract class DrawBag<T> {
  private remaining: T[] = [];
  private readonly random: () => number;

  /** `random` is injectable so tests can pin the order. */
  constructor(random: () => number = Math.random) {
    this.random = random;
    this.refill();
  }

  /** The fixed pool this bag draws from, without repeating until exhausted. */
  protected abstract pool(): readonly T[];

  private refill(): void {
    this.remaining = [...this.pool()];
  }

  /** Draw an item. Refills once every item has been used. */
  next(): T {
    if (this.remaining.length === 0) this.refill();
    const i = Math.min(this.remaining.length - 1, Math.floor(this.random() * this.remaining.length));
    return this.remaining.splice(i, 1)[0]!;
  }

  /** Items still unused in the current pass — exposed for tests. */
  get remainingCount(): number {
    return this.remaining.length;
  }
}

/**
 * A bag that hands out quips without repeating until it is empty.
 *
 * Repetition inside one load is what would give the joke away as a fixed
 * list, so the bag is drawn down rather than sampled independently each time.
 */
export class QuipBag extends DrawBag<string> {
  protected pool(): readonly string[] { return loadingQuips(); }
}

/**
 * A bag that hands out tips without repeating until it is empty — same shape
 * as QuipBag, sharing the draw logic via `DrawBag<T>`.
 */
export class TipBag extends DrawBag<string> {
  protected pool(): readonly string[] { return loadingTips(); }
}
