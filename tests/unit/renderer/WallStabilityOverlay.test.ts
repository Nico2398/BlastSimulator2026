// BlastSimulator2026 — wall overlay tint thresholds and render gating (#1943)
import { describe, it, expect } from 'vitest';
import { wallFaceTint } from '../../../src/renderer/WallStabilityOverlay.js';
import { buildWallOverlayFaces } from '../../../src/renderer/GameRendererSync.js';
import { buildWallGrid, standardShot } from '../../helpers/wallWarningFixture.js';
import { WALL_WARN_RATIO } from '../../../src/core/config/balance.js';

describe('wallFaceTint', () => {
  it('warns from 80% of the safe height', () => {
    expect(WALL_WARN_RATIO).toBe(0.8);
  });

  it('is null under 80% of the safe height', () => {
    expect(wallFaceTint(0, 12)).toBeNull();
    expect(wallFaceTint(9, 12)).toBeNull(); // 75%
    expect(wallFaceTint(9.59, 12)).toBeNull();
  });

  it('is amber from exactly 80% up to (not including) the safe height', () => {
    expect(wallFaceTint(9.6, 12)).toBe('amber');
    expect(wallFaceTint(8, 10)).toBe('amber'); // exactly 0.8
    expect(wallFaceTint(11, 12)).toBe('amber');
    expect(wallFaceTint(11.99, 12)).toBe('amber');
  });

  it('is red at exactly the safe height and above', () => {
    expect(wallFaceTint(12, 12)).toBe('red');
    expect(wallFaceTint(13, 12)).toBe('red');
    expect(wallFaceTint(40, 12)).toBe('red');
  });

  it('scales with the rock: 20 m is red for tier 1 (12 m) and null for tier 5 (30 m)', () => {
    expect(wallFaceTint(20, 12)).toBe('red');
    expect(wallFaceTint(20, 30)).toBeNull();
    expect(wallFaceTint(24, 30)).toBe('amber');
  });
});

describe('buildWallOverlayFaces', () => {
  it('is empty on a non-progression site even when the plan would leave a tall face', () => {
    const shot = standardShot('krackle', 8, false);
    expect(shot.state.grade).toBeUndefined();
    expect(buildWallOverlayFaces(shot.state, buildWallGrid({ plateauTop: 25 }))).toEqual([]);
  });

  it('is empty without a grid', () => {
    expect(buildWallOverlayFaces(standardShot().state, null)).toEqual([]);
  });

  it('is empty when no plan is armed', () => {
    const { state } = standardShot();
    state.drillHoles.length = 0;
    expect(buildWallOverlayFaces(state, buildWallGrid({ plateauTop: 25 }))).toEqual([]);
  });

  it('lists the predicted faces on a progression site', () => {
    const faces = buildWallOverlayFaces(standardShot().state, buildWallGrid({ plateauTop: 25 }));
    expect(faces.length).toBeGreaterThan(0);
    const f = faces.find(face => face.crest.x === 13 && face.crest.z === 20)!;
    expect(f.heightM).toBe(13);
    expect(f.safeM).toBe(12);
  });

  it('is empty when the plan leaves only low faces', () => {
    expect(buildWallOverlayFaces(standardShot().state, buildWallGrid({ plateauTop: 21 }))).toEqual([]);
  });
});
