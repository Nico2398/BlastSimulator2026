import { describe, it, expect } from 'vitest';
import { SOUND_CATALOG } from '../../../../src/audio/SoundCatalog.js';
import { ALL_WEATHER_STATES } from '../../../../src/core/weather/WeatherCycle.js';
import {
  AMBIENCE_CONFIG, BLAST_AUDIO_CONFIG, DIFF_CONFIG, DIRECTOR_CONFIG, EVENT_CUES, HAUL_BUDGET_CONFIG, LIFE_CONFIG, SIREN_CONFIG, WORK_CONFIG,
} from '../../../../src/core/config/audio/game.js';

describe('game audio tuning data', () => {
  it('names only catalog one-shots in the life table', () => {
    for (const id of Object.keys(LIFE_CONFIG.sounds)) {
      const def = (SOUND_CATALOG as Record<string, { loop?: true }>)[id];
      expect(def, id).toBeDefined();
      expect(def?.loop, id).toBeUndefined();
    }
  });

  it('describes every weather the game can produce, with levels in range', () => {
    expect(Object.keys(AMBIENCE_CONFIG.weather).sort()).toEqual([...ALL_WEATHER_STATES].sort());
    for (const levels of Object.values(AMBIENCE_CONFIG.weather)) {
      for (const level of Object.values(levels)) {
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
      }
    }
  });

  it('cross-fades light and heavy rain, never layering them', () => {
    for (const levels of Object.values(AMBIENCE_CONFIG.weather)) expect(levels.rainLight === 0 || levels.rainHeavy === 0).toBe(true);
  });

  it('keeps every range ordered', () => {
    expect(WORK_CONFIG.burstMinS).toBeLessThan(WORK_CONFIG.burstMaxS);
    expect(LIFE_CONFIG.minIntervalS).toBeLessThan(LIFE_CONFIG.maxIntervalS);
    expect(LIFE_CONFIG.minDistanceM).toBeLessThan(LIFE_CONFIG.maxDistanceM);
    expect(LIFE_CONFIG.minDb).toBeLessThan(LIFE_CONFIG.maxDb);
    expect(AMBIENCE_CONFIG.thunder.minDelayS).toBeLessThan(AMBIENCE_CONFIG.thunder.maxDelayS);
    expect(AMBIENCE_CONFIG.thunder.rumbleMinIntervalS).toBeLessThan(AMBIENCE_CONFIG.thunder.rumbleMaxIntervalS);
    expect(BLAST_AUDIO_CONFIG.tailMinDelayS).toBeLessThan(BLAST_AUDIO_CONFIG.tailMaxDelayS);
    expect(BLAST_AUDIO_CONFIG.rain.minBins).toBeLessThanOrEqual(BLAST_AUDIO_CONFIG.rain.maxBins);
    expect(SIREN_CONFIG.fastIntervalS).toBeLessThan(SIREN_CONFIG.slowIntervalS);
    expect(DIFF_CONFIG.income.minAmount).toBeLessThan(DIFF_CONFIG.income.bigAmount);
    expect(DIFF_CONFIG.income.bigAmount).toBeLessThan(DIFF_CONFIG.income.tillAmount);
    expect(AMBIENCE_CONFIG.windViewNearM).toBeLessThan(AMBIENCE_CONFIG.windViewFarM);
  });

  it('never boosts a blast above +4 dB, as designed', () => {
    expect(BLAST_AUDIO_CONFIG.maxBoostDb).toBeLessThanOrEqual(4);
  });

  it('lets the timeline lookahead fit inside the late-skip window', () => {
    expect(BLAST_AUDIO_CONFIG.lookaheadS).toBeLessThan(BLAST_AUDIO_CONFIG.lateSkipS);
  });

  it('keeps the shared hauling budget a trickle, not a flood', () => {
    expect(HAUL_BUDGET_CONFIG.capacity).toBeLessThanOrEqual(4);
    expect(HAUL_BUDGET_CONFIG.refillPerS).toBeLessThanOrEqual(2);
    expect(EVENT_CUES.haulLoad.maxPerFlush).toBeLessThanOrEqual(HAUL_BUDGET_CONFIG.capacity);
  });

  it('allows an 8x batch of ticks in one diff', () => {
    expect(DIRECTOR_CONFIG.maxCoalescedTicks).toBeGreaterThanOrEqual(8);
  });

  it('keeps the work noise lists to real action types', () => {
    const known = ['drill_hole', 'charge_hole', 'dig_ramp_segment', 'level_ground', 'place_building', 'demolish_building', 'survey', 'fragment_debris', 'haul_debris', 'repair_vehicle', 'rest', 'general_work'];
    for (const type of [...DIFF_CONFIG.genericDoneActions, ...DIFF_CONFIG.noiseActions]) expect(known).toContain(type);
  });
});
