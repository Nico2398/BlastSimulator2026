// loadingSiteInfo — briefing row builders for the loading screen (#1321)

import { describe, it, expect } from 'vitest';
import { buildLoadingSiteInfo, buildSandboxLoadingSiteInfo } from '../../../src/ui/loadingSiteInfo.js';
import { getAllLevels } from '../../../src/core/campaign/Level.js';
import { SANDBOX_DEFAULTS } from '../../../src/core/campaign/Sandbox.js';

describe('loadingSiteInfo briefing', () => {
  it('sandbox briefing has cash and explosives rows but no target row', () => {
    const rows = buildSandboxLoadingSiteInfo(SANDBOX_DEFAULTS).briefing ?? [];
    expect(rows.map(r => r.labelKey)).toEqual(['loading.brief.starting_cash', 'loading.brief.explosives']);
  });

  it('campaign briefing still includes the target row', () => {
    const level = getAllLevels()[0]!;
    const keys = (buildLoadingSiteInfo(level).briefing ?? []).map(r => r.labelKey);
    expect(keys).toEqual(['loading.brief.starting_cash', 'loading.brief.explosives', 'loading.brief.target']);
  });
});
