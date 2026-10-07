// BlastSimulator2026 — Integration: hiring candidate pools (#1385)
// Console hire/candidates commands, tick-pipeline refresh, save/load + v30→v31 migration, i18n.

import { describe, it, expect, afterEach } from 'vitest';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { makeGameContext } from '../helpers/gameContext.js';
import { runTick } from '../../src/core/engine/TickPipeline.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { Random } from '../../src/core/math/Random.js';
import { createGame, SAVE_VERSION, type GameState } from '../../src/core/state/GameState.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import { candidatesForRole, createHiringPool, takeCandidate } from '../../src/core/entities/HiringPool.js';
import { HIRING_COSTS, calculateSalary, fireEmployee, hireEmployee, createEmployeeState, type EmployeeRole } from '../../src/core/entities/Employee.js';
import { HIRING_POOL_REFRESH_INTERVAL, PAY_CYCLE_TICKS } from '../../src/core/config/balance.js';
import { setLocale, t } from '../../src/core/i18n/I18n.js';
import en from '../../src/core/i18n/locales/en.json' assert { type: 'json' };
import fr from '../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const ROLES: EmployeeRole[] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];
const SEED = 42;

afterEach(() => setLocale('en'));

function makeCtx(seed = SEED) {
  return makeGameContext({ mineType: 'desert', seed: String(seed), size: '32' });
}

function step(state: GameState): void {
  runTick(state, null, new Random(state.seed + state.tickCount), new EventEmitter(), { checkInvariants: false });
}

function quietGame(seed = SEED): GameState {
  const s = createGame({ seed });
  s.events.eventFreqMultiplier = 0;
  return s;
}

function perHour(perCycle: number): number {
  return Math.round((perCycle / PAY_CYCLE_TICKS) * 10) / 10;
}

describe('SAVE_VERSION', () => {
  it('is 31', () => expect(SAVE_VERSION).toBe(31));
});

describe('console — employee hire with candidate', () => {
  it('hires the chosen candidate: same name/union/quals/salary, pool slot removed, cost charged once', () => {
    for (const seed of [1, 2, 3, 42, 77]) {
      const ctx = makeCtx(seed);
      const state = ctx.state!;
      for (const role of ROLES) {
        const cand = candidatesForRole(state.hiringPool, role)[1]!;
        const cashBefore = state.cash;
        const res = employeeCommand(ctx, ['hire'], { role, candidate: String(cand.id) });
        expect(res.success).toBe(true);
        const emp = state.employees.employees.at(-1)!;
        expect(emp.name).toBe(cand.name);
        expect(emp.unionized).toBe(cand.unionized);
        expect(emp.qualifications).toEqual(cand.qualifications);
        expect(emp.salary).toBe(cand.salary);
        expect(emp.salary).toBe(calculateSalary(emp));
        expect(state.cash).toBe(cashBefore - HIRING_COSTS[role]);
        expect(candidatesForRole(state.hiringPool, role)).toHaveLength(2);
        expect(state.hiringPool.candidates.find(c => c.id === cand.id)).toBeUndefined();
      }
    }
  });

  it('records the hire expense exactly once', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    const cand = candidatesForRole(state.hiringPool, 'driller')[0]!;
    const before = state.cash;
    employeeCommand(ctx, ['hire'], { role: 'driller', candidate: String(cand.id) });
    expect(before - state.cash).toBe(HIRING_COSTS.driller);
  });

  it('without candidate arg hires the first candidate for the role', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    const first = candidatesForRole(state.hiringPool, 'surveyor')[0]!;
    const res = employeeCommand(ctx, ['hire'], { role: 'surveyor' });
    expect(res.success).toBe(true);
    expect(state.employees.employees[0]!.name).toBe(first.name);
    expect(state.hiringPool.candidates.find(c => c.id === first.id)).toBeUndefined();
  });

  it('unknown candidate id refuses with localized message; pool, roster and cash unchanged', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    const poolBefore = structuredClone(state.hiringPool);
    const cash = state.cash;
    const res = employeeCommand(ctx, ['hire'], { role: 'driller', candidate: '99999' });
    expect(res.success).toBe(false);
    expect(res.output).not.toBe('employees.hire_no_candidate');
    expect(res.output).not.toMatch(/[{}]/);
    expect(state.hiringPool).toEqual(poolBefore);
    expect(state.employees.employees).toHaveLength(0);
    expect(state.cash).toBe(cash);
  });

  it('candidate of another role refuses and leaves pool unchanged', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    const other = candidatesForRole(state.hiringPool, 'blaster')[0]!;
    const poolBefore = structuredClone(state.hiringPool);
    const res = employeeCommand(ctx, ['hire'], { role: 'driller', candidate: String(other.id) });
    expect(res.success).toBe(false);
    expect(state.hiringPool).toEqual(poolBefore);
  });

  it('unaffordable hire refuses and leaves pool unchanged', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    state.cash = HIRING_COSTS.manager - 1;
    const cand = candidatesForRole(state.hiringPool, 'manager')[0]!;
    const poolBefore = structuredClone(state.hiringPool);
    const res = employeeCommand(ctx, ['hire'], { role: 'manager', candidate: String(cand.id) });
    expect(res.success).toBe(false);
    expect(state.hiringPool).toEqual(poolBefore);
    expect(state.employees.employees).toHaveLength(0);
    expect(state.cash).toBe(HIRING_COSTS.manager - 1);
  });

  it('empty role slot refuses with the localized no-candidate message; fr differs from en', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    for (let i = 0; i < 3; i++) takeCandidate(state.hiringPool, 'driller');
    const enRes = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(enRes.success).toBe(false);
    expect(enRes.output).not.toBe('employees.hire_no_candidate');
    setLocale('fr');
    const frRes = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(frRes.success).toBe(false);
    expect(frRes.output).not.toBe(enRes.output);
    expect(frRes.output).not.toBe('employees.hire_no_candidate');
  });

  it('a hired slot stays empty after hiring (no instant refill)', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    const [a, b, c] = candidatesForRole(state.hiringPool, 'blaster');
    for (const cand of [a!, b!, c!]) employeeCommand(ctx, ['hire'], { role: 'blaster', candidate: String(cand.id) });
    expect(candidatesForRole(state.hiringPool, 'blaster')).toHaveLength(0);
  });
});

describe('console — employee candidates', () => {
  it('lists every candidate for the role with name and $/h salary', () => {
    const ctx = makeCtx();
    const state = ctx.state!;
    const res = employeeCommand(ctx, ['candidates'], { role: 'driller' });
    expect(res.success).toBe(true);
    for (const c of candidatesForRole(state.hiringPool, 'driller')) {
      expect(res.output).toContain(c.name);
      expect(res.output).toContain(`$${perHour(c.salary)}/h`);
      expect(res.output).toContain(String(c.id));
    }
    for (const c of candidatesForRole(state.hiringPool, 'blaster')) expect(res.output).not.toContain(c.name);
  });

  it('without role lists all roles', () => {
    const ctx = makeCtx();
    const res = employeeCommand(ctx, ['candidates'], {});
    expect(res.success).toBe(true);
    for (const c of ctx.state!.hiringPool.candidates) expect(res.output).toContain(c.name);
  });

  it('does not mutate the pool', () => {
    const ctx = makeCtx();
    const before = structuredClone(ctx.state!.hiringPool);
    employeeCommand(ctx, ['candidates'], {});
    expect(ctx.state!.hiringPool).toEqual(before);
  });
});

describe('tick pipeline refresh', () => {
  it('slot stays empty until the refresh interval, then refills to 3 per role with new ids', () => {
    const state = quietGame();
    const oldIds = new Set(state.hiringPool.candidates.map(c => c.id));
    takeCandidate(state.hiringPool, 'driller');
    takeCandidate(state.hiringPool, 'manager');
    for (let i = 0; i < HIRING_POOL_REFRESH_INTERVAL - 2; i++) step(state);
    expect(candidatesForRole(state.hiringPool, 'driller')).toHaveLength(2);
    expect(candidatesForRole(state.hiringPool, 'manager')).toHaveLength(2);
    for (let i = 0; i < 3; i++) step(state);
    for (const role of ROLES) expect(candidatesForRole(state.hiringPool, role)).toHaveLength(3);
    expect(state.hiringPool.lastRefreshTick).toBeGreaterThan(0);
    expect(candidatesForRole(state.hiringPool, 'driller').some(c => !oldIds.has(c.id))).toBe(true);
  });

  it('is deterministic: same seed + same hires gives identical pools after refresh', () => {
    const run = () => {
      const s = quietGame(5);
      takeCandidate(s.hiringPool, 'surveyor');
      for (let i = 0; i < HIRING_POOL_REFRESH_INTERVAL + 2; i++) step(s);
      return s.hiringPool;
    };
    expect(run()).toEqual(run());
  });

  it('refreshes again one interval later', () => {
    const state = quietGame();
    for (let i = 0; i < HIRING_POOL_REFRESH_INTERVAL + 1; i++) step(state);
    const first = state.hiringPool.lastRefreshTick;
    takeCandidate(state.hiringPool, 'blaster');
    for (let i = 0; i < HIRING_POOL_REFRESH_INTERVAL; i++) step(state);
    expect(state.hiringPool.lastRefreshTick).toBeGreaterThan(first);
    expect(candidatesForRole(state.hiringPool, 'blaster')).toHaveLength(3);
  });
});

describe('save / load', () => {
  it('round-trips the pool exactly, including taken slots', () => {
    const state = createGame({ seed: SEED });
    takeCandidate(state.hiringPool, 'driver');
    const loaded = deserialize(serialize(state));
    expect(loaded.hiringPool).toEqual(state.hiringPool);
    expect(candidatesForRole(loaded.hiringPool, 'driver')).toHaveLength(2);
  });

  it('serialize stamps SAVE_VERSION', () => {
    expect(JSON.parse(serialize(createGame({ seed: SEED }))).version).toBe(SAVE_VERSION);
  });

  it('v30 save without a pool migrates to v31 with a seed-derived pool', () => {
    const raw = JSON.parse(serialize(createGame({ seed: SEED }))) as Record<string, unknown>;
    delete raw['hiringPool'];
    raw['version'] = 30;
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.hiringPool).toEqual(createHiringPool(SEED, loaded.tickCount));
    for (const role of ROLES) expect(candidatesForRole(loaded.hiringPool, role)).toHaveLength(3);
  });

  it('v30 save with a malformed pool is replaced by a seed-derived pool', () => {
    const raw = JSON.parse(serialize(createGame({ seed: SEED }))) as Record<string, unknown>;
    raw['hiringPool'] = { candidates: 'nope' };
    raw['version'] = 30;
    const loaded = deserialize(JSON.stringify(raw));
    expect(candidatesForRole(loaded.hiringPool, 'driller')).toHaveLength(3);
  });

  it('v30 save with a valid pool leaves it untouched', () => {
    const state = createGame({ seed: SEED });
    takeCandidate(state.hiringPool, 'manager');
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    raw['version'] = 30;
    const loaded = deserialize(JSON.stringify(raw));
    expect(loaded.hiringPool).toEqual(state.hiringPool);
  });

  it('a migrated game keeps refreshing after load', () => {
    const raw = JSON.parse(serialize(quietGame())) as Record<string, unknown>;
    delete raw['hiringPool'];
    raw['version'] = 30;
    const loaded = deserialize(JSON.stringify(raw));
    loaded.events.eventFreqMultiplier = 0;
    takeCandidate(loaded.hiringPool, 'driller');
    for (let i = 0; i < HIRING_POOL_REFRESH_INTERVAL + 2; i++) step(loaded);
    expect(candidatesForRole(loaded.hiringPool, 'driller')).toHaveLength(3);
  });
});

describe('fireEmployee unionized refusal (#1385)', () => {
  it('returns errorKey employees.fire_unionized', () => {
    const es = createEmployeeState();
    const { employee } = hireEmployee(es, 'driller', new Random(1));
    employee.unionized = true;
    const res = fireEmployee(es, employee.id);
    expect(res.success).toBe(false);
    expect((res as { errorKey?: string }).errorKey).toBe('employees.fire_unionized');
  });

  it('fr locale shows French text through the console', () => {
    const ctx = makeCtx();
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', new Random(1));
    employee.unionized = true;
    setLocale('fr');
    const res = employeeCommand(ctx, ['fire', String(employee.id)], {});
    expect(res.success).toBe(false);
    expect(res.output).toBe((fr as Record<string, string>)['employees.fire_unionized']);
  });
});

describe('i18n keys (#1385)', () => {
  const keys = [
    'ui.crew.candidate_salary', 'ui.crew.candidate_union', 'ui.crew.candidate_non_union',
    'ui.crew.candidate_skill', 'ui.crew.hire_fee', 'ui.crew.no_candidates',
    'employees.hire_no_candidate', 'employees.candidates_header', 'employees.candidate_line',
  ];
  for (const key of keys) {
    it(`${key} exists in en and fr and differs between them`, () => {
      const E = en as Record<string, string>;
      const F = fr as Record<string, string>;
      expect(E[key]).toBeTruthy();
      expect(F[key]).toBeTruthy();
      expect(F[key]).not.toBe(E[key]);
    });
  }

  it('t() resolves the keys rather than echoing them', () => {
    for (const key of keys) expect(t(key)).not.toBe(key);
  });
});
