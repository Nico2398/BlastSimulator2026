import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { resolveEvent } from '../../../src/core/events/EventResolver.js';
import {
  createEventSystemState,
  type EventSystemState,
} from '../../../src/core/events/EventSystem.js';
import {
  registerEvents,
  clearEvents,
  getAllEvents,
  type EventDef,
} from '../../../src/core/events/EventPool.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import { createFinanceState } from '../../../src/core/economy/Finance.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { UNQUALIFIED_CONTRACTOR_FEE } from '../../../src/core/config/balance.js';
import { makeEffectWorld } from '../../helpers/eventEffectWorld.js';
import { SURVEY_FEE, setupUnqualified, totalDebit } from '../../helpers/unqualifiedWorld.js';

function makeTestEvent(): EventDef {
  return {
    id: 'test_resolve',
    category: 'union',
    titleKey: 'event.test.title',
    descKey: 'event.test.desc',
    options: [
      { labelKey: 'event.test.opt0', resultKey: 'event.test_resolve.res0' },
      { labelKey: 'event.test.opt1', resultKey: 'event.test_resolve.res1' },
      { labelKey: 'event.test.opt2', resultKey: 'event.test_resolve.res2' },
      // Option 3 — probability 0 forces the alt branch deterministically,
      // regardless of rng seed (chance(0) is always false).
      { labelKey: 'event.test.opt3', resultKey: 'event.test_resolve.res3' },
      // Option 4 — probability 1.0 forces the main branch deterministically
      // even though a probability + altConsequence is present (chance(1) is
      // always true since Random.next() never returns exactly 1).
      { labelKey: 'event.test.opt4', resultKey: 'event.test_resolve.res4' },
      // Option 5/6 — large score deltas driving a score past its 0-100
      // bounds, to pin the clamp's boundary behavior through resolveEvent
      // (#710 — shared clampScore helper).
      { labelKey: 'event.test.opt5', resultKey: 'event.test_resolve.res5' },
      { labelKey: 'event.test.opt6', resultKey: 'event.test_resolve.res6' },
    ],
    consequences: [
      { cashDelta: -5000, scoreDelta: { wellBeing: 10 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -5 } },
      {
        cashDelta: -15000,
        corruptionDelta: 2,
        followUpEventId: 'test_followup',
      },
      {
        cashDelta: 100,
        probability: 0,
        altConsequence: { cashDelta: -999, scoreDelta: { safety: -1 } },
      },
      {
        cashDelta: 200,
        probability: 1.0,
        altConsequence: { cashDelta: -1 },
      },
      // Option 5 — wellBeing starts at 50; -999 must clamp to exactly 0.
      { cashDelta: 0, scoreDelta: { wellBeing: -999 } },
      // Option 6 — safety starts at 50; +999 must clamp to exactly 100.
      { cashDelta: 0, scoreDelta: { safety: 999 } },
    ],
    weightCoeff: () => 1,
    canFire: () => true,
  };
}

describe('Event resolution system', () => {
  let eventSystem: EventSystemState;

  beforeEach(() => {
    clearEvents();
    registerEvents([makeTestEvent()]);
    eventSystem = createEventSystemState();
    eventSystem.pendingEvent = { eventId: 'test_resolve', firedAtTick: 10 };
  });

  it('resolving event with option 0 applies option 0 consequences', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    const result = resolveEvent(eventSystem, finances, scores, 0, 10, rng);
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('test_resolve');
    expect(result!.optionIndex).toBe(0);
    expect(result!.cashChange).toBe(-5000);
    expect(finances.cash).toBe(45000);
  });

  it('score changes from resolution are applied', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState(); // wellBeing starts at 50
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 0, 10, rng);
    expect(scores.wellBeing).toBe(60); // +10
  });

  it('financial effects from resolution are applied', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 0, 10, rng);
    expect(finances.cash).toBe(45000);
    expect(finances.transactions.length).toBe(1);
    expect(finances.transactions[0]!.type).toBe('expense');
  });

  it('follow-up events are queued when specified', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    const result = resolveEvent(eventSystem, finances, scores, 2, 10, rng);
    expect(result!.followUpQueued).toBe('test_followup');
    expect(eventSystem.followUpQueue).toContain('test_followup');
    expect(result!.corruptionChange).toBe(2);
  });

  // ── resultKey branch reporting (#421) ────────────────────────────────────
  // The resolver must report which branch of a probabilistic consequence
  // actually fired, so the console/UI can look up the matching outcome
  // sentence: the plain `event.<id>.res<i>` key for the main branch, or
  // `event.<id>.res<i>_alt` when the alternate consequence fires instead.

  it('resultKey is the plain key (no _alt) for a non-probabilistic option', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    const result = resolveEvent(eventSystem, finances, scores, 0, 10, rng);
    expect(result!.resultKey).toBe('event.test_resolve.res0');
  });

  it('resultKey appends _alt when the alternate consequence fires (probability 0 forces failure)', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    const result = resolveEvent(eventSystem, finances, scores, 3, 10, rng);
    expect(result!.resultKey).toBe('event.test_resolve.res3_alt');
    // The alt consequence's own effects must be applied, not the main branch's.
    expect(result!.cashChange).toBe(-999);
    expect(finances.cash).toBe(50000 - 999);
  });

  it('resultKey stays plain when a probabilistic option succeeds (probability 1.0 forces success)', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    const result = resolveEvent(eventSystem, finances, scores, 4, 10, rng);
    expect(result!.resultKey).toBe('event.test_resolve.res4');
    expect(result!.cashChange).toBe(200);
    expect(finances.cash).toBe(50200);
  });

  // ── lastOutcome — structured replacement for effects: string[] (P8) ─────
  // The UI reads state.events.lastOutcome directly instead of parsing the
  // console's pre-formatted "Gained $500" / "wellBeing +10" sentences.

  it('lastOutcome is set from the same resolution, not left null', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 0, 10, rng);

    expect(eventSystem.lastOutcome).not.toBeNull();
    expect(eventSystem.lastOutcome!.eventId).toBe('test_resolve');
    expect(eventSystem.lastOutcome!.resultKey).toBe('event.test_resolve.res0');
  });

  it('lastOutcome effects include a cash entry with the real delta', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 0, 10, rng);

    expect(eventSystem.lastOutcome!.effects).toContainEqual({ kind: 'cash', key: 'cash', delta: -5000 });
  });

  it('lastOutcome effects include a score entry per changed score, keyed by the real ScoreState field', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 0, 10, rng);

    expect(eventSystem.lastOutcome!.effects).toContainEqual({ kind: 'score', key: 'wellBeing', delta: 10 });
  });

  it('lastOutcome omits a cash effect entirely when cashDelta is 0, rather than a zero-delta entry', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 1, 10, rng);

    expect(eventSystem.lastOutcome!.effects.some(e => e.kind === 'cash')).toBe(false);
  });

  it('lastOutcome includes corruption and a follow-up notice as "other" effects', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 2, 10, rng);

    expect(eventSystem.lastOutcome!.effects).toContainEqual({ kind: 'other', key: 'corruption', delta: 2 });
    expect(eventSystem.lastOutcome!.effects).toContainEqual({
      kind: 'other', key: 'followUp', delta: 0, textKey: 'ui.event.follow_up_developing',
    });
  });

  it('lastOutcome survives clearPendingEvent — the outcome phase needs it after pendingEvent is gone', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 0, 10, rng);

    expect(eventSystem.pendingEvent).toBeNull();
    expect(eventSystem.lastOutcome).not.toBeNull();
  });

  // ── score clamp boundaries (#710 — shared clampScore helper) ────────────
  // applyConsequence's score-effect branch must clamp to [0, 100] the same
  // way ScoreManager's own mutators do — pinning this here so a future
  // swap to the shared `clampScore` symbol cannot silently change the
  // observable boundary behavior.

  it('a large negative scoreDelta clamps the score to exactly 0, not below', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState(); // wellBeing starts at 50
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 5, 10, rng);
    expect(scores.wellBeing).toBe(0);
  });

  it('a large positive scoreDelta clamps the score to exactly 100, not above', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState(); // safety starts at 50
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 6, 10, rng);
    expect(scores.safety).toBe(100);
  });
});

// ── unqualified_task_error options reach the world (#1380) ───────────────────

describe('resolveEvent — unqualified_task_error', () => {
  beforeEach(() => {
    clearEvents();
    setupEvents();
  });

  function pending(s: ReturnType<typeof setupUnqualified>, ids: number[] = [s.actionId]) {
    s.state.events.pendingEvent = { eventId: 'unqualified_task_error', firedAtTick: 40, unqualifiedActionIds: ids };
  }

  const choose = (s: ReturnType<typeof setupUnqualified>, option: number) =>
    resolveEvent(s.state.events, s.state.finances, s.state.scores, option, 40, new Random(7), s.world)!;

  it('Cancel removes the blocked action and shows the refund, not the raw tag', () => {
    const s = setupUnqualified();
    pending(s);
    const result = choose(s, 2);
    expect(s.state.pendingActions.find(a => a.id === s.actionId)).toBeUndefined();
    expect(s.state.cash + result.cashChange).toBe(s.cashAfterOrder + SURVEY_FEE);
    expect(result.effects).not.toContain('cancel_task');
    const cash = s.state.events.lastOutcome!.effects.find(e => e.kind === 'cash');
    expect(cash?.delta).toBe(SURVEY_FEE);
  });

  it('Hire a Contractor completes the work for exactly the contractor fee', () => {
    const s = setupUnqualified();
    pending(s);
    const result = choose(s, 1);
    expect(totalDebit(s.cashAfterOrder, s.state, result)).toBe(UNQUALIFIED_CONTRACTOR_FEE);
    expect(s.state.surveyResults).toHaveLength(1);
    expect(s.state.pendingActions.find(a => a.id === s.actionId)).toBeUndefined();
    expect(result.effects).not.toContain('hire_contractor');
    const cash = s.state.events.lastOutcome!.effects.find(e => e.kind === 'cash');
    expect(cash?.delta).toBe(-UNQUALIFIED_CONTRACTOR_FEE);
  });

  it('Send Someone to Training enrols the driver and keeps the plain result key', () => {
    const s = setupUnqualified({ school: true });
    pending(s);
    const result = choose(s, 0);
    const driver = s.state.employees.employees.find(e => e.id === s.driver!.id)!;
    expect((driver.pendingTrainingState ?? driver.trainingState)?.skill).toBe('geology');
    expect(result.resultKey).toBe('event.unqualified_task_error.res0');
    expect(result.effects).not.toContain('train_employee');
  });

  it('Send Someone to Training with no school reports the fallback text and books nothing', () => {
    const s = setupUnqualified({ school: false });
    pending(s);
    const result = choose(s, 0);
    expect(result.resultKey).toBe('event.unqualified_task_error.res0_alt');
    expect(s.state.cash + result.cashChange).toBe(s.cashAfterOrder);
    expect(s.state.events.lastOutcome!.resultKey).toBe('event.unqualified_task_error.res0_alt');
  });

  it('clears the pending event', () => {
    const s = setupUnqualified();
    pending(s);
    choose(s, 2);
    expect(s.state.events.pendingEvent).toBeNull();
  });

  it('without a world, the world effects are not applied and the action is left alone', () => {
    const s = setupUnqualified();
    pending(s);
    resolveEvent(s.state.events, s.state.finances, s.state.scores, 2, 40, new Random(7));
    expect(s.state.pendingActions.some(a => a.id === s.actionId)).toBe(true);
  });
});

// ── event effect spread reaches the world (#1538) ────────────────────────────

describe('resolveEvent — spread declarative effects (#1538)', () => {
  type Spec = { type: string };
  const KIND_OF: Record<string, string> = {
    work_stoppage: 'work_stoppage', work_rate: 'work_rate', morale_shift: 'morale_drift', salary: 'salary_factor',
    recurring_charge: 'recurring_charge', contract_price: 'contract_price', forced_weather: 'forced_weather',
    event_weight: 'event_weight',
  };
  const BAN_KIND = { blast: 'blast_ban', haul: 'haul_pause', drill: 'drill_ban' } as Record<string, string>;
  const COST_KIND = { explosive: 'explosive_price', upkeep: 'upkeep_surcharge' } as Record<string, string>;
  const modKind = (s: Spec & { what?: string }): string | undefined =>
    s.type === 'ban' ? BAN_KIND[s.what!] : s.type === 'cost_factor' ? COST_KIND[s.what!] : KIND_OF[s.type];

  beforeEach(() => {
    clearEvents();
    setupEvents();
  });

  /** First option of the event whose effects (main branch) include the type (and, optionally, a `what`). */
  function findOption(eventId: string, type: string, what?: string): number {
    const def = getAllEvents().find(e => e.id === eventId);
    const idx = def?.consequences.findIndex(c => (c.effects ?? []).some(s => s.type === type && (what === undefined || (s as { what?: string }).what === what))) ?? -1;
    expect(idx, `${eventId} has no option with effect ${type}${what ? ' ' + what : ''}`).toBeGreaterThanOrEqual(0);
    return idx;
  }

  /** First main-pool event of the category with an option carrying a timed modifier effect. */
  function firstTimedEvent(category: string): { id: string; type: string; what?: string } {
    for (const e of getAllEvents()) {
      if (e.category !== category || e.followUpOnly) continue;
      for (const c of e.consequences) {
        const s = (c.effects ?? []).find(x => modKind(x as Spec) !== undefined);
        if (s) return { id: e.id, type: s.type, what: (s as { what?: string }).what };
      }
    }
    throw new Error(`no ${category} event carries a timed effect`);
  }

  function resolveOn(eventId: string, option: number, empty = false) {
    const fx = makeEffectWorld({ empty });
    fx.state.events.pendingEvent = { eventId, firedAtTick: 10 };
    const result = resolveEvent(fx.state.events, fx.state.finances, fx.state.scores, option, 10, new Random(7), fx.world)!;
    return { fx, result };
  }

  function expectLasting(eventId: string, type: string, what?: string): void {
    const opt = findOption(eventId, type, what);
    const { fx, result } = resolveOn(eventId, opt);
    expect(result).not.toBeNull();
    const kind = modKind({ type, what });
    const m = fx.state.events.activeModifiers.find(x => x.kind === kind && x.sourceEventId === eventId);
    expect(m, `${eventId}: modifier ${kind}`).toBeDefined();
    if (type === 'salary' && m!.endTick === null) {
      expect(m!.endTick).toBeNull(); // permanent raise
    } else {
      expect(m!.endTick! - m!.startTick).toBeGreaterThan(0);
    }
    const chip = fx.state.events.lastOutcome!.effects.find(e => e.textKey?.startsWith(`ui.event.effect.${type}`));
    expect(chip, `${eventId}: chip ui.event.effect.${type}`).toBeDefined();
    expect(fx.state.events.lastOutcome!.eventId).toBe(eventId);
  }

  it.each(['union', 'politics', 'weather', 'mafia', 'lawsuit'])('a main-pool %s event applies its timed effect', cat => {
    const { id, type, what } = firstTimedEvent(cat);
    expectLasting(id, type, what);
  });

  it('union_strike_aftermath: salary, employee_joins and morale_shift reach the world', () => {
    expectLasting('union_strike_aftermath', 'salary');
    expectLasting('union_strike_aftermath', 'morale_shift');
    const opt = findOption('union_strike_aftermath', 'employee_joins');
    const before = makeEffectWorld().state.employees.employees.length;
    const { fx } = resolveOn('union_strike_aftermath', opt);
    expect(fx.state.employees.employees.length).toBeGreaterThan(before);
    expect(fx.state.events.lastOutcome!.effects.some(e => e.textKey === 'ui.event.effect.employee_joins')).toBe(true);
  });

  it('lawsuit_dust_fashion_appeal: recurring_charge', () => {
    expectLasting('lawsuit_dust_fashion_appeal', 'recurring_charge');
  });

  it('politics_diplomatic_incident: contract_price', () => {
    expectLasting('politics_diplomatic_incident', 'contract_price');
  });

  it('weather_lawsuit_debris: haul ban and upkeep cost_factor', () => {
    expectLasting('weather_lawsuit_debris', 'ban', 'haul');
    expectLasting('weather_lawsuit_debris', 'cost_factor', 'upkeep');
  });

  it('mafia_police_investigation: blast ban and event_weight', () => {
    expectLasting('mafia_police_investigation', 'ban', 'blast');
    expectLasting('mafia_police_investigation', 'event_weight');
  });

  it('a main-pool weather event forces the weather', () => {
    const def = getAllEvents().find(e => e.category === 'weather' && !e.followUpOnly
      && e.consequences.some(c => (c.effects ?? []).some(s => s.type === 'forced_weather')));
    expect(def, 'no main-pool weather event carries forced_weather').toBeDefined();
    expectLasting(def!.id, 'forced_weather');
  });

  it('an _alt result text is used when the effect has no target (empty roster)', () => {
    const def = getAllEvents().find(e => e.consequences.some(c => (c.effects ?? []).some(s => s.type === 'employee_leaves')));
    expect(def, 'no event carries employee_leaves').toBeDefined();
    const opt = findOption(def!.id, 'employee_leaves');
    const { result, fx } = resolveOn(def!.id, opt, true);
    expect(result.resultKey).toBe(`event.${def!.id}.res${opt}_alt`);
    expect(fx.state.events.lastOutcome!.resultKey).toBe(`event.${def!.id}.res${opt}_alt`);
  });
});
