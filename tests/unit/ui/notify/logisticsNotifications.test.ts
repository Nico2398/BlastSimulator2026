// BlastSimulator2026 — wireLogisticsNotifications (#1372): warehouse stock loss toast.
import { describe, it, expect, beforeEach } from 'vitest';
import { wireLogisticsNotifications } from '../../../../src/ui/notify/logisticsNotifications.js';
import type { NotifyInput } from '../../../../src/ui/notify/NotificationCenter.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';

type Handler = (payload: unknown) => void;

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
      for (const h of handlers.get(event) ?? []) h(payload);
    },
    has(event: string): boolean { return (handlers.get(event) ?? []).length > 0; },
  };
}

describe('wireLogisticsNotifications', () => {
  let emitter: ReturnType<typeof makeEmitter>;
  let notes: NotifyInput[];

  beforeEach(() => {
    setLocale('en');
    emitter = makeEmitter();
    notes = [];
    wireLogisticsNotifications(emitter, (n) => notes.push(n));
  });

  it('subscribes to logistics:warehouse_stock_lost', () => {
    expect(emitter.has('logistics:warehouse_stock_lost')).toBe(true);
  });

  it('raises a warn toast with localized title and body including kg', () => {
    emitter.fire('logistics:warehouse_stock_lost', { buildingId: 7, massKg: 1234.4, oreKg: {} });
    expect(notes).toHaveLength(1);
    expect(notes[0].severity).toBe('warn');
    expect(notes[0].title).toBe(t('notification.title.warehouse_stock_lost'));
    expect(notes[0].body).toBe(t('notification.warehouse_stock_lost', { id: 7, kg: 1234 }));
    expect(notes[0].body).toContain('1234');
  });

  it('rounds fractional kg and handles zero mass', () => {
    emitter.fire('logistics:warehouse_stock_lost', { buildingId: 1, massKg: 0.4, oreKg: {} });
    expect(notes[0].body).toBe(t('notification.warehouse_stock_lost', { id: 1, kg: 0 }));
  });

  it('ignores unrelated events', () => {
    emitter.fire('logistics:other', { buildingId: 1, massKg: 5 });
    expect(notes).toHaveLength(0);
  });
});
