// BlastSimulator2026 — CampaignProfileStore: never-throwing localStorage wrapper (#1312)

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CAMPAIGN_PROFILE_STORAGE_KEY,
  loadCampaignProfile,
  saveCampaignProfile,
  type ProfileStorage,
} from '../../../src/persistence/CampaignProfileStore.js';
import {
  createCampaignProfile,
  mergeCampaignIntoProfile,
} from '../../../src/persistence/CampaignProfile.js';
import { createCampaignState } from '../../../src/core/campaign/Campaign.js';

function memoryStorage(initial: Record<string, string> = {}): ProfileStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

function progressed() {
  const p = createCampaignProfile();
  const inc = createCampaignState();
  inc.levels['dusty_hollow']!.completed = true;
  inc.levels['dusty_hollow']!.cumulativeProfit = 90000;
  inc.levels['grumpstone_ridge']!.unlocked = true;
  mergeCampaignIntoProfile(p, inc, { dusty_hollow: 2 });
  return p;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('CampaignProfileStore', () => {
  it('uses the documented storage key', () => {
    expect(CAMPAIGN_PROFILE_STORAGE_KEY).toBe('bs_campaign_profile_v1');
  });

  it('round-trips a profile', () => {
    const s = memoryStorage();
    const p = progressed();
    expect(saveCampaignProfile(p, s)).toBe(true);
    expect(s.data.has(CAMPAIGN_PROFILE_STORAGE_KEY)).toBe(true);
    expect(loadCampaignProfile(s)).toEqual(p);
  });

  it('loads a fresh profile when nothing is stored', () => {
    expect(loadCampaignProfile(memoryStorage())).toEqual(createCampaignProfile());
  });

  it('loads a fresh profile from corrupt JSON', () => {
    const s = memoryStorage({ [CAMPAIGN_PROFILE_STORAGE_KEY]: '{not json' });
    expect(loadCampaignProfile(s)).toEqual(createCampaignProfile());
  });

  it('loads a fresh profile from valid JSON of the wrong shape', () => {
    const s = memoryStorage({ [CAMPAIGN_PROFILE_STORAGE_KEY]: '[1,2,3]' });
    expect(loadCampaignProfile(s)).toEqual(createCampaignProfile());
  });

  it('load does not throw and returns fresh when getItem throws', () => {
    const s: ProfileStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(loadCampaignProfile(s)).toEqual(createCampaignProfile());
  });

  it('save returns false and does not throw when setItem throws', () => {
    const s: ProfileStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => {},
    };
    expect(saveCampaignProfile(progressed(), s)).toBe(false);
  });

  it('degrades gracefully when localStorage does not exist at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadCampaignProfile()).toEqual(createCampaignProfile());
    expect(saveCampaignProfile(createCampaignProfile())).toBe(false);
  });

  it('defaults to the global localStorage when no storage is passed', () => {
    const s = memoryStorage();
    vi.stubGlobal('localStorage', s);
    const p = progressed();
    expect(saveCampaignProfile(p)).toBe(true);
    expect(loadCampaignProfile()).toEqual(p);
  });
});
