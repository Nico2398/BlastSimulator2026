// BlastSimulator2026 — One-way ramps: a built ramp's traffic direction and the field vehicle routes read it from.
//
// A pit served by one ramp sends every loaded truck up and every empty one down the same corridor, and they meet
// head-on. Marking one ramp down-only and another up-only lets the traffic flow one way on each. The direction is a
// strong preference, not a wall: a step against it costs RAMP_AGAINST_FLOW_COST_FACTOR times its plain cost
// (Pathfinding.ts), so a vehicle takes any other way the site offers and drives the wrong way only when nothing else
// leads out. Reachability stays the same either way, and a pit whose only ramp points down never strands a truck.

import type { GameState } from '../state/GameState.js';
import type { NavGrid } from '../nav/NavGrid.js';
import type { RampFlowField } from '../nav/Pathfinding.js';
import { rampCorridorRects } from './RampPath.js';
import { t } from '../i18n/I18n.js';

/** Traffic direction of a one-way ramp: vehicles only descend it, or only climb it. */
export type RampFlow = 'down' | 'up';

/** Every traffic setting a ramp takes, two-way first. */
export const RAMP_FLOW_SETTINGS = ['both', 'down', 'up'] as const;
type RampFlowSetting = typeof RAMP_FLOW_SETTINGS[number];

/** True when `raw` names a traffic setting. */
export function isRampFlowSetting(raw: string): raw is RampFlowSetting {
  return (RAMP_FLOW_SETTINGS as readonly string[]).includes(raw);
}

/** The setting a built ramp is on: its flow, or 'both' when it has none. */
export function rampFlowSetting(ramp: { flow?: RampFlow }): RampFlowSetting {
  return ramp.flow ?? 'both';
}

/** The setting after `current` in RAMP_FLOW_SETTINGS order, wrapping: what one press of the inspector's toggle selects. */
export function nextRampFlowSetting(current: RampFlowSetting): RampFlowSetting {
  return RAMP_FLOW_SETTINGS[(RAMP_FLOW_SETTINGS.indexOf(current) + 1) % RAMP_FLOW_SETTINGS.length]!;
}

type SetFlowResult = { success: true } | { success: false; error: string };

/** Puts built ramp `rampId` on `setting`; refuses an unknown id. */
export function setRampFlow(state: GameState, rampId: number, setting: RampFlowSetting): SetFlowResult {
  const ramp = state.builtRamps.find(r => r.id === rampId);
  if (!ramp) return { success: false, error: t('mining.ramp_flow.not_found', { id: rampId }) };
  if (setting === 'both') delete ramp.flow;
  else ramp.flow = setting;
  return { success: true };
}

const fieldCache = new WeakMap<NavGrid, { key: string; field: RampFlowField | null }>();

/**
 * The one-way ramp cells of `state`'s site, for a vehicle route (`PathRequest.rampFlow`): 1 on a down-only ramp's
 * corridor, -1 on an up-only one's, 0 elsewhere. Null when no ramp is one-way or there is no nav grid. Built once per
 * nav grid and set of one-way ramps; where two corridors overlap, the older ramp's direction holds.
 */
export function rampFlowField(state: GameState): RampFlowField | null {
  const grid = state.navGrid;
  if (grid === null) return null;
  const oneWay = state.builtRamps.filter(r => r.flow !== undefined).sort((a, b) => b.id - a.id);
  if (oneWay.length === 0) return null;
  const key = oneWay.map(r => `${r.id}:${r.flow}:${r.width}:${r.footprint.minX},${r.footprint.minZ},${r.footprint.maxX},${r.footprint.maxZ}`).join('|');
  const hit = fieldCache.get(grid);
  if (hit !== undefined && hit.key === key) return hit.field;
  const field: RampFlowField = new Int8Array(grid.width * grid.height);
  // Newest first, so an older ramp's direction is written last and holds where two corridors overlap.
  for (const ramp of oneWay) {
    const dir = ramp.flow === 'down' ? 1 : -1;
    for (const rect of rampCorridorRects(ramp.def, ramp.width, ramp.footprint)) {
      for (let z = Math.max(rect.minZ, grid.originZ); z <= Math.min(rect.maxZ, grid.originZ + grid.height - 1); z++) {
        for (let x = Math.max(rect.minX, grid.originX); x <= Math.min(rect.maxX, grid.originX + grid.width - 1); x++) {
          field[(z - grid.originZ) * grid.width + (x - grid.originX)] = dir;
        }
      }
    }
  }
  fieldCache.set(grid, { key, field });
  return field;
}
