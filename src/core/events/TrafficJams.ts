// BlastSimulator2026 — Traffic jam detection at chokepoints (#1208)
// A jam is a cluster of stuck agents — drivers and walkers alike — at one
// chokepoint: a ramp (its upper end is the pit exit, the rest the ramp head)
// or, away from any ramp, a passage. One pass over the employees, bucketed.

import type { BuiltRamp } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import {
  TRAFFIC_JAM_MIN_AGENTS,
  TRAFFIC_JAM_MIN_TICKS,
  TRAFFIC_JAM_PASSAGE_RADIUS,
  TRAFFIC_JAM_RAMP_MARGIN,
} from '../config/balance.js';

export type ChokepointKind = 'ramp_head' | 'pit_exit' | 'passage';

/** A cluster of stuck agents at one chokepoint. */
export interface TrafficJam {
  /** Stable chokepoint identity, used to silence a jam after the player answers it. */
  key: string;
  kind: ChokepointKind;
  /** The ramp the jam sits on; null for a passage jam away from any ramp. */
  rampId: number | null;
  x: number;
  z: number;
  agentIds: number[];
  vehicleCount: number;
}

type RampSpec = Pick<BuiltRamp, 'id' | 'def' | 'footprint'>;

interface Group {
  key: string;
  ramp: RampSpec | null;
  agents: Employee[];
}

/** The lowest-id ramp whose footprint, grown by the margin, holds tile (tx, tz). */
function rampAround(ramps: readonly RampSpec[], tx: number, tz: number): RampSpec | null {
  let found: RampSpec | null = null;
  for (const r of ramps) {
    const f = r.footprint;
    const m = TRAFFIC_JAM_RAMP_MARGIN;
    if (tx < f.minX - m || tx > f.maxX + m || tz < f.minZ - m || tz > f.maxZ + m) continue;
    if (!found || r.id < found.id) found = r;
  }
  return found;
}

/** True when the tile is on the ramp's origin row or outside it, before the descent begins. */
function isUpperEnd(def: RampSpec['def'], tx: number, tz: number): boolean {
  const ox = Math.floor(def.originX);
  const oz = Math.floor(def.originZ);
  switch (def.direction) {
    case 'south': return tz <= oz;
    case 'north': return tz >= oz;
    case 'east': return tx <= ox;
    case 'west': return tx >= ox;
  }
}

/** Finds every chokepoint with enough stuck agents, skipping keys silenced until a later tick. */
export function findTrafficJams(
  ramps: readonly RampSpec[],
  employees: readonly Employee[],
  silencedUntil?: Readonly<Record<string, number>>,
  tick: number = 0,
): TrafficJam[] {
  const groups = new Map<string, Group>();
  for (const emp of employees) {
    if (emp.vehicleWaitingTicks < TRAFFIC_JAM_MIN_TICKS || !emp.itinerary) continue;
    if (Number.isNaN(emp.x) || Number.isNaN(emp.z)) continue;
    const tx = Math.floor(emp.x);
    const tz = Math.floor(emp.z);
    const ramp = rampAround(ramps, tx, tz);
    let key: string;
    if (ramp) {
      key = `ramp:${ramp.id}`;
    } else {
      key = `passage:${Math.floor(emp.x / TRAFFIC_JAM_PASSAGE_RADIUS)},${Math.floor(emp.z / TRAFFIC_JAM_PASSAGE_RADIUS)}`;
    }
    let g = groups.get(key);
    if (!g) { g = { key, ramp, agents: [] }; groups.set(key, g); }
    g.agents.push(emp);
  }

  const jams: TrafficJam[] = [];
  for (const g of groups.values()) {
    if (g.agents.length < TRAFFIC_JAM_MIN_AGENTS) continue;
    if ((silencedUntil?.[g.key] ?? -Infinity) > tick) continue;
    let sx = 0, sz = 0, vehicleCount = 0;
    for (const a of g.agents) {
      sx += a.x; sz += a.z;
      if (a.locomotion.kind === 'mounted') vehicleCount++;
    }
    const n = g.agents.length;
    const x = Math.floor(sx / n) + 0.5;
    const z = Math.floor(sz / n) + 0.5;
    jams.push({
      key: g.key,
      kind: !g.ramp ? 'passage' : isUpperEnd(g.ramp.def, Math.floor(x), Math.floor(z)) ? 'pit_exit' : 'ramp_head',
      rampId: g.ramp?.id ?? null,
      x,
      z,
      agentIds: g.agents.map(a => a.id).sort((a, b) => a - b),
      vehicleCount,
    });
  }
  return jams.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
