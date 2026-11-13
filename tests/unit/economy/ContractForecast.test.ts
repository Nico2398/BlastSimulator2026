// Contract outlook (#2243): per material, stock + transit + gathering against what the active contracts still need.
import { describe, it, expect } from 'vitest';
import type { Contract } from '../../../src/core/economy/Contract.js';
import {
  contractHoursLeft, forecastContracts, forecastFromState, offerOutlook, outlookFor, worseOutlook, type ForecastInputs,
} from '../../../src/core/economy/ContractForecast.js';
import { RUBBLE_MATERIAL_ID } from '../../../src/core/economy/OreCollectionLog.js';
import { CONTRACT_OUTLOOK_MISS_RATIO, CONTRACT_OUTLOOK_SAFE_RATIO } from '../../../src/core/config/balance.js';
import { createGame } from '../../../src/core/state/GameState.js';

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 1, type: 'ore_sale', materialId: 'dirtite', description: '', quantityKg: 100, deliveredKg: 0,
    pricePerKg: 3, deadlineTicks: 50, acceptedAtTick: 0, penaltyAmount: 100, earlyBonus: 10,
    completed: false, expired: false, ...overrides,
  };
}

function inputs(overrides: Partial<ForecastInputs> = {}): ForecastInputs {
  return { active: [], tick: 0, stockKg: {}, inTransitKg: {}, onGroundKg: {}, rateKgPerHour: {}, ...overrides };
}

describe('outlookFor', () => {
  it('is covered when what is in hand meets the demand', () => {
    expect(outlookFor(100, 100, 100)).toBe('covered');
  });
  it('is on track at the safe ratio, at risk just below it, will miss below the miss ratio', () => {
    expect(outlookFor(100, 0, 100 * CONTRACT_OUTLOOK_SAFE_RATIO)).toBe('on_track');
    expect(outlookFor(100, 0, 100 * CONTRACT_OUTLOOK_SAFE_RATIO - 1)).toBe('at_risk');
    expect(outlookFor(100, 0, 100 * CONTRACT_OUTLOOK_MISS_RATIO)).toBe('at_risk');
    expect(outlookFor(100, 0, 100 * CONTRACT_OUTLOOK_MISS_RATIO - 1)).toBe('will_miss');
  });
  it('orders outlooks worst-wins', () => {
    expect(worseOutlook('covered', 'at_risk')).toBe('at_risk');
    expect(worseOutlook('will_miss', 'on_track')).toBe('will_miss');
  });
});

describe('forecastContracts', () => {
  it('stock alone covers demand', () => {
    const [line] = forecastContracts(inputs({ active: [contract({ quantityKg: 80 })], stockKg: { dirtite: 120 } }));
    expect(line!.outlook).toBe('covered');
    expect(line!.demandKg).toBe(80);
    expect(line!.neededRateKgPerHour).toBe(0);
    expect(line!.spareKg).toBe(40);
  });

  it('stock plus the gathering rate covers demand by the deadline', () => {
    // 40 kg in hand, 3 kg/h over 50 h = 190 kg against 120 due: on track.
    const [line] = forecastContracts(inputs({
      active: [contract({ quantityKg: 120 })], stockKg: { dirtite: 40 }, rateKgPerHour: { dirtite: 3 },
    }));
    expect(line!.outlook).toBe('on_track');
    expect(line!.contracts[0]!.projectedKg).toBe(190);
    expect(line!.neededRateKgPerHour).toBeCloseTo(80 / 50);
  });

  it('the contract misses when nothing comes in', () => {
    const [line] = forecastContracts(inputs({ active: [contract({ quantityKg: 300 })], stockKg: { dirtite: 50 } }));
    expect(line!.outlook).toBe('will_miss');
    expect(line!.spareKg).toBe(-250);
  });

  it('two contracts on one material share the stock instead of each counting it', () => {
    // 125 kg in hand. #1 (due in 10 h) takes 80; #2 (due in 40 h) only sees the 45 left.
    const lines = forecastContracts(inputs({
      active: [contract({ id: 2, quantityKg: 80, deadlineTicks: 40 }), contract({ id: 1, quantityKg: 80, deadlineTicks: 10 })],
      stockKg: { dirtite: 125 },
    }));
    expect(lines).toHaveLength(1);
    const [first, second] = lines[0]!.contracts;
    expect(first!.contractId).toBe(1);
    expect(first!.outlook).toBe('covered');
    expect(second!.demandByDeadlineKg).toBe(160);
    expect(second!.outlook).toBe('at_risk'); // 125 of 160 is above the miss ratio, under the safe one
    expect(lines[0]!.stockKg).toBe(125); // counted once, not once per contract
    expect(lines[0]!.demandKg).toBe(160);
    expect(lines[0]!.outlook).toBe('at_risk');
  });

  it('counts ore already on a truck, reports ore on the ground without counting it', () => {
    const [line] = forecastContracts(inputs({
      active: [contract({ quantityKg: 100 })], stockKg: { dirtite: 30 }, inTransitKg: { dirtite: 70 }, onGroundKg: { dirtite: 500 },
    }));
    expect(line!.outlook).toBe('covered');
    expect(line!.onGroundKg).toBe(500);
    expect(line!.spareKg).toBe(0);
  });

  it('gives one line per material, worst first, and rubble clearances their own line', () => {
    const lines = forecastContracts(inputs({
      active: [
        contract({ id: 1, materialId: 'dirtite', quantityKg: 10 }),
        contract({ id: 2, materialId: 'rustite', quantityKg: 500 }),
        contract({ id: 3, type: 'rubble_disposal', materialId: '', quantityKg: 50 }),
      ],
      stockKg: { dirtite: 10, [RUBBLE_MATERIAL_ID]: 0 },
    }));
    expect(lines.map(l => l.materialId)).toEqual(['', 'rustite', 'dirtite']);
    expect(lines[0]!.outlook).toBe('will_miss');
    expect(lines[2]!.outlook).toBe('covered');
  });

  it('skips contracts that are completed, expired or fully delivered', () => {
    const lines = forecastContracts(inputs({ active: [
      contract({ id: 1, completed: true }), contract({ id: 2, expired: true }), contract({ id: 3, deliveredKg: 100 }),
    ] }));
    expect(lines).toEqual([]);
  });

  it('a deadline this very hour needs the whole gap within the hour, never an infinite pace', () => {
    const [line] = forecastContracts(inputs({ tick: 50, active: [contract({ quantityKg: 30 })] }));
    expect(contractHoursLeft(contract(), 50)).toBe(0);
    expect(Number.isFinite(line!.neededRateKgPerHour)).toBe(true);
    expect(line!.neededRateKgPerHour).toBe(30);
  });
});

describe('offerOutlook', () => {
  it('weighs an offer on top of the running contracts due before its deadline', () => {
    const running = contract({ id: 1, quantityKg: 100, deadlineTicks: 20 });
    const offer = contract({ id: 9, quantityKg: 100, deadlineTicks: 40, acceptedAtTick: 0 });
    // 120 in hand + 2 kg/h × 40 h = 200 against 100 running + 100 offered = 200: within the margin, at risk.
    expect(offerOutlook(offer, inputs({ active: [running], stockKg: { dirtite: 120 }, rateKgPerHour: { dirtite: 2 } }))).toBe('at_risk');
    // Without the running contract the same pace fills it comfortably.
    expect(offerOutlook(offer, inputs({ stockKg: { dirtite: 120 }, rateKgPerHour: { dirtite: 2 } }))).toBe('covered');
  });

  it('would miss when no stock and no pace exist for its material', () => {
    expect(offerOutlook(contract({ materialId: 'blingite' }), inputs())).toBe('will_miss');
  });
});

describe('forecastFromState', () => {
  it('reads stock from collectedOre and the rate from the state log', () => {
    const state = createGame({ seed: 42 });
    state.tickCount = 30;
    state.collectedOre['dirtite'] = 50;
    state.oreCollectionLog = [{ tick: 20, kg: { dirtite: 48 } }];
    state.contracts.active = [contract({ quantityKg: 100, acceptedAtTick: 30, deadlineTicks: 40 })];
    const [line] = forecastFromState(state);
    expect(line!.stockKg).toBe(50);
    expect(line!.rateKgPerHour).toBe(2);
    expect(line!.outlook).toBe('on_track'); // 50 + 2 × 40 = 130 ≥ 100 × 1.15
  });
});
