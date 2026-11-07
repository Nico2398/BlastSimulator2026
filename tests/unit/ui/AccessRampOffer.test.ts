// @vitest-environment jsdom
// BlastSimulator2026 — AccessRampOffer: the "Dig access ramp" card shared by the blast report and the Operations panel (#2144).
// The card only previews and forwards: one click sends the proposal's own console line, the other hands it to the manual ramp tool.

import { describe, it, expect, vi } from 'vitest';
import { AccessRampOffer } from '../../../src/ui/panels/AccessRampOffer.js';
import type { AccessRampProposal } from '../../../src/core/mining/CraterAccessProposal.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';

type OkProposal = Extract<AccessRampProposal, { ok: true }>;

const OK: OkProposal = {
  ok: true,
  def: { originX: 20, originZ: 10, direction: 'south', length: 23, targetDepth: 8 },
  cost: 34_500,
  length: 23,
  orderCount: 41,
  line: 'build_ramp path:20,10;20,33 depth:8 width:3',
};
const NO_RAMP: AccessRampProposal = { ok: false, reasonKey: 'mining.crater_access.no_start' };

function makeOffer(prefix: 'report' | 'ops', proposal: () => AccessRampProposal | null) {
  const offer = new AccessRampOffer(prefix);
  const send = vi.fn((_cmd: string): CommandResult => ({ success: true, output: 'ok' }));
  const adjust = vi.fn();
  offer.setProposalProvider(proposal);
  offer.setGameConsole(send);
  offer.setAdjustHandler(adjust);
  document.body.appendChild(offer.root);
  const state = createGame({ seed: 1, mineType: 'desert' });
  offer.refresh(state);
  const button = (name: string) => offer.root.querySelector<HTMLElement>(`[data-action="${prefix}-${name}"]`);
  return { offer, send, adjust, state, button };
}

describe('AccessRampOffer with a proposal', () => {
  it('shows a visible card with the cost and the length', () => {
    const { offer } = makeOffer('report', () => OK);
    expect(offer.root.style.display).not.toBe('none');
    const text = offer.root.textContent ?? '';
    expect(text).toContain(formatMoney(OK.cost));
    expect(text).toContain(String(OK.length));
  });

  it('has a dig button and an adjust button under its prefix', () => {
    const { button } = makeOffer('report', () => OK);
    expect(button('dig-ramp')).not.toBeNull();
    expect(button('adjust-ramp')).not.toBeNull();
  });

  it('sends the proposal line to the game console when dig is clicked, and nothing else', () => {
    const { send, adjust, button } = makeOffer('report', () => OK);
    button('dig-ramp')!.click();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(OK.line);
    expect(adjust).not.toHaveBeenCalled();
  });

  it('hands the proposal to the adjust handler when adjust is clicked, and sends nothing to the console', () => {
    const { send, adjust, button } = makeOffer('report', () => OK);
    button('adjust-ramp')!.click();
    expect(adjust).toHaveBeenCalledTimes(1);
    expect(adjust).toHaveBeenCalledWith(OK);
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing until a button is clicked: rendering and refreshing never send a command', () => {
    const { offer, send, state } = makeOffer('report', () => OK);
    offer.refresh(state);
    offer.refresh(state);
    expect(send).not.toHaveBeenCalled();
  });

  it('namespaces its buttons by prefix', () => {
    const ops = makeOffer('ops', () => OK);
    expect(ops.button('dig-ramp')).not.toBeNull();
    expect(ops.offer.root.querySelector('[data-action="report-dig-ramp"]')).toBeNull();
    const report = makeOffer('report', () => OK);
    expect(report.offer.root.querySelector('[data-action="ops-dig-ramp"]')).toBeNull();
  });

  it('still dispatches after being rebuilt by a later refresh', () => {
    const { offer, send, state, button } = makeOffer('ops', () => OK);
    offer.refresh(state);
    button('dig-ramp')!.click();
    expect(send).toHaveBeenCalledWith(OK.line);
  });
});

describe('AccessRampOffer with no ramp to plan', () => {
  it('says so, names the manual ramp tool, and offers no dig button', () => {
    const { offer, button } = makeOffer('report', () => NO_RAMP);
    expect(offer.root.style.display).not.toBe('none');
    const text = offer.root.textContent ?? '';
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(/mining\.crater_access\./);
    expect(text).toMatch(/ramp/i);
    expect(button('dig-ramp')).toBeNull();
  });

  it('sends nothing to the console', () => {
    const { send } = makeOffer('report', () => NO_RAMP);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('AccessRampOffer with nothing stranded', () => {
  it('hides its root when the proposal is null', () => {
    const { offer, button } = makeOffer('ops', () => null);
    expect(offer.root.style.display).toBe('none');
    expect(button('dig-ramp')).toBeNull();
  });

  it('follows the proposal on every refresh: appears when one shows up, hides when it goes', () => {
    let current: AccessRampProposal | null = null;
    const { offer, state, button } = makeOffer('ops', () => current);
    expect(offer.root.style.display).toBe('none');
    current = OK;
    offer.refresh(state);
    expect(offer.root.style.display).not.toBe('none');
    expect(button('dig-ramp')).not.toBeNull();
    current = null;
    offer.refresh(state);
    expect(offer.root.style.display).toBe('none');
  });

  it('reads the proposal from the provider afresh: a changed cost shows on the next refresh', () => {
    let current: AccessRampProposal | null = OK;
    const { offer, state } = makeOffer('report', () => current);
    current = { ...OK, cost: 91_250, length: 31 };
    offer.refresh(state);
    const text = offer.root.textContent ?? '';
    expect(text).toContain(formatMoney(91_250));
    expect(text).not.toContain(formatMoney(OK.cost));
  });
});
