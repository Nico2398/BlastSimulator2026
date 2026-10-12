import { describe, it, expect } from 'vitest';
import { makeHarness, makeState, addEmployee, addVehicle, addBuilding, listenerAt } from './helpers.js';
import { referenceM, cullM, distanceM, offsetPoint } from '../../../../src/audio/director/listening.js';
import { SPATIAL_CONFIG } from '../../../../src/core/config/audio/engine.js';

describe('createDirectorEnv', () => {
  it('prefers the renderer position and falls back to the core state', () => {
    const state = makeState();
    const worker = addEmployee(state, 3, 4);
    const truck = addVehicle(state, 'debris_hauler', 10, 20);
    const house = addBuilding(state, 'living_quarters', -5, 6);
    const live = makeHarness({ state, entityPosition: (kind, id) => (kind === 'vehicle' && id === truck.id ? { x: 11, z: 21 } : null) });
    expect(live.env.positionOf('vehicle', truck.id)).toEqual({ x: 11, z: 21 });
    expect(live.env.positionOf('employee', worker.id)).toEqual({ x: 3, z: 4 });
    expect(live.env.positionOf('building', house.id)).toEqual({ x: -5, z: 6 });
    expect(live.env.positionOf('vehicle', 999)).toBeNull();
  });

  it('knows no position without a state', () => {
    expect(makeHarness().env.positionOf('employee', 1)).toBeNull();
  });

  it('resolves a site through its entity first, its fallback point otherwise', () => {
    const h = makeHarness({ entityPosition: () => ({ x: 1, z: 2 }) });
    expect(h.env.resolve({ entity: { kind: 'vehicle', id: 1 }, point: { x: 9, z: 9 } })).toEqual({ x: 1, z: 2 });
    expect(h.env.resolve({ point: { x: 9, z: 9 } })).toEqual({ x: 9, z: 9 });
    const gone = makeHarness({ entityPosition: () => null });
    expect(gone.env.resolve({ entity: { kind: 'vehicle', id: 1 }, point: { x: 9, z: 9 } })).toEqual({ x: 9, z: 9 });
  });

  it('judges range from the listener and treats a missing listener as everywhere', () => {
    const h = makeHarness({ listener: listenerAt(0, 0, 50) });
    const reference = referenceM(50);
    expect(h.env.isNear({ x: reference * 2, z: 0 }, 2.5)).toBe(true);
    expect(h.env.isNear({ x: reference * 3, z: 0 }, 2.5)).toBe(false);
    expect(h.env.distanceToListener({ x: 3, z: 4 })).toBe(5);
    h.setListener(null);
    expect(h.env.isNear({ x: 1e6, z: 0 }, 2.5)).toBe(true);
    expect(h.env.distanceToListener({ x: 3, z: 4 })).toBe(0);
  });

  it('reads the clock it was given', () => {
    const h = makeHarness();
    h.advance(2.5);
    expect(h.env.now()).toBe(2.5);
  });
});

describe('listening helpers', () => {
  it('derives reference and cull distance from the engine tuning', () => {
    expect(referenceM(0)).toBe(SPATIAL_CONFIG.minReferenceM);
    expect(referenceM(1e6)).toBe(SPATIAL_CONFIG.maxReferenceM);
    expect(cullM(50)).toBe(referenceM(50) * SPATIAL_CONFIG.cullDistanceFactor);
  });

  it('measures distance and offsets a point along a bearing', () => {
    expect(distanceM({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
    const p = offsetPoint({ x: 10, z: 10 }, Math.PI / 2, 100);
    expect(p.x).toBeCloseTo(10, 6);
    expect(p.z).toBeCloseTo(110, 6);
  });
});
