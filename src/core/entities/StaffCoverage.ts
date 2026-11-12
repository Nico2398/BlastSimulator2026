// BlastSimulator2026 — Staff coverage: what the crew holds against what the site needs (#2242)
// One line per qualification something on site depends on: the vehicles that
// need it as a licence (and the highest licence level their tiers ask for),
// and the queued orders nobody has claimed yet that need it as a skill —
// set against how many living employees hold it, and how many hold it at the
// level the fleet's top tier needs. The Crew and Fleet windows draw these
// lines so a player sees "3 haulers, 1 licensed driver" before the haulers
// sit idle.

import type { Employee, SkillCategory } from './Employee.js';
import type { Vehicle, VehicleRole } from './Vehicle.js';
import { ROLE_LICENCE_REQUIRED, licenceLevelOfSkill } from './VehicleDriverAssignment.js';
import type { PendingAction } from '../state/GameState.js';

/**
 * missing — something needs the qualification and nobody can supply it (or nobody at the level a vehicle needs);
 * short   — fewer qualified people than vehicles needing them, so not every vehicle can run at once;
 * ok      — enough hands.
 */
export type CoverageStatus = 'ok' | 'short' | 'missing';

export interface CoverageLine {
  readonly skill: SkillCategory;
  /** Vehicle roles in the fleet whose licence this is. */
  readonly roles: readonly VehicleRole[];
  /** Vehicles needing the licence. */
  readonly vehicles: number;
  /** Highest licence level those vehicles ask for (their tier); 0 with no vehicle. */
  readonly levelNeeded: number;
  /** Queued, unclaimed orders needing the skill. */
  readonly queuedOrders: number;
  /** Living employees holding the qualification at any level. */
  readonly holders: number;
  /** Living holders at `levelNeeded` or above (equals `holders` when no vehicle needs it). */
  readonly holdersAtLevel: number;
  readonly status: CoverageStatus;
}

/** Order lines worst first, then by skill id, so the problem is the first thing read. */
const STATUS_RANK: Record<CoverageStatus, number> = { missing: 0, short: 1, ok: 2 };

interface Demand { roles: Set<VehicleRole>; vehicles: number; levelNeeded: number; queuedOrders: number }

function statusOf(d: Demand, holders: number, atLevel: number): CoverageStatus {
  if (holders === 0 || (d.vehicles > 0 && atLevel === 0)) return 'missing';
  if (atLevel < d.vehicles) return 'short';
  return 'ok';
}

/** Living holders of `skill` at `level` or above, reading a licence's own level and a skill's proficiency. */
function holdersAt(employees: readonly Employee[], skill: SkillCategory, level: number): number {
  let n = 0;
  for (const e of employees) {
    if (!e.alive) continue;
    const held = licenceLevelOfSkill(e.qualifications, skill);
    if (held > 0 && held >= level) n++;
  }
  return n;
}

/** Every qualification the fleet or the queue depends on, with who can supply it. */
export function staffCoverage(
  vehicles: readonly Pick<Vehicle, 'type' | 'tier'>[],
  employees: readonly Employee[],
  pendingActions: readonly Pick<PendingAction, 'requiredSkill' | 'status' | 'holderId'>[],
): CoverageLine[] {
  const demand = new Map<SkillCategory, Demand>();
  const need = (skill: SkillCategory): Demand => {
    let d = demand.get(skill);
    if (!d) { d = { roles: new Set(), vehicles: 0, levelNeeded: 0, queuedOrders: 0 }; demand.set(skill, d); }
    return d;
  };
  for (const v of vehicles) {
    const d = need(ROLE_LICENCE_REQUIRED[v.type]);
    d.roles.add(v.type);
    d.vehicles++;
    d.levelNeeded = Math.max(d.levelNeeded, v.tier);
  }
  for (const a of pendingActions) {
    if (a.requiredSkill === null || a.status !== 'queued' || a.holderId !== null) continue;
    need(a.requiredSkill).queuedOrders++;
  }
  const lines: CoverageLine[] = [];
  for (const [skill, d] of demand) {
    const holders = holdersAt(employees, skill, 1);
    const atLevel = d.vehicles > 0 ? holdersAt(employees, skill, d.levelNeeded) : holders;
    lines.push({
      skill, roles: [...d.roles], vehicles: d.vehicles, levelNeeded: d.levelNeeded, queuedOrders: d.queuedOrders,
      holders, holdersAtLevel: atLevel, status: statusOf(d, holders, atLevel),
    });
  }
  return lines.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.skill.localeCompare(b.skill));
}
