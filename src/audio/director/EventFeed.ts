// BlastSimulator2026 — Core event feed
// Subscribes to the simulation's events and turns them into cues. Events only
// mark intents (which vehicle hauled, whether a shift changed); the cues play
// when the director flushes, once per command or frame. A burst of a hundred
// hauls or a whole crew changing shift therefore costs a bounded number of
// sounds, nearest to the listener first, however many events fired.

import type { OneShotId } from '../SoundCatalog.js';
import { DIRECTOR_CONFIG, EVENT_CUES, FLAG_CUES, HAUL_BUDGET_CONFIG } from '../../core/config/audio/game.js';
import { playCue } from './playCue.js';
import { TokenBucket } from './rateLimit.js';
import type { LevelStings } from './LevelStings.js';
import type { Subscriptions } from './Subscriptions.js';
import type { DirectorEnv, EntityKind } from './types.js';

type EntityIntent = keyof typeof EVENT_CUES;
type FlagIntent = 'levelUp' | 'shiftBell' | 'unlock';

interface EntityCue {
  readonly sound: OneShotId;
  readonly entity: EntityKind;
  /** Spends from the shared hauling budget. */
  readonly budgeted: boolean;
}

const ENTITY_CUES: Readonly<Record<EntityIntent, EntityCue>> = {
  haulLoad: { sound: 'haul_load', entity: 'vehicle', budgeted: true },
  haulDump: { sound: 'haul_dump', entity: 'vehicle', budgeted: true },
  boulder: { sound: 'boulder_break', entity: 'vehicle', budgeted: true },
  vehicleStart: { sound: 'vehicle_start', entity: 'vehicle', budgeted: false },
  horn: { sound: 'vehicle_horn', entity: 'vehicle', budgeted: false },
  collapse: { sound: 'worker_collapse', entity: 'employee', budgeted: false },
};

// Owner of the `unlock` (research:completed) and `level_up` (employee:levelup) sounds: this feed. Their toasts are
// created silent (researchNotifications, crewNotifications), so the toast cue never doubles them.
const FLAG_SOUNDS: Readonly<Record<FlagIntent, OneShotId>> = {
  levelUp: 'level_up',
  shiftBell: 'shift_bell',
  unlock: 'unlock',
};

export class EventFeed {
  private readonly pending = new Map<EntityIntent, Set<number>>();
  private readonly flags = new Set<FlagIntent>();
  private readonly haulBudget = new TokenBucket(HAUL_BUDGET_CONFIG.capacity, HAUL_BUDGET_CONFIG.refillPerS);

  constructor(
    private readonly env: DirectorEnv,
    private readonly stings: LevelStings,
  ) {}

  attach(subs: Subscriptions): void {
    subs.on('vehicle:haul_loaded', e => this.mark('haulLoad', e.vehicleId));
    subs.on('vehicle:haul_delivered', e => this.mark('haulDump', e.vehicleId));
    subs.on('vehicle:boulder_broken', e => this.mark('boulder', e.vehicleId));
    subs.on('employee:mounted', e => this.mark('vehicleStart', e.vehicleId));
    subs.on('vehicle:stuck', e => this.mark('horn', e.vehicleId));
    subs.on('employee:collapsed', e => this.mark('collapse', e.employeeId));
    subs.on('employee:levelup', () => this.flags.add('levelUp'));
    subs.on('employee:shift_change', () => this.flags.add('shiftBell'));
    subs.on('research:completed', () => this.flags.add('unlock'));
    subs.on('level:complete', () => this.stings.play('win'));
    subs.on('bankruptcy:triggered', () => this.stings.play('lose'));
    subs.on('arrest:triggered', () => this.stings.play('lose'));
    subs.on('ecology:shutdown', () => this.stings.play('lose'));
    subs.on('revolt:triggered', () => this.stings.play('lose'));
  }

  /** The hauling budget refills in real time. */
  update(dtS: number): void {
    this.haulBudget.refill(dtS);
  }

  /** Play what the events asked for, then forget it. */
  flush(): void {
    for (const [intent, ids] of this.pending) this.flushEntities(intent, ids);
    this.pending.clear();
    for (const flag of this.flags) {
      playCue(this.env, { sound: FLAG_SOUNDS[flag], key: FLAG_SOUNDS[flag], cooldownS: FLAG_CUES[flag].cooldownS });
    }
    this.flags.clear();
  }

  /** Drop what the events asked for (a menu hides the game). */
  clear(): void {
    this.pending.clear();
    this.flags.clear();
  }

  reset(): void {
    this.clear();
    this.haulBudget.reset();
  }

  private mark(intent: EntityIntent, id: number): void {
    let ids = this.pending.get(intent);
    if (!ids) {
      ids = new Set();
      this.pending.set(intent, ids);
    }
    if (ids.size < DIRECTOR_CONFIG.maxPendingEntities) ids.add(id);
  }

  private flushEntities(intent: EntityIntent, ids: ReadonlySet<number>): void {
    const cue = ENTITY_CUES[intent];
    const policy = EVENT_CUES[intent];
    const heard: { id: number; distance: number }[] = [];
    for (const id of ids) {
      const point = this.env.positionOf(cue.entity, id);
      if (point && this.env.isNear(point, DIRECTOR_CONFIG.nearRangeFactor)) heard.push({ id, distance: this.env.distanceToListener(point) });
    }
    heard.sort((a, b) => a.distance - b.distance);

    const spacingKey = `spacing:${intent}`;
    let played = 0;
    for (const { id } of heard) {
      if (played >= policy.maxPerFlush || (cue.budgeted && !this.haulBudget.canTake()) || !this.env.gate.isReady(spacingKey)) break;
      const point = this.env.positionOf(cue.entity, id);
      if (!point) continue;
      const issued = playCue(this.env, {
        sound: cue.sound,
        site: { entity: { kind: cue.entity, id }, point },
        key: `${intent}:${id}`,
        cooldownS: policy.entityCooldownS,
        rangeFactor: DIRECTOR_CONFIG.nearRangeFactor,
      });
      if (!issued) continue;
      played++;
      if (policy.spacingS > 0) this.env.gate.tryPass(spacingKey, policy.spacingS);
      if (cue.budgeted) this.haulBudget.take();
    }
    // Nobody in earshot fell: one muted alert, so the collapse is not lost to a worker off screen.
    if (intent === 'collapse' && heard.length === 0 && ids.size > 0) {
      playCue(this.env, { sound: 'notify_bad', key: 'offscreen_collapse', cooldownS: FLAG_CUES.offscreenCollapse.cooldownS, gainDb: FLAG_CUES.offscreenCollapse.gainDb });
    }
  }
}
