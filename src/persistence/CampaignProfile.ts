// BlastSimulator2026 — Campaign profile: campaign progress kept outside GameState (#1312)
// Pure data + merge helpers. Storage lives in CampaignProfileStore.ts.

import { createCampaignState, isCampaignComplete, recordStars, unlockNextLevel, type CampaignState } from '../core/campaign/Campaign.js';
import { getAllLevels } from '../core/campaign/Level.js';

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

type Stars = 0 | 1 | 2 | 3;

function clampStars(value: unknown): Stars {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(3, Math.floor(value))) as Stars;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Completing a level unlocks the one after it (by level order). */
function unlockSuccessorsOfCompleted(campaign: CampaignState): void {
  for (const level of getAllLevels()) {
    if (campaign.levels[level.id]?.completed) unlockNextLevel(campaign, level.id);
  }
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
  const target = profile.campaign;
  if (incoming !== target) {
    for (const [id, entry] of Object.entries(target.levels)) {
      const inc = incoming.levels?.[id];
      if (!inc) continue;
      entry.unlocked = entry.unlocked || inc.unlocked === true;
      entry.completed = entry.completed || inc.completed === true;
      entry.cumulativeProfit = Math.max(entry.cumulativeProfit, finiteOr(inc.cumulativeProfit, 0));
      entry.bestSessionProfit = Math.max(entry.bestSessionProfit, finiteOr(inc.bestSessionProfit, 0));
      if (inc.bestStars) recordBestStars(profile, id, inc.bestStars);
    }
    target.campaignComplete = target.campaignComplete || incoming.campaignComplete === true;
  }
  unlockSuccessorsOfCompleted(target);
  target.campaignComplete = target.campaignComplete || isCampaignComplete(target);
  if (incomingStars) {
    for (const [id, stars] of Object.entries(incomingStars)) recordBestStars(profile, id, stars);
  }
}

/**
 * Raise a level's best stars (never lowers). Mirrored onto the campaign's own
 * level entry, which the world map and level end screen read (#1311).
 */
export function recordBestStars(profile: CampaignProfile, levelId: string, stars: number): void {
  if (!Object.hasOwn(profile.campaign.levels, levelId)) return;
  profile.bestStars[levelId] = Math.max((Object.hasOwn(profile.bestStars, levelId) ? profile.bestStars[levelId]! : 0), clampStars(stars)) as Stars;
  recordStars(profile.campaign, levelId, profile.bestStars[levelId]!);
}

/** Reset the profile to a fresh state, in place (object identity preserved). */
export function resetCampaignProfile(profile: CampaignProfile): void {
  const fresh = createCampaignProfile();
  const levels = profile.campaign.levels;
  for (const id of Object.keys(levels)) delete levels[id];
  Object.assign(levels, fresh.campaign.levels);
  profile.campaign.activeLevelId = null;
  profile.campaign.campaignComplete = false;
  for (const id of Object.keys(profile.bestStars)) delete profile.bestStars[id];
}

/** Validate untrusted JSON into a profile; falls back to a fresh one. */
export function parseCampaignProfile(raw: unknown): CampaignProfile {
  const profile = createCampaignProfile();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return profile;
  const data = raw as { campaign?: unknown; bestStars?: unknown };
  const camp = data.campaign;
  if (typeof camp === 'object' && camp !== null) {
    const levels = (camp as { levels?: unknown }).levels;
    if (typeof levels === 'object' && levels !== null) {
      for (const [id, entry] of Object.entries(profile.campaign.levels)) {
        const stored = (levels as Record<string, unknown>)[id];
        if (typeof stored !== 'object' || stored === null) continue;
        const s = stored as Record<string, unknown>;
        entry.completed = s['completed'] === true;
        entry.unlocked = entry.unlocked || entry.completed || s['unlocked'] === true;
        entry.cumulativeProfit = Math.max(0, finiteOr(s['cumulativeProfit'], 0));
        entry.bestSessionProfit = Math.max(0, finiteOr(s['bestSessionProfit'], 0));
      }
    }
    profile.campaign.campaignComplete = (camp as { campaignComplete?: unknown }).campaignComplete === true;
  }
  unlockSuccessorsOfCompleted(profile.campaign);
  const stars = data.bestStars;
  if (typeof stars === 'object' && stars !== null && !Array.isArray(stars)) {
    for (const [id, v] of Object.entries(stars)) recordBestStars(profile, id, clampStars(v));
  }
  return profile;
}

/** True when any level beyond the initial state is unlocked/completed, profit earned or stars held. */
export function hasCampaignProgress(profile: CampaignProfile): boolean {
  const fresh = createCampaignState();
  if (profile.campaign.campaignComplete) return true;
  if (Object.values(profile.bestStars).some(s => s > 0)) return true;
  return Object.entries(profile.campaign.levels).some(([id, e]) => {
    const base = fresh.levels[id];
    return e.completed || e.cumulativeProfit > 0 || e.bestSessionProfit > 0 || (e.unlocked && !base?.unlocked);
  });
}
