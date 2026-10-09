// #1409 — Tax audit: pure balance functions, open books, audit clock, regularisation.
// Model and numbers: docs/plans/issue-1409-smuggling-balance.md (§2-§4, §9).
import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  DEFAULT_TAX_AUDIT_PARAMS,
  smugglingIncomeRatio,
  auditChance,
  targetGain,
  regularisationMultiplier,
  validateTaxAuditParams,
  auditHazard,
  auditClockSpeed,
  closingLookBack,
  createTaxAuditState,
  bookTaxAuditIncome,
  tickTaxAudit,
  closingAudit,
  collectAuditDebt,
  type TaxAuditParams,
  type TaxAuditState,
  type AuditOutcome,
} from '../../../src/core/events/TaxAudit.js';
import { TICKS_PER_DAY } from '../../../src/core/config/balance.js';

const D = DEFAULT_TAX_AUDIT_PARAMS;
const GRID: number[] = [];
for (let i = 1; i <= 95; i++) GRID.push(i / 100);

function withParams(over: Partial<TaxAuditParams>): TaxAuditParams {
  return { ...D, ...over };
}

function totalSmuggled(a: TaxAuditState): number {
  return a.buckets.reduce((s, b) => s + b.smuggled, 0);
}

/**
 * Books a steady income each tick (share = smuggled / (legit + smuggled)) and ticks the
 * audit until `count` outcomes happened. Returns them in order.
 */
function collectOutcomes(
  a: TaxAuditState,
  rng: Random,
  p: TaxAuditParams,
  legit: number,
  smuggled: number,
  count: number,
  maxTicks = 400_000,
  startTick = 0,
): { outcomes: AuditOutcome[]; endTick: number } {
  const outcomes: AuditOutcome[] = [];
  let tick = startTick;
  while (outcomes.length < count && tick < startTick + maxTicks) {
    tick++;
    bookTaxAuditIncome(a, tick, legit, smuggled);
    const out = tickTaxAudit(a, tick, rng, p);
    if (out) outcomes.push(out);
  }
  return { outcomes, endTick: tick };
}

describe('smugglingIncomeRatio S(s)', () => {
  it('is s / (1 - s)', () => {
    expect(smugglingIncomeRatio(0)).toBe(0);
    expect(smugglingIncomeRatio(0.2)).toBeCloseTo(0.25, 12);
    expect(smugglingIncomeRatio(0.5)).toBeCloseTo(1, 12);
    expect(smugglingIncomeRatio(0.75)).toBeCloseTo(3, 12);
  });
});

describe('auditChance P(s)', () => {
  it('hits the three anchors', () => {
    expect(auditChance(0)).toBeCloseTo(0.2, 12);
    expect(auditChance(0.2)).toBeCloseTo(0.5, 12);
    expect(auditChance(0.5)).toBeCloseTo(0.8, 12);
  });

  it('matches the documented table', () => {
    const table: Array<[number, number]> = [
      [0.05, 0.275], [0.1, 0.35], [0.15, 0.425], [0.25, 0.55], [0.3, 0.6], [0.4, 0.7],
    ];
    for (const [s, p] of table) expect(auditChance(s)).toBeCloseTo(p, 9);
  });

  it('is clamped at P50 beyond the max-risk share', () => {
    expect(auditChance(0.6)).toBeCloseTo(0.8, 12);
    expect(auditChance(0.75)).toBeCloseTo(0.8, 12);
    expect(auditChance(0.99)).toBeCloseTo(0.8, 12);
  });

  it('is never impossible and never certain on (0, 1)', () => {
    for (const s of GRID) {
      expect(auditChance(s)).toBeGreaterThan(0);
      expect(auditChance(s)).toBeLessThan(1);
    }
  });

  it('is non-decreasing in the share', () => {
    let prev = 0;
    for (const s of GRID) {
      const p = auditChance(s);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = p;
    }
  });

  it('follows overridden params', () => {
    const p = withParams({ p0: 0.1, p20: 0.4, p50: 0.9 });
    expect(auditChance(0, p)).toBeCloseTo(0.1, 12);
    expect(auditChance(0.2, p)).toBeCloseTo(0.4, 12);
    expect(auditChance(0.5, p)).toBeCloseTo(0.9, 12);
  });
});

describe('targetGain G*(s)', () => {
  it('is 0 at 0 %, E20 at 20 % and E50 at 50 %', () => {
    expect(targetGain(0)).toBeCloseTo(0, 12);
    expect(targetGain(0.2)).toBeCloseTo(0.1, 12);
    expect(targetGain(0.5)).toBeCloseTo(-0.25, 12);
  });

  it('follows the constant-rho curve beyond the max-risk share', () => {
    expect(targetGain(0.75)).toBeCloseTo(-0.75, 9);
  });

  it('interpolates linearly between anchors', () => {
    expect(targetGain(0.1)).toBeCloseTo(0.05, 12);
    expect(targetGain(0.35)).toBeCloseTo(0.1 + (-0.25 - 0.1) * 0.5, 12);
  });

  it('has its argmax at exactly 20 % on a fine grid', () => {
    let best = -Infinity;
    let arg = -1;
    for (let i = 0; i <= 990; i++) {
      const s = i / 1000;
      const g = targetGain(s);
      if (g > best) { best = g; arg = s; }
    }
    expect(arg).toBeCloseTo(0.2, 9);
    expect(best).toBeCloseTo(0.1, 9);
  });

  it('is concave on [0, s2]', () => {
    for (let i = 1; i < 50; i++) {
      const a = (i - 1) / 100;
      const b = (i + 1) / 100;
      expect(targetGain(i / 100)).toBeGreaterThanOrEqual((targetGain(a) + targetGain(b)) / 2 - 1e-12);
    }
  });
});

describe('regularisationMultiplier rho(s)', () => {
  it('is 1.2 at the sweet spot and 1.5625 at the max-risk share', () => {
    expect(regularisationMultiplier(0.2)).toBeCloseTo(1.2, 12);
    expect(regularisationMultiplier(0.5)).toBeCloseTo(1.5625, 12);
  });

  it('is at least 1 everywhere on (0, 1)', () => {
    for (const s of GRID) expect(regularisationMultiplier(s)).toBeGreaterThanOrEqual(1 - 1e-12);
  });

  it('is large at tiny shares and not monotone', () => {
    expect(regularisationMultiplier(0.01)).toBeGreaterThan(2);
    expect(regularisationMultiplier(0.3)).toBeGreaterThan(regularisationMultiplier(0.2));
  });

  it('satisfies S(s) * (1 - rho(s) * P(s)) = G*(s) within 1e-9 on the grid', () => {
    for (const s of GRID) {
      const g = smugglingIncomeRatio(s) * (1 - regularisationMultiplier(s) * auditChance(s));
      expect(Math.abs(g - targetGain(s))).toBeLessThan(1e-9);
    }
  });

  it('keeps the identity under overridden valid params', () => {
    const p = withParams({ p20: 0.4, e50: -0.5 });
    expect(validateTaxAuditParams(p).ok).toBe(true);
    for (const s of GRID) {
      const g = smugglingIncomeRatio(s) * (1 - regularisationMultiplier(s, p) * auditChance(s, p));
      expect(Math.abs(g - targetGain(s, p))).toBeLessThan(1e-9);
    }
    expect(regularisationMultiplier(0.2, p)).toBeCloseTo(1.5, 12);
    expect(regularisationMultiplier(0.5, p)).toBeCloseTo(1.875 + 0, 9);
  });
});

describe('validateTaxAuditParams', () => {
  it('accepts the defaults', () => {
    expect(validateTaxAuditParams(D)).toEqual({ ok: true });
  });

  it('accepts the documented sensitivity variants that stay valid', () => {
    expect(validateTaxAuditParams(withParams({ p20: 0.4 })).ok).toBe(true);
    expect(validateTaxAuditParams(withParams({ e50: -0.5 })).ok).toBe(true);
    expect(validateTaxAuditParams(withParams({ timeBase: 180 * TICKS_PER_DAY })).ok).toBe(true);
  });

  it('rejects E20 = 0.15 (rho would drop below 1)', () => {
    const r = validateTaxAuditParams(withParams({ e20: 0.15 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });

  it('rejects P20 = 0.6 with E20 = 0.10 (rho = 1 boundary)', () => {
    expect(validateTaxAuditParams(withParams({ p20: 0.6, e20: 0.1 })).ok).toBe(false);
  });

  it('rejects audit chances that are out of order', () => {
    expect(validateTaxAuditParams(withParams({ p0: 0.6, p20: 0.5 })).ok).toBe(false);
    expect(validateTaxAuditParams(withParams({ p20: 0.9, p50: 0.8 })).ok).toBe(false);
  });

  it('rejects an audit chance that is impossible or certain', () => {
    expect(validateTaxAuditParams(withParams({ p0: 0 })).ok).toBe(false);
    expect(validateTaxAuditParams(withParams({ p50: 1 })).ok).toBe(false);
  });

  it('rejects gains with the wrong signs', () => {
    expect(validateTaxAuditParams(withParams({ e50: 0.05 })).ok).toBe(false);
    expect(validateTaxAuditParams(withParams({ e20: -0.1 })).ok).toBe(false);
    expect(validateTaxAuditParams(withParams({ e20: 0 })).ok).toBe(false);
    expect(validateTaxAuditParams(withParams({ e50: 0 })).ok).toBe(false);
  });

  it('rejects a recidivism surcharge that could pull the peak below the sweet spot', () => {
    expect(validateTaxAuditParams(withParams({ surcharge: 1 })).ok).toBe(false);
  });

  it('accepts recidivism switched off', () => {
    expect(validateTaxAuditParams(withParams({ surcharge: 0 })).ok).toBe(true);
  });
});

describe('auditHazard', () => {
  it('is zero when the clock is stopped', () => {
    expect(auditHazard(0.5, 0, 2160)).toBe(0);
  });

  it('equals 1 - (1 - P)^(speed / B)', () => {
    expect(auditHazard(0.5, 1, 2160)).toBeCloseTo(1 - Math.pow(0.5, 1 / 2160), 12);
    expect(auditHazard(0.8, 0.5, 100)).toBeCloseTo(1 - Math.pow(0.2, 0.5 / 100), 12);
  });

  it('compounds over one time base at full speed to exactly P', () => {
    for (const p of [0.2, 0.5, 0.8]) {
      const B = 2160;
      const h = auditHazard(p, 1, B);
      expect(1 - Math.pow(1 - h, B)).toBeCloseTo(p, 9);
    }
  });

  it('grows with the clock speed', () => {
    expect(auditHazard(0.5, 1, 2160)).toBeGreaterThan(auditHazard(0.5, 0.5, 2160));
  });

  it('is a probability', () => {
    const h = auditHazard(0.8, 1, 1);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(1);
  });
});

describe('auditClockSpeed', () => {
  const C = 720;
  const R = 720;

  it('is 1 when never audited', () => {
    expect(auditClockSpeed(null, C, R)).toBe(1);
  });

  it('is 0 right after an audit and throughout the cooldown', () => {
    expect(auditClockSpeed(0, C, R)).toBe(0);
    expect(auditClockSpeed(1, C, R)).toBe(0);
    expect(auditClockSpeed(C - 1, C, R)).toBe(0);
  });

  it('ramps linearly from 0 to 1 over the ramp', () => {
    expect(auditClockSpeed(C, C, R)).toBeCloseTo(0, 12);
    expect(auditClockSpeed(C + R / 4, C, R)).toBeCloseTo(0.25, 12);
    expect(auditClockSpeed(C + R / 2, C, R)).toBeCloseTo(0.5, 12);
    expect(auditClockSpeed(C + (3 * R) / 4, C, R)).toBeCloseTo(0.75, 12);
  });

  it('is back to 1 once the ramp is over', () => {
    expect(auditClockSpeed(C + R, C, R)).toBe(1);
    expect(auditClockSpeed(C + R + 10_000, C, R)).toBe(1);
  });

  it('copes with a zero cooldown and zero ramp', () => {
    expect(auditClockSpeed(0, 0, 0)).toBe(1);
    expect(auditClockSpeed(5, 0, 0)).toBe(1);
  });
});

describe('closingLookBack', () => {
  it('is B at u = 0.5 for a coin-flip chance', () => {
    expect(closingLookBack(0.5, 2160, 0.5)).toBeCloseTo(2160, 6);
  });

  it('is 0 at u = 1 and grows as u shrinks', () => {
    expect(closingLookBack(0.5, 2160, 1)).toBeCloseTo(0, 9);
    expect(closingLookBack(0.5, 2160, 0.25)).toBeGreaterThan(closingLookBack(0.5, 2160, 0.5));
  });

  it('is B * ln(u) / ln(1 - P)', () => {
    expect(closingLookBack(0.8, 1000, 0.3)).toBeCloseTo((1000 * Math.log(0.3)) / Math.log(0.2), 9);
  });

  it('reaches back further when the chance is lower', () => {
    expect(closingLookBack(0.2, 2160, 0.4)).toBeGreaterThan(closingLookBack(0.8, 2160, 0.4));
  });

  it('is below B exactly with probability P (u > 1 - P)', () => {
    expect(closingLookBack(0.5, 2160, 0.51)).toBeLessThan(2160);
    expect(closingLookBack(0.5, 2160, 0.49)).toBeGreaterThan(2160);
  });
});

describe('createTaxAuditState', () => {
  it('starts with empty books, a stopped record and no debt', () => {
    const a = createTaxAuditState();
    expect(a.buckets).toEqual([]);
    expect(a.clock).toBe(0);
    expect(a.lastAuditTick).toBeNull();
    expect(a.convictions).toBe(0);
    expect(a.debt).toBe(0);
    expect(a.auditsCount).toBe(0);
  });

  it('returns independent objects', () => {
    const a = createTaxAuditState();
    const b = createTaxAuditState();
    a.buckets.push({ day: 0, legit: 1, smuggled: 1, clockAtEarn: 0 });
    expect(b.buckets).toEqual([]);
  });
});

describe('bookTaxAuditIncome', () => {
  it('books into one bucket per day', () => {
    const a = createTaxAuditState();
    bookTaxAuditIncome(a, 0, 10, 2);
    bookTaxAuditIncome(a, 5, 20, 3);
    bookTaxAuditIncome(a, TICKS_PER_DAY - 1, 30, 4);
    expect(a.buckets).toHaveLength(1);
    expect(a.buckets[0]!.legit).toBeCloseTo(60, 9);
    expect(a.buckets[0]!.smuggled).toBeCloseTo(9, 9);
    expect(a.buckets[0]!.day).toBe(0);
  });

  it('opens a new bucket on the next day', () => {
    const a = createTaxAuditState();
    bookTaxAuditIncome(a, 0, 10, 0);
    bookTaxAuditIncome(a, TICKS_PER_DAY, 10, 5);
    expect(a.buckets).toHaveLength(2);
    expect(a.buckets[1]!.day).toBe(1);
    expect(a.buckets[1]!.smuggled).toBe(5);
  });

  it('stamps the bucket with the audit clock at earn time', () => {
    const a = createTaxAuditState();
    a.clock = 123;
    bookTaxAuditIncome(a, 3, 1, 1);
    expect(a.buckets[0]!.clockAtEarn).toBe(123);
  });

  it('books zero income without breaking the books', () => {
    const a = createTaxAuditState();
    bookTaxAuditIncome(a, 0, 0, 0);
    expect(totalSmuggled(a)).toBe(0);
  });
});

describe('tickTaxAudit — clock and prescription', () => {
  // Practically-impossible audits so only the clock and the books move.
  const NEVER = withParams({ p0: 1e-12, p20: 2e-12, p50: 3e-12 });

  it('advances the clock one per tick while never audited', () => {
    const a = createTaxAuditState();
    const rng = new Random(1);
    for (let t = 1; t <= 100; t++) tickTaxAudit(a, t, rng, NEVER);
    expect(a.clock).toBeGreaterThan(98);
    expect(a.clock).toBeLessThanOrEqual(101);
  });

  it('keeps income on the books for a full time base of clock, then drops it', () => {
    const a = createTaxAuditState();
    const rng = new Random(1);
    bookTaxAuditIncome(a, 0, 100, 50);
    for (let t = 1; t <= 2100; t++) {
      bookTaxAuditIncome(a, t, 100, 0);
      tickTaxAudit(a, t, rng, NEVER);
    }
    expect(totalSmuggled(a)).toBeGreaterThan(0);
    for (let t = 2101; t <= 2300; t++) {
      bookTaxAuditIncome(a, t, 100, 0);
      tickTaxAudit(a, t, rng, NEVER);
    }
    expect(totalSmuggled(a)).toBe(0);
  });

  it('returns null while nothing happens', () => {
    const a = createTaxAuditState();
    const rng = new Random(2);
    for (let t = 1; t <= 500; t++) expect(tickTaxAudit(a, t, rng, NEVER)).toBeNull();
  });
});

describe('tickTaxAudit — clean audit', () => {
  it('hits an honest mine with a clean outcome that costs nothing', () => {
    const a = createTaxAuditState();
    const { outcomes, endTick } = collectOutcomes(a, new Random(7), D, 100, 0, 1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.kind).toBe('clean');
    expect(outcomes[0]!.tick).toBe(endTick);
    expect(a.debt).toBe(0);
    expect(a.convictions).toBe(0);
    expect(a.auditsCount).toBe(1);
    expect(a.lastAuditTick).toBe(endTick);
  });

  it('is sometimes triggered at 0 % across seeds', () => {
    let audited = 0;
    for (let seed = 0; seed < 20; seed++) {
      const { outcomes } = collectOutcomes(createTaxAuditState(), new Random(seed), D, 100, 0, 1, 20_000);
      if (outcomes.length > 0) audited++;
    }
    expect(audited).toBeGreaterThan(0);
  });

  it('never produces a regularisation at 0 %', () => {
    for (let seed = 0; seed < 10; seed++) {
      const { outcomes } = collectOutcomes(createTaxAuditState(), new Random(seed), D, 100, 0, 5, 60_000);
      for (const o of outcomes) expect(o.kind).toBe('clean');
    }
  });

  it('clears the books and starts the cooldown', () => {
    const a = createTaxAuditState();
    collectOutcomes(a, new Random(7), D, 100, 0, 1);
    expect(a.buckets).toEqual([]);
  });
});

describe('tickTaxAudit — regularisation', () => {
  const NO_RECIDIVISM = withParams({ surcharge: 0 });

  it('charges rho(s) times the smuggling on the books, share 20 %', () => {
    const a = createTaxAuditState();
    const { outcomes } = collectOutcomes(a, new Random(11), NO_RECIDIVISM, 80, 20, 1);
    const o = outcomes[0]!;
    expect(o.kind).toBe('regularisation');
    if (o.kind !== 'regularisation') return;
    expect(o.smuggled).toBeGreaterThan(0);
    expect(o.share).toBeCloseTo(0.2, 9);
    expect(o.owed).toBeCloseTo(1.2 * o.smuggled, 6);
  });

  it('charges rho(s) at the max-risk share too', () => {
    const a = createTaxAuditState();
    const { outcomes } = collectOutcomes(a, new Random(12), NO_RECIDIVISM, 50, 50, 1);
    const o = outcomes[0]!;
    expect(o.kind).toBe('regularisation');
    if (o.kind !== 'regularisation') return;
    expect(o.share).toBeCloseTo(0.5, 9);
    expect(o.owed).toBeCloseTo(1.5625 * o.smuggled, 6);
  });

  it('records the conviction, the audit, the debt and clears the books', () => {
    const a = createTaxAuditState();
    const { outcomes, endTick } = collectOutcomes(a, new Random(11), D, 80, 20, 1);
    const o = outcomes[0]!;
    expect(o.kind).toBe('regularisation');
    if (o.kind !== 'regularisation') return;
    expect(a.convictions).toBe(1);
    expect(a.auditsCount).toBe(1);
    expect(a.lastAuditTick).toBe(endTick);
    expect(a.debt).toBeCloseTo(o.owed, 6);
    expect(a.buckets).toEqual([]);
  });

  it('adds the recidivism surcharge per earlier conviction, capped at maxSteps', () => {
    const a = createTaxAuditState();
    const { outcomes } = collectOutcomes(a, new Random(5), D, 80, 20, 4);
    expect(outcomes).toHaveLength(4);
    const ratios = outcomes.map(o => {
      if (o.kind !== 'regularisation') throw new Error('expected regularisation');
      return o.owed / o.smuggled;
    });
    expect(ratios[0]).toBeCloseTo(1.2, 6);
    expect(ratios[1]).toBeCloseTo(1.4, 6);
    expect(ratios[2]).toBeCloseTo(1.6, 6);
    expect(ratios[3]).toBeCloseTo(1.6, 6); // capped at 2 steps
    expect(a.convictions).toBe(4);
  });

  it('does not add a surcharge when recidivism is off', () => {
    const a = createTaxAuditState();
    const { outcomes } = collectOutcomes(a, new Random(5), NO_RECIDIVISM, 80, 20, 3);
    for (const o of outcomes) {
      if (o.kind !== 'regularisation') throw new Error('expected regularisation');
      expect(o.owed / o.smuggled).toBeCloseTo(1.2, 6);
    }
  });

  it('a clean audit does not count as a conviction for the surcharge', () => {
    const a = createTaxAuditState();
    // honest first, then smuggle: the first regularisation must carry no surcharge
    const first = collectOutcomes(a, new Random(3), D, 100, 0, 1);
    expect(first.outcomes[0]!.kind).toBe('clean');
    const next = collectOutcomes(a, new Random(4), D, 80, 20, 1, 400_000, first.endTick);
    const o = next.outcomes[0]!;
    expect(o.kind).toBe('regularisation');
    if (o.kind !== 'regularisation') return;
    expect(o.owed / o.smuggled).toBeCloseTo(1.2, 6);
  });
});

describe('tickTaxAudit — cooldown', () => {
  it('never audits during the cooldown after an audit', () => {
    for (let seed = 0; seed < 5; seed++) {
      const a = createTaxAuditState();
      const rng = new Random(seed + 100);
      const first = collectOutcomes(a, rng, D, 50, 50, 1);
      expect(first.outcomes).toHaveLength(1);
      for (let t = first.endTick + 1; t <= first.endTick + D.cooldown; t++) {
        bookTaxAuditIncome(a, t, 50, 50);
        expect(tickTaxAudit(a, t, rng, D)).toBeNull();
      }
    }
  });

  it('keeps the clock stopped during the cooldown', () => {
    const a = createTaxAuditState();
    const rng = new Random(9);
    const first = collectOutcomes(a, rng, D, 50, 50, 1);
    const clockAtAudit = a.clock;
    for (let t = first.endTick + 1; t <= first.endTick + D.cooldown - 1; t++) {
      bookTaxAuditIncome(a, t, 50, 50);
      tickTaxAudit(a, t, rng, D);
    }
    expect(a.clock).toBeCloseTo(clockAtAudit, 6);
  });

  it('audits again once the cooldown and ramp are over', () => {
    const a = createTaxAuditState();
    const { outcomes } = collectOutcomes(a, new Random(21), D, 50, 50, 2);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[1]!.tick - outcomes[0]!.tick).toBeGreaterThan(D.cooldown);
  });
});

describe('closingAudit', () => {
  it('is null when the books hold no smuggling', () => {
    const a = createTaxAuditState();
    bookTaxAuditIncome(a, 0, 100, 0);
    expect(closingAudit(a, new Random(1))).toBeNull();
    expect(createTaxAuditState().buckets).toEqual([]);
    expect(closingAudit(createTaxAuditState(), new Random(1))).toBeNull();
  });

  it('catches fresh smuggling with probability P(s) across seeds', () => {
    let caught = 0;
    const N = 600;
    for (let seed = 0; seed < N; seed++) {
      const a = createTaxAuditState();
      bookTaxAuditIncome(a, 0, 80, 20); // share 20 %, age 0 on the audit clock
      const o = closingAudit(a, new Random(seed), withParams({ surcharge: 0 }));
      if (o && o.kind === 'regularisation') {
        caught++;
        expect(o.smuggled).toBeCloseTo(20, 9);
        expect(o.owed).toBeCloseTo(24, 6); // rho(0.2) = 1.2
      }
    }
    expect(caught / N).toBeGreaterThan(0.4);
    expect(caught / N).toBeLessThan(0.6);
  });

  it('records the conviction and the debt when it catches', () => {
    for (let seed = 0; seed < 50; seed++) {
      const a = createTaxAuditState();
      bookTaxAuditIncome(a, 0, 50, 50);
      const o = closingAudit(a, new Random(seed));
      if (o && o.kind === 'regularisation') {
        expect(a.convictions).toBe(1);
        expect(a.debt).toBeCloseTo(o.owed, 6);
        return;
      }
    }
    expect.unreachable('closing audit never caught 50 % smuggling in 50 seeds');
  });

  it('adds the recidivism surcharge for earlier convictions', () => {
    for (let seed = 0; seed < 50; seed++) {
      const a = createTaxAuditState();
      a.convictions = 1;
      bookTaxAuditIncome(a, 0, 80, 20);
      const o = closingAudit(a, new Random(seed));
      if (o && o.kind === 'regularisation') {
        expect(o.owed / o.smuggled).toBeCloseTo(1.4, 6);
        return;
      }
    }
    expect.unreachable('closing audit never caught 20 % smuggling in 50 seeds');
  });

  it('does not catch smuggling that has aged out of the look-back window', () => {
    // An old bucket (a full time base of clock ago) is out of reach for every look-back T > 0.
    let caught = 0;
    for (let seed = 0; seed < 100; seed++) {
      const a = createTaxAuditState();
      bookTaxAuditIncome(a, 0, 50, 50);
      a.clock = D.timeBase * 2;
      const o = closingAudit(a, new Random(seed));
      if (o && o.kind === 'regularisation') caught++;
    }
    expect(caught).toBe(0);
  });
});

describe('collectAuditDebt', () => {
  it('returns 0 when nothing is owed', () => {
    const a = createTaxAuditState();
    expect(collectAuditDebt(a, 1_000, 1_000_000)).toBe(0);
    expect(a.debt).toBe(0);
  });

  it('never returns more than the debt', () => {
    const a = createTaxAuditState();
    a.debt = 500;
    const got = collectAuditDebt(a, 1_000_000, 1_000_000);
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThanOrEqual(500);
    expect(a.debt).toBeCloseTo(500 - got, 9);
  });

  it('is limited by the available cash', () => {
    const a = createTaxAuditState();
    a.debt = 1_000_000;
    const got = collectAuditDebt(a, 1_000_000, 0);
    expect(got).toBe(0);
    expect(a.debt).toBe(1_000_000);
  });

  it('never goes negative and clears the debt over repeated collections', () => {
    const a = createTaxAuditState();
    a.debt = 1_000;
    let total = 0;
    for (let i = 0; i < 1_000 && a.debt > 0; i++) {
      const got = collectAuditDebt(a, 1_000, 1_000_000);
      expect(got).toBeGreaterThanOrEqual(0);
      total += got;
    }
    expect(a.debt).toBeGreaterThanOrEqual(0);
    expect(total).toBeCloseTo(1_000, 6);
    expect(a.debt).toBeCloseTo(0, 6);
  });
});
