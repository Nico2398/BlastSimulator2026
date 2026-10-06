// BlastSimulator2026 — Campaign profile storage (localStorage-shaped) (#1312)
// Never throws: storage failures degrade to a fresh profile / false.

import type { CampaignProfile } from './CampaignProfile.js';

export const CAMPAIGN_PROFILE_STORAGE_KEY = 'bs_campaign_profile_v1';

export type ProfileStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Load the profile; missing/corrupt/unavailable storage yields a fresh profile. */
export function loadCampaignProfile(storage?: ProfileStorage): CampaignProfile {
  void storage;
  throw new Error('not implemented');
}

/** Persist the profile; returns false when storage is unavailable or refuses. */
export function saveCampaignProfile(profile: CampaignProfile, storage?: ProfileStorage): boolean {
  void profile; void storage;
  throw new Error('not implemented');
}

/** Remove the stored profile. */
export function clearCampaignProfile(storage?: ProfileStorage): void {
  void storage;
  throw new Error('not implemented');
}
