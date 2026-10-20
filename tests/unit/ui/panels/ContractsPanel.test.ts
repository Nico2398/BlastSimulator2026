// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  ContractsPanel, deliverableAmountKg, orderOffers, summarizeActive, CONTRACT_OFFER_CARD_PX, AVAILABLE_VISIBLE_CARDS, SECTION_GAP_PX,
} from '../../../../src/ui/panels/ContractsPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { Random } from '../../../../src/core/math/Random.js';
import { addFreightWarehouseToState } from '../../../helpers/freightWarehouse.js';
import type { Contract } from '../../../../src/core/economy/Contract.js';
import { formatMoney } from '../../../../src/core/economy/formatMoney.js';
import { placeBuilding } from '../../../../src/core/entities/Building.js';
import { createGradeState, gradeDef } from '../../../../src/core/economy/MineGrade.js';
import { BUYER_TIERS, buyerTierNameKey } from '../../../../src/core/economy/BuyerTiers.js';
import { oreSaturationTrend } from '../../../../src/core/economy/OreSaturation.js';
import { resolveContractOres } from '../../../../src/core/campaign/Level.js';

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

/** Put one stored fragment of the given mass into warehouse storage; barren when oreDensities is empty. */
function storeRock(state: GameState, mass: number, oreDensities: Record<string, number> = {}): void {
  const fragment = {
    id: state.logistics.fragments.length + 1, mass, volume: mass / 2500, rockId: 'sandite', oreDensities,
  } as unknown as GameState['logistics']['fragments'][number]['fragment'];
  state.logistics.fragments.push({ fragment, state: 'stored', vehicleId: null, warehouseId: 1 });
  state.logistics.storedMassKg += mass;
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

  it('marks data-contract-wins only on a fillable offer whose payout covers the profit target (#1724)', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.campaign.activeLevelId = 'tutorial_pit'; // target $5,000, no profit yet
    state.collectedOre['dirtite'] = 100;
    state.contracts.available.push(
      makeContract({ id: 7, materialId: 'dirtite', quantityKg: 100, pricePerKg: 49 }),
      makeContract({ id: 9, materialId: 'dirtite', quantityKg: 100, pricePerKg: 50 }),
    );
    panel.show();
    panel.update(state);

    expect(panel.root.querySelector('[data-contract-id="7"]')!.getAttribute('data-contract-wins')).toBe('false');
    expect(panel.root.querySelector('[data-contract-id="9"]')!.getAttribute('data-contract-wins')).toBe('true');
  });

  it('marks a rubble offer fillable from barren stored fragments, and not from ore-bearing ones (#1871)', () => {
    const { panel } = makePanel();
    const state = makeState();
    storeRock(state, 500);
    state.contracts.available.push(makeContract({ id: 8, type: 'rubble_disposal', materialId: '', quantityKg: 400 }));
    panel.show();
    panel.update(state);

    expect(panel.root.querySelector('[data-contract-id="8"]')!
      .getAttribute('data-contract-fillable')).toBe('true');

    const ore = makePanel();
    const oreState = makeState();
    storeRock(oreState, 500, { dirtite: 0.5 });
    oreState.contracts.available.push(makeContract({ id: 8, type: 'rubble_disposal', materialId: '', quantityKg: 400 }));
    ore.panel.show();
    ore.panel.update(oreState);
    expect(ore.panel.root.querySelector('[data-contract-id="8"]')!
      .getAttribute('data-contract-fillable')).toBe('false');
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

    it('rubble_disposal is fillable against barren stored rock, not collected ore or ore-bearing rock (#1871)', () => {
      const rubble = makeContract({ id: 3, type: 'rubble_disposal', materialId: '', quantityKg: 800 });
      expect(fillableOf([rubble], (s) => { storeRock(s, 800); })['3']).toBe('true');
      expect(fillableOf([rubble], (s) => { storeRock(s, 799); })['3']).toBe('false');
      expect(fillableOf([rubble], (s) => { storeRock(s, 800, { dirtite: 0.5 }); })['3']).toBe('false');
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
/** Header label without its count suffix ("Available · 3" -> "Available"). */
function countLabel(key: 'ui.contracts.available_count' | 'ui.contracts.active_count'): string {
  return t(key, { count: 0 }).replace(/\s*·\s*0$/, '');
}
const AVAILABLE_LABEL = countLabel('ui.contracts.available_count');
const ACTIVE_LABEL = countLabel('ui.contracts.active_count');

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
    const activeChildren = sectionChildren(bodyEl, ACTIVE_LABEL);
    const availableChildren = sectionChildren(bodyEl, AVAILABLE_LABEL);
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
      sectionChildren(bodyEl, ACTIVE_LABEL)[0]!,
      sectionChildren(bodyEl, AVAILABLE_LABEL)[0]!,
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

    expect(headerLabels.some(l => l.includes(ACTIVE_LABEL))).toBe(true);
    expect(headerLabels.some(l => l.includes(AVAILABLE_LABEL))).toBe(true);
    expect(headerLabels.some(l => l.includes(t('ui.contracts.closed')))).toBe(true);
    expect(headers.length).toBe(3);
  });

  it('with zero contracts in any list, each of the three bounded wrappers is still present and contains the empty state', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());

    const bodyEl = getBodyEl(panel);
    for (const [label, emptyKey] of [
      [ACTIVE_LABEL, t('ui.contracts.none_active')],
      [AVAILABLE_LABEL, t('ui.contracts.none')],
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
    if (rubble) storeRock(state, stock);
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

  it('rubble contract floors against barren stored rock', () => {
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

// ── Live refresh keeps scroll and typed input across ticks (#1592) ──

describe('ContractsPanel — tick refresh keeps scroll and typed input (#1592)', () => {
  /** The three bounded sections, always as [active, available, closed] regardless of DOM order (#1970). */
  const sections = (panel: ContractsPanel): HTMLElement[] =>
    ['active', 'available', 'closed']
      .map(k => panel.root.querySelector<HTMLElement>(`[data-scroll-key="${k}"]`))
      .filter((d): d is HTMLElement => d !== null);

  function busyState(): GameState {
    const state = makeState();
    state.collectedOre['dirtite'] = 40;
    state.tickCount = 10;
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }));
    state.contracts.available.push(makeContract({ id: 6, quantityKg: 50, deadlineTicks: 80 }));
    state.contracts.completedHistory.push(makeContract({ id: 7, completed: true, deliveredKg: 100 }));
    return state;
  }

  it('finds the three bounded sections', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(busyState());
    expect(sections(panel)).toHaveLength(3);
  });

  it('keeps active, available and closed section scrollTop after a tick', () => {
    const { panel } = makePanel();
    const state = busyState();
    panel.show();
    panel.update(state);
    const [a, b, c] = sections(panel);
    a!.scrollTop = 30; b!.scrollTop = 45; c!.scrollTop = 60;

    state.tickCount++;
    panel.update(state);

    const [a2, b2, c2] = sections(panel);
    expect([a2!.scrollTop, b2!.scrollTop, c2!.scrollTop]).toEqual([30, 45, 60]);
  });

  it('keeps section scrollTop across many consecutive ticks', () => {
    const { panel } = makePanel();
    const state = busyState();
    panel.show();
    panel.update(state);
    sections(panel)[0]!.scrollTop = 30;
    for (let i = 0; i < 5; i++) { state.tickCount++; panel.update(state); }
    expect(sections(panel)[0]!.scrollTop).toBe(30);
  });

  it('keeps a typed amount in .bs-contract-amount across a tick', () => {
    const { panel } = makePanel();
    const state = busyState();
    panel.show();
    panel.update(state);
    const input = panel.root.querySelector<HTMLInputElement>('.bs-contract-amount')!;
    input.value = '12.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    state.tickCount++;
    panel.update(state);

    expect(panel.root.querySelector<HTMLInputElement>('.bs-contract-amount')!.value).toBe('12.5');
  });

  it('clamps a typed amount to the new max when stock shrinks', () => {
    const { panel } = makePanel();
    const state = busyState();
    panel.show();
    panel.update(state);
    const input = panel.root.querySelector<HTMLInputElement>('.bs-contract-amount')!;
    input.value = '35';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    state.collectedOre['dirtite'] = 20;
    state.tickCount++;
    panel.update(state);

    expect(panel.root.querySelector<HTMLInputElement>('.bs-contract-amount')!.value).toBe('20');
  });

  it('an untouched amount still follows the new max', () => {
    const { panel } = makePanel();
    const state = busyState();
    panel.show();
    panel.update(state);
    state.collectedOre['dirtite'] = 20;
    state.tickCount++;
    panel.update(state);
    expect(panel.root.querySelector<HTMLInputElement>('.bs-contract-amount')!.value).toBe('20');
  });

  it('the time-left text still counts down per tick', () => {
    const { panel } = makePanel();
    const state = busyState();
    panel.show();
    panel.update(state);
    const before = t('ui.contracts.time_left', { hours: 40 }); // 0 + 50 - 10
    expect(panel.root.textContent).toContain(before);

    state.tickCount += 5;
    panel.update(state);

    expect(panel.root.textContent).toContain(t('ui.contracts.time_left', { hours: 35 }));
    expect(panel.root.textContent).not.toContain(before);
  });
});


// ── Rubble cards: heaps, pays/costs, whole-kilogram amounts (#1892) ──

function putHeapRock(state: GameState, kg: number): void {
  const r = placeBuilding(state.buildings, 'spoil_heap', 40, 40, 200, 200);
  if (!r.success || !r.building) throw new Error('fixture heap refused');
  r.building.storedSpoilKg = kg;
}

describe('ContractsPanel — rubble cards (#1892)', () => {
  const rubble = (over: Partial<Contract> = {}) => makeContract({
    id: 4, type: 'rubble_disposal', materialId: '', description: 'Dispose of rubble',
    quantityKg: 20_000, pricePerKg: 0.02, penaltyAmount: 0, earlyBonus: 0, ...over,
  });

  function offerText(c: Contract, prepare: (s: GameState) => void = () => {}): string {
    const { panel } = makePanel();
    const state = makeState();
    prepare(state);
    state.contracts.available.push(c);
    panel.show();
    panel.update(state);
    return panel.root.querySelector('[data-contract-id="' + c.id + '"]')!.textContent ?? '';
  }

  it('an offered rubble card names the heaps, not storage', () => {
    const text = offerText(rubble(), s => putHeapRock(s, 53_846.4));
    expect(text).toContain(t('ui.contracts.stock_spoil_heaps', { kg: '53,846' }));
    expect(text).not.toContain(t('ui.contracts.have_line', { kg: '53,846' }));
  });

  it('an ore card keeps the in-storage line', () => {
    const text = offerText(makeContract({ id: 4 }), s => { s.collectedOre['dirtite'] = 70; });
    expect(text).toContain(t('ui.contracts.have_line', { kg: '70' }));
    expect(text).not.toContain(t('ui.contracts.stock_spoil_heaps', { kg: '70' }));
  });

  it('a cheap clearance says how much it removes and what it pays', () => {
    const text = offerText(rubble());
    expect(text).toContain(t('ui.contracts.rubble_removes', { kg: '20,000' }));
    expect(text).toContain(t('ui.contracts.rubble_pays', { amount: formatMoney(400) }));
    expect(text).not.toContain(t('ui.contracts.rubble_costs', { amount: formatMoney(400) }));
  });

  it('a paid clearance says what it costs the player', () => {
    const text = offerText(rubble({ playerPays: true, pricePerKg: 0.04 }));
    expect(text).toContain(t('ui.contracts.rubble_removes', { kg: '20,000' }));
    expect(text).toContain(t('ui.contracts.rubble_costs', { amount: formatMoney(800) }));
    expect(text).not.toContain(t('ui.contracts.rubble_pays', { amount: formatMoney(800) }));
  });

  it('accept is disabled when the player cannot afford a paid clearance fee', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.cash = 10;
    state.contracts.available.push(rubble({ playerPays: true, pricePerKg: 0.04 }));
    panel.show();
    panel.update(state);
    expect((panel.root.querySelector('.bs-contract-accept') as HTMLButtonElement).disabled).toBe(true);
  });

  it('accept is enabled for a paid clearance the player can afford', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.cash = 100_000;
    state.contracts.available.push(rubble({ playerPays: true, pricePerKg: 0.04 }));
    panel.show();
    panel.update(state);
    expect((panel.root.querySelector('.bs-contract-accept') as HTMLButtonElement).disabled).toBe(false);
  });

  it('an active rubble card names the heaps and its fee or payment', () => {
    const { panel } = makePanel();
    const state = makeState();
    putHeapRock(state, 30_000.7);
    state.contracts.active.push(rubble({ playerPays: true, pricePerKg: 0.04 }));
    panel.show();
    panel.update(state);
    const text = panel.root.textContent ?? '';
    expect(text).toContain(t('ui.contracts.stock_spoil_heaps', { kg: '30,001' }));
    expect(text).toContain(t('ui.contracts.rubble_costs', { amount: formatMoney(800) }));
  });

  it('delivered kilograms are rounded to whole numbers on an active card', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 299_500, deliveredKg: 53_846.339 }));
    panel.show();
    panel.update(state);
    const text = panel.root.textContent ?? '';
    expect(text).toContain(t('ui.contracts.delivered_line', { delivered: '53,846', total: '299,500' }));
    expect(text).not.toContain('53,846.339');
  });

  it('a delivered amount of 0.5 kg rounds up, a whole amount stays whole', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 1_000, deliveredKg: 100.5 }));
    state.contracts.active.push(makeContract({ id: 6, quantityKg: 1_000, deliveredKg: 250 }));
    panel.show();
    panel.update(state);
    const text = panel.root.textContent ?? '';
    expect(text).toContain(t('ui.contracts.delivered_line', { delivered: '101', total: '1,000' }));
    expect(text).toContain(t('ui.contracts.delivered_line', { delivered: '250', total: '1,000' }));
  });
});


// ── Layout: Available above Active, fillable first, counts, taller Available (#1970) ──

describe('orderOffers (#1970)', () => {
  const o = (id: number, over: Partial<Contract> = {}) => makeContract({ id, quantityKg: 100, ...over });
  const ids = (cs: Contract[]) => cs.map(c => c.id);

  it('keeps board order when every offer is fillable', () => {
    const list = [o(3), o(1), o(2)];
    expect(ids(orderOffers(list, { dirtite: 500 }, 0))).toEqual([3, 1, 2]);
  });

  it('keeps board order when no offer is fillable', () => {
    const list = [o(3), o(1), o(2)];
    expect(ids(orderOffers(list, { dirtite: 5 }, 0))).toEqual([3, 1, 2]);
  });

  it('returns an empty list for no offers', () => {
    expect(orderOffers([], { dirtite: 500 }, 100)).toEqual([]);
  });

  it('puts fillable offers first and keeps board order inside each group', () => {
    const list = [o(1, { quantityKg: 900 }), o(2), o(3, { quantityKg: 800 }), o(4), o(5, { quantityKg: 700 })];
    expect(ids(orderOffers(list, { dirtite: 100 }, 0))).toEqual([2, 4, 1, 3, 5]);
  });

  it('does not mutate its input', () => {
    const list = [o(1, { quantityKg: 900 }), o(2)];
    const copy = [...list];
    const out = orderOffers(list, { dirtite: 100 }, 0);
    expect(list).toEqual(copy);
    expect(out).not.toBe(list);
  });

  it('judges rubble offers against the rubble stock argument, not collected ore', () => {
    const rubble = o(2, { type: 'rubble_disposal', materialId: '', quantityKg: 400 });
    const ore = o(1, { quantityKg: 900 });
    expect(ids(orderOffers([ore, rubble], {}, 400))).toEqual([2, 1]);
    expect(ids(orderOffers([ore, rubble], { dirtite: 5000 }, 399))).toEqual([1, 2]);
    expect(ids(orderOffers([rubble, ore], { dirtite: 5000 }, 399))).toEqual([1, 2]);
  });
});

describe('ContractsPanel layout (#1970)', () => {
  const headerTexts = (panel: ContractsPanel): string[] =>
    (Array.from(getBodyEl(panel).children) as HTMLElement[])
      .filter(c => c.classList.contains('bsx-section')).map(c => c.textContent ?? '');
  const offerIds = (panel: ContractsPanel): string[] =>
    Array.from(panel.root.querySelectorAll<HTMLElement>('[data-scroll-key="available"] [data-contract-id]'))
      .map(n => n.dataset['contractId']!);

  /** Offers 1..n; odd-numbered ones are fillable (100 kg), even ones need 900 kg. */
  function mixedState(n: number): GameState {
    const state = makeState();
    state.collectedOre['dirtite'] = 100;
    for (let i = 1; i <= n; i++) state.contracts.available.push(makeContract({ id: i, quantityKg: i % 2 ? 100 : 900 }));
    return state;
  }

  it('orders sections Storage, Available, Active, Closed', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    const kids = Array.from(getBodyEl(panel).children) as HTMLElement[];
    const pos = (key: string) => kids.findIndex(k => k.dataset['scrollKey'] === key);
    const strip = kids.findIndex(k => k.querySelector('[data-action="goto-ops"]') !== null);
    expect(strip).toBeGreaterThanOrEqual(0);
    expect(strip).toBeLessThan(pos('available'));
    expect(pos('available')).toBeLessThan(pos('active'));
    expect(pos('active')).toBeLessThan(pos('closed'));
    const labels = headerTexts(panel);
    expect(labels[0]).toContain(AVAILABLE_LABEL);
    expect(labels[1]).toContain(ACTIVE_LABEL);
    expect(labels[2]).toContain(t('ui.contracts.closed'));
  });

  it('shows the offer count in the Available header', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(mixedState(8));
    expect(headerTexts(panel)[0]).toContain(t('ui.contracts.available_count', { count: 8 }));
  });

  it('shows count 0 in the Available header with no offers', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    expect(headerTexts(panel)[0]).toContain(t('ui.contracts.available_count', { count: 0 }));
  });

  it('shows the active count in the Active header', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.active.push(...makeManyContracts(3, 50));
    panel.show();
    panel.update(state);
    const active = headerTexts(panel).find(h => h.includes(t('ui.contracts.active_count', { count: 3 })));
    expect(active).toBeDefined();
  });

  it('updates the counts when offers are added', () => {
    const { panel } = makePanel();
    const state = mixedState(2);
    panel.show();
    panel.update(state);
    state.contracts.available.push(makeContract({ id: 30 }));
    panel.update(state);
    expect(headerTexts(panel)[0]).toContain(t('ui.contracts.available_count', { count: 3 }));
  });

  it('renders fillable offers before unfillable ones, board order inside each group', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(mixedState(8));
    expect(offerIds(panel)).toEqual(['1', '3', '5', '7', '2', '4', '6', '8']);
  });

  it('keeps the order identical across two renders and after a forced refresh', () => {
    const { panel } = makePanel();
    const state = mixedState(8);
    panel.show();
    panel.update(state);
    const first = offerIds(panel);
    panel.update(state);
    expect(offerIds(panel)).toEqual(first);
    panel.refreshLocale();
    panel.update(state);
    expect(offerIds(panel)).toEqual(first);
    expect(first).toEqual(['1', '3', '5', '7', '2', '4', '6', '8']);
  });

  it('puts a rubble offer first when the rubble stock covers it', () => {
    const { panel } = makePanel();
    const state = makeState();
    storeRock(state, 500);
    state.contracts.available.push(
      makeContract({ id: 1, quantityKg: 900 }),
      makeContract({ id: 2, type: 'rubble_disposal', materialId: '', quantityKg: 400 }),
    );
    panel.show();
    panel.update(state);
    expect(offerIds(panel)).toEqual(['2', '1']);
  });

  it('sizes the Available wrapper for three offer cards, still scrolling', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(mixedState(8));
    const wrapper = panel.root.querySelector<HTMLElement>('[data-scroll-key="available"]')!;
    expect(AVAILABLE_VISIBLE_CARDS).toBe(3);
    expect(wrapper.style.maxHeight).toMatch(/^\d+px$/);
    expect(parseInt(wrapper.style.maxHeight, 10)).toBeGreaterThanOrEqual(3 * CONTRACT_OFFER_CARD_PX + 2 * SECTION_GAP_PX);
    expect(wrapper.style.overflowY).toBe('auto');
  });

  it('leaves the Active and Closed wrappers at their own bounded height', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    for (const key of ['active', 'closed']) {
      const w = panel.root.querySelector<HTMLElement>(`[data-scroll-key="${key}"]`)!;
      expect(w.style.overflowY).toBe('auto');
      expect(w.style.maxHeight).toMatch(/^\d+px$/);
    }
  });
});

describe('summarizeActive (#1983)', () => {
  it('returns null for an empty list', () => {
    expect(summarizeActive([], 10)).toBeNull();
  });

  it('counts contracts and sums penalties', () => {
    const s = summarizeActive([
      makeContract({ id: 1, penaltyAmount: 90 }),
      makeContract({ id: 2, penaltyAmount: 10 }),
    ], 0);
    expect(s).not.toBeNull();
    expect(s!.count).toBe(2);
    expect(s!.penaltyTotal).toBe(100);
  });

  it('takes the earliest deadline, in the same hour unit as the card time-left', () => {
    const s = summarizeActive([
      makeContract({ id: 1, acceptedAtTick: 0, deadlineTicks: 50 }),
      makeContract({ id: 2, acceptedAtTick: 10, deadlineTicks: 20 }),
    ], 12);
    expect(s!.nextDeadlineHours).toBe(18);
  });

  it('floors an overdue deadline at 0', () => {
    const s = summarizeActive([makeContract({ acceptedAtTick: 0, deadlineTicks: 5 })], 99);
    expect(s!.nextDeadlineHours).toBe(0);
  });

  it('excludes rubble_disposal penalties; rubble-only totals 0', () => {
    const rubble = makeContract({ id: 2, type: 'rubble_disposal', materialId: '', penaltyAmount: 500 });
    expect(summarizeActive([makeContract({ id: 1, penaltyAmount: 90 }), rubble], 0)!.penaltyTotal).toBe(90);
    const only = summarizeActive([rubble], 0)!;
    expect(only.penaltyTotal).toBe(0);
    expect(only.count).toBe(1);
  });
});

describe('ContractsPanel — running-contracts summary strip (#1983)', () => {
  const STRIP = '.bs-contract-active-summary';
  const stripOf = (panel: ContractsPanel): HTMLElement | null => getBodyEl(panel).querySelector<HTMLElement>(`:scope > ${STRIP}`);

  function runningState(): GameState {
    const state = makeState();
    state.collectedOre['dirtite'] = 100;
    state.tickCount = 10;
    state.contracts.active.push(
      makeContract({ id: 21, acceptedAtTick: 0, deadlineTicks: 52, penaltyAmount: 1234 }),
      makeContract({ id: 22, acceptedAtTick: 0, deadlineTicks: 100, penaltyAmount: 4000 }),
    );
    for (let i = 1; i <= 8; i++) state.contracts.available.push(makeContract({ id: i, quantityKg: i % 2 ? 100 : 900 }));
    return state;
  }

  it('renders a goto-active button strip as a direct child of the body, before Available header and cards', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(runningState());
    const strip = stripOf(panel)!;
    expect(strip).not.toBeNull();
    expect(strip.matches('button[data-action="goto-active"]')).toBe(true);
    const kids = Array.from(getBodyEl(panel).children) as HTMLElement[];
    const stripIdx = kids.indexOf(strip);
    const availHeader = kids.findIndex(k => k.classList.contains('bsx-section') && (k.textContent ?? '').includes(AVAILABLE_LABEL));
    const firstCard = kids.findIndex(k => k.querySelector('[data-contract-id]') !== null || k.hasAttribute('data-contract-id'));
    expect(availHeader).toBeGreaterThan(stripIdx);
    expect(firstCard).toBeGreaterThan(stripIdx);
  });

  it('is not a section header and sits outside every scroll-keyed section', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(runningState());
    const strip = stripOf(panel)!;
    expect(strip.classList.contains('bsx-section')).toBe(false);
    expect(strip.closest('[data-scroll-key]')).toBeNull();
    expect(strip.querySelector('[data-scroll-key]')).toBeNull();
    expect((Array.from(getBodyEl(panel).children) as HTMLElement[]).filter(c => c.classList.contains('bsx-section'))).toHaveLength(3);
  });

  it('shows count, hours to the next deadline and the penalty total', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(runningState());
    const text = stripOf(panel)!.textContent ?? '';
    expect(text).toContain(t('ui.contracts.active_summary', { count: 2 }));
    expect(text).toContain(t('ui.contracts.active_deadline', { hours: 42 }));
    expect(text).toContain(formatMoney(5234));
  });

  it('omits penalty text when only rubble contracts run', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.active.push(makeContract({ id: 9, type: 'rubble_disposal', materialId: '', penaltyAmount: 777 }));
    panel.show();
    panel.update(state);
    const text = stripOf(panel)!.textContent ?? '';
    expect(text).not.toContain(formatMoney(777));
    expect(text).not.toContain(t('ui.contracts.penalty_line', { amount: formatMoney(0) }));
  });

  it('is absent with nothing running, and the Active empty state still renders', () => {
    const { panel } = makePanel();
    panel.show();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 1 }));
    panel.update(state);
    expect(stripOf(panel)).toBeNull();
    expect(panel.root.querySelector(STRIP)).toBeNull();
    expect(sectionChildren(getBodyEl(panel), ACTIVE_LABEL)).toHaveLength(1);
    expect(panel.root.textContent).toContain(t('ui.contracts.none_active'));
  });

  it('leaves Available unchanged with 2 running and 8 offers: cap, count, fillable-first', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(runningState());
    const wrapper = panel.root.querySelector<HTMLElement>('[data-scroll-key="available"]')!;
    expect(parseInt(wrapper.style.maxHeight, 10)).toBeGreaterThanOrEqual(3 * CONTRACT_OFFER_CARD_PX + 2 * SECTION_GAP_PX);
    expect(wrapper.style.overflowY).toBe('auto');
    const header = (Array.from(getBodyEl(panel).children) as HTMLElement[]).find(c => c.classList.contains('bsx-section') && (c.textContent ?? '').includes(AVAILABLE_LABEL))!;
    expect(header.textContent).toContain(t('ui.contracts.available_count', { count: 8 }));
    const ids = Array.from(wrapper.querySelectorAll<HTMLElement>('[data-contract-id]')).map(n => n.dataset['contractId']);
    expect(ids).toEqual(['1', '3', '5', '7', '2', '4', '6', '8']);
  });

  it('updates the hours on a tick without a re-render, keeping typed amount and scrollTop', () => {
    const { panel } = makePanel();
    const state = runningState();
    panel.show();
    panel.update(state);
    const input = panel.root.querySelector<HTMLInputElement>('.bs-contract-amount')!;
    input.value = '12.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const avail = panel.root.querySelector<HTMLElement>('[data-scroll-key="available"]')!;
    avail.scrollTop = 40;

    state.tickCount += 5;
    panel.update(state);

    const after = stripOf(panel)!;
    expect(after.textContent).toContain('37');
    expect(after.textContent).not.toContain('42');
    expect(panel.root.querySelector<HTMLInputElement>('.bs-contract-amount')!.value).toBe('12.5');
    expect(panel.root.querySelector<HTMLElement>('[data-scroll-key="available"]')!.scrollTop).toBe(40);
  });

  it('click scrolls the Active section header into view without throwing', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(runningState());
    const original = Element.prototype.scrollIntoView;
    const receivers: unknown[] = [];
    const spy = vi.fn(function (this: unknown) { receivers.push(this); });
    Element.prototype.scrollIntoView = spy;
    try {
      const target = stripOf(panel)!;
      const button = target.matches('button') ? target : target.querySelector<HTMLElement>('button[data-action="goto-active"]')!;
      expect(() => button.click()).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
      const scrolled = receivers[0] as HTMLElement;
      const activeWrapper = panel.root.querySelector<HTMLElement>('[data-scroll-key="active"]')!;
      const kids = Array.from(getBodyEl(panel).children) as HTMLElement[];
      const activeHeader = kids[kids.indexOf(activeWrapper) - 1]!;
      expect(scrolled === activeHeader || scrolled === activeWrapper).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('click does not throw when scrollIntoView is unavailable (jsdom)', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(runningState());
    const target = stripOf(panel)!;
    const button = target.matches('button') ? target : target.querySelector<HTMLElement>('button[data-action="goto-active"]')!;
    expect(() => button.click()).not.toThrow();
  });

  it('re-renders the strip in French after refreshLocale', () => {
    const { panel } = makePanel();
    const state = runningState();
    panel.show();
    panel.update(state);
    const en = stripOf(panel)!.textContent;
    try {
      setLocale('fr');
      panel.refreshLocale();
      panel.update(state);
      const fr = stripOf(panel)!.textContent ?? '';
      expect(fr).not.toBe(en);
      expect(fr).toContain('42');
      expect(fr).toContain(formatMoney(5234));
      expect(fr).toContain(t('ui.contracts.active_summary', { count: 2 }));
      expect(fr).toContain(t('ui.contracts.active_deadline', { hours: 42 }));
    } finally {
      setLocale('en');
    }
  });

  it('has English label and deadline keys with exact strings', () => {
    setLocale('en');
    expect(t('ui.contracts.active_summary', { count: 3 })).toBe('Running · 3');
    expect(t('ui.contracts.active_deadline', { hours: 17 })).toBe('Due in 17h');
  });

  it('has French label and deadline keys with exact strings', () => {
    try {
      setLocale('fr');
      expect(t('ui.contracts.active_summary', { count: 3 })).toBe('En cours · 3');
      expect(t('ui.contracts.active_deadline', { hours: 17 })).toBe('Échéance dans 17h');
    } finally {
      setLocale('en');
    }
  });

  it('renders label, time and penalty as three ordered spans', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(runningState());
    const kids = Array.from(stripOf(panel)!.children) as HTMLElement[];
    expect(kids).toHaveLength(3);
    expect(kids[0]!.classList.contains('bs-contract-active-summary-label')).toBe(true);
    expect(kids[0]!.textContent).toBe(t('ui.contracts.active_summary', { count: 2 }));
    expect(kids[1]!.classList.contains('bs-contract-active-summary-deadline')).toBe(true);
    expect(kids[1]!.textContent).toBe(t('ui.contracts.active_deadline', { hours: 42 }));
    expect(kids[2]!.textContent).toContain(formatMoney(5234));
  });

  it('omits the penalty span when only rubble contracts run, leaving label and time', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.active.push(makeContract({ id: 9, type: 'rubble_disposal', materialId: '', penaltyAmount: 777 }));
    panel.show();
    panel.update(state);
    expect(stripOf(panel)!.children).toHaveLength(2);
  });

  describe('long deadline (2151h) never truncates the time', () => {
    function longState(): GameState {
      const state = makeState();
      state.tickCount = 0;
      state.contracts.active.push(makeContract({ id: 31, acceptedAtTick: 0, deadlineTicks: 2151, penaltyAmount: 67518 }));
      return state;
    }

    function check(timeText: string): void {
      const { panel } = makePanel();
      panel.show();
      panel.update(longState());
      const strip = stripOf(panel)!;
      const label = strip.querySelector<HTMLElement>('.bs-contract-active-summary-label')!;
      const time = strip.querySelector<HTMLElement>('.bs-contract-active-summary-deadline')!;
      expect(label).not.toBeNull();
      expect(time).not.toBeNull();
      expect(time).not.toBe(label);
      expect(label.contains(time)).toBe(false);
      expect(time.textContent).toBe(timeText);
      expect(time.textContent).toContain('2151h');
      expect(label.textContent).not.toContain('2151');
      expect(time.style.flexShrink).toBe('0');
      expect(time.style.whiteSpace).toBe('nowrap');
      expect(time.style.textOverflow).toBe('');
      expect(label.style.textOverflow).toBe('ellipsis');
      expect(label.style.minWidth).toBe('0px');
      expect(label.style.overflow).toBe('hidden');
      expect(label.style.whiteSpace).toBe('nowrap');
      expect(strip.textContent).toContain(formatMoney(67518));
    }

    it('EN: time span is its own non-shrinking element', () => {
      setLocale('en');
      check('Due in 2151h');
    });

    it('FR: time span is its own non-shrinking element', () => {
      try {
        setLocale('fr');
        check('Échéance dans 2151h');
      } finally {
        setLocale('en');
      }
    });
  });

  it('hourly refresh changes the time text and colour while the label and strip stay', () => {
    const { panel } = makePanel();
    const state = runningState();
    panel.show();
    panel.update(state);
    const strip = stripOf(panel)!;
    const label = strip.querySelector<HTMLElement>('.bs-contract-active-summary-label')!;
    const time = strip.querySelector<HTMLElement>('.bs-contract-active-summary-deadline')!;
    const labelText = label.textContent;
    expect(time.textContent).toBe('Due in 42h');

    state.tickCount += 5;
    panel.update(state);

    expect(stripOf(panel)).toBe(strip);
    expect(strip.querySelector('.bs-contract-active-summary-label')).toBe(label);
    expect(strip.querySelector('.bs-contract-active-summary-deadline')).toBe(time);
    expect(label.textContent).toBe(labelText);
    expect(time.textContent).toBe('Due in 37h');
  });

  it('hourly refresh recolours the time span as urgency rises', () => {
    const { panel } = makePanel();
    const state = runningState();
    panel.show();
    panel.update(state);
    const time = stripOf(panel)!.querySelector<HTMLElement>('.bs-contract-active-summary-deadline')!;
    const before = time.style.color;
    state.tickCount = 50; // soonest contract: 2 of 52 ticks left
    panel.update(state);
    expect(time.style.color).not.toBe(before);
    expect(time.style.color).toContain('critical');
  });
});


// ── Market strip, buyer badges and locked tiers on progression sites (#1931) ──

describe('ContractsPanel — market strip (progression)', () => {
  const STRIP = '[id="bs-contract-market"]';

  function progressionState(grade = 0): GameState {
    const state = makeState();
    state.grade = { ...createGradeState(), grade };
    state.tickCount = 100;
    return state;
  }

  function render(state: GameState): { panel: ContractsPanel } {
    const { panel } = makePanel();
    panel.show();
    panel.update(state);
    return { panel };
  }

  const rowOf = (panel: ContractsPanel, ore: string): HTMLElement =>
    panel.root.querySelector<HTMLElement>(`${STRIP} .bs-market-row[data-ore="${ore}"]`)!;

  /** Saturate `ore` to `level` as of the state's current tick. */
  const saturate = (state: GameState, ore: string, level: number): void => {
    state.saturation = { ...(state.saturation ?? {}), [ore]: { level, tick: state.tickCount } };
  };

  describe('buyer badge', () => {
    it.each(BUYER_TIERS.map(b => b.id))('offer card shows the %s badge with the buyer name', (id) => {
      const state = progressionState();
      state.contracts.available.push(makeContract({ id: 3, buyerTier: id }));
      const { panel } = render(state);
      const badge = panel.root.querySelector<HTMLElement>(
        `[data-contract-id="3"] .bs-contract-buyer-badge[data-buyer-tier="${id}"]`,
      );
      expect(badge).not.toBeNull();
      expect(badge!.textContent).toBe(t(buyerTierNameKey(id)));
    });

    it('gives each tier a badge of its own look', () => {
      const state = progressionState();
      BUYER_TIERS.forEach((b, i) => state.contracts.available.push(makeContract({ id: i + 1, buyerTier: b.id })));
      const { panel } = render(state);
      const styles = BUYER_TIERS.map(b => panel.root.querySelector<HTMLElement>(
        `.bs-contract-buyer-badge[data-buyer-tier="${b.id}"]`,
      )!.getAttribute('style'));
      expect(new Set(styles).size).toBe(BUYER_TIERS.length);
    });

    it('an offer without a buyer tier (rubble clearance) carries no badge', () => {
      const state = progressionState();
      state.contracts.available.push(makeContract({ id: 4, type: 'rubble_disposal', materialId: '' }));
      const { panel } = render(state);
      expect(panel.root.querySelector('.bs-contract-buyer-badge')).toBeNull();
    });

    it('a non-progression site shows no badge even on a tiered offer', () => {
      const state = makeState();
      state.contracts.available.push(makeContract({ id: 3, buyerTier: 'regional' }));
      const { panel } = render(state);
      expect(panel.root.querySelector('.bs-contract-buyer-badge')).toBeNull();
    });
  });

  describe('strip layout', () => {
    it('sits first in the panel body', () => {
      const { panel } = render(progressionState());
      expect(getBodyEl(panel).firstElementChild!.id).toBe('bs-contract-market');
    });

    it('has one row per ore the site yields, in site order', () => {
      const state = progressionState();
      const { panel } = render(state);
      const rows = Array.from(panel.root.querySelectorAll<HTMLElement>(`${STRIP} .bs-market-row`));
      expect(rows.map(r => r.dataset['ore'])).toEqual([...resolveContractOres(state)]);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('titles the strip', () => {
      const { panel } = render(progressionState());
      expect(panel.root.querySelector(STRIP)!.textContent).toContain(t('ui.contracts.market_title'));
    });

    it('each row has a trend and a saturation bar', () => {
      const state = progressionState();
      const { panel } = render(state);
      for (const ore of resolveContractOres(state)) {
        expect(rowOf(panel, ore).querySelector('.bs-market-trend[data-trend-pct]')).not.toBeNull();
        expect(rowOf(panel, ore).querySelector('.bs-market-sat')).not.toBeNull();
      }
    });

    it('does not move the existing sections out of order', () => {
      const { panel } = render(progressionState());
      const kids = Array.from(getBodyEl(panel).children) as HTMLElement[];
      const pos = (key: string) => kids.findIndex(k => k.dataset['scrollKey'] === key);
      expect(pos('available')).toBeLessThan(pos('active'));
      expect(pos('active')).toBeLessThan(pos('closed'));
    });
  });

  describe('trend from saturation', () => {
    it('reads -20 at saturation 0.4, matching oreSaturationTrend', () => {
      const state = progressionState();
      saturate(state, 'dirtite', 0.4);
      const { panel } = render(state);
      const trend = rowOf(panel, 'dirtite').querySelector<HTMLElement>('.bs-market-trend')!;
      expect(oreSaturationTrend('dirtite', 0.4, 1).pct).toBe(-20);
      expect(trend.dataset['trendPct']).toBe('-20');
      expect(trend.textContent).toContain('20');
    });

    it('prints the trend through the market_trend key', () => {
      const state = progressionState();
      saturate(state, 'dirtite', 0.4);
      const { panel } = render(state);
      const trend = rowOf(panel, 'dirtite').querySelector<HTMLElement>('.bs-market-trend')!;
      expect(trend.textContent).toContain(t('ui.contracts.market_trend', { pct: -20 }));
    });

    it('an unsold ore reads 0', () => {
      const { panel } = render(progressionState());
      const trend = rowOf(panel, 'dirtite').querySelector<HTMLElement>('.bs-market-trend')!;
      expect(trend.dataset['trendPct']).toBe('0');
    });

    it('decays: a stale entry reads the decayed saturation, not the stored level', () => {
      const state = progressionState();
      state.saturation = { dirtite: { level: 0.4, tick: 100 - 500 } }; // one half-life ago -> 0.2
      const { panel } = render(state);
      expect(rowOf(panel, 'dirtite').querySelector<HTMLElement>('.bs-market-trend')!.dataset['trendPct'])
        .toBe(String(oreSaturationTrend('dirtite', 0.2, 1).pct));
    });

    it('saturates one ore without touching the others', () => {
      const state = progressionState();
      saturate(state, 'dirtite', 0.6);
      const { panel } = render(state);
      for (const ore of resolveContractOres(state).filter(o => o !== 'dirtite')) {
        expect(rowOf(panel, ore).querySelector<HTMLElement>('.bs-market-trend')!.dataset['trendPct']).toBe('0');
      }
      expect(rowOf(panel, 'dirtite').querySelector<HTMLElement>('.bs-market-trend')!.dataset['trendPct']).toBe('-30');
    });

    it('never prints negative zero (a sub-percent discount)', () => {
      const state = progressionState();
      saturate(state, 'dirtite', 0.005); // factor 0.9975 -> Math.round(-0.25) is -0
      const { panel } = render(state);
      const trend = rowOf(panel, 'dirtite').querySelector<HTMLElement>('.bs-market-trend')!;
      expect(trend.dataset['trendPct']).toBe('0');
      expect(trend.textContent).not.toMatch(/-0(?!\d)/);
      expect(panel.root.querySelector(STRIP)!.textContent).not.toMatch(/-0%/);
    });

    it('carries the saturation bar as a progress element', () => {
      const state = progressionState();
      saturate(state, 'dirtite', 0.4);
      const { panel } = render(state);
      const bar = rowOf(panel, 'dirtite').querySelector<HTMLElement>('.bs-market-sat')!;
      const value = bar instanceof HTMLProgressElement ? bar.value : Number(bar.getAttribute('aria-valuenow'));
      expect(value).toBeCloseTo(0.4, 2);
    });
  });

  describe('tooltip in the game voice', () => {
    const titleAt = (level: number): string => {
      const state = progressionState();
      saturate(state, 'dirtite', level);
      return rowOf(render(state).panel, 'dirtite').title;
    };

    it('has the exact English lines', () => {
      setLocale('en');
      expect(t('ui.contracts.market_tip_flooded')).toBe('Market flooded. The GRX blames you.');
      expect(t('ui.contracts.market_tip_hungry')).toBe('Buyers are hungry.');
      expect(t('ui.contracts.market_tip_steady')).not.toBe('ui.contracts.market_tip_steady');
    });

    it('flooded at 0.5 (boundary) and above', () => {
      expect(titleAt(0.5)).toBe(t('ui.contracts.market_tip_flooded'));
      expect(titleAt(1)).toBe(t('ui.contracts.market_tip_flooded'));
    });

    it('hungry at 0.1 (boundary) and below, and when unsold', () => {
      expect(titleAt(0.1)).toBe(t('ui.contracts.market_tip_hungry'));
      expect(titleAt(0)).toBe(t('ui.contracts.market_tip_hungry'));
    });

    it('steady in between', () => {
      expect(titleAt(0.3)).toBe(t('ui.contracts.market_tip_steady'));
      expect(titleAt(0.49)).toBe(t('ui.contracts.market_tip_steady'));
      expect(titleAt(0.11)).toBe(t('ui.contracts.market_tip_steady'));
    });
  });

  describe('locked tiers row', () => {
    const lockedLine = (id: 'regional' | 'national' | 'global'): string => {
      const tier = BUYER_TIERS.find(b => b.id === id)!;
      const def = gradeDef(tier.unlockGrade);
      return t('ui.contracts.locked_tier', { buyer: t(tier.nameKey), grade: t(def.nameKey, def.nameParams) });
    };
    const lockedText = (grade: number): string | null => {
      const { panel } = render(progressionState(grade));
      return panel.root.querySelector(`${STRIP} .bs-market-locked`)?.textContent ?? null;
    };

    it('names the national board and the grade it needs', () => {
      setLocale('en');
      const text = lockedText(0)!;
      expect(text).toContain('National Ore Railway Board: needs Industrial Pit');
      expect(text).toContain(lockedLine('national'));
    });

    it('at grade 0 lists regional, national and global', () => {
      const text = lockedText(0)!;
      for (const id of ['regional', 'national', 'global'] as const) expect(text).toContain(lockedLine(id));
      expect(text).toContain(t('ui.contracts.locked_tiers', { list: '' }).trim());
    });

    it('at grade 1 the regional buyer is no longer locked', () => {
      const text = lockedText(1)!;
      expect(text).not.toContain(lockedLine('regional'));
      expect(text).toContain(lockedLine('national'));
      expect(text).toContain(lockedLine('global'));
    });

    it('at grade 3 only global is left', () => {
      const text = lockedText(3)!;
      expect(text).not.toContain(lockedLine('national'));
      expect(text).toContain(lockedLine('global'));
    });

    it('is absent once every tier is unlocked (grade 5)', () => {
      expect(lockedText(5)).toBeNull();
    });

    it('updates when the permit grade rises', () => {
      const { panel } = makePanel();
      const state = progressionState(0);
      panel.show();
      panel.update(state);
      state.grade!.grade = 5;
      panel.update(state);
      expect(panel.root.querySelector('.bs-market-locked')).toBeNull();
    });
  });

  describe('non-progression site', () => {
    it('has no strip, no locked row and no badge', () => {
      const state = makeState();
      state.saturation = { dirtite: { level: 0.4, tick: state.tickCount } };
      state.contracts.available.push(makeContract({ id: 1, buyerTier: 'local' }));
      const { panel } = render(state);
      expect(panel.root.querySelector('#bs-contract-market')).toBeNull();
      expect(panel.root.querySelector('.bs-market-locked')).toBeNull();
      expect(panel.root.querySelector('.bs-market-row')).toBeNull();
      expect(panel.root.querySelector('.bs-contract-buyer-badge')).toBeNull();
    });

    it('keeps the storage strip first in the body', () => {
      const { panel } = render(makeState());
      expect(getBodyEl(panel).firstElementChild!.querySelector('[data-action="goto-ops"]')).not.toBeNull();
    });
  });

  describe('re-rendering', () => {
    it('a sale changes the shown percentage and rebuilds the strip', () => {
      const { panel } = makePanel();
      const state = progressionState();
      saturate(state, 'dirtite', 0.4);
      panel.show();
      panel.update(state);
      const before = panel.root.querySelector(STRIP);

      saturate(state, 'dirtite', 0.6);
      panel.update(state);

      expect(panel.root.querySelector(STRIP)).not.toBe(before);
      expect(rowOf(panel, 'dirtite').querySelector<HTMLElement>('.bs-market-trend')!.dataset['trendPct']).toBe('-30');
    });

    it('decay alone, within the same whole percent, does not re-render', () => {
      const { panel } = makePanel();
      const state = progressionState();
      saturate(state, 'dirtite', 0.4);
      panel.show();
      panel.update(state);
      const before = panel.root.querySelector(STRIP);
      const row = rowOf(panel, 'dirtite');

      state.tickCount += 1; // 0.4 * 0.5^(1/500) -> still -20%
      panel.update(state);

      expect(panel.root.querySelector(STRIP)).toBe(before);
      expect(rowOf(panel, 'dirtite')).toBe(row);
    });

    it('decay across a whole percent does re-render', () => {
      const { panel } = makePanel();
      const state = progressionState();
      saturate(state, 'dirtite', 0.4);
      panel.show();
      panel.update(state);

      state.tickCount += 500; // one half-life -> 0.2 -> -10%
      panel.update(state);

      expect(rowOf(panel, 'dirtite').querySelector<HTMLElement>('.bs-market-trend')!.dataset['trendPct']).toBe('-10');
    });

    it('refreshLocale re-renders the strip in French', () => {
      const { panel } = makePanel();
      const state = progressionState();
      panel.show();
      panel.update(state);
      const en = panel.root.querySelector(STRIP)!.textContent;
      try {
        setLocale('fr');
        panel.refreshLocale();
        panel.update(state);
        expect(panel.root.querySelector(STRIP)!.textContent).not.toBe(en);
      } finally {
        setLocale('en');
      }
    });
  });
});
