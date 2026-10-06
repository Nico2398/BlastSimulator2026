// BlastSimulator2026 — wireResearchNotifications (#1398): research event toasts.
import { describe, it, expect, beforeEach } from 'vitest';
import { wireResearchNotifications } from '../../../src/ui/notify/researchNotifications.js';
import type { NotifyInput } from '../../../src/ui/notify/NotificationCenter.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
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

describe('research notification i18n keys', () => {
  for (const key of ['notification.title.research', 'notification.research.completed', 'notification.research.cancelled']) {
    it(`en.json and fr.json define ${key}`, () => {
      expect((en as Record<string, string>)[key]).toBeTypeOf('string');
      expect((fr as Record<string, string>)[key]).toBeTypeOf('string');
    });
  }
});

describe('wireResearchNotifications', () => {
  let emitter: ReturnType<typeof makeEmitter>;
  let notes: NotifyInput[];

  beforeEach(() => {
    setLocale('en');
    emitter = makeEmitter();
    notes = [];
    wireResearchNotifications(emitter, (n) => notes.push(n));
  });

  it('subscribes to research:completed and research:cancelled', () => {
    expect(emitter.has('research:completed')).toBe(true);
    expect(emitter.has('research:cancelled')).toBe(true);
  });

  it('completion raises a positive toast naming the building type and tier', () => {
    emitter.fire('research:completed', { targetType: 'driving_center', targetTier: 3 });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('positive');
    expect(notes[0]!.title).toBe(t('notification.title.research'));
    expect(notes[0]!.body).toBe(t('notification.research.completed', {
      type: t('building.driving_center.name'), tier: 3,
    }));
    expect(notes[0]!.body).toContain('Driving Center');
    expect(notes[0]!.body).not.toContain('notification.research.');
  });

  it('cancellation raises a warn toast stating the formatted refund', () => {
    emitter.fire('research:cancelled', { targetType: 'blasting_academy', targetTier: 2, refund: 5000 });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.severity).toBe('warn');
    expect(notes[0]!.title).toBe(t('notification.title.research'));
    expect(notes[0]!.body).toBe(t('notification.research.cancelled', {
      type: t('building.blasting_academy.name'), tier: 2, refund: formatMoney(5000),
    }));
    expect(notes[0]!.body).toContain(formatMoney(5000));
  });

  it('localizes to French', () => {
    setLocale('fr');
    emitter.fire('research:completed', { targetType: 'driving_center', targetTier: 2 });
    expect(notes[0]!.title).toBe(t('notification.title.research'));
    expect(notes[0]!.body).toBe(t('notification.research.completed', {
      type: t('building.driving_center.name'), tier: 2,
    }));
    setLocale('en');
  });

  it('raises one toast per event', () => {
    emitter.fire('research:completed', { targetType: 'driving_center', targetTier: 2 });
    emitter.fire('research:completed', { targetType: 'driving_center', targetTier: 3 });
    expect(notes).toHaveLength(2);
  });
});
