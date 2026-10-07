// BlastSimulator2026 — wireCorruptionNotifications (#1411): scandal / investigation / exposure toasts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { wireCorruptionNotifications } from '../../../src/ui/notify/corruptionNotifications.js';
import type { NotifyInput } from '../../../src/ui/notify/NotificationCenter.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

type Handler = (payload: never) => void;

function makeEmitter() {
  const handlers = new Map<string, Handler[]>();
  return {
    on: ((event: string, h: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(h);
      handlers.set(event, list);
      return () => undefined;
    }) as never,
    fire(event: string, payload: unknown): void {
      for (const h of handlers.get(event) ?? []) (h as (p: unknown) => void)(payload);
    },
    has(event: string): boolean { return (handlers.get(event) ?? []).length > 0; },
  };
}

const KEYS = [
  'notification.title.scandal',
  'notification.title.investigation',
  'notification.corruption.scandal',
  'notification.mafia.investigation',
  'notification.mafia.smuggling_exposed',
  'notification.mafia.exposed',
  'event.mafia_police_investigation.title',
  'event.mafia_police_investigation.desc',
  'event.mafia_police_investigation.opt0',
  'event.mafia_police_investigation.opt1',
  'event.mafia_police_investigation.opt2',
  'event.mafia_police_investigation.res0',
  'event.mafia_police_investigation.res1',
  'event.mafia_police_investigation.res2',
];

describe('corruption notification i18n keys', () => {
  for (const key of KEYS) {
    it(`en.json defines ${key}`, () => {
      expect((en as Record<string, string>)[key]).toBeTypeOf('string');
    });
    it(`fr.json defines ${key}`, () => {
      expect((fr as Record<string, string>)[key]).toBeTypeOf('string');
    });
  }
});

describe('wireCorruptionNotifications', () => {
  let emitter: ReturnType<typeof makeEmitter>;
  let notified: NotifyInput[];

  beforeEach(() => {
    setLocale('en');
    emitter = makeEmitter();
    notified = [];
    wireCorruptionNotifications(emitter, n => notified.push(n));
  });
  afterEach(() => setLocale('en'));

  function expectLocalized(n: NotifyInput): void {
    expect(n.title.length).toBeGreaterThan(0);
    expect(n.body.length).toBeGreaterThan(0);
    expect(n.title).not.toMatch(/^notification\./);
    expect(n.body).not.toMatch(/^notification\./);
    expect(n.body).not.toMatch(/\{\w+\}/);
  }

  it('subscribes to all four events', () => {
    for (const e of ['corruption:scandal', 'mafia:investigation', 'mafia:smuggling_exposed', 'mafia:exposed']) {
      expect(emitter.has(e)).toBe(true);
    }
  });

  it('corruption:scandal notifies once with the target and fine in the text', () => {
    emitter.fire('corruption:scandal', { target: 'judge', fine: 4000 });
    expect(notified).toHaveLength(1);
    expectLocalized(notified[0]!);
    expect(notified[0]!.title).toBe((en as Record<string, string>)['notification.title.scandal']);
    expect(notified[0]!.body).toMatch(/4[,.\s]?000/);
  });

  it('mafia:investigation notifies once', () => {
    emitter.fire('mafia:investigation', { outcomeKey: 'mafia.accident_failed' });
    expect(notified).toHaveLength(1);
    expectLocalized(notified[0]!);
    expect(notified[0]!.title).toBe((en as Record<string, string>)['notification.title.investigation']);
  });

  it('mafia:smuggling_exposed notifies once with the fine in the text', () => {
    emitter.fire('mafia:smuggling_exposed', { fine: 7500 });
    expect(notified).toHaveLength(1);
    expectLocalized(notified[0]!);
    expect(notified[0]!.body).toMatch(/7[,.\s]?500/);
  });

  it('mafia:exposed notifies once', () => {
    emitter.fire('mafia:exposed', {});
    expect(notified).toHaveLength(1);
    expectLocalized(notified[0]!);
  });

  it('notifications follow the active locale', () => {
    setLocale('fr');
    emitter.fire('mafia:exposed', {});
    expect(notified[0]!.body).toBe((fr as Record<string, string>)['notification.mafia.exposed']);
  });

  it('does not notify before any event fires', () => {
    expect(notified).toHaveLength(0);
  });
});
