// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ContractsPanel, deliverableAmountKg } from '../../../../src/ui/panels/ContractsPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { t } from '../../../../src/core/i18n/I18n.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { Random } from '../../../../src/core/math/Random.js';
import { addFreightWarehouseToState } from '../../../helpers/freightWarehouse.js';
import type { Contract } from '../../../../src/core/economy/Contract.js';

function makeState(): GameState {
  return createGame({ seed: 1, mineType: 'desert' });
}

/** Roster a healthy manager so Negotiate is allowed (#1340). */
function withManager(state: GameState): GameState {
  hireEmployee(state.employees, 'manager', new Random(7), 0, 0, 0);
  return state;
}

function makePanel(): { panel: ContractsPanel; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new ContractsPanel(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  panel.setGameConsole(gameConsole);
  return { panel, container, gameConsole };
}

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 1, type: 'ore_sale', materialId: 'dirtite', description: 'Deliver dirtite ore',
    quantityKg: 100, deliveredKg: 0, pricePerKg: 3, deadlineTicks: 50, acceptedAtTick: 0,
    penaltyAmount: 90, earlyBonus: 45, completed: false, expired: false,
    ...overrides,
  };
}

describe('ContractsPanel', () => {
  it('is hidden until show() is called', () => {
    const { panel } = makePanel();
    expect(panel.visible).toBe(false);
  });

  it('show() + update() renders the storage strip from real logistics state', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.logistics.storedMassKg = 12400;
    state.logistics.storageCapacityKg = 20000;

    panel.show();
    panel.update(state);

    expect(panel.root.textContent).toContain('12,400');
    expect(panel.root.textContent).toContain('20,000');
  });

  it('shows empty states for active, offered, and closed when nothing exists', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());

    const text = panel.root.textContent ?? '';
    expect(text).toContain('No active contracts');
    expect(text).toContain('No contracts available');
  });

  it('renders an active card with a deliver amount capped at what is actually in storage', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 40;
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }));

    panel.show();
    panel.update(state);

    const amount = panel.root.querySelector<HTMLInputElement>('.bs-contract-amount');
    expect(amount).not.toBeNull();
    expect(amount!.value).toBe('40'); // min(remaining=100, stored=40)
  });

  it('MAX shortcut resets the deliver amount after the player edits it', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 40;
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }));
    panel.show();
    panel.update(state);

    const amount = panel.root.querySelector<HTMLInputElement>('.bs-contract-amount')!;
    amount.value = '3';
    (panel.root.querySelector('[data-action="deliver-max"]') as HTMLButtonElement).click();

    expect(amount.value).toBe('40');
  });

  it('Deliver dispatches contract deliver with the current amount field value', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 40;
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }));
    panel.show();
    panel.update(state);

    (panel.root.querySelector('.bs-contract-deliver') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract deliver 5 amount:40');
  });

  it('Deliver is disabled when nothing of the material is in storage', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }));
    panel.show();
    panel.update(state);

    expect((panel.root.querySelector('.bs-contract-deliver') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Accept dispatches contract accept for the right offered card', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    addFreightWarehouseToState(state); // ore_sale offers can only be accepted with a freight warehouse (#1372)
    state.contracts.available.push(makeContract({ id: 7 }));
    panel.show();
    panel.update(state);

    (panel.root.querySelector('.bs-contract-accept') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract accept id:7');
  });

  it('Accept on an ore_sale offer is disabled and explained while no freight warehouse exists (#1372)', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 7 }));
    panel.show();
    panel.update(state);

    const accept = panel.root.querySelector('.bs-contract-accept') as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    expect(accept.title).toBe(t('economy.contract.needs_warehouse'));
    accept.click();
    expect(gameConsole).not.toHaveBeenCalled();
  });

  // data-contract-fillable (#1048 CI fix): the DOM counterpart of
  // console-api.ts's fillableOreSaleOffered, so a click can be scoped to an
  // offer the site can complete instead of to a named ore the random offer
  // pool may not be asking for on this run.
  it('marks an offered card fillable only when storage covers its whole quantity', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 100;
    state.contracts.available.push(makeContract({ id: 7, materialId: 'dirtite', quantityKg: 100 }));
    panel.show();
    panel.update(state);

    expect(panel.root.querySelector('[data-contract-id="7"]')!
      .getAttribute('data-contract-fillable')).toBe('true');

    state.collectedOre['dirtite'] = 99;
    state.contracts.available[0]!.quantityKg = 100;
    panel.update(state);

    expect(panel.root.querySelector('[data-contract-id="7"]')!
      .getAttribute('data-contract-fillable')).toBe('false');
  });

  it('marks a rubble offer fillable from raw stored mass, which carries no ore breakdown', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.logistics.storedMassKg = 500;
    state.contracts.available.push(makeContract({ id: 8, type: 'rubble_disposal', materialId: '', quantityKg: 400 }));
    panel.show();
    panel.update(state);

    expect(panel.root.querySelector('[data-contract-id="8"]')!
      .getAttribute('data-contract-fillable')).toBe('true');
  });

  it('Negotiate and Decline dispatch their commands', () => {
    const { panel, gameConsole } = makePanel();
    const state = withManager(makeState());
    state.contracts.available.push(makeContract({ id: 9 }));
    panel.show();
    panel.update(state);

    (panel.root.querySelector('[data-action="negotiate"]') as HTMLButtonElement).click();
    (panel.root.querySelector('[data-action="decline"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract negotiate id:9');
    expect(gameConsole).toHaveBeenCalledWith('contract decline id:9');
  });

  it('shows the negotiate result inline only on the matching offered card', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 3 }), makeContract({ id: 4 }));
    state.contracts.lastNegotiation = { contractId: 3, success: true, changes: [{ field: 'price', improved: true, pct: 12 }] };
    panel.show();
    panel.update(state);

    expect(panel.root.textContent).toContain('12%');
  });

  it('renders a completed history row with a positive payout', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.completedHistory.push(makeContract({ id: 11, quantityKg: 50, deliveredKg: 50, pricePerKg: 4, completed: true, expired: false }));
    panel.show();
    panel.update(state);

    expect(panel.root.textContent).toContain('+$200');
  });

  it('renders an expired history row with the penalty amount', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.completedHistory.push(makeContract({ id: 12, penaltyAmount: 75, completed: false, expired: true }));
    panel.show();
    panel.update(state);

    expect(panel.root.textContent).toContain('-$75');
  });

  it('an active card carries a hold-toggle button that dispatches `contract hold <id>`', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.contracts.active.push(makeContract({ id: 5 }));
    panel.show();
    panel.update(state);

    const btn = panel.root.querySelector<HTMLButtonElement>('[data-contract-id="5"] [data-action="hold-toggle"]');
    expect(btn).not.toBeNull();
    btn!.click();

    expect(gameConsole).toHaveBeenCalledWith('contract hold 5');
  });

  it('a held card dispatches `contract release <id>` from the same button', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.contracts.active.push(makeContract({ id: 5, held: true }));
    panel.show();
    panel.update(state);

    panel.root.querySelector<HTMLButtonElement>('[data-contract-id="5"] [data-action="hold-toggle"]')!.click();

    expect(gameConsole).toHaveBeenCalledWith('contract release 5');
  });

  it('the active signature includes held: toggling held re-renders the button', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.contracts.active.push(makeContract({ id: 5 }));
    panel.show();
    panel.update(state);
    const before = panel.root.querySelector('[data-contract-id="5"] [data-action="hold-toggle"]')!.textContent;

    state.contracts.active[0]!.held = true;
    panel.update(state);

    const btn = panel.root.querySelector<HTMLButtonElement>('[data-contract-id="5"] [data-action="hold-toggle"]')!;
    expect(btn.textContent).not.toBe(before);
    btn.click();
    expect(gameConsole).toHaveBeenCalledWith('contract release 5');
  });

  it('each active card has its own hold-toggle', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.contracts.active.push(makeContract({ id: 5 }), makeContract({ id: 6, held: true }));
    panel.show();
    panel.update(state);

    expect(panel.root.querySelectorAll('[data-action="hold-toggle"]')).toHaveLength(2);
    panel.root.querySelector<HTMLButtonElement>('[data-contract-id="6"] [data-action="hold-toggle"]')!.click();
    expect(gameConsole).toHaveBeenCalledWith('contract release 6');
  });

  it('an expired history row shows what was paid and the reduced penalty actually charged', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.completedHistory.push(makeContract({
      id: 13, quantityKg: 100, deliveredKg: 40, pricePerKg: 10, penaltyAmount: 300,
      completed: false, expired: true, paidTotal: 400, penaltyCharged: 180,
    }));
    panel.show();
    panel.update(state);

    const text = panel.root.textContent ?? '';
    expect(text).toContain('400');
    expect(text).toContain('-$180');
    expect(text).not.toContain('-$300');
  });

  it('an expired history row with nothing delivered still shows the full penalty', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.completedHistory.push(makeContract({
      id: 14, penaltyAmount: 300, completed: false, expired: true, penaltyCharged: 300,
    }));
    panel.show();
    panel.update(state);

    expect(panel.root.textContent).toContain('-$300');
  });

  it('storage strip link navigates to Operations', () => {
    const { panel } = makePanel();
    const onNavigate = vi.fn();
    panel.setNavigateHandler(onNavigate);
    panel.show();
    panel.update(makeState());

    (panel.root.querySelector('[data-action="goto-ops"]') as HTMLButtonElement).click();

    expect(onNavigate).toHaveBeenCalledWith('ops');
  });

  it('refreshLocale() does not throw', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    expect(() => panel.refreshLocale()).not.toThrow();
  });

  it('dispose() removes the panel from the DOM', () => {
    const { panel, container } = makePanel();
    panel.dispose();
    expect(container.contains(panel.root)).toBe(false);
  });

  it('flags an offer for an ore the site cannot yield, and not one it can or rubble (#1364)', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.available.push(
      makeContract({ id: 21, materialId: 'dirtite' }),
      makeContract({ id: 22, materialId: 'sparkium' }),
      makeContract({ id: 23, type: 'rubble_disposal', materialId: '' }),
    );
    panel.show();
    panel.update(state);

    const card = (id: number) => panel.root.querySelector<HTMLElement>(`[data-contract-id="${id}"]`)!;
    const badge = t('ui.contracts.not_on_site');
    expect(card(21).textContent).not.toContain(badge);
    expect(card(21).dataset['contractOnsite']).toBe('true');
    expect(card(22).textContent).toContain(badge);
    expect(card(22).dataset['contractOnsite']).toBe('false');
    expect(card(23).textContent).not.toContain(badge);
    expect(card(23).dataset['contractOnsite']).toBe('true');
  });

  // ── #513: cards must carry data-contract-id so per-card action selectors scope correctly ──

  it('offered card carries data-contract-id matching its contract', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 7 }));
    panel.show();
    panel.update(state);

    expect(panel.root.querySelector('[data-contract-id="7"]')).not.toBeNull();
  });

  it('active card carries data-contract-id matching its contract', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 40;
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }));
    panel.show();
    panel.update(state);

    expect(panel.root.querySelector('[data-contract-id="5"]')).not.toBeNull();
  });

  describe('data-contract-fillable (#1335, derived from isFillableSaleOffer)', () => {
    function fillableOf(contracts: Contract[], setup: (s: GameState) => void): Record<string, string | undefined> {
      const { panel } = makePanel();
      const state = makeState();
      setup(state);
      state.contracts.available.push(...contracts);
      panel.show();
      panel.update(state);
      const out: Record<string, string | undefined> = {};
      for (const c of contracts) {
        out[String(c.id)] = (panel.root.querySelector(`[data-contract-id="${c.id}"]`) as HTMLElement).dataset['contractFillable'];
      }
      return out;
    }

    it('ore_sale is fillable when collected ore covers the quantity exactly', () => {
      const r = fillableOf([makeContract({ id: 1, quantityKg: 100 })], (s) => { s.collectedOre['dirtite'] = 100; });
      expect(r['1']).toBe('true');
    });

    it('ore_sale is not fillable one kg short', () => {
      const r = fillableOf([makeContract({ id: 1, quantityKg: 100 })], (s) => { s.collectedOre['dirtite'] = 99; });
      expect(r['1']).toBe('false');
    });

    it('ore_sale is not fillable when only another ore is stored', () => {
      const r = fillableOf([makeContract({ id: 1, quantityKg: 100 })], (s) => { s.collectedOre['gloomium'] = 5000; });
      expect(r['1']).toBe('false');
    });

    it('marks fillable and unfillable ore offers independently, side by side', () => {
      const r = fillableOf(
        [makeContract({ id: 1, quantityKg: 100 }), makeContract({ id: 2, quantityKg: 900 })],
        (s) => { s.collectedOre['dirtite'] = 500; },
      );
      expect(r).toEqual({ '1': 'true', '2': 'false' });
    });

    it('rubble_disposal is fillable against stored mass, not collected ore', () => {
      const rubble = makeContract({ id: 3, type: 'rubble_disposal', materialId: '', quantityKg: 800 });
      expect(fillableOf([rubble], (s) => { s.logistics.storedMassKg = 800; })['3']).toBe('true');
      expect(fillableOf([rubble], (s) => { s.logistics.storedMassKg = 799; })['3']).toBe('false');
    });
  });

  it('Accept on a specific offered card dispatches contract accept for that card only, with two offers present', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    addFreightWarehouseToState(state); // ore_sale offers can only be accepted with a freight warehouse (#1372)
    state.contracts.available.push(makeContract({ id: 3 }), makeContract({ id: 9 }));
    panel.show();
    panel.update(state);

    (panel.root.querySelector('[data-contract-id="9"] .bs-contract-accept') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract accept id:9');
    expect(gameConsole).not.toHaveBeenCalledWith('contract accept id:3');
  });

  it('Accept on the other offered card dispatches contract accept for that id, with two offers present', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    addFreightWarehouseToState(state); // ore_sale offers can only be accepted with a freight warehouse (#1372)
    state.contracts.available.push(makeContract({ id: 3 }), makeContract({ id: 9 }));
    panel.show();
    panel.update(state);

    (panel.root.querySelector('[data-contract-id="3"] .bs-contract-accept') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract accept id:3');
    expect(gameConsole).not.toHaveBeenCalledWith('contract accept id:9');
  });

  it('Deliver on a specific active card dispatches contract deliver for that card only, with two active contracts present', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 100;
    state.contracts.active.push(
      makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }),
      makeContract({ id: 8, quantityKg: 60, deliveredKg: 0 }),
    );
    panel.show();
    panel.update(state);

    (panel.root.querySelector('[data-contract-id="8"] .bs-contract-deliver') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract deliver 8 amount:60');
    expect(gameConsole).not.toHaveBeenCalledWith(expect.stringMatching(/^contract deliver 5 /));
  });
});

// ── Scroll-bounded Active/Available/Closed sections (#958) ──────────────────
//
// bodyEl (this.el.append(header, this.bodyEl) in the constructor) is always
// the panel root's second child. Active, Available (offered), and Closed
// (history) are each a flat run of cards/rows spread directly into bodyEl
// between one sectionHeader and the next — a long list in any one of them
// buries the following sections far below the panel's fold. The fix nests
// each of the three lists inside its OWN scrollBoundedSection wrapper,
// standing between its own section header and the next.

function getBodyEl(panel: ContractsPanel): HTMLElement {
  return panel.root.children[1] as HTMLElement;
}

/**
 * Every direct child of `bodyEl` between the section header whose text
 * contains `label` and the next section header (or the end of bodyEl).
 */
function sectionChildren(bodyEl: HTMLElement, label: string): HTMLElement[] {
  const children = Array.from(bodyEl.children) as HTMLElement[];
  const idx = children.findIndex(c => c.classList.contains('bsx-section') && (c.textContent ?? '').includes(label));
  if (idx === -1) throw new Error(`section header not found for label: ${label}`);
  const result: HTMLElement[] = [];
  for (let i = idx + 1; i < children.length; i++) {
    if (children[i]!.classList.contains('bsx-section')) break;
    result.push(children[i]!);
  }
  return result;
}

function makeManyContracts(count: number, idBase: number): Contract[] {
  return Array.from({ length: count }, (_, i) => makeContract({ id: idBase + i }));
}

describe('ContractsPanel — scroll-bounded Active/Available/Closed sections (#958)', () => {
  it('wraps Active, Available, and Closed each in their own distinct bounded wrapper', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 100000;
    state.contracts.active.push(...makeManyContracts(20, 100));
    state.contracts.available.push(...makeManyContracts(20, 200));
    state.contracts.completedHistory.push(...makeManyContracts(20, 300).map(c => ({ ...c, completed: true })));

    panel.show();
    panel.update(state);

    const bodyEl = getBodyEl(panel);
    const activeChildren = sectionChildren(bodyEl, t('ui.contracts.active'));
    const availableChildren = sectionChildren(bodyEl, t('ui.contracts.available'));
    const closedChildren = sectionChildren(bodyEl, t('ui.contracts.closed'));

    expect(activeChildren.length).toBe(1);
    expect(availableChildren.length).toBe(1);
    expect(closedChildren.length).toBe(1);

    const activeWrapper = activeChildren[0]!;
    const availableWrapper = availableChildren[0]!;
    const closedWrapper = closedChildren[0]!;

    // Distinct elements — one section's wrapper never swallows another's rows.
    expect(activeWrapper).not.toBe(availableWrapper);
    expect(availableWrapper).not.toBe(closedWrapper);
    expect(activeWrapper).not.toBe(closedWrapper);

    expect(activeWrapper.querySelectorAll('[data-contract-id]').length).toBe(20);
    expect(availableWrapper.querySelectorAll('[data-contract-id]').length).toBe(20);
    expect(closedWrapper.children.length).toBe(20);
  });

  it('gives each of the three wrappers inline overflow-y:auto and a numeric max-height', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 100000;
    state.contracts.active.push(...makeManyContracts(20, 100));
    state.contracts.available.push(...makeManyContracts(20, 200));
    state.contracts.completedHistory.push(...makeManyContracts(20, 300).map(c => ({ ...c, completed: true })));

    panel.show();
    panel.update(state);

    const bodyEl = getBodyEl(panel);
    const wrappers = [
      sectionChildren(bodyEl, t('ui.contracts.active'))[0]!,
      sectionChildren(bodyEl, t('ui.contracts.available'))[0]!,
      sectionChildren(bodyEl, t('ui.contracts.closed'))[0]!,
    ];
    for (const wrapper of wrappers) {
      expect(wrapper.style.overflowY).toBe('auto');
      expect(wrapper.style.maxHeight).toMatch(/^\d+px$/);
    }
  });

  it('keeps all three section headers reachable as bodyEl-level siblings — one wrapper never swallows another section\'s header', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 100000;
    state.contracts.active.push(...makeManyContracts(20, 100));
    state.contracts.available.push(...makeManyContracts(20, 200));
    state.contracts.completedHistory.push(...makeManyContracts(20, 300).map(c => ({ ...c, completed: true })));

    panel.show();
    panel.update(state);

    const bodyEl = getBodyEl(panel);
    const headers = (Array.from(bodyEl.children) as HTMLElement[]).filter(c => c.classList.contains('bsx-section'));
    const headerLabels = headers.map(h => h.textContent ?? '');

    expect(headerLabels.some(l => l.includes(t('ui.contracts.active')))).toBe(true);
    expect(headerLabels.some(l => l.includes(t('ui.contracts.available')))).toBe(true);
    expect(headerLabels.some(l => l.includes(t('ui.contracts.closed')))).toBe(true);
    expect(headers.length).toBe(3);
  });

  it('with zero contracts in any list, each of the three bounded wrappers is still present and contains the empty state', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());

    const bodyEl = getBodyEl(panel);
    for (const [label, emptyKey] of [
      [t('ui.contracts.active'), t('ui.contracts.none_active')],
      [t('ui.contracts.available'), t('ui.contracts.none')],
      [t('ui.contracts.closed'), t('ui.contracts.none_closed')],
    ] as const) {
      const children = sectionChildren(bodyEl, label);
      expect(children.length).toBe(1);
      const wrapper = children[0]!;
      expect(wrapper.style.overflowY).toBe('auto');
      expect(wrapper.style.maxHeight).toMatch(/^\d+px$/);
      expect(wrapper.textContent).toContain(emptyKey);
    }
  });

  it('disables the negotiate button only on offers already negotiated (#1366)', () => {
    const { panel } = makePanel();
    const state = withManager(makeState());
    state.contracts.available.push(
      makeContract({ id: 1, negotiationAttempts: 1 }),
      makeContract({ id: 2 }),
    );
    panel.show();
    panel.update(state);

    const btn = (id: number) => panel.root.querySelector<HTMLButtonElement>(
      `[data-contract-id="${id}"] [data-action="negotiate"]`,
    );
    expect(btn(1)).not.toBeNull();
    expect(btn(1)!.disabled).toBe(true);
    expect(btn(1)!.title).toBe(t('ui.contracts.negotiate_used'));
    expect(btn(2)!.disabled).toBe(false);
  });

  it('disables a card negotiate button after the offer has been negotiated (#1366)', () => {
    const { panel } = makePanel();
    const state = withManager(makeState());
    const c = makeContract({ id: 3 });
    state.contracts.available.push(c, makeContract({ id: 4 }));
    panel.show();
    panel.update(state);
    expect(panel.root.querySelector<HTMLButtonElement>('[data-contract-id="3"] [data-action="negotiate"]')!.disabled).toBe(false);

    c.negotiationAttempts = 1;
    panel.update(state);
    expect(panel.root.querySelector<HTMLButtonElement>('[data-contract-id="3"] [data-action="negotiate"]')!.disabled).toBe(true);
    expect(panel.root.querySelector<HTMLButtonElement>('[data-contract-id="4"] [data-action="negotiate"]')!.disabled).toBe(false);
  });
});

describe('negotiate needs a manager (#1340)', () => {
  const btn = (panel: ContractsPanel, id: number) => panel.root.querySelector<HTMLButtonElement>(
    `[data-contract-id="${id}"] [data-action="negotiate"]`,
  )!;

  it('is disabled with the no-manager title when the roster has no manager', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 1 }));
    panel.show();
    panel.update(state);
    expect(btn(panel, 1).disabled).toBe(true);
    expect(btn(panel, 1).title).toBe(t('ui.contracts.negotiate_no_manager'));
    btn(panel, 1).click();
    expect(gameConsole).not.toHaveBeenCalledWith('contract negotiate id:1');
  });

  it('enables on the next update once a manager is hired', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 1 }));
    panel.show();
    panel.update(state);
    expect(btn(panel, 1).disabled).toBe(true);

    withManager(state);
    panel.update(state);
    expect(btn(panel, 1).disabled).toBe(false);
  });

  it('disables again when the only manager is injured', () => {
    const { panel } = makePanel();
    const state = withManager(makeState());
    state.contracts.available.push(makeContract({ id: 1 }));
    panel.show();
    panel.update(state);
    expect(btn(panel, 1).disabled).toBe(false);

    state.employees.employees[0]!.injured = true;
    panel.update(state);
    expect(btn(panel, 1).disabled).toBe(true);
    expect(btn(panel, 1).title).toBe(t('ui.contracts.negotiate_no_manager'));
  });

  it('an already-negotiated offer keeps the used title even with a manager', () => {
    const { panel } = makePanel();
    const state = withManager(makeState());
    state.contracts.available.push(makeContract({ id: 1, negotiationAttempts: 1 }));
    panel.show();
    panel.update(state);
    expect(btn(panel, 1).title).toBe(t('ui.contracts.negotiate_used'));
  });
});

// ── #1368: deliver amount floors to 0.1 kg, never exceeds stock; failures surface ──

describe('deliverableAmountKg (#1368)', () => {
  it.each([
    [99.6, 99.6],
    [0.3, 0.3],
    [1.1, 1.1],
    [0.04, 0],
    [1234.567, 1234.5],
    [0, 0],
    [40, 40],
  ])('floors %s kg to %s', (input, expected) => {
    expect(deliverableAmountKg(input)).toBeCloseTo(expected, 10);
  });

  it('never exceeds its input', () => {
    for (const v of [99.6, 0.3, 1.1, 0.04, 1234.567, 99.99, 7.77, 0.1 + 0.2, 55.55]) {
      expect(deliverableAmountKg(v)).toBeLessThanOrEqual(v + 1e-9);
    }
  });

  it('returns 0 for non-positive or non-finite input', () => {
    expect(deliverableAmountKg(-5)).toBe(0);
    expect(deliverableAmountKg(NaN)).toBe(0);
  });
});

describe('ContractsPanel deliver amount (#1368)', () => {
  function setup(stock: number, contract: Partial<Contract> = {}, rubble = false) {
    const ctx = makePanel();
    const state = makeState();
    if (rubble) state.logistics.storedMassKg = stock;
    else state.collectedOre['dirtite'] = stock;
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0, ...contract }));
    ctx.panel.show();
    ctx.panel.update(state);
    const input = () => ctx.panel.root.querySelector<HTMLInputElement>('.bs-contract-amount')!;
    const deliver = () => ctx.panel.root.querySelector<HTMLButtonElement>('.bs-contract-deliver')!;
    const max = () => ctx.panel.root.querySelector<HTMLButtonElement>('[data-action="deliver-max"]')!;
    return { ...ctx, state, input, deliver, max };
  }

  it('pre-fills 99.6 for 99.6 kg stock instead of rounding up to 100', () => {
    const { input } = setup(99.6);
    expect(Number(input().value)).toBeCloseTo(99.6, 10);
  });

  it('MAX sets 99.6 after the player edits the field', () => {
    const { input, max } = setup(99.6);
    input().value = '3';
    max().click();
    expect(Number(input().value)).toBeCloseTo(99.6, 10);
  });

  it('Deliver calls the console with amount:99.6', () => {
    const { deliver, gameConsole } = setup(99.6);
    deliver().click();
    expect(gameConsole).toHaveBeenCalledWith('contract deliver 5 amount:99.6');
  });

  it('input max attribute does not exceed stock', () => {
    const { input } = setup(99.6);
    expect(Number(input().max)).toBeLessThanOrEqual(99.6 + 1e-9);
  });

  it('limits to remaining when remaining < stock (40.5 of 99.6)', () => {
    const { input, deliver, gameConsole } = setup(99.6, { quantityKg: 40.5 });
    expect(Number(input().value)).toBeCloseTo(40.5, 10);
    deliver().click();
    expect(gameConsole).toHaveBeenCalledWith('contract deliver 5 amount:40.5');
  });

  it('disables input, MAX and Deliver when floored amount is 0 (stock 0.04)', () => {
    const { input, deliver, max } = setup(0.04);
    expect(input().disabled).toBe(true);
    expect(deliver().disabled).toBe(true);
    expect(max().disabled).toBe(true);
  });

  it('rubble contract floors against storedMassKg', () => {
    const { input, deliver, gameConsole } = setup(99.6, { type: 'rubble_disposal', materialId: '' }, true);
    expect(Number(input().value)).toBeCloseTo(99.6, 10);
    deliver().click();
    expect(gameConsole).toHaveBeenCalledWith('contract deliver 5 amount:99.6');
  });

  it('rubble contract with 0.04 kg stored is disabled', () => {
    const { deliver } = setup(0.04, { type: 'rubble_disposal', materialId: '' }, true);
    expect(deliver().disabled).toBe(true);
  });

  it('shows the console output in the panel when Deliver fails', () => {
    const { panel, deliver, gameConsole } = setup(99.6);
    gameConsole.mockReturnValue({ success: false, output: 'Not enough ore in storage (#1368)' });
    deliver().click();
    expect(panel.root.textContent).toContain('Not enough ore in storage (#1368)');
  });

  it('failure status survives a re-render', () => {
    const { panel, state, deliver, gameConsole } = setup(99.6);
    gameConsole.mockReturnValue({ success: false, output: 'Refused: reason-xyz' });
    deliver().click();
    panel.update(state);
    state.collectedOre['dirtite'] = 98.6;
    panel.update(state);
    expect(panel.root.textContent).toContain('Refused: reason-xyz');
  });

  it('a successful Deliver clears the earlier failure message', () => {
    const { panel, deliver, gameConsole } = setup(99.6);
    gameConsole.mockReturnValue({ success: false, output: 'Refused: reason-xyz' });
    deliver().click();
    expect(panel.root.textContent).toContain('Refused: reason-xyz');
    gameConsole.mockReturnValue({ success: true, output: 'Delivered fine' });
    deliver().click();
    expect(panel.root.textContent).not.toContain('Refused: reason-xyz');
  });
});
