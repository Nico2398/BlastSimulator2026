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

/**
 * Single-link clusters of off-ramp agents: two agents chain together when within
 * PASSAGE_RADIUS on both axes. Unlike fixed grid buckets, a crowd straddling a
 * bucket edge stays one jam. The key is the tile of the cluster's lowest-id agent.
 */
function clusterByProximity(agents: readonly Employee[]): Group[] {
  const sorted = [...agents].sort((a, b) => a.id - b.id);
  const seen = new Set<number>();
  const out: Group[] = [];
  for (const seed of sorted) {
    if (seen.has(seed.id)) continue;
    seen.add(seed.id);
    const members = [seed];
    for (let i = 0; i < members.length; i++) {
      const m = members[i]!;
      for (const o of sorted) {
        if (seen.has(o.id)) continue;
        if (Math.abs(o.x - m.x) <= TRAFFIC_JAM_PASSAGE_RADIUS && Math.abs(o.z - m.z) <= TRAFFIC_JAM_PASSAGE_RADIUS) {
          seen.add(o.id);
          members.push(o);
        }
      }
    }
    out.push({ key: `passage:${Math.floor(seed.x)},${Math.floor(seed.z)}`, ramp: null, agents: members });
  }
  return out;
}

/** Finds every chokepoint with enough stuck agents, skipping keys silenced until a later tick. */
export function findTrafficJams(
  ramps: readonly RampSpec[],
  employees: readonly Employee[],
  silencedUntil?: Readonly<Record<string, number>>,
  tick: number = 0,
): TrafficJam[] {
  const groups = new Map<string, Group>();
  const loose: Employee[] = [];
  for (const emp of employees) {
    if (emp.vehicleWaitingTicks < TRAFFIC_JAM_MIN_TICKS || !emp.itinerary) continue;
    if (Number.isNaN(emp.x) || Number.isNaN(emp.z)) continue;
    const tx = Math.floor(emp.x);
    const tz = Math.floor(emp.z);
    const ramp = rampAround(ramps, tx, tz);
    if (ramp) {
      const key = `ramp:${ramp.id}`;
      let g = groups.get(key);
      if (!g) { g = { key, ramp, agents: [] }; groups.set(key, g); }
      g.agents.push(emp);
    } else {
      loose.push(emp);
    }
  }
  for (const g of clusterByProximity(loose)) groups.set(g.key, g);

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
