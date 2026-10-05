import { t } from '../core/i18n/I18n.js';
import { TICKS_PER_DAY } from '../core/config/balance.js';

/** Format a span of game ticks (1 tick = 1 game hour) as a localized "Xd Yh" string. */
export function formatGameDuration(ticks: number): string {
  const total = Math.max(0, Math.floor(ticks));
  const d = Math.floor(total / TICKS_PER_DAY);
  const h = total % TICKS_PER_DAY;
  if (d === 0) return t('time.duration.hours', { h });
  if (h === 0) return t('time.duration.days', { d });
  return t('time.duration.days_hours', { d, h });
}
