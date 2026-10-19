// BlastSimulator2026 — wireProgressionNotifications (#1926): filed / approved toasts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { wireProgressionNotifications } from '../../../../src/ui/notify/progressionNotifications.js';
import { gradeDef } from '../../../../src/core/economy/MineGrade.js';
import type { NotifyInput } from '../../../../src/ui/notify/NotificationCenter.js';
import { setLocale, t } from '../../../../src/core/i18n/I18n.js';

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

describe('wireProgressionNotifications (#1926)', () => {
  let emitter: ReturnType<typeof makeEmitter>;
  let notified: NotifyInput[];

  beforeEach(() => {
    setLocale('en');
    emitter = makeEmitter();
    notified = [];
    wireProgressionNotifications(emitter, n => notified.push(n));
  });
  afterEach(() => setLocale('en'));

  const text = (n: NotifyInput) => `${n.title} ${n.body}`;

  it('subscribes to both progression events', () => {
    expect(emitter.has('progression:grade_applied')).toBe(true);
    expect(emitter.has('progression:grade_approved')).toBe(true);
  });

  it('does not notify before any event fires', () => {
    expect(notified).toHaveLength(0);
  });

  it('grade_applied notifies once with the waiting-room line', () => {
    emitter.fire('progression:grade_applied', { toGrade: 1, fee: 20_000 });
    expect(notified).toHaveLength(1);
    expect(text(notified[0]!)).toContain('Application received. Please allow 3–5 geological eras.');
    expect(text(notified[0]!)).not.toMatch(/\{\w+\}|progression\./);
  });

  it('grade_approved notifies once and names the grade', () => {
    emitter.fire('progression:grade_approved', { grade: 1 });
    expect(notified).toHaveLength(1);
    expect(text(notified[0]!)).toContain('Hobby Quarry Licence');
    expect(text(notified[0]!)).not.toMatch(/\{\w+\}|progression\./);
  });

  it('names an endless class grade by its class name', () => {
    emitter.fire('progression:grade_approved', { grade: 7 });
    expect(text(notified[0]!)).toContain(t(gradeDef(7).nameKey, gradeDef(7).nameParams));
  });

  it('each event raises exactly one toast per firing', () => {
    emitter.fire('progression:grade_applied', { toGrade: 1, fee: 20_000 });
    emitter.fire('progression:grade_approved', { grade: 1 });
    emitter.fire('progression:grade_applied', { toGrade: 2, fee: 75_000 });
    expect(notified).toHaveLength(3);
  });

  it('follows the active locale', () => {
    emitter.fire('progression:grade_applied', { toGrade: 1, fee: 20_000 });
    setLocale('fr');
    emitter.fire('progression:grade_applied', { toGrade: 1, fee: 20_000 });
    expect(text(notified[1]!)).not.toBe(text(notified[0]!));
  });
});
