// BlastSimulator2026 — wireProgressionNotifications (#1926): filed / approved toasts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { wireProgressionNotifications } from '../../../../src/ui/notify/progressionNotifications.js';
import { gradeDef } from '../../../../src/core/economy/MineGrade.js';
import type { NotifyInput } from '../../../../src/ui/notify/NotificationCenter.js';
import { setLocale, t } from '../../../../src/core/i18n/I18n.js';
import { explosivesOfTier } from '../../../../src/core/world/ExplosiveCatalog.js';
import { getQuest } from '../../../../src/core/economy/QuestCatalog.js';

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

  it('subscribes to the progression events, the tier-up included (#2277)', () => {
    expect(emitter.has('progression:grade_applied')).toBe(true);
    expect(emitter.has('progression:grade_approved')).toBe(true);
    expect(emitter.has('progression:tier_up')).toBe(true);
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
    expect(text(notified[0]!)).toContain('Depth');
    expect(notified[0]!.body).toBe(t('notification.progression.approved', { name: t('permit.grade.1') }));
    expect(text(notified[0]!)).not.toMatch(/\{\w+\}|progression\./);
  });

  it('names an endless class grade by its class name', () => {
    emitter.fire('progression:grade_approved', { grade: 5 });
    expect(text(notified[0]!)).toContain(t(gradeDef(5).nameKey, gradeDef(5).nameParams));
  });

  describe('tier-up toast (#2277)', () => {
    it('notifies once, naming the grade and the new tier', () => {
      emitter.fire('progression:tier_up', { grade: 1, tier: 2 });
      expect(notified).toHaveLength(1);
      expect(notified[0]!.body).toBe(t('notification.progression.tier_up', { name: t('permit.grade.1'), tier: 2 }));
      expect(text(notified[0]!)).not.toMatch(/\{\w+\}|progression\.|notification\./);
    });

    it.each([[0, 2], [0, 3], [2, 3], [3, 2]])('grade %i tier %i names both', (grade, tier) => {
      emitter.fire('progression:tier_up', { grade, tier });
      expect(notified[0]!.body).toContain(t(`permit.grade.${grade}`));
      expect(notified[0]!.body).toContain(String(tier));
    });

    it('a cascade of two tier-ups raises two toasts, in order', () => {
      emitter.fire('progression:tier_up', { grade: 0, tier: 2 });
      emitter.fire('progression:tier_up', { grade: 0, tier: 3 });
      expect(notified).toHaveLength(2);
      expect(notified[0]!.body).not.toBe(notified[1]!.body);
    });

    it('is not the grade-approval toast', () => {
      emitter.fire('progression:tier_up', { grade: 1, tier: 2 });
      emitter.fire('progression:grade_approved', { grade: 1 });
      expect(notified[0]!.body).not.toBe(notified[1]!.body);
      expect(notified[1]!.body).toBe(t('notification.progression.approved', { name: t('permit.grade.1') }));
    });

    it('follows the active locale', () => {
      emitter.fire('progression:tier_up', { grade: 1, tier: 2 });
      setLocale('fr');
      emitter.fire('progression:tier_up', { grade: 1, tier: 2 });
      expect(notified[1]!.body).not.toBe(notified[0]!.body);
    });

    it('has text in both locales', () => {
      for (const loc of ['en', 'fr']) {
        setLocale(loc as 'en' | 'fr');
        expect(t('notification.progression.tier_up', { name: 'N', tier: 2 })).not.toBe('notification.progression.tier_up');
      }
    });
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

  it('ore_glut notifies once, naming the ore (#1930)', () => {
    expect(emitter.has('progression:ore_glut')).toBe(true);
    emitter.fire('progression:ore_glut', { oreId: 'dirtite', saturation: 0.5 });
    expect(notified).toHaveLength(1);
    expect(notified[0]!.body).toBe(t('notification.market.glut', { ore: t('ore.dirtite.name') }));
    expect(notified[0]!.title).toBe(t('notification.title.market'));
    expect(text(notified[0]!)).not.toMatch(/\{\w+\}|notification\./);
  });

  it('ore_glut text reads as the analysts line in English', () => {
    emitter.fire('progression:ore_glut', { oreId: 'dirtite', saturation: 0.6 });
    expect(notified[0]!.body).toMatch(/^Analysts blame you for the .+ glut\.$/);
  });

  it('ore_glut follows the active locale', () => {
    emitter.fire('progression:ore_glut', { oreId: 'dirtite', saturation: 0.5 });
    setLocale('fr');
    emitter.fire('progression:ore_glut', { oreId: 'dirtite', saturation: 0.5 });
    expect(notified[1]!.body).not.toBe(notified[0]!.body);
  });
});

describe('wireProgressionNotifications — quest:completed (#2280)', () => {
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

  it('subscribes to quest:completed', () => {
    expect(emitter.has('quest:completed')).toBe(true);
  });

  it('a completed T2 quest raises one notice naming the tier-2 explosives now purchasable', () => {
    emitter.fire('quest:completed', { questId: 'quest_explosive_t2' });
    expect(notified).toHaveLength(1);
    const body = text(notified[0]!);
    expect(explosivesOfTier(2).some(e => body.includes(t(e.nameKey)))).toBe(true);
    expect(explosivesOfTier(3).some(e => body.includes(t(e.nameKey)))).toBe(false);
    expect(body).not.toMatch(/\{\w+\}|notification\./);
  });

  it('a completed T3 quest names the tier-3 explosives', () => {
    emitter.fire('quest:completed', { questId: 'quest_explosive_t3' });
    expect(notified).toHaveLength(1);
    const body = text(notified[0]!);
    expect(explosivesOfTier(3).some(e => body.includes(t(e.nameKey)))).toBe(true);
    expect(explosivesOfTier(2).some(e => body.includes(t(e.nameKey)))).toBe(false);
  });

  it('the notice names the quest it completed', () => {
    emitter.fire('quest:completed', { questId: 'quest_explosive_t2' });
    expect(text(notified[0]!)).toContain(t(getQuest('quest_explosive_t2')!.titleKey));
  });

  it('an unknown quest id raises nothing and does not throw', () => {
    expect(() => emitter.fire('quest:completed', { questId: 'quest_nope' })).not.toThrow();
    expect(notified).toHaveLength(0);
  });

  it('each completion raises its own notice', () => {
    emitter.fire('quest:completed', { questId: 'quest_explosive_t2' });
    emitter.fire('quest:completed', { questId: 'quest_explosive_t3' });
    expect(notified).toHaveLength(2);
    expect(text(notified[0]!)).not.toBe(text(notified[1]!));
  });

  it('follows the active locale', () => {
    emitter.fire('quest:completed', { questId: 'quest_explosive_t2' });
    setLocale('fr');
    emitter.fire('quest:completed', { questId: 'quest_explosive_t2' });
    expect(text(notified[1]!)).not.toBe(text(notified[0]!));
  });
});
