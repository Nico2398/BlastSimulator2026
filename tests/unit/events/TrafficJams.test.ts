// BlastSimulator2026 — findTrafficJams: chokepoint clustering of stuck agents (#1208)

import { describe, it, expect, beforeEach } from 'vitest';
import { findTrafficJams } from '../../../src/core/events/TrafficJams.js';
import type { BuiltRamp } from '../../../src/core/state/GameState.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { createEmployeeState, hireEmployee, type EmployeeState } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { rampFootprint } from '../../../src/core/mining/RampWidening.js';
import {
  TRAFFIC_JAM_MIN_AGENTS, TRAFFIC_JAM_MIN_TICKS, TRAFFIC_JAM_RAMP_MARGIN, TRAFFIC_JAM_PASSAGE_RADIUS,
} from '../../../src/core/config/balance.js';

let es: EmployeeState;
let rng: Random;

beforeEach(() => {
  es = createEmployeeState();
  rng = new Random(42);
});

function makeRamp(id: number, originX: number, originZ: number, direction: 'south' | 'east' = 'south', length = 10): BuiltRamp {
  const def = { originX, originZ, direction, length, width: 3 as const, targetDepth: 5 };
  return { id, def, width: 3, footprint: rampFootprint(def, 3) };
}

/** A stuck agent standing at (x, z) — use .5 coordinates so tile-centre maths is unambiguous. */
function stuck(x: number, z: number, opts: { drive?: boolean; ticks?: number; itinerary?: boolean } = {}): Employee {
  const { employee } = hireEmployee(es, 'driller', rng, x, z);
  employee.x = x;
  employee.z = z;
  employee.vehicleWaitingTicks = opts.ticks ?? TRAFFIC_JAM_MIN_TICKS;
  const drive = opts.drive ?? false;
  if (opts.itinerary !== false) {
    employee.itinerary = {
      legs: [{
        mode: drive ? 'drive' : 'foot', ...(drive ? { vehicleId: employee.id } : {}),
        destX: 40, destZ: 40, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5,
      }],
      goal: { kind: 'reposition', x: 40, z: 40 },
      workTicks: 0,
      estTotalTicks: 5,
    } as unknown as Employee['itinerary'];
  } else {
    employee.itinerary = null;
  }
  if (drive) employee.locomotion = { kind: 'mounted', vehicleId: employee.id };
  return employee;
}

const RAMP = (): BuiltRamp => makeRamp(1, 20, 10); // footprint x 19..21, z 10..19

describe('findTrafficJams — thresholds', () => {
  it('exports sane constants', () => {
    expect(TRAFFIC_JAM_MIN_AGENTS).toBe(3);
    expect(TRAFFIC_JAM_RAMP_MARGIN).toBeGreaterThan(0);
    expect(TRAFFIC_JAM_PASSAGE_RADIUS).toBeGreaterThan(0);
  });

  it('returns [] with no employees', () => {
    expect(findTrafficJams([RAMP()], [])).toEqual([]);
  });

  it('returns [] for 2 stuck agents on a ramp (below minimum)', () => {
    expect(findTrafficJams([RAMP()], [stuck(20.5, 14.5), stuck(20.5, 15.5)])).toEqual([]);
  });

  it('finds exactly one jam for 3 stuck agents on a ramp', () => {
    const jams = findTrafficJams([RAMP()], [stuck(20.5, 14.5), stuck(20.5, 15.5), stuck(19.5, 15.5)]);
    expect(jams).toHaveLength(1);
    expect(jams[0]!.rampId).toBe(1);
    expect(jams[0]!.key).toBe('ramp:1');
  });

  it('ignores agents below TRAFFIC_JAM_MIN_TICKS (boundary: MIN-1 excluded)', () => {
    const agents = [stuck(20.5, 14.5), stuck(20.5, 15.5), stuck(19.5, 15.5, { ticks: TRAFFIC_JAM_MIN_TICKS - 1 })];
    expect(findTrafficJams([RAMP()], agents)).toEqual([]);
  });

  it('counts agents at exactly TRAFFIC_JAM_MIN_TICKS', () => {
    const agents = [1, 2, 3].map(i => stuck(20.5, 13.5 + i, { ticks: TRAFFIC_JAM_MIN_TICKS }));
    expect(findTrafficJams([RAMP()], agents)).toHaveLength(1);
  });

  it('ignores agents without an itinerary', () => {
    const agents = [stuck(20.5, 14.5), stuck(20.5, 15.5), stuck(19.5, 15.5, { itinerary: false })];
    expect(findTrafficJams([RAMP()], agents)).toEqual([]);
  });

  it('counts foot-only queues (3 walkers at a ramp head)', () => {
    const agents = [stuck(20.5, 10.5), stuck(19.5, 10.5), stuck(21.5, 10.5)];
    const jams = findTrafficJams([RAMP()], agents);
    expect(jams).toHaveLength(1);
    expect(jams[0]!.vehicleCount).toBe(0);
  });

  it('counts foot and drive agents once each and reports vehicleCount', () => {
    const agents = [stuck(20.5, 14.5, { drive: true }), stuck(20.5, 15.5, { drive: true }), stuck(19.5, 15.5)];
    const [jam] = findTrafficJams([RAMP()], agents);
    expect(jam!.agentIds).toHaveLength(3);
    expect(jam!.vehicleCount).toBe(2);
  });

  it('lists agentIds sorted ascending', () => {
    const agents = [stuck(20.5, 15.5), stuck(20.5, 14.5), stuck(19.5, 15.5)];
    const [jam] = findTrafficJams([RAMP()], agents.slice().reverse());
    expect(jam!.agentIds).toEqual(agents.map(a => a.id).sort((a, b) => a - b));
  });
});

describe('findTrafficJams — chokepoint kinds', () => {
  it('classifies agents at the upper end (origin) as pit_exit', () => {
    const agents = [stuck(20.5, 10.5), stuck(19.5, 10.5), stuck(21.5, 10.5)];
    const [jam] = findTrafficJams([RAMP()], agents);
    expect(jam!.kind).toBe('pit_exit');
    expect(jam!.rampId).toBe(1);
  });

  it('classifies agents in the ramp body as ramp_head', () => {
    const agents = [stuck(20.5, 14.5), stuck(19.5, 15.5), stuck(21.5, 15.5)];
    const [jam] = findTrafficJams([RAMP()], agents);
    expect(jam!.kind).toBe('ramp_head');
    expect(jam!.rampId).toBe(1);
  });

  it('keeps agents within RAMP_MARGIN outside the footprint on that ramp', () => {
    const z = 19 + TRAFFIC_JAM_RAMP_MARGIN + 0.5;
    const agents = [stuck(20.5, z), stuck(19.5, z), stuck(21.5, z)];
    const [jam] = findTrafficJams([RAMP()], agents);
    expect(jam!.key).toBe('ramp:1');
  });

  it('agents just past RAMP_MARGIN are a passage jam with rampId null', () => {
    const z = 19 + TRAFFIC_JAM_RAMP_MARGIN + 1.5;
    const agents = [stuck(20.5, z), stuck(20.5, z + 0.2), stuck(20.5, z - 0.2)];
    const jams = findTrafficJams([RAMP()], agents);
    expect(jams).toHaveLength(1);
    expect(jams[0]!.kind).toBe('passage');
    expect(jams[0]!.rampId).toBeNull();
    expect(jams[0]!.key.startsWith('passage:')).toBe(true);
  });

  it('merges stuck agents within PASSAGE_RADIUS into one passage jam', () => {
    const agents = [stuck(60.5, 60.5), stuck(61.5, 60.5), stuck(60.5, 61.5), stuck(61.5, 61.5)];
    const jams = findTrafficJams([], agents);
    expect(jams).toHaveLength(1);
    expect(jams[0]!.agentIds).toHaveLength(4);
  });

  it('does not merge passage agents farther apart than PASSAGE_RADIUS', () => {
    const far = 60.5 + TRAFFIC_JAM_PASSAGE_RADIUS * 4;
    const agents = [stuck(60.5, 60.5), stuck(61.5, 60.5), stuck(far, 60.5), stuck(far + 1, 60.5)];
    expect(findTrafficJams([], agents)).toEqual([]);
  });

  it('reports x/z as the tile-centre mean of its agents', () => {
    const agents = [stuck(20.5, 14.5), stuck(20.5, 15.5), stuck(20.5, 16.5)];
    const [jam] = findTrafficJams([RAMP()], agents);
    expect(jam!.x).toBeCloseTo(20.5);
    expect(jam!.z).toBeCloseTo(15.5);
  });

  it('a 2+2 split across two ramps yields no jam', () => {
    const ramps = [makeRamp(1, 20, 10), makeRamp(2, 50, 10)];
    const agents = [stuck(20.5, 14.5), stuck(20.5, 15.5), stuck(50.5, 14.5), stuck(50.5, 15.5)];
    expect(findTrafficJams(ramps, agents)).toEqual([]);
  });

  it('overlapping ramp footprints resolve to the lowest ramp id', () => {
    const ramps = [makeRamp(2, 20, 10), makeRamp(1, 21, 10)];
    const agents = [stuck(20.5, 14.5), stuck(20.5, 15.5), stuck(20.5, 16.5)];
    const jams = findTrafficJams(ramps, agents);
    expect(jams).toHaveLength(1);
    expect(jams[0]!.rampId).toBe(1);
  });

  it('finds one jam per chokepoint, sorted by key', () => {
    const ramps = [makeRamp(1, 20, 10), makeRamp(2, 50, 10)];
    const agents = [
      ...[14.5, 15.5, 16.5].map(z => stuck(50.5, z)),
      ...[14.5, 15.5, 16.5].map(z => stuck(20.5, z)),
    ];
    const jams = findTrafficJams(ramps, agents);
    expect(jams.map(j => j.key)).toEqual(['ramp:1', 'ramp:2']);
  });
});

describe('findTrafficJams — silencing', () => {
  const agents = (): Employee[] => [stuck(20.5, 14.5), stuck(20.5, 15.5), stuck(19.5, 15.5)];

  it('omits a jam whose key is silenced beyond the current tick', () => {
    expect(findTrafficJams([RAMP()], agents(), { 'ramp:1': 200 }, 100)).toEqual([]);
  });

  it('reports a jam once silence has expired (silencedUntil <= tick)', () => {
    expect(findTrafficJams([RAMP()], agents(), { 'ramp:1': 100 }, 100)).toHaveLength(1);
  });

  it('silencing one key leaves other jams', () => {
    const ramps = [makeRamp(1, 20, 10), makeRamp(2, 50, 10)];
    const all = [
      ...[14.5, 15.5, 16.5].map(z => stuck(20.5, z)),
      ...[14.5, 15.5, 16.5].map(z => stuck(50.5, z)),
    ];
    const jams = findTrafficJams(ramps, all, { 'ramp:1': 500 }, 10);
    expect(jams.map(j => j.key)).toEqual(['ramp:2']);
  });
});
