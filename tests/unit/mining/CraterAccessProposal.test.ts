// BlastSimulator2026 — proposeAccessRamp: the game proposes a ramp into a stranded crater, the player decides and pays (#2144).
// Fixtures: the menu-default sandbox after the standard opening shot, and a flat-site shallow pit (tests/helpers).

import { describe, it, expect, beforeAll } from 'vitest';
import { proposeAccessRamp, type AccessRampProposal } from '../../../src/core/mining/CraterAccessProposal.js';
import { validateRampOrder, computeRampCost, rampWidthOf } from '../../../src/core/mining/Ramp.js';
import { rampLegsOf, rampTotalLength } from '../../../src/core/mining/RampPath.js';
import type { PlannedRamp } from '../../../src/core/state/GameState.js';
import { openingCraterGame, menuDefaultSandbox, outOfReachCount, type OpeningGame } from '../../helpers/openingCrater.js';
import { makeCraterSite, dropRubble, type Pit } from '../../helpers/craterAccessFixture.js';
import { tickUntilFresh } from '../../helpers/blastFixtures.js';

type OkProposal = Extract<AccessRampProposal, { ok: true }>;

function expectOk(p: AccessRampProposal | null): OkProposal {
  expect(p).not.toBeNull();
  expect(p!.ok).toBe(true);
  return p as OkProposal;
}

const propose = (g: Pick<OpeningGame, 'state' | 'ctx'>) => proposeAccessRamp(g.state, g.ctx.grid!);

describe('proposeAccessRamp on the opening crater of the menu-default sandbox', () => {
  let game: OpeningGame;
  beforeAll(() => { game = openingCraterGame(); }, 300_000);

  it('proposes a ramp whose def the console would accept', () => {
    const proposal = expectOk(propose(game));
    expect(validateRampOrder(proposal.def, game.state.cash).success).toBe(true);
  });

  it('prices the ramp at its length and width, and reports its total length in metres', () => {
    const proposal = expectOk(propose(game));
    const length = rampTotalLength(rampLegsOf(proposal.def));
    expect(proposal.length).toBe(length);
    expect(proposal.length).toBeGreaterThan(0);
    expect(proposal.cost).toBeGreaterThan(0);
    expect(proposal.cost).toBe(computeRampCost(length, rampWidthOf(proposal.def)));
  });

  it('counts the stranded orders the ramp is for, no more than are out of reach', () => {
    const proposal = expectOk(propose(game));
    expect(proposal.orderCount).toBeGreaterThan(0);
    expect(proposal.orderCount).toBeLessThanOrEqual(outOfReachCount(game.state));
  });

  it('carries the build_ramp console order for the proposed ramp', () => {
    const proposal = expectOk(propose(game));
    expect(proposal.line.startsWith('build_ramp')).toBe(true);
  });

  it('only reads: no ramp planned, no cash spent, no order added, and asking twice gives the same proposal', () => {
    const { state } = game;
    const cash = state.cash;
    const orders = state.pendingActions.length;
    const first = propose(game);
    const second = propose(game);
    expect(second).toEqual(first);
    expect(state.plannedRamps).toEqual([]);
    expect(state.builtRamps).toEqual([]);
    expect(state.cash).toBe(cash);
    expect(state.pendingActions).toHaveLength(orders);
  });

  it('is ordered by its own line at exactly the quoted cost', () => {
    const g = openingCraterGame();
    const proposal = expectOk(propose(g));
    const cash = g.state.cash;
    expect(g.run(proposal.line)).toMatchObject({ success: true });
    expect(cash - g.state.cash).toBe(proposal.cost);
    expect(g.state.plannedRamps).toHaveLength(1);
  }, 300_000);
});

describe('proposeAccessRamp: nothing to propose', () => {
  it('returns null on a fresh site where no debris order is out of reach', () => {
    const g = menuDefaultSandbox();
    expect(outOfReachCount(g.state)).toBe(0);
    expect(propose(g)).toBeNull();
  });

  it('returns null while an access ramp is being dug', () => {
    const g = openingCraterGame();
    const proposal = expectOk(propose(g));
    expect(g.run(proposal.line)).toMatchObject({ success: true });
    expect(g.state.plannedRamps.length).toBeGreaterThan(0);
    expect(propose(g)).toBeNull();
  }, 300_000);

  it('does not return null for a repair or a widening in progress: only an access ramp holds the offer back', () => {
    const g = openingCraterGame();
    const base = g.state.plannedRamps;
    const stub = (id: number, extra: Partial<PlannedRamp>): PlannedRamp => ({
      id, def: { originX: 2, originZ: 2, direction: 'south', length: 5, targetDepth: 1 },
      footprint: { minX: 2, maxX: 4, minZ: 2, maxZ: 7 }, segments: [], ...extra,
    });
    base.push(stub(901, { repairOf: 77 }));
    expect(propose(g)).not.toBeNull();
    base.length = 0;
    base.push(stub(902, { widenOf: 78 }));
    expect(propose(g)).not.toBeNull();
  }, 300_000);
});

describe('proposeAccessRamp: stranded debris with no ramp to plan', () => {
  it('answers ok:false with a translatable reason key when the stranded floor is too shallow for a ramp', () => {
    const pit: Pit = { x0: 40, z0: 40, size: 12, drop: 1 };
    const site = makeCraterSite([pit]);
    dropRubble(site, pit, 8);
    tickUntilFresh(site.run, site.state, () => false, 2);
    expect(outOfReachCount(site.state)).toBeGreaterThan(0);
    const proposal = proposeAccessRamp(site.state, site.ctx.grid!);
    expect(proposal).not.toBeNull();
    expect(proposal!.ok).toBe(false);
    const reasonKey = (proposal as { reasonKey: string }).reasonKey;
    expect(reasonKey).toMatch(/^mining\.crater_access\./);
    expect(site.state.plannedRamps).toEqual([]);
  });

  it('proposes an ok ramp for a deep pit on the same site, so the shallow refusal is about the floor', () => {
    const pit: Pit = { x0: 40, z0: 40, size: 12, drop: 8 };
    const site = makeCraterSite([pit]);
    dropRubble(site, pit, 8);
    tickUntilFresh(site.run, site.state, () => false, 2);
    const proposal = expectOk(proposeAccessRamp(site.state, site.ctx.grid!));
    expect(validateRampOrder(proposal.def, site.state.cash).success).toBe(true);
  });
});
