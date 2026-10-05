// BlastSimulator2026 — Event result text must not claim safety is fine when the
// consequence lowers safety (#1466).
//
// Example defect: event.mafia_family_reunion.res1 said "safety stays intact"
// while declining applies safety: -6.

import { describe, it, expect } from 'vitest';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { setupEvents } from '../../../src/core/events/index.js';
import {
  clearEvents,
  getAllEvents,
  type EventConsequence,
  type EventDef,
} from '../../../src/core/events/EventPool.js';

const LOCALES = ['en', 'fr'] as const;
type Locale = (typeof LOCALES)[number];

/** Phrases that claim safety is unharmed. Only checked where safety delta < 0. */
const SAFETY_OK_CLAIMS: Record<Locale, readonly RegExp[]> = {
  en: [/\bintact\b/i, /\bunaffected\b/i, /\bunharmed\b/i, /stays? safe/i, /remains? safe/i, /safety (is )?(fine|unchanged)/i],
  fr: [/\bintacte?s?\b/i, /\binchangée?s?\b/i, /\bindemne\b/i, /reste en sécurité/i, /restent en sécurité/i],
};

/** Events whose negative-safety result text is allowed to match (none known yet). */
const ALLOWLIST = new Set<string>([]);

clearEvents();
setupEvents();
const ALL_EVENTS: readonly EventDef[] = getAllEvents();

interface Branch {
  key: string;
  consequence: EventConsequence;
}

function negativeSafetyBranches(ev: EventDef): Branch[] {
  const out: Branch[] = [];
  ev.options.forEach((opt, i) => {
    const c = ev.consequences[i];
    if (!c) return;
    if ((c.scoreDelta?.safety ?? 0) < 0) out.push({ key: opt.resultKey, consequence: c });
    const alt = c.altConsequence;
    if (alt && (alt.scoreDelta?.safety ?? 0) < 0) out.push({ key: `${opt.resultKey}_alt`, consequence: alt });
  });
  return out;
}

describe('Event result text does not claim safety is intact when safety drops (#1466)', () => {
  it('sanity: pool has events with negative safety consequences', () => {
    expect(ALL_EVENTS.flatMap(negativeSafetyBranches).length).toBeGreaterThan(0);
  });

  for (const ev of ALL_EVENTS) {
    const branches = negativeSafetyBranches(ev);
    if (branches.length === 0) continue;
    const run = ALLOWLIST.has(ev.id) ? it.skip : it;
    run(`${ev.id}: negative-safety results do not claim safety is intact (en, fr)`, () => {
      const offenders: string[] = [];
      for (const { key } of branches) {
        for (const locale of LOCALES) {
          setLocale(locale);
          const text = t(key);
          for (const re of SAFETY_OK_CLAIMS[locale]) {
            if (re.test(text)) offenders.push(`[${locale}] ${key}: "${text}" matches ${re}`);
          }
        }
      }
      setLocale('en');
      expect(offenders, offenders.join('\n')).toEqual([]);
    });
  }

  it('mafia_family_reunion res1 mentions the safety drop and no longer says intact', () => {
    const key = 'event.mafia_family_reunion.res1';
    try {
      setLocale('en');
      const en = t(key);
      expect(en).toMatch(/safety/i);
      expect(en).not.toMatch(/intact/i);
      setLocale('fr');
      const fr = t(key);
      expect(fr).toMatch(/sécurité/i);
      expect(fr).not.toMatch(/intacte?/i);
    } finally {
      setLocale('en');
    }
  });
});
