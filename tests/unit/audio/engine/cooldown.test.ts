import { describe, expect, it } from 'vitest';
import { CooldownGate } from '../../../../src/audio/engine/cooldown.js';

describe('CooldownGate', () => {
  it('isReady is true for an unknown key and does not start a cooldown', () => {
    const gate = new CooldownGate(() => 0);
    expect(gate.isReady('a')).toBe(true);
    expect(gate.isReady('a')).toBe(true);
  });

  it('start puts a key on cooldown until exactly now + cooldown, in the clock\'s own unit', () => {
    let now = 5000;
    const gate = new CooldownGate(() => now);
    gate.start('a', 250);
    now = 5249;
    expect(gate.isReady('a')).toBe(false);
    now = 5250;
    expect(gate.isReady('a')).toBe(true);
  });

  it('tryPass starts the cooldown only when it lets the key through', () => {
    let now = 0;
    const gate = new CooldownGate(() => now);
    expect(gate.tryPass('a', 10)).toBe(true);
    now = 6;
    expect(gate.tryPass('a', 10)).toBe(false);
    now = 10;
    expect(gate.tryPass('a', 10)).toBe(true);
  });

  it('sweeps expired keys past the threshold and keeps live ones', () => {
    let now = 0;
    const gate = new CooldownGate(() => now, 3);
    gate.start('live', 1000);
    for (let i = 0; i < 3; i++) gate.start(`short${i}`, 1);
    now = 10;
    gate.start('trigger', 1);
    expect(gate.isReady('live')).toBe(false);
    expect(gate.isReady('short0')).toBe(true);
  });

  it('clear forgets every cooldown', () => {
    const gate = new CooldownGate(() => 0);
    gate.start('a', 5);
    gate.clear();
    expect(gate.isReady('a')).toBe(true);
  });
});
