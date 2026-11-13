// VehicleWaitingQueue — waitingRenderPosition reach rule (#2232)

import { describe, it, expect } from 'vitest';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { Leg } from '../../../src/core/engine/Itinerary.js';
import { hireEmployee, createEmployeeState } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { waitingRenderPosition } from '../../../src/renderer/VehicleWaitingQueue.js';
import { WAITING_QUEUE_SLOT_OFFSETS, WAITING_QUEUE_TARGET_REACH } from '../../../src/core/config/balance.js';

const TX = 50;
const TZ = 60;

const MAX_SLOT_OFFSET = Math.max(...WAITING_QUEUE_SLOT_OFFSETS.map(([x, z]) => Math.hypot(x, z)));

function makeVehicle(id: number, x: number, z: number): Vehicle {
  return { id, type: 'debris_hauler', tier: 1, x, z, hp: 100, cargo: [], occupantIds: [] };
}

let nextEmployeeId = 1;

interface DriverOpts {
  waitingTicks?: number;
  mode?: 'drive' | 'foot';
  noItinerary?: boolean;
}

/** A driver mounted in `vehicle`, whose current leg heads for (destX, destZ). */
function driverFor(vehicle: Vehicle, destX: number, destZ: number, opts: DriverOpts = {}): Employee {
  const id = nextEmployeeId++;
  const { employee } = hireEmployee(createEmployeeState(), 'driller', new Random(id), vehicle.x, vehicle.z);
  employee.id = id;
  employee.vehicleWaitingTicks = opts.waitingTicks ?? 5;
  const mode = opts.mode ?? 'drive';
  const leg: Leg = { mode, vehicleId: mode === 'drive' ? vehicle.id : null, destX, destZ, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5 };
  employee.itinerary = opts.noItinerary
    ? null
    : {
      legs: [leg],
      goal: { kind: 'reposition', x: destX, z: destZ },
      workTicks: 0,
      estTotalTicks: 5,
    };
  vehicle.occupantIds = [employee.id];
  return employee;
}

/** A vehicle at (x, z) with a driver waiting on the shared target (TX, TZ). */
function waiter(id: number, x: number, z: number): { v: Vehicle; e: Employee } {
  const v = makeVehicle(id, x, z);
  return { v, e: driverFor(v, TX, TZ) };
}

const dist = (a: readonly [number, number], b: readonly [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('waitingRenderPosition (#2232)', () => {
  it('the reach constant is a positive distance', () => {
    expect(WAITING_QUEUE_TARGET_REACH).toBeGreaterThan(0);
  });

  describe('C1 — a lone waiting vehicle renders at its own x/z', () => {
    it('far from its drive target', () => {
      const { v, e } = waiter(1, 5, 7);
      expect(waitingRenderPosition(v, [v], [e])).toEqual([5, 7]);
    });

    it('very far from its drive target', () => {
      const { v, e } = waiter(1, 500, -300);
      expect(waitingRenderPosition(v, [v], [e])).toEqual([500, -300]);
    });

    it('even when it is close to the target, since nobody shares it', () => {
      const { v, e } = waiter(1, TX - 0.4, TZ + 0.3);
      expect(waitingRenderPosition(v, [v], [e])).toEqual([TX - 0.4, TZ + 0.3]);
    });

    it('when the only other vehicle in the pool waits on a different target', () => {
      const a = waiter(1, 5, 7);
      const b = makeVehicle(2, 20, 20);
      const eb = driverFor(b, 90, 90);
      expect(waitingRenderPosition(a.v, [a.v, b], [a.e, eb])).toEqual([5, 7]);
    });
  });

  describe('C2 — a waiting vehicle farther than the reach renders at its own x/z', () => {
    it('even when others share its target', () => {
      const far = waiter(1, TX + 12, TZ - 9);
      const n1 = waiter(2, TX + 0.5, TZ);
      const n2 = waiter(3, TX - 0.5, TZ + 0.5);
      const pool = [far.v, n1.v, n2.v];
      const employees = [far.e, n1.e, n2.e];
      expect(waitingRenderPosition(far.v, pool, employees)).toEqual([TX + 12, TZ - 9]);
    });

    it('just past the reach', () => {
      const far = waiter(1, TX + WAITING_QUEUE_TARGET_REACH + 0.2, TZ);
      const near = waiter(2, TX, TZ);
      const pool = [far.v, near.v];
      const employees = [far.e, near.e];
      expect(waitingRenderPosition(far.v, pool, employees)).toEqual([TX + WAITING_QUEUE_TARGET_REACH + 0.2, TZ]);
    });

    it('measures the reach as a Euclidean distance, not per axis', () => {
      // Each axis is inside the reach, the diagonal is outside.
      const d = WAITING_QUEUE_TARGET_REACH * 0.9;
      const far = waiter(1, TX + d, TZ + d);
      const near = waiter(2, TX, TZ);
      const pool = [far.v, near.v];
      const employees = [far.e, near.e];
      expect(Math.hypot(d, d)).toBeGreaterThan(WAITING_QUEUE_TARGET_REACH);
      expect(waitingRenderPosition(far.v, pool, employees)).toEqual([TX + d, TZ + d]);
    });

    it('a vehicle exactly at the reach is not farther, so it still takes its queue slot', () => {
      const edge = waiter(2, TX - WAITING_QUEUE_TARGET_REACH, TZ);
      const centre = waiter(1, TX, TZ);
      const pool = [centre.v, edge.v];
      const employees = [centre.e, edge.e];
      const [ox, oz] = WAITING_QUEUE_SLOT_OFFSETS[1]!;
      expect(waitingRenderPosition(edge.v, pool, employees)).toEqual([TX + ox, TZ + oz]);
    });
  });

  describe('C3 — vehicles sharing a target within reach render at distinct slot points', () => {
    it('two vehicles land at target + slot offset, by ascending id', () => {
      const a = waiter(1, TX + 0.6, TZ - 0.4);
      const b = waiter(2, TX - 0.9, TZ + 1.0);
      const pool = [a.v, b.v];
      const employees = [a.e, b.e];
      const [o0x, o0z] = WAITING_QUEUE_SLOT_OFFSETS[0]!;
      const [o1x, o1z] = WAITING_QUEUE_SLOT_OFFSETS[1]!;
      expect(waitingRenderPosition(a.v, pool, employees)).toEqual([TX + o0x, TZ + o0z]);
      expect(waitingRenderPosition(b.v, pool, employees)).toEqual([TX + o1x, TZ + o1z]);
    });

    it('slot assignment follows ascending id, not pool order', () => {
      const a = waiter(7, TX + 0.2, TZ);
      const b = waiter(3, TX - 0.2, TZ);
      const pool = [a.v, b.v];
      const employees = [a.e, b.e];
      const [o0x, o0z] = WAITING_QUEUE_SLOT_OFFSETS[0]!;
      const [o1x, o1z] = WAITING_QUEUE_SLOT_OFFSETS[1]!;
      expect(waitingRenderPosition(b.v, pool, employees)).toEqual([TX + o0x, TZ + o0z]);
      expect(waitingRenderPosition(a.v, pool, employees)).toEqual([TX + o1x, TZ + o1z]);
    });

    it('four vehicles get pairwise distinct points', () => {
      const group = [1, 2, 3, 4].map(id => waiter(id, TX + 0.3 * id - 0.6, TZ + 0.2 * id - 0.4));
      const pool = group.map(g => g.v);
      const employees = group.map(g => g.e);
      const points = pool.map(v => waitingRenderPosition(v, pool, employees));
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          expect(dist(points[i]!, points[j]!)).toBeGreaterThan(0);
        }
      }
    });

    it('each drawn point stays within (largest slot offset + reach) of the vehicle own x/z', () => {
      const group = [1, 2, 3, 4, 5].map(id => {
        const angle = id * 1.3;
        return waiter(id, TX + Math.cos(angle) * WAITING_QUEUE_TARGET_REACH, TZ + Math.sin(angle) * WAITING_QUEUE_TARGET_REACH);
      });
      const pool = group.map(g => g.v);
      const employees = group.map(g => g.e);
      for (const g of group) {
        const drawn = waitingRenderPosition(g.v, pool, employees);
        expect(dist(drawn, [g.v.x, g.v.z])).toBeLessThanOrEqual(MAX_SLOT_OFFSET + WAITING_QUEUE_TARGET_REACH + 1e-9);
      }
    });
  });

  describe('C4 — a non-waiting vehicle renders at its own x/z', () => {
    it('no driver aboard', () => {
      const v = makeVehicle(1, 3, 4);
      expect(waitingRenderPosition(v, [v], [])).toEqual([3, 4]);
    });

    it('driver on a drive leg but not waiting (vehicleWaitingTicks 0)', () => {
      const v = makeVehicle(1, 3, 4);
      const e = driverFor(v, TX, TZ, { waitingTicks: 0 });
      expect(waitingRenderPosition(v, [v], [e])).toEqual([3, 4]);
    });

    it('driver waiting but the current leg is not a drive leg', () => {
      const v = makeVehicle(1, 3, 4);
      const e = driverFor(v, TX, TZ, { mode: 'foot' });
      expect(waitingRenderPosition(v, [v], [e])).toEqual([3, 4]);
    });

    it('driver waiting without an itinerary', () => {
      const v = makeVehicle(1, 3, 4);
      const e = driverFor(v, TX, TZ, { noItinerary: true });
      expect(waitingRenderPosition(v, [v], [e])).toEqual([3, 4]);
    });

    it('sitting next to the shared target of waiting vehicles, without waiting itself', () => {
      const a = waiter(1, TX + 0.3, TZ);
      const b = waiter(2, TX - 0.3, TZ);
      const idle = makeVehicle(3, TX, TZ + 0.2);
      const idleDriver = driverFor(idle, TX, TZ, { waitingTicks: 0 });
      const pool = [a.v, b.v, idle];
      expect(waitingRenderPosition(idle, pool, [a.e, b.e, idleDriver])).toEqual([TX, TZ + 0.2]);
    });

    it('does not count toward the slotting of a waiting vehicle that is otherwise alone', () => {
      const a = waiter(1, TX + 0.3, TZ);
      const idle = makeVehicle(2, TX, TZ);
      const idleDriver = driverFor(idle, TX, TZ, { waitingTicks: 0 });
      expect(waitingRenderPosition(a.v, [a.v, idle], [a.e, idleDriver])).toEqual([TX + 0.3, TZ]);
    });
  });
});
