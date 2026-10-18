import { t } from '../core/i18n/I18n.js';
import { TICKS_PER_DAY } from '../core/config/balance.js';

/** Formats a tick as the in-game clock, e.g. "Day 29, 08:00" (#1966). */
export function formatGameClock(tick: number): string {
  const whole = Math.floor(tick);
  const day = Math.floor(whole / TICKS_PER_DAY) + 1;
  const hour = String(whole % TICKS_PER_DAY).padStart(2, '0');
  return t('time.clock.day_hour', { day, hour });
}
