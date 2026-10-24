import { describe, it, expect } from 'vitest';
import { ladderHoleDepthM, type ProbeSession } from '../../../scripts/shared/probe-strategies';

const session = (activeLevelId: string | null): ProbeSession =>
  ({ engine: { ctx: { campaignProfile: { campaign: { activeLevelId } } } } }) as unknown as ProbeSession;

describe('ladderHoleDepthM (#2066)', () => {
  it('drills 9 m holes in a sandbox session', () => {
    expect(ladderHoleDepthM(session(null))).toBe(9);
  });

  it('drills 11 m holes in a campaign session', () => {
    expect(ladderHoleDepthM(session('volcanic_flats'))).toBe(11);
  });
});
