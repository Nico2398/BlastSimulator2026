// BlastSimulator2026 — Tutorial events
// Events that guide the player through the first levels of the campaign.

import { ev } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const TUTORIAL_EVENTS: EventDef[] = [
  ev('tutorial_synergy_consultant', 'tutorial', {
    weight: () => 0.5,
    options: [
      { cashDelta: -3000, scoreDelta: { wellBeing: 15 } },
      { scoreDelta: { wellBeing: -10, safety: -5 } },
      { scoreDelta: { wellBeing: 5, safety: -5 } },
    ],
  }),
];
