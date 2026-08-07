// BlastSimulator2026 — shared language-pill selection state (#492 section 2)
//
// Both MainMenu's menu-bar language toggle and SettingsPanel's settings
// language toggle render a pair of EN/FR pill buttons and need to mark the
// currently active locale with the `active` class — at construction time
// (so a fresh load already shows the default locale, 'en', as selected
// rather than showing neither pill selected until the player clicks one)
// and again whenever the locale changes. Shared here so both call sites
// stay in sync instead of each carrying its own copy of the same
// two-line classList toggle.

import type { Locale } from '../core/i18n/I18n.js';

/**
 * Toggle the `active` class on an EN/FR pill pair to match `active`.
 * Pure DOM update — reads only its arguments, no i18n/global state access.
 */
export function syncLangPills(enPill: HTMLElement, frPill: HTMLElement, active: Locale): void {
  enPill.classList.toggle('active', active === 'en');
  frPill.classList.toggle('active', active === 'fr');
}
