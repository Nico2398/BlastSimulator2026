import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

describe('EventEmitter', () => {
  it('subscribing and emitting calls the handler with correct data', () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('time:tick', handler);
    emitter.emit('time:tick', { dt: 100 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ dt: 100 });
  });

  it('off() removes the handler', () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('blast:started', handler);
    emitter.off('blast:started', handler);
    emitter.emit('blast:started', { originX: 0, originY: 0, originZ: 0 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple handlers on the same event all fire', () => {
    const emitter = new EventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();
    emitter.on('terrain:updated', handler1);
    emitter.on('terrain:updated', handler2);
    emitter.on('terrain:updated', handler3);
    emitter.emit('terrain:updated', { region: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 } });
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler3).toHaveBeenCalledTimes(1);
  });

  it('emitting an event with no listeners does not throw', () => {
    const emitter = new EventEmitter();
    expect(() => emitter.emit('blast:ended', undefined)).not.toThrow();
  });

  it('off() only removes the specific handler', () => {
    const emitter = new EventEmitter();
    const kept = vi.fn();
    const removed = vi.fn();
    emitter.on('terrain:updated', kept);
    emitter.on('terrain:updated', removed);
    emitter.off('terrain:updated', removed);
    emitter.emit('terrain:updated', { region: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 } });
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });
});
