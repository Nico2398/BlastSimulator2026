// BlastSimulator2026 — Interface tour mix scenario
// Every kind of interface sound in the order a player meets them: hovering and
// clicking, panels and tabs, toggles and sliders, refusals, notifications, event
// alerts, orders, hiring and buying, money, and the two level-end stings.

import { LAB_RENDER_CONFIG } from '../../core/config/audio/lab.js';
import type { OneShotId } from '../SoundCatalog.js';
import type { MixScenario } from './mixTypes.js';
import { TimelineBuilder } from './timeline.js';

/** [sound, seconds until the next step]: gaps are longer than each sound's cooldown unless a burst is the point. */
const TOUR: ReadonlyArray<readonly [OneShotId, number]> = [
  // pointing and clicking
  ['ui_hover', 0.25], ['ui_click', 0.9], ['ui_hover', 0.2], ['ui_click', 1],
  // panels, tabs, toggles
  ['ui_open', 1], ['ui_tab', 0.5], ['ui_tab', 0.5], ['ui_toggle_on', 0.7], ['ui_toggle_off', 0.9],
  // a slider dragged
  ['ui_slider', 0.1], ['ui_slider', 0.1], ['ui_slider', 0.1], ['ui_slider', 0.1], ['ui_slider', 0.9],
  ['ui_select', 0.8], ['ui_confirm', 0.9], ['ui_back', 0.7], ['ui_close', 1.2],
  // refusals and a modal
  ['ui_denied', 1], ['ui_error', 1.1], ['ui_invalid', 1.1], ['blast_cancel', 1.6], ['ui_modal', 1.4], ['ui_confirm', 1.2],
  // notifications of rising severity
  ['notify_info', 1.2], ['notify_good', 1.2], ['notify_warn', 1.3], ['notify_bad', 1.4], ['notify_alert', 2.2],
  // event alerts
  ['event_union', 2.2], ['event_lawsuit', 2.2], ['event_mafia', 2.2], ['event_politics', 2.2],
  // orders, staff, purchases
  ['order_queued', 0.4], ['order_queued', 1], ['order_done', 1.2], ['build_placed', 1.2],
  ['hire', 1.1], ['fire', 1.1], ['purchase', 1.2], ['unlock', 1.6], ['level_up', 1.8],
  // money
  ['coins_small', 1.2], ['coins_big', 1.5], ['cash_till', 2.2],
  // a burst of fast clicking, a sweep of the pointer over a menu
  ['ui_click', 0.09], ['ui_click', 0.09], ['ui_click', 0.09], ['ui_click', 1.2],
  ['ui_hover', 0.12], ['ui_hover', 0.12], ['ui_hover', 0.12], ['ui_hover', 0.12], ['ui_hover', 1.5],
  // the level ends
  ['level_win', 4], ['level_lose', 0],
];

const LEAD_IN_S = 0.5;

export function buildUiTourScenario(): MixScenario {
  const builder = new TimelineBuilder();
  let t = LEAD_IN_S;
  for (const [id, gapS] of TOUR) {
    builder.play(t, id);
    t += gapS;
  }
  return {
    name: 'ui-tour',
    title: 'Interface tour: clicks, panels, alerts, orders, money',
    durationS: t + LAB_RENDER_CONFIG.tailS,
    listener: LAB_RENDER_CONFIG.listener,
    events: builder.build(),
  };
}
