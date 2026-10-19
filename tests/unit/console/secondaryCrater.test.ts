import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeBlastSteps = vi.fn();
const resolveSecondaryBlasts = vi.fn();
const emitFootprintOccupancyChanged = vi.fn();
const recordBuildingDestruction = vi.fn();
const destroyEntitiesOnColumns = vi.fn(() => []);

vi.mock('../../../src/core/mining/BlastExecution.js', () => ({
  executeBlastSteps: (...args: unknown[]) => executeBlastSteps(...args),
}));
vi.mock('../../../src/core/entities/SecondaryBlast.js', () => ({
  resolveSecondaryBlasts: (...args: unknown[]) => resolveSecondaryBlasts(...args),
}));
vi.mock('../../../src/core/campaign/Level.js', () => ({ resolveMarketId: () => 'market' }));
vi.mock('../../../src/core/economy/Logistics.js', () => ({
  addBlastFragments: vi.fn(),
  reserveFragmentIds: vi.fn(),
}));
vi.mock('../../../src/core/entities/Building.js', () => ({
  getBuildingDef: () => ({}),
  getDefSize: () => ({ sizeX: 2, sizeZ: 3 }),
}));
vi.mock('../../../src/core/scores/ScoreManager.js', () => ({
  recordBuildingDestruction: (...args: unknown[]) => recordBuildingDestruction(...args),
}));
vi.mock('../../../src/console/commands/buildingHelpers.js', () => ({
  emitFootprintOccupancyChanged: (...args: unknown[]) => emitFootprintOccupancyChanged(...args),
}));
vi.mock('../../../src/console/commands/mining/shared.js', () => ({
  destroyEntitiesOnColumns: (...args: unknown[]) => destroyEntitiesOnColumns(...(args as [])),
}));

import { carveSecondaryCraters } from '../../../src/console/commands/mining/secondaryCrater.js';
import { SECONDARY_BLAST_CRATER_MAX_PASSES } from '../../../src/core/config/balance.js';

function outcome(buildingId: number, holes = 1): any {
  return {
    event: { buildingId, x: 0, z: 0, explosivesKg: 10 * buildingId, stock: {} },
    craterPlan: { holes: new Array(holes).fill({}) },
  };
}

function blastResult(over: Record<string, unknown> = {}): any {
  return {
    fragments: [{ position: { x: 1, y: 2, z: 3 } }],
    flights: [],
    destroyedBuildings: [],
    clearedColumns: [],
    secondaryBlastEvents: [],
    clearedVoxels: 5,
    fragmentCount: 1,
    ...over,
  };
}

function makeCtx(): any {
  return {
    state: {
      buildings: { buildings: [{ id: 7, type: 'explosive_warehouse', tier: 1, x: 4, z: 6 }] },
      logistics: { nextFragmentId: 0 },
      scores: {},
      navGrid: {},
      vehicles: [], employees: [], damage: {}, tickCount: 0,
    },
    grid: {},
    emitter: {},
  };
}

function run(ctx: any, outcomes: any[]) {
  const gen = carveSecondaryCraters(ctx, outcomes, [], new Set());
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

describe('carveSecondaryCraters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeBlastSteps.mockImplementation(function* () { return blastResult(); });
    resolveSecondaryBlasts.mockReturnValue([]);
  });

  it('returns no reports without state or grid', () => {
    const noState = makeCtx(); noState.state = undefined;
    const noGrid = makeCtx(); noGrid.grid = undefined;
    expect(run(noState, [outcome(1)])).toEqual([]);
    expect(run(noGrid, [outcome(1)])).toEqual([]);
    expect(executeBlastSteps).not.toHaveBeenCalled();
  });

  it('reports one crater per outcome', () => {
    const reports = run(makeCtx(), [outcome(1)]);
    expect(reports).toEqual([{ warehouseId: 1, explosivesKg: 10, craterVoxels: 5, craterFragments: 1 }]);
  });

  it('skips outcomes whose crater plan has no holes', () => {
    expect(run(makeCtx(), [outcome(1, 0)])).toEqual([]);
    expect(executeBlastSteps).not.toHaveBeenCalled();
  });

  it('skips outcomes the blast pipeline does not resolve', () => {
    executeBlastSteps.mockImplementation(function* () { return null; });
    expect(run(makeCtx(), [outcome(1)])).toEqual([]);
  });

  it('carves a warehouse once when listed twice', () => {
    run(makeCtx(), [outcome(1), outcome(1)]);
    expect(executeBlastSteps).toHaveBeenCalledTimes(1);
  });

  it('emits occupancy for destroyed buildings with a known footprint only', () => {
    executeBlastSteps.mockImplementation(function* () {
      return blastResult({
        destroyedBuildings: [
          { buildingId: 7, type: 'explosive_warehouse' },
          { buildingId: 99, type: 'tent' },
        ],
      });
    });
    run(makeCtx(), [outcome(1)]);
    expect(recordBuildingDestruction).toHaveBeenCalledTimes(2);
    expect(emitFootprintOccupancyChanged).toHaveBeenCalledTimes(1);
    expect(emitFootprintOccupancyChanged).toHaveBeenCalledWith(expect.anything(), 4, 6, 2, 3);
  });

  it('stops chaining when every new event was already visited', () => {
    executeBlastSteps.mockImplementation(function* () {
      return blastResult({ secondaryBlastEvents: [{ buildingId: 1 }] });
    });
    run(makeCtx(), [outcome(1)]);
    expect(resolveSecondaryBlasts).not.toHaveBeenCalled();
    expect(executeBlastSteps).toHaveBeenCalledTimes(1);
  });

  it('carves chained warehouses and appends their outcomes', () => {
    let next = 2;
    executeBlastSteps.mockImplementation(function* () {
      return blastResult({ secondaryBlastEvents: next <= 3 ? [{ buildingId: next++ }] : [] });
    });
    resolveSecondaryBlasts.mockImplementation((events: any[]) => events.map(e => outcome(e.buildingId)));
    const outcomes = [outcome(1)];
    const reports = run(makeCtx(), outcomes);
    expect(reports.map(r => r.warehouseId)).toEqual([1, 2, 3]);
    expect(outcomes.map(o => o.event.buildingId)).toEqual([1, 2, 3]);
  });

  it('breaks at the pass cap without resolving blasts it cannot carve', () => {
    let next = 2;
    executeBlastSteps.mockImplementation(function* () {
      return blastResult({ secondaryBlastEvents: [{ buildingId: next++ }] });
    });
    resolveSecondaryBlasts.mockImplementation((events: any[]) => events.map(e => outcome(e.buildingId)));
    const reports = run(makeCtx(), [outcome(1)]);
    expect(reports).toHaveLength(SECONDARY_BLAST_CRATER_MAX_PASSES);
    expect(resolveSecondaryBlasts).toHaveBeenCalledTimes(SECONDARY_BLAST_CRATER_MAX_PASSES - 1);
  });
});
