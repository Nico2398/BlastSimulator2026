// BlastSimulator2026 — Campaign profile storage (localStorage-shaped) (#1312)
// Never throws: storage failures degrade to a fresh profile / false.

import { parseCampaignProfile, createCampaignProfile, type CampaignProfile } from './CampaignProfile.js';
import { resolveStorage } from './browserStorage.js';

export const CAMPAIGN_PROFILE_STORAGE_KEY = 'bs_campaign_profile_v1';

export type ProfileStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Load the profile; missing/corrupt/unavailable storage yields a fresh profile. */
export function loadCampaignProfile(storage?: ProfileStorage): CampaignProfile {
  try {
    const raw = resolveStorage(storage)?.getItem(CAMPAIGN_PROFILE_STORAGE_KEY);
    if (!raw) return createCampaignProfile();
    return parseCampaignProfile(JSON.parse(raw));
  } catch {
    return createCampaignProfile();
  }
}

/** Persist the profile; returns false when storage is unavailable or refuses. */
export function saveCampaignProfile(profile: CampaignProfile, storage?: ProfileStorage): boolean {
  try {
    const store = resolveStorage(storage);
    if (!store) return false;
    store.setItem(CAMPAIGN_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}
