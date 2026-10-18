// BlastSimulator2026 — Permit inspection visit and neighbours' petition events (#1927)

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Random } from '../../../src/core/math/Random.js';
import { clearEvents, registerEvents, getEventById, type EventContext, type EventDef } from '../../../src/core/events/EventPool.js';
import { PERMIT_EVENTS_1 } from '../../../src/core/events/PermitEvents1.js';
import { EVENT_FILES, setupEvents } from '../../../src/core/events/index.js';
import { selectEvent } from '../../../src/core/events/EventSystem.js';
import { findDominatedPairs } from '../../../src/core/events/EventOptionBalance.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import type { ActiveProtection } from '../../../src/core/economy/BribeProtection.js';
import { INSPECTION_EVENT_TAG } from '../../../src/core/config/balance.js';

const LOCALE_DIR = join(import.meta.dirname, '../../../src/core/i18n/locales');
const load = (f: string): Record<string, string> => JSON.parse(readFileSync(join(LOCALE_DIR, f), 'utf8'));

function makeCtx(overrides: Partial<EventContext> = {}): EventContext {
  return {
    scores: createScoreState(),
    employeeCount: 10,
    deathCount: 0,
    corruptionLevel: 0,
    hasBuilding: () => false,
    hasDrillPlan: false,
    tickCount: 1_000,
    lawsuitCount: 0,
    activeContractCount: 0,
    weatherId: 'sunny',
    hasBlasted: true,
    ...overrides,
  };
}

const visit = (): EventDef => getEventById('permit_inspection_visit')!;
const petition = (): EventDef => getEventById('permit_neighbours_petition')!;

beforeEach(() => {
  clearEvents();
  registerEvents(PERMIT_EVENTS_1);
});

describe('PERMIT_EVENTS_1 registration', () => {
  it('defines exactly the two events, both politics', () => {
    expect(PERMIT_EVENTS_1.map(e => e.id).sort()).toEqual(['permit_inspection_visit', 'permit_neighbours_petition']);
    for (const e of PERMIT_EVENTS_1) expect(e.category).toBe('politics');
  });

  it('is part of EVENT_FILES and setupEvents registers both', () => {
    expect(EVENT_FILES['PermitEvents1.ts']).toBe(PERMIT_EVENTS_1);
    setupEvents();
    expect(getEventById('permit_inspection_visit')).toBeDefined();
    expect(getEventById('permit_neighbours_petition')).toBeDefined();
  });

  it('options and consequences are parallel, 3 each', () => {
    for (const e of PERMIT_EVENTS_1) {
      expect(e.options).toHaveLength(3);
      expect(e.consequences).toHaveLength(3);
    }
  });

  it('has no dominated option pair', () => {
    for (const e of PERMIT_EVENTS_1) expect(findDominatedPairs(e), e.id).toEqual([]);
  });

  it('has titles, descriptions, options and results in en and fr', () => {
    for (const [name, loc] of [['en', load('en.json')], ['fr', load('fr.json')]] as const) {
      for (const e of PERMIT_EVENTS_1) {
        for (const k of [`event.${e.id}.title`, `event.${e.id}.desc`, ...e.options.flatMap((_, i) => [`event.${e.id}.opt${i}`, `event.${e.id}.res${i}`])]) {
          expect(loc[k], `${name} ${k}`).toBeTruthy();
        }
      }
      expect(loc['event.permit_inspection_visit.res1_alt'], `${name} stamp alt`).toBeTruthy();
    }
  });
});

describe('permit_inspection_visit', () => {
  it('is repeatable, politics, tagged as an inspection', () => {
    expect(visit().repeatable).toBe(true);
    expect(visit().category).toBe('politics');
    expect(visit().tags).toContain(INSPECTION_EVENT_TAG);
  });

  it('can fire on a progression site with a pending application', () => {
    expect(visit().canFire(makeCtx({ hasProgression: true, applicationPending: true }))).toBe(true);
  });

  it('cannot fire without a pending application', () => {
    expect(visit().canFire(makeCtx({ hasProgression: true, applicationPending: false }))).toBe(false);
  });

  it('cannot fire with an unset context (campaign)', () => {
    expect(visit().canFire(makeCtx())).toBe(false);
  });

  it('cannot fire off a progression site even with a stale pending flag', () => {
    expect(visit().canFire(makeCtx({ hasProgression: false, applicationPending: true }))).toBe(false);
  });

  it('grand tour: 8 h work stoppage, then processing -24 ticks at safety >= 50 else +24', () => {
    const c = visit().consequences[0]!;
    expect(c.effects).toContainEqual({ type: 'work_stoppage', hours: 8 });
    expect(c.effects).toContainEqual({ type: 'permit_processing', action: 'shift', ticks: -24, safetyMin: 50, ticksBelow: 24 });
  });

  it('expediting stamp: corruption +5 and approve with 25% fee', () => {
    const c = visit().consequences[1]!;
    expect(c.corruptionDelta).toBe(5);
    expect(c.effects).toContainEqual({ type: 'permit_processing', action: 'approve', feePct: 25 });
  });

  it('pretend nobody is home: processing +72 ticks', () => {
    const c = visit().consequences[2]!;
    expect(c.effects).toContainEqual({ type: 'permit_processing', action: 'shift', ticks: 72 });
  });

  it('is selected from the politics pool when an application is pending', () => {
    const ctx = makeCtx({ hasProgression: true, applicationPending: true });
    const seen = new Set<string>();
    for (let seed = 0; seed < 20; seed++) seen.add(selectEvent('politics', ctx, new Random(seed))?.id ?? '');
    expect(seen.has('permit_inspection_visit')).toBe(true);
  });

  it('is never selected without a pending application', () => {
    const ctx = makeCtx({ hasProgression: true, applicationPending: false, lastBlastChargeShare: 0 });
    for (let seed = 0; seed < 20; seed++) expect(selectEvent('politics', ctx, new Random(seed))).toBeNull();
  });

  it('a bribed inspector shields it', () => {
    const protections: ActiveProtection[] = [{ target: 'inspector', expiresAtTick: 2_000_000, dismissalsLeft: 0, shielded: true }];
    const ctx = makeCtx({ hasProgression: true, applicationPending: true, protections });
    for (let seed = 0; seed < 20; seed++) expect(selectEvent('politics', ctx, new Random(seed))).toBeNull();
  });
});

describe('permit_neighbours_petition', () => {
  const ctx = (share: number, nuisance: number, hasProgression = true): EventContext =>
    makeCtx({ hasProgression, lastBlastChargeShare: share, scores: { ...createScoreState(), nuisance } });

  it('is a politics event', () => {
    expect(petition().category).toBe('politics');
  });

  it('can fire after a blast using half the limit while relations are below 50', () => {
    expect(petition().canFire(ctx(0.5, 49))).toBe(true);
    expect(petition().canFire(ctx(1.2, 10))).toBe(true);
  });

  it('cannot fire just under the blast share threshold', () => {
    expect(petition().canFire(ctx(0.49, 20))).toBe(false);
  });

  it('cannot fire at neighbour relations of 50', () => {
    expect(petition().canFire(ctx(0.9, 50))).toBe(false);
  });

  it('cannot fire without progression', () => {
    expect(petition().canFire(ctx(0.9, 20, false))).toBe(false);
  });

  it('cannot fire with the share unset', () => {
    expect(petition().canFire(makeCtx({ hasProgression: true, scores: { ...createScoreState(), nuisance: 10 } }))).toBe(false);
  });

  it('barbecue: cash -6000, neighbours +6', () => {
    const c = petition().consequences[0]!;
    expect(c.cashDelta).toBe(-6000);
    expect(c.scoreDelta).toMatchObject({ nuisance: 6 });
  });

  it('berm: cash -20000, neighbours +10, ecology +5', () => {
    const c = petition().consequences[1]!;
    expect(c.cashDelta).toBe(-20000);
    expect(c.scoreDelta).toMatchObject({ nuisance: 10, ecology: 5 });
  });

  it('ignore: neighbours -8 and the next application +48 ticks', () => {
    const c = petition().consequences[2]!;
    expect(c.scoreDelta).toMatchObject({ nuisance: -8 });
    expect(c.effects).toContainEqual({ type: 'permit_processing', action: 'shift', ticks: 48, next: true });
  });

  it('ignore costs no cash', () => {
    expect(petition().consequences[2]!.cashDelta ?? 0).toBe(0);
  });

  it('is not shielded by a bribed inspector', () => {
    expect(petition().tags ?? []).not.toContain(INSPECTION_EVENT_TAG);
  });
});
