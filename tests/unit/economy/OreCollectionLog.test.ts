// Gathering rate log (#2243): what hauls credited, per material, over the last day.
import { describe, it, expect } from 'vitest';
import {
  collectionRateKgPerHour, recordCollection, recordStateCollection, RUBBLE_MATERIAL_ID, type OreCollectionEntry,
} from '../../../src/core/economy/OreCollectionLog.js';
import { ORE_RATE_WINDOW_TICKS } from '../../../src/core/config/balance.js';

describe('recordCollection', () => {
  it('merges credits landing on the same tick into one entry', () => {
    const log: OreCollectionEntry[] = [];
    recordCollection(log, 10, { dirtite: 40 });
    recordCollection(log, 10, { dirtite: 10, rustite: 5 });
    expect(log).toEqual([{ tick: 10, kg: { dirtite: 50, rustite: 5 } }]);
  });

  it('ignores zero and negative amounts, adding no empty entry', () => {
    const log: OreCollectionEntry[] = [];
    recordCollection(log, 3, { dirtite: 0, rustite: -4 });
    expect(log).toEqual([]);
  });

  it('drops entries that fell out of the window', () => {
    const log: OreCollectionEntry[] = [];
    recordCollection(log, 1, { dirtite: 10 }, 24);
    recordCollection(log, 20, { dirtite: 10 }, 24);
    recordCollection(log, 25, { dirtite: 10 }, 24);
    expect(log.map(e => e.tick)).toEqual([20, 25]);
  });
});

describe('collectionRateKgPerHour', () => {
  it('divides what the window holds by the whole window, so one early haul is a modest rate', () => {
    const log: OreCollectionEntry[] = [{ tick: 5, kg: { dirtite: 240 } }];
    expect(collectionRateKgPerHour(log, 5, 24)).toEqual({ dirtite: 10 });
  });

  it('sums every material separately, rubble included', () => {
    const log: OreCollectionEntry[] = [
      { tick: 2, kg: { dirtite: 24, [RUBBLE_MATERIAL_ID]: 48 } },
      { tick: 9, kg: { dirtite: 24 } },
    ];
    expect(collectionRateKgPerHour(log, 10, 24)).toEqual({ dirtite: 2, [RUBBLE_MATERIAL_ID]: 2 });
  });

  it('falls to zero once the hauling stops for a whole window', () => {
    const log: OreCollectionEntry[] = [{ tick: 10, kg: { dirtite: 240 } }];
    expect(collectionRateKgPerHour(log, 10 + ORE_RATE_WINDOW_TICKS, ORE_RATE_WINDOW_TICKS)).toEqual({});
  });

  it('reads an absent log (a save from before #2243) as no rate at all', () => {
    expect(collectionRateKgPerHour(undefined, 50)).toEqual({});
  });

  it('ignores entries stamped after the tick asked about', () => {
    expect(collectionRateKgPerHour([{ tick: 11, kg: { dirtite: 99 } }], 10, 24)).toEqual({});
  });
});

describe('recordStateCollection', () => {
  it('creates the log on a state that has none and stamps the state tick', () => {
    const state: { tickCount: number; oreCollectionLog?: OreCollectionEntry[] } = { tickCount: 7 };
    recordStateCollection(state, { dirtite: 12 });
    expect(state.oreCollectionLog).toEqual([{ tick: 7, kg: { dirtite: 12 } }]);
  });
});
