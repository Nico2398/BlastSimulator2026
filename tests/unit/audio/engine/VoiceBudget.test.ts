import { describe, it, expect } from 'vitest';
import { VoiceBudget, type VoiceRequest } from '../../../../src/audio/engine/VoiceBudget.js';

function setup(cap = 3, sweep = 64) {
  let now = 1000;
  const budget = new VoiceBudget(cap, () => now, sweep);
  return { budget, advance: (ms: number) => { now += ms; } };
}

const req = (over: Partial<VoiceRequest> = {}): VoiceRequest => ({
  sound: 'a', key: 'a', cooldownMs: 0, maxVoices: Infinity, priority: 2, ...over,
});

const noSteal = (): void => undefined;

describe('VoiceBudget cooldown', () => {
  it('drops a play inside the cooldown and accepts it after', () => {
    const { budget, advance } = setup();
    expect(budget.acquire(req({ cooldownMs: 100 }), noSteal)).not.toBeNull();
    advance(99);
    expect(budget.acquire(req({ cooldownMs: 100 }), noSteal)).toBeNull();
    advance(1);
    expect(budget.acquire(req({ cooldownMs: 100 }), noSteal)).not.toBeNull();
  });

  it('a dropped play does not restart the cooldown', () => {
    const { budget, advance } = setup();
    budget.acquire(req({ cooldownMs: 100 }), noSteal);
    advance(60);
    expect(budget.acquire(req({ cooldownMs: 100 }), noSteal)).toBeNull();
    advance(40);
    expect(budget.acquire(req({ cooldownMs: 100 }), noSteal)).not.toBeNull();
  });

  it('cooldowns are per key', () => {
    const { budget } = setup();
    expect(budget.acquire(req({ cooldownMs: 100, key: 'truck-1' }), noSteal)).not.toBeNull();
    expect(budget.acquire(req({ cooldownMs: 100, key: 'truck-2' }), noSteal)).not.toBeNull();
    expect(budget.acquire(req({ cooldownMs: 100, key: 'truck-1' }), noSteal)).toBeNull();
  });

  it('a zero cooldown never blocks', () => {
    const { budget } = setup(10);
    for (let i = 0; i < 5; i++) expect(budget.acquire(req(), noSteal)).not.toBeNull();
  });

  it('sweeps expired cooldown entries once there are many', () => {
    const { budget, advance } = setup(100, 2);
    for (let i = 0; i < 3; i++) budget.acquire(req({ cooldownMs: 10, key: `k${i}` }), noSteal);
    advance(50);
    expect(budget.acquire(req({ cooldownMs: 10, key: 'k0' }), noSteal)).not.toBeNull();
  });
});

describe('VoiceBudget per-sound cap', () => {
  it('drops the newest play at the cap and frees a slot on release', () => {
    const { budget } = setup(10);
    const first = budget.acquire(req({ maxVoices: 2 }), noSteal);
    expect(budget.acquire(req({ maxVoices: 2 }), noSteal)).not.toBeNull();
    expect(budget.acquire(req({ maxVoices: 2 }), noSteal)).toBeNull();
    first?.release();
    expect(budget.acquire(req({ maxVoices: 2 }), noSteal)).not.toBeNull();
  });

  it('counts per sound, not per key', () => {
    const { budget } = setup(10);
    budget.acquire(req({ maxVoices: 1, key: 'x' }), noSteal);
    expect(budget.acquire(req({ maxVoices: 1, key: 'y' }), noSteal)).toBeNull();
    expect(budget.acquire(req({ maxVoices: 1, sound: 'b', key: 'b' }), noSteal)).not.toBeNull();
  });

  it('release is idempotent', () => {
    const { budget } = setup(10);
    const ticket = budget.acquire(req(), noSteal)!;
    ticket.release();
    ticket.release();
    expect(budget.activeCount).toBe(0);
  });
});

describe('VoiceBudget global cap and priority', () => {
  it('a higher-priority sound steals the lowest-priority, oldest voice', () => {
    const { budget } = setup(3);
    const stolen: string[] = [];
    budget.acquire(req({ sound: 'p2-old', key: 'p2-old', priority: 2 }), () => stolen.push('p2-old'));
    budget.acquire(req({ sound: 'p1-old', key: 'p1-old', priority: 1 }), () => stolen.push('p1-old'));
    budget.acquire(req({ sound: 'p1-new', key: 'p1-new', priority: 1 }), () => stolen.push('p1-new'));
    const ticket = budget.acquire(req({ sound: 'p4', key: 'p4', priority: 4 }), noSteal);
    expect(ticket).not.toBeNull();
    expect(stolen).toEqual(['p1-old']);
    expect(budget.activeCount).toBe(3);
  });

  it('an equal or lower priority newcomer is dropped when full', () => {
    const { budget } = setup(2);
    budget.acquire(req({ sound: 'a', priority: 2 }), noSteal);
    budget.acquire(req({ sound: 'b', key: 'b', priority: 2 }), noSteal);
    expect(budget.acquire(req({ sound: 'c', key: 'c', priority: 2 }), noSteal)).toBeNull();
    expect(budget.acquire(req({ sound: 'd', key: 'd', priority: 1 }), noSteal)).toBeNull();
    expect(budget.activeCount).toBe(2);
  });

  it('a dropped newcomer steals nothing', () => {
    const { budget } = setup(1);
    let stolen = false;
    budget.acquire(req({ priority: 3 }), () => { stolen = true; });
    expect(budget.acquire(req({ sound: 'z', key: 'z', priority: 3 }), noSteal)).toBeNull();
    expect(stolen).toBe(false);
  });

  it('a steal does not start the cooldown of a refused play', () => {
    const { budget } = setup(1);
    budget.acquire(req({ priority: 3 }), noSteal);
    expect(budget.acquire(req({ sound: 'low', key: 'low', priority: 1, cooldownMs: 1000 }), noSteal)).toBeNull();
    const ticket = budget.acquire(req({ sound: 'hi', key: 'low', priority: 4, cooldownMs: 1000 }), noSteal);
    expect(ticket).not.toBeNull();
  });

  it('a released slot is reusable without stealing', () => {
    const { budget } = setup(1);
    const first = budget.acquire(req({ priority: 1 }), () => { throw new Error('should not steal'); })!;
    first.release();
    expect(budget.acquire(req({ sound: 'b', key: 'b', priority: 1 }), noSteal)).not.toBeNull();
  });
});
