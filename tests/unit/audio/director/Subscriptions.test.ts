import { describe, it, expect } from 'vitest';
import { EventEmitter } from '../../../../src/core/state/EventEmitter.js';
import { Subscriptions } from '../../../../src/audio/director/Subscriptions.js';

describe('Subscriptions', () => {
  it('delivers events to the handler', () => {
    const emitter = new EventEmitter();
    const subs = new Subscriptions(emitter, () => undefined);
    const seen: number[] = [];
    subs.on('vehicle:stuck', e => seen.push(e.vehicleId));
    emitter.emit('vehicle:stuck', { vehicleId: 7 });
    expect(seen).toEqual([7]);
  });

  it('swallows a throwing handler, reports it, and lets later listeners run', () => {
    const emitter = new EventEmitter();
    const errors: unknown[] = [];
    const subs = new Subscriptions(emitter, e => errors.push(e));
    const later: number[] = [];
    subs.on('vehicle:stuck', () => { throw new Error('boom'); });
    emitter.on('vehicle:stuck', e => later.push(e.vehicleId));
    expect(() => emitter.emit('vehicle:stuck', { vehicleId: 1 })).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(later).toEqual([1]);
  });

  it('detaches every handler on dispose', () => {
    const emitter = new EventEmitter();
    const subs = new Subscriptions(emitter, () => undefined);
    let calls = 0;
    subs.on('vehicle:stuck', () => { calls++; });
    subs.dispose();
    emitter.emit('vehicle:stuck', { vehicleId: 1 });
    expect(calls).toBe(0);
  });
});
