import { describe, it, expect } from 'vitest';
import { CooldownGate, TokenBucket } from '../../../../src/audio/director/rateLimit.js';

describe('CooldownGate', () => {
  it('passes a key once per cooldown, on the injected clock', () => {
    let now = 0;
    const gate = new CooldownGate(() => now);
    expect(gate.tryPass('a', 2)).toBe(true);
    expect(gate.tryPass('a', 2)).toBe(false);
    now = 1.99;
    expect(gate.tryPass('a', 2)).toBe(false);
    now = 2;
    expect(gate.tryPass('a', 2)).toBe(true);
  });

  it('keeps keys independent', () => {
    const gate = new CooldownGate(() => 0);
    expect(gate.tryPass('a', 5)).toBe(true);
    expect(gate.tryPass('b', 5)).toBe(true);
  });

  it('forgets every cooldown on clear', () => {
    const gate = new CooldownGate(() => 0);
    gate.tryPass('a', 5);
    gate.clear();
    expect(gate.tryPass('a', 5)).toBe(true);
  });

  it('sweeps expired entries once the table grows past the threshold, keeping live ones', () => {
    let now = 0;
    const sweepThreshold = 8;
    const gate = new CooldownGate(() => now, sweepThreshold);
    gate.tryPass('live', 1000);
    for (let i = 0; i < sweepThreshold; i++) gate.tryPass(`short:${i}`, 1);
    now = 10;
    gate.tryPass('trigger', 1);
    expect(gate.tryPass('live', 1000)).toBe(false);
    expect(gate.tryPass('short:0', 1)).toBe(true);
  });
});

describe('TokenBucket', () => {
  it('starts full, empties, and refills over real time up to its capacity', () => {
    const bucket = new TokenBucket(2, 1);
    expect(bucket.canTake()).toBe(true);
    bucket.take();
    bucket.take();
    expect(bucket.canTake()).toBe(false);
    bucket.refill(0.5);
    expect(bucket.canTake()).toBe(false);
    bucket.refill(0.5);
    expect(bucket.canTake()).toBe(true);
    bucket.refill(100);
    bucket.take();
    bucket.take();
    expect(bucket.canTake()).toBe(false);
  });

  it('never goes below zero and resets to full', () => {
    const bucket = new TokenBucket(1, 1);
    bucket.take();
    bucket.take();
    bucket.reset();
    expect(bucket.canTake()).toBe(true);
  });
});
