// BlastSimulator2026 — CampaignProfile: campaign progress kept outside GameState (#1312)

import { describe, it, expect } from 'vitest';
import {
  createCampaignProfile,
  mergeCampaignIntoProfile,
  recordBestStars,
  resetCampaignProfile,
  parseCampaignProfile,
  hasCampaignProgress,
} from '../../../src/persistence/CampaignProfile.js';
import { createCampaignState, type CampaignState } from '../../../src/core/campaign/Campaign.js';

function completedIncoming(): CampaignState {
  const c = createCampaignState();
  c.levels['dusty_hollow']!.completed = true;
  c.levels['dusty_hollow']!.cumulativeProfit = 90000;
  c.levels['dusty_hollow']!.bestSessionProfit = 90000;
  c.levels['grumpstone_ridge']!.unlocked = true;
  return c;
}

describe('createCampaignProfile', () => {
  it('starts fresh: version 1, fresh campaign, no stars', () => {
    const p = createCampaignProfile();
    expect(p.version).toBe(1);
    expect(p.campaign).toEqual(createCampaignState());
    expect(p.bestStars).toEqual({});
  });

  it('gives each call its own campaign object', () => {
    expect(createCampaignProfile().campaign).not.toBe(createCampaignProfile().campaign);
  });
});

describe('mergeCampaignIntoProfile', () => {
  it('ORs completed/unlocked and takes max profits', () => {
    const p = createCampaignProfile();
    mergeCampaignIntoProfile(p, completedIncoming());
    expect(p.campaign.levels['dusty_hollow']!.completed).toBe(true);
    expect(p.campaign.levels['dusty_hollow']!.cumulativeProfit).toBe(90000);
    expect(p.campaign.levels['dusty_hollow']!.bestSessionProfit).toBe(90000);
    expect(p.campaign.levels['grumpstone_ridge']!.unlocked).toBe(true);
  });

  it('never lowers progress when the incoming state is behind', () => {
    const p = createCampaignProfile();
    mergeCampaignIntoProfile(p, completedIncoming());
    mergeCampaignIntoProfile(p, createCampaignState());
    expect(p.campaign.levels['dusty_hollow']!.completed).toBe(true);
    expect(p.campaign.levels['dusty_hollow']!.cumulativeProfit).toBe(90000);
    expect(p.campaign.levels['grumpstone_ridge']!.unlocked).toBe(true);
  });

  it('is idempotent', () => {
    const p = createCampaignProfile();
    const incoming = completedIncoming();
    mergeCampaignIntoProfile(p, incoming, { dusty_hollow: 2 });
    const once = JSON.parse(JSON.stringify(p));
    mergeCampaignIntoProfile(p, incoming, { dusty_hollow: 2 });
    expect(p).toEqual(once);
  });

  it('takes the max of profit when incoming is higher and keeps profit when lower', () => {
    const p = createCampaignProfile();
    p.campaign.levels['dusty_hollow']!.cumulativeProfit = 500;
    p.campaign.levels['dusty_hollow']!.bestSessionProfit = 500;
    const incoming = createCampaignState();
    incoming.levels['dusty_hollow']!.cumulativeProfit = 200;
    incoming.levels['dusty_hollow']!.bestSessionProfit = 800;
    mergeCampaignIntoProfile(p, incoming);
    expect(p.campaign.levels['dusty_hollow']!.cumulativeProfit).toBe(500);
    expect(p.campaign.levels['dusty_hollow']!.bestSessionProfit).toBe(800);
  });

  it('ORs campaignComplete', () => {
    const p = createCampaignProfile();
    const incoming = createCampaignState();
    incoming.campaignComplete = true;
    mergeCampaignIntoProfile(p, incoming);
    expect(p.campaign.campaignComplete).toBe(true);
    mergeCampaignIntoProfile(p, createCampaignState());
    expect(p.campaign.campaignComplete).toBe(true);
  });

  it('ignores unknown level ids', () => {
    const p = createCampaignProfile();
    const incoming = createCampaignState();
    incoming.levels['no_such_level'] = {
      levelId: 'no_such_level', unlocked: true, completed: true, cumulativeProfit: 1, bestSessionProfit: 1,
    };
    mergeCampaignIntoProfile(p, incoming, { no_such_level: 3 });
    expect(p.campaign.levels['no_such_level']).toBeUndefined();
    expect(p.bestStars['no_such_level']).toBeUndefined();
  });

  it('never touches activeLevelId', () => {
    const p = createCampaignProfile();
    const incoming = completedIncoming();
    incoming.activeLevelId = 'dusty_hollow';
    mergeCampaignIntoProfile(p, incoming);
    expect(p.campaign.activeLevelId).toBeNull();
  });

  it('merges stars by max and ignores out-of-range or non-finite values', () => {
    const p = createCampaignProfile();
    mergeCampaignIntoProfile(p, createCampaignState(), { dusty_hollow: 2 });
    mergeCampaignIntoProfile(p, createCampaignState(), { dusty_hollow: 1 });
    expect(p.bestStars['dusty_hollow']).toBe(2);
    mergeCampaignIntoProfile(p, createCampaignState(), { dusty_hollow: Number.NaN, tutorial_pit: 99 });
    expect(p.bestStars['dusty_hollow']).toBe(2);
    expect([undefined, 0, 3]).toContain(p.bestStars['tutorial_pit']);
  });

  it('does not alias the incoming campaign objects', () => {
    const p = createCampaignProfile();
    const incoming = completedIncoming();
    mergeCampaignIntoProfile(p, incoming);
    incoming.levels['dusty_hollow']!.cumulativeProfit = 1;
    expect(p.campaign.levels['dusty_hollow']!.cumulativeProfit).toBe(90000);
  });
});

describe('recordBestStars', () => {
  it('raises stars', () => {
    const p = createCampaignProfile();
    recordBestStars(p, 'dusty_hollow', 2);
    expect(p.bestStars['dusty_hollow']).toBe(2);
    recordBestStars(p, 'dusty_hollow', 3);
    expect(p.bestStars['dusty_hollow']).toBe(3);
  });

  it('never lowers stars', () => {
    const p = createCampaignProfile();
    recordBestStars(p, 'dusty_hollow', 3);
    recordBestStars(p, 'dusty_hollow', 1);
    expect(p.bestStars['dusty_hollow']).toBe(3);
  });

  it('ignores unknown levels and invalid values', () => {
    const p = createCampaignProfile();
    recordBestStars(p, 'no_such_level', 3);
    recordBestStars(p, 'dusty_hollow', Number.NaN);
    recordBestStars(p, 'dusty_hollow', -2);
    expect(p.bestStars['no_such_level']).toBeUndefined();
    expect(p.bestStars['dusty_hollow'] ?? 0).toBe(0);
  });
});

describe('resetCampaignProfile', () => {
  it('resets in place, keeping object identity of profile and campaign', () => {
    const p = createCampaignProfile();
    const campaignRef = p.campaign;
    mergeCampaignIntoProfile(p, completedIncoming(), { dusty_hollow: 3 });
    resetCampaignProfile(p);
    expect(p.campaign).toBe(campaignRef);
    expect(p.campaign).toEqual(createCampaignState());
    expect(p.bestStars).toEqual({});
    expect(p.campaign.levels['grumpstone_ridge']!.unlocked).toBe(false);
  });
});

describe('parseCampaignProfile', () => {
  it.each([null, undefined, 42, 'x', [], {}, { version: 2 }, { version: 1 }, { version: 1, campaign: 5 }])(
    'falls back to a fresh profile for %j',
    (raw) => {
      expect(parseCampaignProfile(raw)).toEqual(createCampaignProfile());
    },
  );

  it('round-trips a valid profile through JSON', () => {
    const p = createCampaignProfile();
    mergeCampaignIntoProfile(p, completedIncoming(), { dusty_hollow: 2 });
    expect(parseCampaignProfile(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('drops unknown level ids and keeps every known level present', () => {
    const p = createCampaignProfile();
    const raw = JSON.parse(JSON.stringify(p));
    raw.campaign.levels['ghost'] = { levelId: 'ghost', unlocked: true, completed: true, cumulativeProfit: 1, bestSessionProfit: 1 };
    raw.bestStars['ghost'] = 3;
    const parsed = parseCampaignProfile(raw);
    expect(parsed.campaign.levels['ghost']).toBeUndefined();
    expect(parsed.bestStars['ghost']).toBeUndefined();
    expect(Object.keys(parsed.campaign.levels)).toEqual(Object.keys(createCampaignState().levels));
  });

  it('sanitises bad field types and values', () => {
    const raw = JSON.parse(JSON.stringify(createCampaignProfile()));
    raw.campaign.levels['dusty_hollow'] = {
      levelId: 'dusty_hollow', unlocked: 'yes', completed: 1, cumulativeProfit: 'lots', bestSessionProfit: -5,
    };
    raw.bestStars = { dusty_hollow: 7, tutorial_pit: 'x' };
    const parsed = parseCampaignProfile(raw);
    const e = parsed.campaign.levels['dusty_hollow']!;
    expect(typeof e.unlocked).toBe('boolean');
    expect(typeof e.completed).toBe('boolean');
    expect(Number.isFinite(e.cumulativeProfit)).toBe(true);
    expect(e.cumulativeProfit).toBeGreaterThanOrEqual(0);
    expect(e.bestSessionProfit).toBeGreaterThanOrEqual(0);
    for (const s of Object.values(parsed.bestStars)) expect([0, 1, 2, 3]).toContain(s);
  });

  it('never restores an active level', () => {
    const raw = JSON.parse(JSON.stringify(createCampaignProfile()));
    raw.campaign.activeLevelId = 'dusty_hollow';
    expect(parseCampaignProfile(raw).campaign.activeLevelId).toBeNull();
  });

  it('a completed level implies the next level is unlocked', () => {
    const raw = JSON.parse(JSON.stringify(createCampaignProfile()));
    raw.campaign.levels['dusty_hollow'].completed = true;
    raw.campaign.levels['grumpstone_ridge'].unlocked = false;
    expect(parseCampaignProfile(raw).campaign.levels['grumpstone_ridge']!.unlocked).toBe(true);
  });
});

describe('hasCampaignProgress', () => {
  it('is false for a fresh profile', () => {
    expect(hasCampaignProgress(createCampaignProfile())).toBe(false);
  });

  it('is true once a level beyond the initial state is unlocked', () => {
    const p = createCampaignProfile();
    p.campaign.levels['grumpstone_ridge']!.unlocked = true;
    expect(hasCampaignProgress(p)).toBe(true);
  });

  it('is true once a level is completed', () => {
    const p = createCampaignProfile();
    p.campaign.levels['dusty_hollow']!.completed = true;
    expect(hasCampaignProgress(p)).toBe(true);
  });

  it('is true once profit is earned', () => {
    const p = createCampaignProfile();
    p.campaign.levels['dusty_hollow']!.cumulativeProfit = 10;
    expect(hasCampaignProgress(p)).toBe(true);
  });

  it('is true once stars are held', () => {
    const p = createCampaignProfile();
    recordBestStars(p, 'dusty_hollow', 1);
    expect(hasCampaignProgress(p)).toBe(true);
  });

  it('is false again after reset', () => {
    const p = createCampaignProfile();
    mergeCampaignIntoProfile(p, completedIncoming(), { dusty_hollow: 1 });
    resetCampaignProfile(p);
    expect(hasCampaignProgress(p)).toBe(false);
  });
});
