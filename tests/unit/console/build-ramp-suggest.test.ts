// BlastSimulator2026 — Console: `build_ramp suggest [order]` shows or orders the proposed access ramp (#2144).
// The game proposes, the player decides and pays: `suggest` changes nothing, `suggest order` is exactly the manual order.

import { describe, it, expect } from 'vitest';
import { proposeAccessRamp, type AccessRampProposal } from '../../../src/core/mining/CraterAccessProposal.js';
import { rampPathOf, rampWaypoints } from '../../../src/core/mining/RampPath.js';
import { rampWidthOf } from '../../../src/core/mining/Ramp.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { openingCraterGame, menuDefaultSandbox, type OpeningGame } from '../../helpers/openingCrater.js';
import { makeCraterSite, dropRubble, type Pit } from '../../helpers/craterAccessFixture.js';
import { tickUntilFresh } from '../../helpers/blastFixtures.js';

type OkProposal = Extract<AccessRampProposal, { ok: true }>;

function okProposal(g: Pick<OpeningGame, 'state' | 'ctx'>): OkProposal {
  const p = proposeAccessRamp(g.state, g.ctx.grid!);
  expect(p).not.toBeNull();
  expect(p!.ok).toBe(true);
  return p as OkProposal;
}

/** The manual order that orders `proposal`'s def: its waypoints as a path, its depth and its width. */
function manualOrder(proposal: OkProposal): string {
  const path = rampWaypoints(rampPathOf(proposal.def)).map(w => `${w.x},${w.z}`).join(';');
  return `build_ramp path:${path} depth:${proposal.def.targetDepth} width:${rampWidthOf(proposal.def)}`;
}

describe('build_ramp suggest', () => {
  it('prints the proposed ramp length and cost', () => {
    const g = openingCraterGame();
    const proposal = okProposal(g);
    const result = g.run('build_ramp suggest');
    expect(result.success).toBe(true);
    expect(result.output).toContain(String(proposal.length));
    expect(result.output).toContain(formatMoney(proposal.cost));
  }, 300_000);

  it('changes nothing: no planned ramp, no cash spent, no order queued', () => {
    const g = openingCraterGame();
    const cash = g.state.cash;
    const orders = g.state.pendingActions.length;
    expect(g.run('build_ramp suggest')).toMatchObject({ success: true });
    expect(g.state.plannedRamps).toEqual([]);
    expect(g.state.builtRamps).toEqual([]);
    expect(g.state.cash).toBe(cash);
    expect(g.state.pendingActions).toHaveLength(orders);
  }, 300_000);

  it('still leaves the proposal on offer afterwards', () => {
    const g = openingCraterGame();
    const before = proposeAccessRamp(g.state, g.ctx.grid!);
    g.run('build_ramp suggest');
    expect(proposeAccessRamp(g.state, g.ctx.grid!)).toEqual(before);
  }, 300_000);
});

describe('build_ramp suggest order', () => {
  it('orders the proposed ramp and charges its quoted cost', () => {
    const g = openingCraterGame();
    const proposal = okProposal(g);
    const cash = g.state.cash;
    expect(g.run('build_ramp suggest order')).toMatchObject({ success: true });
    expect(g.state.plannedRamps).toHaveLength(1);
    expect(cash - g.state.cash).toBe(proposal.cost);
  }, 300_000);

  it('is exactly the manual order of the proposed def: same planned ramp, same segments, same charge', () => {
    const suggested = openingCraterGame();
    const proposal = okProposal(suggested);
    const manual = openingCraterGame();
    expect(manual.state.cash).toBe(suggested.state.cash);

    const cashS = suggested.state.cash;
    const cashM = manual.state.cash;
    expect(suggested.run('build_ramp suggest order')).toMatchObject({ success: true });
    expect(manual.run(manualOrder(proposal))).toMatchObject({ success: true });

    expect(suggested.state.plannedRamps).toEqual(manual.state.plannedRamps);
    expect(cashS - suggested.state.cash).toBe(cashM - manual.state.cash);
    expect(suggested.state.pendingActions.length).toBe(manual.state.pendingActions.length);
  }, 600_000);

  it('offers nothing more while the ordered ramp is dug: a second order is refused and charges nothing', () => {
    const g = openingCraterGame();
    expect(g.run('build_ramp suggest order')).toMatchObject({ success: true });
    const cash = g.state.cash;
    const ramps = g.state.plannedRamps.length;
    const again = g.run('build_ramp suggest order');
    expect(again.success).toBe(false);
    expect(g.state.cash).toBe(cash);
    expect(g.state.plannedRamps).toHaveLength(ramps);
  }, 300_000);
});

describe('build_ramp suggest with no proposal', () => {
  it.each(['build_ramp suggest', 'build_ramp suggest order'])('"%s" fails on a site with nothing out of reach and points to the manual ramp tool', (cmd) => {
    const g = menuDefaultSandbox();
    const cash = g.state.cash;
    const result = g.run(cmd);
    expect(result.success).toBe(false);
    expect(result.output).toContain('build_ramp');
    expect(g.state.plannedRamps).toEqual([]);
    expect(g.state.cash).toBe(cash);
  });

  it.each(['build_ramp suggest', 'build_ramp suggest order'])('"%s" fails when stranded debris has no ramp to plan, and orders nothing', (cmd) => {
    const pit: Pit = { x0: 40, z0: 40, size: 12, drop: 1 };
    const site = makeCraterSite([pit]);
    dropRubble(site, pit, 8);
    tickUntilFresh(site.run, site.state, () => false, 2);
    const cash = site.state.cash;
    const result = site.run(cmd) as { success: boolean; output: string };
    expect(result.success).toBe(false);
    expect(result.output).toContain('build_ramp');
    expect(site.state.plannedRamps).toEqual([]);
    expect(site.state.cash).toBe(cash);
  });
});

describe('the manual ramp tool is unchanged', () => {
  it('still orders a ramp from start:/end: and refuses a bad width', () => {
    const g = menuDefaultSandbox();
    const cash = g.state.cash;
    expect(g.run('build_ramp start:27,31 end:35,31 depth:2')).toMatchObject({ success: true });
    expect(g.state.plannedRamps).toHaveLength(1);
    expect(g.state.cash).toBeLessThan(cash);
    expect(g.run('build_ramp start:27,40 end:35,40 depth:2 width:4').success).toBe(false);
  });
});
