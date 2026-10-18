// BlastSimulator2026 — Permit and petition events on progression sites (#1927)

import { ev, r } from './EventBuilder.js';
import {
  EVENT_PERMIT_TOUR_STOP_HOURS,
  EVENT_PERMIT_TOUR_SAFETY_MIN,
  EVENT_PERMIT_TOUR_IMPRESSED_TICKS,
  EVENT_PERMIT_TOUR_TRIPPED_TICKS,
  EVENT_PERMIT_STAMP_FEE_PCT,
  EVENT_PERMIT_STAMP_CORRUPTION,
  EVENT_PERMIT_HIDE_DELAY_TICKS,
  EVENT_PETITION_MIN_BLAST_SHARE,
  EVENT_PETITION_MAX_NEIGHBOURS,
  EVENT_PETITION_BBQ_COST,
  EVENT_PETITION_BBQ_NEIGHBOURS,
  EVENT_PETITION_BERM_COST,
  EVENT_PETITION_BERM_NEIGHBOURS,
  EVENT_PETITION_BERM_ECOLOGY,
  EVENT_PETITION_IGNORE_NEIGHBOURS,
  EVENT_PETITION_IGNORE_DELAY_TICKS,
  INSPECTION_EVENT_TAG,
} from '../config/balance.js';
import type { EventDef } from './EventPool.js';

export const PERMIT_EVENTS_1: EventDef[] = [
  // The Ministry's inspector turns up while the application is still on his desk.
  ev('permit_inspection_visit', 'politics', {
    tags: [INSPECTION_EVENT_TAG],
    repeatable: true,
    weight: (s) => 1.0 + 0.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.hasProgression === true && ctx.applicationPending === true,
    options: [
      { effectTag: 'permit_grand_tour',
        effects: [
          { type: 'work_stoppage', hours: EVENT_PERMIT_TOUR_STOP_HOURS },
          { type: 'permit_processing', action: 'shift', ticks: EVENT_PERMIT_TOUR_IMPRESSED_TICKS,
            safetyMin: EVENT_PERMIT_TOUR_SAFETY_MIN, ticksBelow: EVENT_PERMIT_TOUR_TRIPPED_TICKS },
        ] },
      { corruptionDelta: EVENT_PERMIT_STAMP_CORRUPTION, effectTag: 'permit_stamp',
        effects: [{ type: 'permit_processing', action: 'approve', feePct: EVENT_PERMIT_STAMP_FEE_PCT }] },
      { effectTag: 'permit_hide',
        effects: [{ type: 'permit_processing', action: 'shift', ticks: EVENT_PERMIT_HIDE_DELAY_TICKS }] },
    ],
  }),
  // Neighbours complain after a blast that used most of the charge limit.
  ev('permit_neighbours_petition', 'politics', {
    weight: (s) => 1.0 + 0.5 * (1 - r.nu(s)),
    canFire: (ctx) => ctx.hasProgression === true
      && (ctx.lastBlastChargeShare ?? 0) >= EVENT_PETITION_MIN_BLAST_SHARE
      && ctx.scores.nuisance < EVENT_PETITION_MAX_NEIGHBOURS,
    options: [
      { cashDelta: -EVENT_PETITION_BBQ_COST, scoreDelta: { nuisance: EVENT_PETITION_BBQ_NEIGHBOURS }, effectTag: 'petition_bbq' },
      { cashDelta: -EVENT_PETITION_BERM_COST,
        scoreDelta: { nuisance: EVENT_PETITION_BERM_NEIGHBOURS, ecology: EVENT_PETITION_BERM_ECOLOGY }, effectTag: 'petition_berm' },
      { scoreDelta: { nuisance: EVENT_PETITION_IGNORE_NEIGHBOURS }, effectTag: 'petition_ignore',
        effects: [{ type: 'permit_processing', action: 'shift', ticks: EVENT_PETITION_IGNORE_DELAY_TICKS, next: true }] },
    ],
  }),
];
