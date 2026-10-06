// BlastSimulator2026 — Campaign profile: campaign progress kept outside GameState (#1312)
// Pure data + merge helpers. Storage lives in CampaignProfileStore.ts.

import { createCampaignState, type CampaignState } from '../core/campaign/Campaign.js';

export interface CampaignProfile {
  version: 1;
  campaign: CampaignState;
  /** Best star rating per level id. */
  bestStars: Record<string, 0 | 1 | 2 | 3>;
}

/** Fresh profile with a fresh campaign and no stars. */
export function createCampaignProfile(): CampaignProfile {
  return { version: 1, campaign: createCampaignState(), bestStars: {} };
}

/**
 * Monotonic merge of `incoming` into `profile`: unlocked/completed OR,
 * cumulativeProfit/bestSessionProfit/stars max, campaignComplete OR, unknown
 * level ids ignored, activeLevelId never touched.
 */
export function mergeCampaignIntoProfile(
  profile: CampaignProfile,
  incoming: CampaignState,
  incomingStars?: Record<string, number>,
): void {
  void profile; void incoming; void incomingStars;
  throw new Error('not implemented');
}

/** Raise a level's best stars (never lowers). */
export function recordBestStars(profile: CampaignProfile, levelId: string, stars: number): void {
  void profile; void levelId; void stars;
  throw new Error('not implemented');
}

/** Reset the profile to a fresh state, in place. */
export function resetCampaignProfile(profile: CampaignProfile): void {
  void profile;
  throw new Error('not implemented');
}

/** Validate untrusted JSON into a profile; falls back to a fresh one. */
export function parseCampaignProfile(raw: unknown): CampaignProfile {
  void raw;
  throw new Error('not implemented');
}

/** True when any level beyond the initial state is unlocked/completed, profit earned or stars held. */
export function hasCampaignProgress(profile: CampaignProfile): boolean {
  void profile;
  throw new Error('not implemented');
}
