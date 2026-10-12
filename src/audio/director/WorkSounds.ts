// BlastSimulator2026 — Work sounds
// While crews and machines are actually working, the nearest work sites make
// short bursts (drill, dig, hammer) on a real-time timer with random jitter, and
// a quiet machinery bed follows how much is going on near the listener. Only
// the few nearest sites sound at once, so a busy mine is a texture, not a wall.
//
// The list of working units is rebuilt from the game state after each command
// or tick (`refresh`); the timers, the nearest-site choice and the bed level
// run on real frame time (`update`), so nothing here multiplies at 8x.

import type { OneShotId } from '../SoundCatalog.js';
import type { ActionType, GameState } from '../../core/state/GameState.js';
import { computeEmployeeActivity } from '../../core/entities/EmployeeActivity.js';
import { DIRECTOR_CONFIG, WORK_CONFIG } from '../../core/config/audio/game.js';
import { clamp } from '../engine/units.js';
import { BedFeed } from './BedFeed.js';
import { playCue } from './playCue.js';
import type { DirectorEnv, EntityKind } from './types.js';
import type { Spot } from './worldSnapshot.js';

/** Which burst an action makes while it is being worked. Actions not listed are silent at the site. */
const WORK_SOUND: Readonly<Partial<Record<ActionType, OneShotId>>> = {
  drill_hole: 'work_drill',
  dig_ramp_segment: 'work_dig',
  level_ground: 'work_dig',
  place_building: 'work_hammer',
  demolish_building: 'work_hammer',
  repair_vehicle: 'work_hammer',
};

interface Unit {
  readonly entity: { readonly kind: EntityKind; readonly id: number };
  readonly point: Spot;
}

interface Site extends Unit {
  readonly key: string;
  readonly sound: OneShotId;
  /** Seconds until the next burst; only counts down while the site is among the nearest. */
  timerS: number;
  selected: boolean;
}

export class WorkSounds {
  private sites = new Map<string, Site>();
  private units: Unit[] = [];
  private selectionTimerS = 0;
  private suppressedUntilS = 0;
  private nearUnits = 0;
  private level = 0;
  private readonly bed: BedFeed;

  constructor(private readonly env: DirectorEnv) {
    this.bed = new BedFeed(env.player.loop('amb_machinery'), WORK_CONFIG.machinery.epsilon);
  }

  /** Rebuild the working units from the game state. Call after every command and tick. */
  refresh(state: GameState): void {
    const rider = new Map<number, number>();
    for (const vehicle of state.vehicles.vehicles) for (const id of vehicle.occupantIds) rider.set(id, vehicle.id);

    const sites = new Map<string, Site>();
    const units: Unit[] = [];
    for (const employee of state.employees.employees) {
      if (!employee.alive) continue;
      const activity = computeEmployeeActivity(employee, state.vehicles);
      if (activity.kind !== 'working' && activity.kind !== 'driving' && activity.kind !== 'driving_to_task') continue;
      const vehicleId = rider.get(employee.id);
      const unit: Unit = {
        entity: vehicleId !== undefined ? { kind: 'vehicle', id: vehicleId } : { kind: 'employee', id: employee.id },
        point: { x: employee.x, z: employee.z },
      };
      units.push(unit);
      const sound = activity.kind === 'working' && activity.actionType ? WORK_SOUND[activity.actionType] : undefined;
      if (!sound) continue;
      const key = `work:${employee.id}`;
      const previous = this.sites.get(key);
      sites.set(key, { ...unit, key, sound, timerS: previous?.timerS ?? 0, selected: previous?.selected ?? false });
    }
    this.sites = sites;
    this.units = units;
  }

  /** Keep work bursts quiet for a while (a blast is going off). */
  suppress(seconds: number): void {
    this.suppressedUntilS = Math.max(this.suppressedUntilS, this.env.now() + seconds);
  }

  /** `active` is false while paused, behind a menu or after the level ended. */
  update(dtS: number, active: boolean): void {
    this.selectionTimerS -= dtS;
    if (this.selectionTimerS <= 0) {
      this.selectionTimerS = WORK_CONFIG.selectionIntervalS;
      this.select();
    }
    this.followActivity(dtS, active);
    if (!active || this.env.now() < this.suppressedUntilS) return;
    for (const site of this.sites.values()) {
      if (!site.selected) continue;
      site.timerS -= dtS;
      if (site.timerS > 0) continue;
      site.timerS = this.env.random.nextFloat(WORK_CONFIG.burstMinS, WORK_CONFIG.burstMaxS);
      playCue(this.env, {
        sound: site.sound,
        site: { entity: site.entity, point: site.point },
        key: site.key,
        cooldownS: 0,
        rangeFactor: DIRECTOR_CONFIG.nearRangeFactor,
      });
    }
  }

  /** Silence the bed and forget every site. */
  clear(): void {
    this.sites.clear();
    this.units = [];
    this.nearUnits = 0;
    this.level = 0;
    this.suppressedUntilS = 0;
    this.bed.set(0, WORK_CONFIG.machinery.rampS);
  }

  /** Re-pick the nearest work sites and count the units close enough to add to the bed. */
  private select(): void {
    const audible = [...this.sites.values()].flatMap(site => {
      const point = this.env.resolve(site);
      return this.env.isNear(point, DIRECTOR_CONFIG.nearRangeFactor) ? [{ site, distance: this.env.distanceToListener(point) }] : [];
    });
    audible.sort((a, b) => a.distance - b.distance);
    const chosen = new Set(audible.slice(0, WORK_CONFIG.maxSites).map(entry => entry.site));
    for (const site of this.sites.values()) {
      const wasSelected = site.selected;
      site.selected = chosen.has(site);
      if (site.selected && !wasSelected) site.timerS = this.env.random.nextFloat(0, WORK_CONFIG.firstBurstMaxS);
    }
    this.nearUnits = this.units.filter(unit => this.env.isNear(this.env.resolve(unit), WORK_CONFIG.machinery.rangeFactor)).length;
  }

  /** Ease the machinery bed toward how busy the area near the listener is. */
  private followActivity(dtS: number, active: boolean): void {
    const config = WORK_CONFIG.machinery;
    const target = active ? Math.sqrt(clamp(this.nearUnits / config.unitsForFull, 0, 1)) : 0;
    this.level += (target - this.level) * (1 - Math.exp(-dtS / config.smoothTauS));
    if (target === 0 && this.level < config.epsilon) this.level = 0;
    this.bed.set(this.level * config.maxLevel, config.rampS);
  }
}
