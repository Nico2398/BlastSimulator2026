// BlastSimulator2026 — Event outcome sentence completeness guard (#421)
//
// Every event option's resultKey (and resultKey + '_alt' for options whose
// consequence carries an altConsequence) must resolve to a real, non-empty,
// non-echoing sentence in BOTH locales. This is the acceptance criterion for
// #421 ("Outcome: Lost $3000, safety -3" replaced by satirical prose).
//
// Regression guard: every `event.*.res*` key must have a real locale entry
// in both files. If t() ever falls back to echoing the key itself for one
// of them, this suite catches it.
//
// One it() per registered event (not per option) keeps the ~1700-check total
// down to a manageable, still individually-attributable set of CI failures —
// each failing test names exactly which event's keys are missing.

import { describe, it, expect } from 'vitest';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { clearEvents, getAllEvents, type EventDef } from '../../../src/core/events/EventPool.js';

const LOCALES = ['en', 'fr'] as const;

// The event pool is a runtime registry — nothing is registered until
// setupEvents() runs. Build the full list once, at module scope, so we can
// generate one it() per event (Vitest evaluates describe bodies fully before
// running any hook, so this can't happen inside beforeAll/beforeEach).
clearEvents();
setupEvents();
const ALL_EVENTS: readonly EventDef[] = getAllEvents();

describe('Event outcome sentence keys (resultKey) resolve in en + fr (#421)', () => {
  it('the event pool has events registered (sanity check for this suite itself)', () => {
    expect(ALL_EVENTS.length).toBeGreaterThan(0);
  });

  for (const eventDef of ALL_EVENTS) {
    it(`${eventDef.id}: every option's resultKey (+ _alt where applicable) resolves to real prose in en and fr`, () => {
      const missing: string[] = [];

      for (let i = 0; i < eventDef.options.length; i++) {
        const option = eventDef.options[i]!;
        const consequence = eventDef.consequences[i];
        const keysToCheck = [option.resultKey];
        if (consequence?.altConsequence) {
          keysToCheck.push(`${option.resultKey}_alt`);
        }

        for (const key of keysToCheck) {
          for (const locale of LOCALES) {
            setLocale(locale);
            const resolved = t(key);
            if (resolved === key || resolved.length === 0) {
              missing.push(`[${locale}] "${key}"`);
            }
          }
        }
      }

      setLocale('en');
      expect(
        missing,
        `event "${eventDef.id}" has missing/echoing resultKey translations: ${missing.join(', ')}`,
      ).toEqual([]);
    });
  }
});
