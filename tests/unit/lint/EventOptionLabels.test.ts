// Issue #1404 — event option labels must read as real choices.
// Data-driven over the full event catalog and both locales. Each rule collects
// every offender into one list so a failure shows the whole backlog at once.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { setupEvents } from '../../../src/core/events/index.js';
import { getAllEvents } from '../../../src/core/events/EventPool.js';
import type { EventDef } from '../../../src/core/events/EventPool.js';

const LOCALE_DIR = join(import.meta.dirname, '../../../src/core/i18n/locales');
const load = (f: string): Record<string, string> => JSON.parse(readFileSync(join(LOCALE_DIR, f), 'utf8'));
const en = load('en.json');
const fr = load('fr.json');

const PLACEHOLDER = /^Option \d+$/;
const EN_GENERIC = new Set(['Spend to fix it', 'Accept the deal', 'Pay up', 'Pay the hefty price']);
const FR_GENERIC = new Set([
  'Dépenser pour réparer', 'Accepter le marché', 'Payer', 'Payer le prix fort',
  'Première Option', 'Deuxième Option', 'Troisième Option', 'Quatrième Option',
]);

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

let events: readonly EventDef[] = [];
beforeAll(() => {
  setupEvents();
  events = getAllEvents();
});

function offenders(check: (e: EventDef) => string[]): string[] {
  return events.flatMap(check);
}

describe('event option labels (#1404)', () => {
  it('catalog is non-empty', () => {
    expect(events.length).toBeGreaterThan(50);
  });

  it('rule 1: en labels are not placeholders or generic stand-ins', () => {
    const bad = offenders(e => e.options.flatMap((o, i) => {
      const v = en[o.labelKey];
      return v !== undefined && (PLACEHOLDER.test(v) || EN_GENERIC.has(v))
        ? [`${e.id} option ${i} [en]: "${v}"`] : [];
    }));
    expect(bad, `generic en labels:\n${bad.join('\n')}`).toEqual([]);
  });

  it('rule 2: fr labels are not placeholders or generic stand-ins', () => {
    const bad = offenders(e => e.options.flatMap((o, i) => {
      const v = fr[o.labelKey];
      return v !== undefined && (PLACEHOLDER.test(v) || FR_GENERIC.has(v))
        ? [`${e.id} option ${i} [fr]: "${v}"`] : [];
    }));
    expect(bad, `generic fr labels:\n${bad.join('\n')}`).toEqual([]);
  });

  it("rule 3: an option's en label does not equal another option's effectTag", () => {
    const bad = offenders(e => e.options.flatMap((o, i) => {
      const v = en[o.labelKey];
      if (v === undefined) return [];
      const n = norm(v);
      return e.consequences.flatMap((c, j) =>
        j !== i && c.effectTag !== undefined && c.effectTag === n
          ? [`${e.id} option ${i} [en] "${v}" equals effectTag of option ${j} ("${c.effectTag}")`] : []);
    }));
    expect(bad, `labels colliding with other options' effectTags:\n${bad.join('\n')}`).toEqual([]);
  });

  it('rule 4: no two options of an event share a label (en and fr)', () => {
    const bad = offenders(e => (['en', 'fr'] as const).flatMap(loc => {
      const dict = loc === 'en' ? en : fr;
      const seen = new Map<string, number>();
      const out: string[] = [];
      e.options.forEach((o, i) => {
        const v = dict[o.labelKey];
        if (v === undefined) return;
        const prev = seen.get(v);
        if (prev !== undefined) out.push(`${e.id} options ${prev} and ${i} [${loc}] share "${v}"`);
        else seen.set(v, i);
      });
      return out;
    }));
    expect(bad, `duplicate labels:\n${bad.join('\n')}`).toEqual([]);
  });

  it('rule 5: event descriptions do not talk about follow-ups or option numbers', () => {
    const bad = offenders(e => (['en', 'fr'] as const).flatMap(loc => {
      const v = (loc === 'en' ? en : fr)[e.descKey];
      if (v === undefined) return [];
      return /follow-up to/i.test(v) || /\boption\s*\d/i.test(v)
        ? [`${e.id} desc [${loc}]: "${v}"`] : [];
    }));
    expect(bad, `meta-talk in descriptions:\n${bad.join('\n')}`).toEqual([]);
  });

  it('rule 6: every labelKey resolves in both locales', () => {
    const bad = offenders(e => e.options.flatMap((o, i) => (['en', 'fr'] as const).flatMap(loc => {
      const v = (loc === 'en' ? en : fr)[o.labelKey];
      return v === undefined || v === '' || v === o.labelKey
        ? [`${e.id} option ${i} [${loc}]: unresolved ${o.labelKey}`] : [];
    })));
    expect(bad, `unresolved labelKeys:\n${bad.join('\n')}`).toEqual([]);
  });
});
